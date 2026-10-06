/**
 * Postgres-backed store (spec §3.3) — the room on a serverless host.
 *
 * `FileStore` is correct on an always-on box and is what the tools use, but it
 * cannot work on Vercel: the deployment filesystem is read-only and every
 * invocation gets its own instance, so a log on disk is neither writable nor
 * shared. Every page visit also wakes the room through bounded catch-up, so
 * "the reader is the driver" only works if the state is shared.
 *
 * This store keeps the same `ForumStore` contract over three tables. The two
 * things the file version got for free are the interesting ones:
 *
 *   - **The lease** is a conditional upsert. `insert … on conflict do update …
 *     where expires_at <= now` is the compare-and-swap `open(…, "wx")` provided,
 *     so two drivers racing still cannot both win.
 *   - **The log** uses `seq` as the primary key, which makes it append-only and
 *     monotonic by construction rather than by convention.
 *
 * The room *definition* (config, roster, topics, world) is not stored here — it
 * ships with the build, see `room-data.ts`.
 */

import { Pool } from "pg";

import { humanMessageRecord } from "./human";
import { ROOM_CONFIG, ROOM_PERSONAS, ROOM_TOPICS, ROOM_WORLD } from "./room-data";
import { MEMORY_VERSIONS_KEPT } from "./store";
import type { ForumStore, HumanMessageArgs } from "./store";
import type {
  ForumConfig,
  Heartbeat,
  Lease,
  MemoryFile,
  Persona,
  PersonaId,
  Topic,
  TurnRecord,
  WorldState,
} from "./types";

/**
 * One row per turn, plus the two single-row coordination records. `seq` is the
 * primary key, so a duplicate append is rejected instead of corrupting the log.
 */
const SCHEMA = `
  create table if not exists forum_turns (
    seq    bigint primary key,
    record jsonb  not null
  );
  create table if not exists forum_lease (
    id         text   primary key,
    owner      text   not null,
    expires_at bigint not null
  );
  create table if not exists forum_heartbeat (
    id         text   primary key,
    owner      text   not null,
    expires_at bigint not null
  );
  -- Agent 2's memory files (spec §7): one row per (persona, companion) thread,
  -- plus the snapshots that make a bad compaction reversible.
  create table if not exists forum_memory (
    persona    text   not null,
    companion  text   not null,
    version    int    not null default 0,
    file       jsonb  not null,
    updated_at bigint not null,
    primary key (persona, companion)
  );
  create table if not exists forum_memory_versions (
    persona    text  not null,
    companion  text  not null,
    version    int   not null,
    file       jsonb not null,
    primary key (persona, companion, version)
  );
`;

const LEASE_ID = "turn";
const HEARTBEAT_ID = "worker";
/** Postgres `unique_violation`; two writers picked the same `seq`. */
const UNIQUE_VIOLATION = "23505";

export interface PgStoreOptions {
  /** a `postgres://…` URL; TLS is enabled automatically for a non-local host */
  connectionString: string;
  /** keep small: serverless instances are many and short-lived */
  maxConnections?: number;
}

export class PgStore implements ForumStore {
  readonly root = "postgres";

  private readonly pool: Pool;
  /** Resolved once per instance, so every cold start guarantees the tables exist. */
  private ready: Promise<void> | null = null;

  constructor(options: PgStoreOptions) {
    const isLocal = /(^|@)(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(options.connectionString);
    const sslDisabled =
      process.env.PGSSLMODE === "disable" || options.connectionString.includes("sslmode=disable");

    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 4,
      // A managed server presents a certificate the driver has no local root for.
      // The connection is still encrypted, which is the part that matters here.
      ssl: !isLocal && !sslDisabled ? { rejectUnauthorized: false } : undefined,
    });
  }

  /** Idempotent schema creation. A transient failure is retried on the next call. */
  private async ensure(): Promise<void> {
    if (this.ready) return this.ready;
    const init = this.pool.query(SCHEMA).then(() => undefined);
    this.ready = init.catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  async readConfig(): Promise<ForumConfig> {
    const config = ROOM_CONFIG;
    if (!config.roomId) throw new Error("forum: config.json is missing roomId");
    if (!config.agenda?.enginePersona) {
      throw new Error("forum: config.json is missing agenda.enginePersona");
    }
    return config;
  }

  async readPersonas(): Promise<Persona[]> {
    const personas = ROOM_PERSONAS;
    if (!Array.isArray(personas) || personas.length === 0) {
      throw new Error("forum: personas.json must contain a non-empty roster");
    }
    return personas;
  }

  async readTopics(): Promise<Topic[]> {
    const topics = ROOM_TOPICS;
    if (!Array.isArray(topics) || topics.length === 0) {
      throw new Error("forum: topics/deck.json must contain at least one topic");
    }
    return topics;
  }

  async readWorld(): Promise<WorldState> {
    const world = ROOM_WORLD;
    if (!world.version) throw new Error("forum: world/latest.json is missing version");
    return world;
  }

  async readTurns(limit = Number.POSITIVE_INFINITY): Promise<TurnRecord[]> {
    await this.ensure();

    if (limit === Number.POSITIVE_INFINITY) {
      const { rows } = await this.pool.query<{ record: TurnRecord }>(
        "select record from forum_turns order by seq asc",
      );
      return rows.map((row) => row.record);
    }

    if (limit <= 0) return [];

    // Newest N, then presented in log order like every other reader.
    const { rows } = await this.pool.query<{ record: TurnRecord }>(
      "select record from (select record, seq from forum_turns order by seq desc limit $1) newest order by seq asc",
      [limit],
    );
    return rows.map((row) => row.record);
  }

  async readLastTurn(): Promise<TurnRecord | null> {
    await this.ensure();
    const { rows } = await this.pool.query<{ record: TurnRecord }>(
      "select record from forum_turns order by seq desc limit 1",
    );
    return rows[0]?.record ?? null;
  }

  async appendTurn(record: TurnRecord): Promise<void> {
    await this.ensure();
    try {
      await this.pool.query("insert into forum_turns (seq, record) values ($1, $2)", [
        record.seq,
        JSON.stringify(record),
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new Error(`forum: turn ${record.seq} is already in the log`);
      }
      throw error;
    }
  }

  async appendHumanMessage(args: HumanMessageArgs): Promise<TurnRecord> {
    await this.ensure();

    // Two people can post at once, so the seq is chosen and then claimed; losing
    // the race means recomputing rather than dropping the message.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const last = await this.readLastTurn();
      const seq = (last?.seq ?? 0) + 1;
      const record = humanMessageRecord(seq, args);
      try {
        await this.pool.query("insert into forum_turns (seq, record) values ($1, $2)", [
          seq,
          JSON.stringify(record),
        ]);
        return record;
      } catch (error) {
        if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
      }
    }

    throw new Error("forum: could not append the message — the log is too busy");
  }

  /**
   * Atomic compare-and-swap. Updating only an expired row is what makes this
   * safe: a live lease matches nothing and the insert/update reports zero rows.
   */
  async acquireLease(owner: string, ttlMs: number, now: number): Promise<boolean> {
    await this.ensure();
    const { rowCount } = await this.pool.query(
      `insert into forum_lease (id, owner, expires_at)
       values ($1, $2, $3)
       on conflict (id) do update
         set owner = excluded.owner, expires_at = excluded.expires_at
         where forum_lease.expires_at <= $4`,
      [LEASE_ID, owner, now + ttlMs, now],
    );
    return rowCount === 1;
  }

  async releaseLease(owner: string): Promise<void> {
    await this.ensure();
    await this.pool.query("delete from forum_lease where id = $1 and owner = $2", [
      LEASE_ID,
      owner,
    ]);
  }

  async readLease(): Promise<Lease | null> {
    await this.ensure();
    const { rows } = await this.pool.query<{ owner: string; expires_at: string }>(
      "select owner, expires_at from forum_lease where id = $1",
      [LEASE_ID],
    );
    const row = rows[0];
    return row ? { owner: row.owner, expiresAt: Number(row.expires_at) } : null;
  }

  async readHeartbeat(): Promise<Heartbeat | null> {
    await this.ensure();
    const { rows } = await this.pool.query<{ owner: string; expires_at: string }>(
      "select owner, expires_at from forum_heartbeat where id = $1",
      [HEARTBEAT_ID],
    );
    const row = rows[0];
    return row ? { owner: row.owner, expiresAt: Number(row.expires_at) } : null;
  }

  async writeHeartbeat(beat: Heartbeat): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `insert into forum_heartbeat (id, owner, expires_at)
       values ($1, $2, $3)
       on conflict (id) do update
         set owner = excluded.owner, expires_at = excluded.expires_at`,
      [HEARTBEAT_ID, beat.owner, beat.expiresAt],
    );
  }

  async clearHeartbeat(owner: string): Promise<void> {
    await this.ensure();
    await this.pool.query("delete from forum_heartbeat where id = $1 and owner = $2", [
      HEARTBEAT_ID,
      owner,
    ]);
  }

  async readMemory(persona: PersonaId, companion: string): Promise<MemoryFile | null> {
    await this.ensure();
    const { rows } = await this.pool.query<{ file: MemoryFile }>(
      "select file from forum_memory where persona = $1 and companion = $2",
      [persona, companion],
    );
    return rows[0]?.file ?? null;
  }

  /**
   * Snapshot-then-replace, in one transaction: a reader sees either the whole
   * previous thread or the whole new one, and a crash cannot leave the row and its
   * history disagreeing (spec §7.5, "never truncate-then-write").
   */
  async writeMemory(file: MemoryFile): Promise<void> {
    await this.ensure();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const previous = await client.query<{ file: MemoryFile; version: number }>(
        "select file, version from forum_memory where persona = $1 and companion = $2 for update",
        [file.persona, file.companion],
      );
      const old = previous.rows[0];
      // Only a genuine version bump is worth keeping: an ordinary per-turn fold
      // rewrites the same version, and snapshotting those would fill the history
      // with mid-stream buffers and — because the key is the version — would let a
      // stale one shadow the real pre-compaction file, which is the state a
      // rollback must restore (spec §7.5).
      if (old && file.version > old.version) {
        await client.query(
          `insert into forum_memory_versions (persona, companion, version, file)
           values ($1, $2, $3, $4)
           on conflict (persona, companion, version) do nothing`,
          [file.persona, file.companion, old.version, old.file],
        );
      }

      await client.query(
        `insert into forum_memory (persona, companion, version, file, updated_at)
         values ($1, $2, $3, $4, $5)
         on conflict (persona, companion) do update
           set version = excluded.version, file = excluded.file, updated_at = excluded.updated_at`,
        [file.persona, file.companion, file.version, JSON.stringify(file), file.updatedAt],
      );

      // Bounded history: keep the newest snapshots, drop the rest.
      await client.query(
        `delete from forum_memory_versions
          where persona = $1 and companion = $2
            and version <= (select max(version) from forum_memory_versions
                             where persona = $1 and companion = $2) - $3`,
        [file.persona, file.companion, MEMORY_VERSIONS_KEPT],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async readMemoryVersion(
    persona: PersonaId,
    companion: string,
    version: number,
  ): Promise<MemoryFile | null> {
    await this.ensure();
    const { rows } = await this.pool.query<{ file: MemoryFile }>(
      "select file from forum_memory_versions where persona = $1 and companion = $2 and version = $3",
      [persona, companion, version],
    );
    return rows[0]?.file ?? null;
  }

  async listMemory(persona?: PersonaId): Promise<MemoryFile[]> {
    await this.ensure();
    const { rows } = persona
      ? await this.pool.query<{ file: MemoryFile }>(
          "select file from forum_memory where persona = $1 order by updated_at desc",
          [persona],
        )
      : await this.pool.query<{ file: MemoryFile }>(
          "select file from forum_memory order by updated_at desc",
        );
    return rows.map((row) => row.file);
  }

  /** Release the pool. Not part of `ForumStore`; used by tests and short-lived tools. */
  async end(): Promise<void> {
    await this.pool.end();
  }
}
