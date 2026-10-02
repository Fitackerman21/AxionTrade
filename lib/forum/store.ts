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

import { appendFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ForumConfig,
  ForumMessage,
  Lease,
  Persona,
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
  /** The human path: a person speaks, the Director answers next turn. */
  appendHumanMessage(args: HumanMessageArgs): Promise<TurnRecord>;
  acquireLease(owner: string, ttlMs: number, now: number): Promise<boolean>;
  releaseLease(owner: string, now: number): Promise<void>;
  readLease(): Promise<Lease | null>;
}

export interface HumanMessageArgs {
  text: string;
  /** external sender id, e.g. "human" or a member id */
  sender: string;
  t: number;
  topicId: string;
  side?: Side;
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
    const side: Side = args.side ?? "a";

    const record: TurnRecord = {
      seq,
      t: args.t,
      driver: "human",
      trigger: "HUMAN",
      event: {
        kind: "HUMAN",
        reason: "human input",
        sender: args.sender,
        topicId: args.topicId,
        side,
      },
      candidates: [],
      ordered: [],
      chosen: null,
      escalated: null,
      decision: "APPROVE",
      attempts: [],
      message: {
        id: `m_${seq}`,
        seq,
        t: args.t,
        sender: args.sender,
        primaryRecipient: "",
        mentions: [],
        text: args.text,
        topicId: args.topicId,
        side,
        system: false,
      },
      memoryWrites: [],
      worldVersion: "",
      note: "human input",
      durationMs: 0,
    };

    await this.appendTurn(record);
    return record;
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
}
