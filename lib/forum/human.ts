/**
 * The turn a person's message becomes (spec §9, §13.1).
 *
 * Shared so a human message is recorded identically whether the room runs on a
 * filesystem or in Postgres — the log is the same contract either way, and a
 * second implementation drifting here would make replays incomparable.
 */

import type { HumanMessageArgs } from "./store";
import type { Side, TurnRecord } from "./types";

export function humanMessageRecord(seq: number, args: HumanMessageArgs): TurnRecord {
  const side: Side = args.side ?? "a";

  return {
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
}
