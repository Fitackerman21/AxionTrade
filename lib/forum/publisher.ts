/**
 * The publisher — the only component that writes persona turns (spec §2).
 *
 * The Gate "never publishes" rule is enforced structurally: the Gate will return
 * a decision object in P2, and `publish` is the sole caller of
 * `store.appendTurn`. There is no code path from a verdict to the log.
 */

import type { ForumStore } from "./store";
import type { ForumMessage, PersonaId, Side, TurnRecord } from "./types";

export interface BuildMessageArgs {
  seq: number;
  t: number;
  sender: PersonaId;
  primaryRecipient: string;
  text: string;
  topicId: string;
  side: Side;
  mentions?: string[];
  system?: boolean;
  /** the message this one answers, for the UI's quoted strip */
  replyToSeq?: number;
  /** set on the second bubble of a double-text (see `TurnRecord` in types.ts) */
  continuationOf?: number;
}

export function buildMessage(args: BuildMessageArgs): ForumMessage {
  return {
    id: `m_${args.seq}`,
    seq: args.seq,
    t: args.t,
    sender: args.sender,
    primaryRecipient: args.primaryRecipient,
    mentions: args.mentions ?? [],
    text: args.text,
    topicId: args.topicId,
    side: args.side,
    system: args.system ?? false,
    ...(args.replyToSeq === undefined ? {} : { replyToSeq: args.replyToSeq }),
    ...(args.continuationOf === undefined ? {} : { continuationOf: args.continuationOf }),
  };
}

export async function publish(store: ForumStore, record: TurnRecord): Promise<void> {
  if (record.decision !== "APPROVE") {
    throw new Error(`forum: refusing to publish turn ${record.seq} (decision ${record.decision})`);
  }
  if (!record.message) {
    throw new Error(`forum: refusing to publish turn ${record.seq} with no message`);
  }
  await store.appendTurn(record);
}

/**
 * Record a turn whose draft the Gate never approved (spec §8.4).
 *
 * This is still a write, so it lives here with `publish`, not in the Gate — the
 * Gate's verdict is data, and the only way to the log is through this module.
 * The record carries the full attempt trace but no message, so the public
 * projection never sees it.
 */
export async function publishUnpublished(store: ForumStore, record: TurnRecord): Promise<void> {
  if (record.decision !== "UNPUBLISHED") {
    throw new Error(
      `forum: refusing to record turn ${record.seq} as unpublished (decision ${record.decision})`,
    );
  }
  if (record.message) {
    throw new Error(`forum: unpublished turn ${record.seq} must not carry a message`);
  }
  await store.appendTurn(record);
}
