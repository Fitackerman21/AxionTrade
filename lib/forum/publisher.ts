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
