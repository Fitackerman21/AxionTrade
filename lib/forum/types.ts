/**
 * P0 types for the Axion AI forum. See docs/ai-forum-spec.md.
 *
 * Everything the room knows is derived from the turn log, so these shapes are
 * the contract between the Director (who schedules), the publisher (the only
 * writer) and the store (which owns durability).
 */

export type PersonaId = string;

/** Which side of a topic's argument a message lands on. */
export type Side = "a" | "b";

/** Display metadata — shared with the chat UI in components/community-chat.tsx. */
export interface PersonaDisplay {
  id: PersonaId;
  name: string;
  role: string;
  /** avatar gradient stops */
  g1: string;
  g2: string;
  /** name colour in the chat */
  color: string;
  online: boolean;
  bot?: boolean;
}

/** The character sheet's mechanically-checkable half (spec §7.1, §8.1). */
export interface PersonaSheet {
  /** one-line stance that anchors every response */
  stance: string;
  register: {
    /** inclusive character band; the Gate's LENGTH check reads the persona's own envelope */
    minChars: number;
    maxChars: number;
    note: string;
  };
  /** verbal tics and running opinions, re-injected every turn so voice survives compaction */
  quirks: string[];
  /** 3+ real lines used as the voice anchor (spec §8.2 voiceMatch) */
  sampleLines: string[];
}

export interface Persona extends PersonaDisplay {
  sheet: PersonaSheet;
}

export interface Topic {
  id: string;
  title: string;
  /** the two positions, used for stance memory and the anti-collapse rule */
  sides: Record<Side, string>;
  /** the line each side uses when the Director forces a counter-position (spec §6.4) */
  friction: Record<Side, string>;
}

export interface WorldHighlight {
  /** a quotable fact, injected as a WORLD event */
  text: string;
  topicId: string;
  side?: Side;
}

/** Shared read-only substrate — the fourth pillar (spec §5). */
export interface WorldState {
  /** content hash + timestamp; recorded on every turn */
  version: string;
  digest: string;
  highlights: WorldHighlight[];
  account?: { value: number; dayPnl: number; dayPnlPct: number };
  positions?: Array<{
    symbol: string;
    qty: number;
    avg: number;
    last: number;
    upnl: number;
    upnlPct: number;
  }>;
  platform?: { changelog: string[]; knownIssues: string[] };
}

export interface ForumConfig {
  roomId: string;
  permissions: {
    /** sender id -> personas that may reply to that sender */
    allow: Record<string, PersonaId[]>;
    /** always wins over allow */
    deny: Record<string, PersonaId[]>;
    allowSelfReply: boolean;
  };
  scheduling: {
    /** per-persona cooldown, measured in turns */
    minTurnsBetweenPosts: number;
    maxConsecutivePosts: number;
    /** inclusive spread between turns, in seconds */
    gapSec: [number, number];
    /** a WORLD event is due every N turns */
    worldEventEveryTurns: number;
    /** trailing same-side posts before the room must switch sides */
    frictionStreakTurns: number;
    /** how long the room may stay on one topic before rotating */
    topicRotationTurns: number;
  };
  agenda: {
    /** the persona that reports world state and stage directs */
    enginePersona: PersonaId;
    stageDirections: string[];
  };
}

/** The agenda kinds, in precedence order (spec §4). */
export type EventKind = "HUMAN" | "WORLD" | "FRICTION" | "THREAD" | "IDLE";

export interface AgendaEvent {
  kind: EventKind;
  /** why this event won — recorded so scheduling decisions are auditable */
  reason: string;
  /** whose message the room is responding to (a persona id, or an external sender) */
  sender: string;
  topic: Topic;
  side: Side;
  /** the incoming text being responded to, when there is one */
  quoted?: string;
  /** true when this is the engine persona reporting rather than a persona asking */
  fromEngine?: boolean;
}

export interface ForumMessage {
  id: string;
  seq: number;
  t: number;
  sender: string;
  primaryRecipient: string;
  mentions: string[];
  text: string;
  topicId: string;
  side: Side;
  /** true for engine stage directions, which are not a persona reply */
  system: boolean;
}

export type Decision = "APPROVE" | "SKIP";

export interface Attempt {
  n: number;
  decision: Decision;
  /** deterministic failure codes from the Gate (spec §8.1) */
  codes: string[];
  detail?: string;
}

/** One line of log.jsonl. This is the whole room state (spec §13.1). */
export interface TurnRecord {
  seq: number;
  t: number;
  driver: string;
  trigger: EventKind;
  event: { kind: EventKind; reason: string; sender: string; topicId: string; side: Side };
  candidates: PersonaId[];
  ordered: PersonaId[];
  chosen: string | null;
  /** set when the Director had to escalate (spec §6.3) */
  escalated: "pool-widened" | "stage-direction" | null;
  decision: Decision;
  attempts: Attempt[];
  message: ForumMessage | null;
  /** (persona, companion) threads this turn wrote to, per spec §7.4 */
  memoryWrites: string[];
  worldVersion: string;
  note: string | null;
  durationMs: number;
}

export interface Lease {
  owner: string;
  expiresAt: number;
}
