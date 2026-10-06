/**
 * Durable state (spec §3.3, §13.1).
 *
 * The interface exists because the eventual deployment choice matters: a worker
 * on the always-on box uses FileStore against a real filesystem, while a
 * Vercel-hosted reader would need a RemoteStore in front of the same shapes.
 * Nothing above this file knows which one it is talking to.
 *
 * The log is append-only and `seq` is monotonic, so it *is* the room state — no
 * in-memory conversation object survives between turns.
 */

import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { humanMessageRecord } from "./human";
import { PgStore } from "./pg-store";
import type {
  ForumConfig,
  ForumMessage,
  Heartbeat,
  Lease,
  MemoryFile,
  Persona,
  PersonaId,
  Side,
  Topic,
  TurnRecord,
  WorldState,
} from "./types";

export interface ForumStore {
  readonly root: string;
  readConfig(): Promise<ForumConfig>;
  readPersonas(): Promise<Persona[]>;
  readTopics(): Promise<Topic[]>;
  readWorld(): Promise<WorldState>;
  readTurns(limit: number): Promise<TurnRecord[]>;
  readLastTurn(): Promise<TurnRecord | null>;
  /** Only the publisher calls this. */
  appendTurn(record: TurnRecord): Promise<void>;
  /**
   * Remove every turn whose seq is inside `[from, to]`, and return how many went.
   *
   * The log *is* the room's state, so this is irreversible and the room itself never
   * calls it — the only caller is the `forum:prune` tool a person runs on purpose, to
   * take a test run's messages back out of a room they were written into. Gaps are
   * fine: the room moves on from the highest seq it can still see.
   */
  deleteTurns(from: number, to: number): Promise<number>;
  /** The human path: a person speaks, the Director answers next turn. */
  appendHumanMessage(args: HumanMessageArgs): Promise<TurnRecord>;
  /**
   * One (persona, companion) thread of Agent 2's memory (spec §7). Null when the
   * persona has never spoken to that companion, which is the state that makes a
   * file: an untouched thread costs nothing to carry.
   */
  readMemory(persona: PersonaId, companion: string): Promise<MemoryFile | null>;
  /**
   * Replace a thread's file and keep the previous version under `_versions`.
   * Callers write the *whole* file — never a partial update — so a crash can only
   * lose the newest write, not corrupt the thread (§7.5).
   */
  writeMemory(file: MemoryFile): Promise<void>;
  /** The snapshot written before version `version`, for rollback and review. */
  readMemoryVersion(persona: PersonaId, companion: string, version: number): Promise<MemoryFile | null>;
  /** Every thread, newest first — the observability half (`?debug=1`, §13.1). */
  listMemory(persona?: PersonaId): Promise<MemoryFile[]>;
  acquireLease(owner: string, ttlMs: number, now: number): Promise<boolean>;
  releaseLease(owner: string, now: number): Promise<void>;
  readLease(): Promise<Lease | null>;
  /** Liveness of a worker driver, distinct from the per-turn lease. */
  readHeartbeat(): Promise<Heartbeat | null>;
  writeHeartbeat(beat: Heartbeat): Promise<void>;
  clearHeartbeat(owner: string): Promise<void>;
}

export interface HumanMessageArgs {
  text: string;
  /** external sender id, e.g. "human" or a member id */
  sender: string;
  t: number;
  topicId: string;
  side?: Side;
  /** the seq of the message this one is a reply to, when a person quoted one */
  replyToSeq?: number;
}

/** A memory file needs a key that is safe as a path segment and as a row value. */
function memoryFileFor(root: string, persona: PersonaId, companion: string): string {
  const safe = (part: string): string => part.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(root, "memory", safe(persona), `${safe(companion)}.json`);
}

function versionFileFor(
  root: string,
  persona: PersonaId,
  companion: string,
  version: number,
): string {
  const safe = (part: string): string => part.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(root, "memory", "_versions", safe(persona), safe(companion), `v${version}.json`);
}

/** How many superseded versions of a thread are kept (spec §7.5: the last ten). */
export const MEMORY_VERSIONS_KEPT = 10;

async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  // Write-then-rename: a reader either sees the whole previous file or the whole
  // new one, never a half-written thread.
  const temporary = `${file}.new`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

/** The public projection — published messages only, never internals (spec §13.2). */
export function messagesFromTurns(turns: readonly TurnRecord[]): ForumMessage[] {
  const messages: ForumMessage[] = [];
  for (const turn of turns) {
    if (turn.message) messages.push(turn.message);
  }
  return messages;
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

export class FileStore implements ForumStore {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private file(...parts: string[]): string {
    return path.join(this.root, ...parts);
  }

  private async readJson<T>(relative: string, what: string): Promise<T> {
    const raw = await readFile(this.file(relative), "utf8");
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      throw new Error(`forum: ${what} (${relative}) is not valid JSON`, { cause: error });
    }
  }

  async readConfig(): Promise<ForumConfig> {
    const config = await this.readJson<ForumConfig>("config.json", "config");
    if (!config.roomId) throw new Error("forum: config.json is missing roomId");
    if (!config.agenda?.enginePersona) {
      throw new Error("forum: config.json is missing agenda.enginePersona");
    }
    return config;
  }

  async readPersonas(): Promise<Persona[]> {
    const personas = await this.readJson<Persona[]>("personas.json", "roster");
    if (!Array.isArray(personas) || personas.length === 0) {
      throw new Error("forum: personas.json must contain a non-empty roster");
    }
    return personas;
  }

  async readTopics(): Promise<Topic[]> {
    const topics = await this.readJson<Topic[]>("topics/deck.json", "topic deck");
    if (!Array.isArray(topics) || topics.length === 0) {
      throw new Error("forum: topics/deck.json must contain at least one topic");
    }
    return topics;
  }

  async readWorld(): Promise<WorldState> {
    const world = await this.readJson<WorldState>("world/latest.json", "world state");
    if (!world.version) throw new Error("forum: world/latest.json is missing version");
    return world;
  }

  async readTurns(limit = Number.POSITIVE_INFINITY): Promise<TurnRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.file("log.jsonl"), "utf8");
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }

    const lines = raw.split("\n").filter((line) => line.trim() !== "");
    const records: TurnRecord[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      try {
        records.push(JSON.parse(line) as TurnRecord);
      } catch (error) {
        // A truncated final line is a half-finished append — the safe move is to
        // drop it and carry on (spec §10.12). Corruption anywhere else is real.
        if (i === lines.length - 1) {
          console.warn("forum: dropped a truncated final line from log.jsonl");
          continue;
        }
        throw new Error(`forum: log.jsonl line ${i + 1} is corrupt`, { cause: error });
      }
    }

    if (limit === Number.POSITIVE_INFINITY || records.length <= limit) return records;
    return records.slice(-limit);
  }

  async readLastTurn(): Promise<TurnRecord | null> {
    const turns = await this.readTurns(1);
    return turns[turns.length - 1] ?? null;
  }

  async appendTurn(record: TurnRecord): Promise<void> {
    await mkdir(this.root, { recursive: true });
    // One write of one line: a reader never sees a partial record in the middle
    // of the log, only possibly a truncated tail.
    await appendFile(this.file("log.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  }

  async appendHumanMessage(args: HumanMessageArgs): Promise<TurnRecord> {
    const last = await this.readLastTurn();
    const seq = (last?.seq ?? 0) + 1;
    const record = humanMessageRecord(seq, args);
    await this.appendTurn(record);
    return record;
  }

  async deleteTurns(from: number, to: number): Promise<number> {
    const turns = await this.readTurns(Number.POSITIVE_INFINITY);
    const kept = turns.filter((turn) => turn.seq < from || turn.seq > to);
    const removed = turns.length - kept.length;
    if (removed === 0) return 0;

    // Rewrite-then-rename, the same discipline as a memory write: a reader sees the
    // old log or the new one, never a half-written one.
    await mkdir(this.root, { recursive: true });
    const target = this.file("log.jsonl");
    const temp = `${target}.tmp`;
    await writeFile(temp, kept.map((turn) => `${JSON.stringify(turn)}\n`).join(""), "utf8");
    await rename(temp, target);
    return removed;
  }

  async readLease(): Promise<Lease | null> {
    try {
      return JSON.parse(await readFile(this.file("lease.json"), "utf8")) as Lease;
    } catch {
      return null;
    }
  }

  async acquireLease(owner: string, ttlMs: number, now: number): Promise<boolean> {
    await mkdir(this.root, { recursive: true });
    const payload = JSON.stringify({ owner, expiresAt: now + ttlMs } satisfies Lease);

    // "wx" is an atomic exclusive create, which is the compare-and-swap the
    // spec asks for: two drivers racing cannot both win it.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await writeFile(this.file("lease.json"), payload, { encoding: "utf8", flag: "wx" });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw error;

        const held = await this.readLease();
        if (held && held.expiresAt > now) return false;

        // Expired or unreadable: reclaim. Losing the race here just means the
        // other driver created it again and we see EEXIST on the next pass.
        await unlink(this.file("lease.json")).catch(() => undefined);
      }
    }

    return false;
  }

  async releaseLease(owner: string): Promise<void> {
    const held = await this.readLease();
    if (held?.owner === owner) {
      await unlink(this.file("lease.json")).catch(() => undefined);
    }
  }

  async readHeartbeat(): Promise<Heartbeat | null> {
    try {
      return JSON.parse(await readFile(this.file("heartbeat.json"), "utf8")) as Heartbeat;
    } catch {
      return null;
    }
  }

  async writeHeartbeat(beat: Heartbeat): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.file("heartbeat.json"), JSON.stringify(beat), "utf8");
  }

  async clearHeartbeat(owner: string): Promise<void> {
    const held = await this.readHeartbeat();
    if (held?.owner === owner) {
      await unlink(this.file("heartbeat.json")).catch(() => undefined);
    }
  }

  async readMemory(persona: PersonaId, companion: string): Promise<MemoryFile | null> {
    return readJsonFile<MemoryFile>(memoryFileFor(this.root, persona, companion));
  }

  /**
   * Snapshot, then replace. The old file is kept under `_versions/v<old>` before the
   * new one lands, so a bad compaction is one copy away from being undone (§7.5).
   */
  async writeMemory(file: MemoryFile): Promise<void> {
    const target = memoryFileFor(this.root, file.persona, file.companion);
    const previous = await readJsonFile<MemoryFile>(target);

    // Only a genuine version bump is worth keeping: an ordinary per-turn fold
    // rewrites the same version, and snapshotting those would fill the history
    // with mid-stream buffers and — because the snapshot is keyed by the version —
    // would let a stale one stand in for the real pre-compaction file, which is the
    // state a rollback must restore (spec §7.5).
    if (previous && file.version > previous.version) {
      await writeJsonFile(versionFileFor(this.root, file.persona, file.companion, previous.version), previous);
    }
    await writeJsonFile(target, file);

    // Keep the version history bounded; the oldest snapshot is the one to drop.
    const directory = path.join(this.root, "memory", "_versions", file.persona, file.companion);
    const snapshots = (await readdir(directory).catch(() => [] as string[]))
      .filter((name) => /^v\d+\.json$/.test(name))
      .sort((a, b) => Number(a.slice(1, -5)) - Number(b.slice(1, -5)));
    for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - MEMORY_VERSIONS_KEPT))) {
      await unlink(path.join(directory, stale)).catch(() => undefined);
    }
  }

  async readMemoryVersion(
    persona: PersonaId,
    companion: string,
    version: number,
  ): Promise<MemoryFile | null> {
    return readJsonFile<MemoryFile>(versionFileFor(this.root, persona, companion, version));
  }

  async listMemory(persona?: PersonaId): Promise<MemoryFile[]> {
    const base = path.join(this.root, "memory");
    const personas = persona ? [persona] : await readdir(base).catch(() => [] as string[]);
    const files: MemoryFile[] = [];

    for (const id of personas) {
      if (id === "_versions") continue;
      const names = await readdir(path.join(base, id)).catch(() => [] as string[]);
      for (const name of names.filter((n) => n.endsWith(".json"))) {
        const file = await readMemoryFileAt(path.join(base, id, name));
        if (file) files.push(file);
      }
    }

    return files.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

async function readMemoryFileAt(file: string): Promise<MemoryFile | null> {
  return readJsonFile<MemoryFile>(file);
}

export const DEFAULT_FORUM_ROOT = "data/forum";

/** Where the room lives. FORUM_ROOT lets an always-on box point somewhere else. */
export function forumRoot(): string {
  const configured = process.env.FORUM_ROOT;
  return configured ? path.resolve(configured) : path.join(process.cwd(), DEFAULT_FORUM_ROOT);
}

/**
 * The store the app and the tools use unless told otherwise.
 *
 * `DATABASE_URL` selects Postgres. That is the deployment case: a serverless host
 * has a read-only filesystem and no shared instance, so a log on disk is neither
 * writable nor visible to the next request (spec §3.3). Without it the room is a
 * directory, which is what local development and the CLI tools want.
 */
export function openForumStore(root: string = forumRoot()): ForumStore {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return new PgStore({ connectionString: url });
  return new FileStore(root);
}
