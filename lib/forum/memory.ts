/**
 * Memory files — Agent 2's substrate (spec §7, and step 8 of the workflow).
 *
 * The turn log is *shared*: everybody reads the same scrollback, which is why the
 * Voice is handed the last ten messages every turn. A memory file is the other
 * half — one per (persona, companion), so a persona can hold what it said to one
 * person an hour ago, and cannot see what it said to somebody else.
 *
 * Three tiers exist in the spec; two are built here, deliberately:
 *
 *   - **recent** — verbatim entries, capped at `recentTurns`. Exact voice.
 *   - **digest** — one rolling paragraph per thread, written by the Archivist
 *     (Agent 2) when the buffer crosses the threshold. Only one, replaced on
 *     compaction, so the per-turn cost is bounded.
 *
 * The structured `episodic` tier and its lexical retrieval are designed in §7.2 and
 * not implemented: nothing here pretends otherwise, and `needsCompaction` is the
 * seam where the third tier would join.
 *
 * Everything in this module is pure. Reading and writing is the store's job, and
 * deciding *when* to compact is `archivist.ts`.
 */

import type { MemoryConfig, MemoryEntry, MemoryFile, PersonaId } from "./types";

/** Rough token estimate (chars/4), the same one the spec uses at v1. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** The identity of a thread: one persona's view of one companion. */
export function memoryKey(persona: PersonaId, companion: string): string {
  return `${persona}:${companion}`;
}

/** How the companion is described to the model — "human" is a room id, not a name. */
export function companionLabel(companion: string): string {
  return companion === "human" ? "the visitor (the person who posts as You)" : companion;
}

export function emptyMemory(persona: PersonaId, companion: string, now: number): MemoryFile {
  return {
    persona,
    companion,
    seq: 0,
    recent: [],
    digest: null,
    version: 0,
    updatedAt: now,
    compactions: 0,
  };
}

/** What a turn contributes to a companion's thread: what they said, what you said. */
export interface MemoryTurn {
  seq: number;
  t: number;
  /** the incoming line, when the turn is answering one */
  incoming?: { text: string; topicId?: string };
  /** the published line */
  outgoing: { text: string; topicId?: string };
}

/**
 * Fold one published turn into the file.
 *
 * Both sides are recorded (§7.4) — a reply that does not remember the message it
 * answered is a quote, not a conversation. The verbatim buffer is trimmed to
 * `recentTurns`; what falls off is only recoverable through the digest, which is
 * exactly what compaction is for.
 */
export function foldTurn(
  file: MemoryFile | null,
  persona: PersonaId,
  companion: string,
  turn: MemoryTurn,
  config: MemoryConfig,
): MemoryFile {
  const base = file ?? emptyMemory(persona, companion, turn.t);
  const added: MemoryEntry[] = [];

  if (turn.incoming && turn.incoming.text.trim() !== "") {
    added.push({
      seq: turn.seq,
      t: turn.t,
      role: "them",
      text: turn.incoming.text.trim(),
      topicId: turn.incoming.topicId,
    });
  }
  if (turn.outgoing.text.trim() !== "") {
    added.push({
      seq: turn.seq,
      t: turn.t,
      role: "me",
      text: turn.outgoing.text.trim(),
      topicId: turn.outgoing.topicId,
    });
  }

  const recent = [...base.recent, ...added].slice(-Math.max(1, config.recentTurns));

  return {
    ...base,
    persona,
    companion,
    seq: Math.max(base.seq, turn.seq),
    recent,
    updatedAt: turn.t,
  };
}

/** The size of one thread, in the units the trigger is written in (spec §7.5). */
export function memoryTokens(file: MemoryFile): number {
  const digest = file.digest ? estimateTokens(file.digest) : 0;
  const recent = file.recent.reduce((total, entry) => total + estimateTokens(entry.text), 0);
  return digest + recent;
}

/** Is this thread over its budget? Ordinary code, checked per thread (§7.5). */
export function needsCompaction(file: MemoryFile, config: MemoryConfig): boolean {
  return memoryTokens(file) > Math.max(1, config.compactionTokens);
}

/**
 * The memory block injected into one Voice call.
 *
 * Entries newer than `olderThanSeq` are skipped because the shared transcript
 * already carries them — the whole point of a per-companion file is what the
 * window cannot show. That keeps the block small and makes it additive rather
 * than a second copy of the last ten messages.
 */
export function injectionText(file: MemoryFile, olderThanSeq: number, limit = 6): string {
  const older = file.recent.filter((entry) => entry.seq < olderThanSeq).slice(-limit);
  const parts: string[] = [];

  if (file.digest) {
    parts.push(`Your notes on earlier conversations with ${file.companion}:`);
    parts.push(file.digest);
  }
  if (older.length > 0) {
    parts.push(`Earlier, with ${file.companion}:`);
    parts.push(
      ...older.map((entry) => `- ${entry.role === "me" ? "you said" : "they said"}: ${entry.text}`),
    );
  }

  return parts.join("\n");
}

/** Keep the Archivist's output a digest rather than a new transcript. */
export function clampDigest(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const cap = Math.max(80, maxChars);
  if (flat.length <= cap) return flat;
  const cut = flat.slice(0, cap);
  const space = cut.lastIndexOf(" ");
  return `${(space > cap * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}
