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
  /**
   * Claims this persona must never make (spec §8.1 CONTINUITY). Plain substrings,
   * matched case-insensitively — e.g. "we are long semis" for a desk that is short.
   */
  forbiddenClaims?: string[];
}

export interface Persona extends PersonaDisplay {
  sheet: PersonaSheet;
  /** the Voice's model id (spec §15); set in P1 when the real Voice lands */
  model?: string;
  /** used when the primary provider is down (spec §10.3) */
  fallbackModel?: string;
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

/**
 * The Gate's tunables (spec §8, §11). Present in config.json so the room's
 * strictness is data, not code.
 */
export interface GateConfig {
  /** "off" skips the Gate entirely; "deterministic" runs only the cheap checks */
  mode: "off" | "deterministic" | "hybrid";
  /** drafts allowed per turn before the turn is recorded as UNPUBLISHED (§8.4) */
  maxAttempts: number;
  /** share of turns that get an LLM check once a persona is warm (§8.3) */
  sampleRate: number;
  /** a persona's first N turns are always checked (§8.3) */
  warmupTurns: number;
  /** how many recent messages REDUNDANCY compares against (§8.1) */
  redundancyWindow: number;
  /** 5-gram Jaccard above this fails REDUNDANCY (§8.1) */
  redundancyThreshold: number;
  /** how many recent messages FORMULAIC compares openers against (§8.1) */
  openerWindow: number;
  /** relative tolerance for numbers attached to tickers (§8.1) */
  numberTolerance: number;
  /** require a responder to share a content token with the message it answers (§8.1) */
  requireAddressee: boolean;
  /** phrases that always fail FORMULAIC (§8.1) */
  bannedPhrases: string[];
  /** judge model id for the LLM half; when unset (or no key) only deterministic runs */
  model?: string;
  /**
   * Ordered judge models, tried in turn when one is rate-limited, blocked or times
   * out (§8.6). Supersedes `model`, which is kept so an older room still loads.
   */
  models?: string[];
  /** how long to wait for the judge before falling back to deterministic (§10.2) */
  timeoutMs: number;
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
  runtime: {
    /** most turns a single catch-up burst may generate */
    catchUpMaxTurns: number;
    /** a gap longer than this is not replayed, it is recapped (spec §3.2) */
    staleAfterMin: number;
    /** how long a worker's heartbeat stays valid without being refreshed */
    heartbeatTtlSec: number;
  };
  /** Optional so a room written before P2 still loads; defaults come from gate.ts */
  gate?: GateConfig;
}

/** Is a worker alive right now? */
export type RoomMode = "live" | "lazy";

/**
 * Written by the worker each loop and cleared on shutdown, so readers can tell
 * a live room from one that is merely being woken by a page visit. Separate from
 * the turn lease on purpose: the lease guards a single turn, the heartbeat says
 * whether a driver exists at all.
 */
export interface Heartbeat {
  owner: string;
  expiresAt: number;
}

/** The agenda kinds, in precedence order (spec §4). */
export type EventKind = "HUMAN" | "RECAP" | "WORLD" | "FRICTION" | "THREAD" | "IDLE";

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
  /**
   * Who writes this turn's message. `engine` means the room is being addressed
   * *by* the engine persona (an opening, a world report, a recap) rather than
   * someone responding to a companion — so no candidate set is consulted.
   */
  authoredBy: "engine" | "responder";
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

/**
 * The final state of a recorded turn. `UNPUBLISHED` is the v0 requirement that a
 * rejected draft is never shown — it is logged for review, with no message.
 */
export type Decision = "APPROVE" | "SKIP" | "UNPUBLISHED";

/** One Gate verdict on one draft (spec §8.3). */
export type AttemptDecision = "APPROVE" | "REVISE" | "REJECT";

export interface Attempt {
  n: number;
  decision: AttemptDecision;
  /** gate codes — deterministic (§8.1) or rubric item names (§8.2) */
  codes: string[];
  detail?: string;
  /** per-item reasons the LLM check returned, when it ran */
  reasons?: Record<string, string>;
}

/** One model call's cost, recorded on the turn that caused it (spec §11). */
export interface TurnUsage {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  estCost: number;
}

/** What the Gate actually did on this turn — auditable without the trace (spec §13.1). */
export interface TurnGate {
  mode: "off" | "deterministic" | "llm";
  model?: string;
  sampled: boolean;
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
  /** the gate's own record of what it did (spec §13.1) */
  gate?: TurnGate;
  /** token/cost accounting for the calls this turn made (spec §11) */
  usage?: TurnUsage[];
  worldVersion: string;
  note: string | null;
  durationMs: number;
}

export interface Lease {
  owner: string;
  expiresAt: number;
}
