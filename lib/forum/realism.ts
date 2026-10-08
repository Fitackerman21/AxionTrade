/**
 * The realism audit — a number for "does the room read like people".
 *
 * "Realism" is partly taste, and no metric settles taste. But almost every *mechanical*
 * tell the room has ever shipped is countable, and every one of them was found by reading
 * a transcript rather than by a test: the same sentence four times in sixty messages, two
 * thirds of the lines opening with a person's name, a reply quoting a message it shares
 * nothing with, a line of Japanese in an American room. This module turns those reads into
 * a score, so the target ("90%") is a gate a change has to pass instead of a feeling.
 *
 * It is deliberately pure: give it a window of turns and it returns a report. That makes it
 * usable three ways — as the unit test below, as a one-off audit of the live log, and as the
 * thing a change to the Voice or the fallback is measured against.
 *
 * What it does not measure: voice, stance, whether a line is *interesting*. A room of
 * eleven people saying "cooked" is a 100 on repetition and a 0 on conversation. The audit
 * gates the tells; a human still has to read the room.
 */

import { normalizeLine } from "./drafts";
import { contentTokens } from "./gate";
import type { TurnRecord } from "./types";

export interface RealismReport {
  /** published persona messages in the window */
  messages: number;
  /** share of messages whose exact line already appeared in the window */
  repeatRate: number;
  /** share of messages sharing an 8-word run with another message in the window */
  longRunRepeatRate: number;
  /** share of messages opening with a person's name ("kofi, …") */
  namePrefixRate: number;
  /**
   * Share of replies that answer nothing: a self-quote, or a non-beat line sharing no
   * content word with the message it claims to answer.
   */
  replyMismatchRate: number;
  /** share of replies quoting a message the same persona wrote */
  selfQuoteRate: number;
  /** share of messages carrying a non-ASCII character (emoji is exempt) */
  nonAsciiRate: number;
  /** distinct length buckets present, as a share of the four the register has */
  lengthVariety: number;
}

/** The length buckets a room should be using — the tiers in `register.ts`, roughly. */
const LENGTH_BUCKETS = 4;

const EMOJI = /\p{Extended_Pictographic}/u;

function isNonAsciiTell(text: string): boolean {
  return /[^\x00-\x7F]/.test(text.replace(new RegExp(EMOJI, "gu"), ""));
}

function words(text: string): string[] {
  return normalizeLine(text).split(" ").filter(Boolean);
}

function runs(text: string, n: number): Set<string> {
  const tokens = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i += 1) out.add(tokens.slice(i, i + n).join(" "));
  return out;
}

function bucketOf(length: number): number {
  if (length <= 28) return 0;
  if (length <= 80) return 1;
  if (length <= 240) return 2;
  return 3;
}

/** How many messages back a repeat is still a repeat. */
const LOOKBACK = 25;

/** Names a line might be prefixed with: the roster, plus every sender in the window. */
function vocatives(turns: readonly TurnRecord[], roster?: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const name of roster ?? []) {
    for (const word of name.toLowerCase().split(/\s+/)) if (word.length >= 3) out.add(word);
  }
  for (const turn of turns) {
    const sender = turn.message?.sender;
    if (sender) out.add(sender.toLowerCase());
  }
  return out;
}

/**
 * Audit a window of turns (newest last). Only published messages count — an unpublished
 * turn is a hole, and a hole is not a line anyone reads.
 */
export function auditTurns(turns: readonly TurnRecord[], roster?: readonly string[]): RealismReport {
  const posted = turns.filter((turn) => turn.message).map((turn) => turn.message!);
  const total = posted.length;
  if (total === 0) {
    return {
      messages: 0,
      repeatRate: 0,
      longRunRepeatRate: 0,
      namePrefixRate: 0,
      replyMismatchRate: 0,
      selfQuoteRate: 0,
      nonAsciiRate: 0,
      // Nothing was said, so there is nothing misshapen about the variety.
      lengthVariety: 1,
    };
  }

  const names = vocatives(turns, roster);
  const bySeq = new Map<number, string>();
  const senderBySeq = new Map<number, string>();
  for (const turn of turns) {
    if (!turn.message) continue;
    bySeq.set(turn.message.seq, turn.message.text);
    senderBySeq.set(turn.message.seq, turn.message.sender);
  }

  // Precomputed so a repeat is measured against the last `LOOKBACK` messages, not against
  // the whole window. A line said again an hour later is a person; a line said again three
  // messages later is the same bank reciting itself, which is the failure observed live.
  const normalized = posted.map((message) => normalizeLine(message.text));
  const runSets = posted.map((message) => runs(message.text, 8));

  const buckets = new Set<number>();
  let repeatMessages = 0;
  let longRunRepeatMessages = 0;
  let namePrefixed = 0;
  let nonAscii = 0;
  let replies = 0;
  let mismatch = 0;
  let selfQuote = 0;

  for (let i = 0; i < posted.length; i += 1) {
    const message = posted[i]!;
    const from = Math.max(0, i - LOOKBACK);

    for (let j = from; j < i; j += 1) {
      if (normalized[j] === normalized[i]) {
        repeatMessages += 1;
        break;
      }
    }

    let repeatsARun = false;
    for (let j = from; j < i && !repeatsARun; j += 1) {
      for (const run of runSets[j]!) {
        if (runSets[i]!.has(run)) {
          repeatsARun = true;
          break;
        }
      }
    }
    if (repeatsARun) longRunRepeatMessages += 1;

    buckets.add(bucketOf(message.text.trim().length));
    if (isNonAsciiTell(message.text)) nonAscii += 1;

    const vocative = /^([a-z0-9'-]+)\s*[,!]/i.exec(message.text.trim())?.[1]?.toLowerCase();
    if (vocative && names.has(vocative)) namePrefixed += 1;

    if (message.replyToSeq !== undefined) {
      const quoted = bySeq.get(message.replyToSeq);
      if (quoted !== undefined) {
        replies += 1;
        if (senderBySeq.get(message.replyToSeq) === message.sender) {
          selfQuote += 1;
          mismatch += 1;
        } else {
          // A beat is a reaction and owes the message nothing; only a line that should
          // have a subject in it is judged on whether it has one.
          const whose = senderBySeq.get(message.replyToSeq) ?? "";
          const theirs = contentTokens(quoted);
          const mine = contentTokens(message.text);
          // The Gate's own rule: a line answers a message by sharing a content word with
          // it, or by naming the person. Anything else is a quote pointing at nothing.
          const shares =
            theirs.size === 0 ||
            [...mine].some((token) => theirs.has(token)) ||
            (whose !== "" && message.text.toLowerCase().includes(whose));
          if (!shares && message.text.trim().length > 28) mismatch += 1;
        }
      }
    }
  }

  return {
    messages: total,
    repeatRate: repeatMessages / total,
    longRunRepeatRate: longRunRepeatMessages / total,
    namePrefixRate: namePrefixed / total,
    replyMismatchRate: replies === 0 ? 0 : mismatch / replies,
    selfQuoteRate: replies === 0 ? 0 : selfQuote / replies,
    nonAsciiRate: nonAscii / total,
    lengthVariety: buckets.size / LENGTH_BUCKETS,
  };
}

/** One metric's target: a floor for a ratio that should be high, a ceiling for one that should be low. */
interface Target {
  metric: keyof Omit<RealismReport, "messages">;
  weight: number;
  min?: number;
  max?: number;
  why: string;
}

/**
 * The targets, and why each number is where it is.
 *
 * The ceilings are generous on purpose. A real group chat repeats a word, a line, a name
 * now and then; the failure being caught is not imperfection but a *system* — the same
 * bank recited, every line naming its target, a quote pointing at nothing. These are set
 * just inside "not a machine" and well above "perfect".
 */
export const REALISM_TARGETS: readonly Target[] = [
  {
    metric: "repeatRate",
    weight: 0.32,
    max: 0.05,
    why: "an exact line saying itself again is the loudest tell there is",
  },
  {
    metric: "longRunRepeatRate",
    weight: 0.14,
    max: 0.05,
    why: "eight words in a row copied from another message",
  },
  {
    metric: "namePrefixRate",
    weight: 0.14,
    max: 0.5,
    why: "a room where most lines open with a name recites names at itself",
  },
  {
    metric: "replyMismatchRate",
    weight: 0.14,
    max: 0.35,
    why: "a reply that shares nothing with the message it quotes",
  },
  {
    metric: "selfQuoteRate",
    weight: 0.06,
    max: 0,
    why: "a line quoting itself is never right",
  },
  {
    metric: "nonAsciiRate",
    weight: 0.06,
    max: 0.01,
    why: "the room's voice is one language; a stray word from another is a data bug",
  },
  {
    metric: "lengthVariety",
    weight: 0.1,
    min: 0.75,
    why: "beats, one-liners and paragraphs together, not one length wall to wall",
  },
];

/**
 * The score, 0–100: each target contributes its weight, in full when the metric is on the
 * right side of its line and partially when it is close. A miss is not fatal — the point
 * is a dial a change can be measured against, not a pass/fail that hides how far off it is.
 */
export function realismScore(report: RealismReport): number {
  let score = 0;
  for (const target of REALISM_TARGETS) {
    const value = report[target.metric];
    let ratio: number;
    if (target.max !== undefined) {
      ratio = target.max === 0 ? (value === 0 ? 1 : 0) : Math.min(1, target.max / Math.max(value, 1e-9));
    } else {
      const floor = target.min ?? 0;
      ratio = floor === 0 ? 1 : Math.min(1, value / floor);
    }
    score += target.weight * ratio;
  }
  return Math.round(score * 1000) / 10;
}

/** Which targets a report misses, worst first — for the audit's own output. */
export function realismMisses(
  report: RealismReport,
): Array<{ metric: string; value: number; weight: number; why: string }> {
  const misses: Array<{ metric: string; value: number; weight: number; why: string }> = [];
  for (const target of REALISM_TARGETS) {
    const value = report[target.metric];
    const failed =
      (target.max !== undefined && value > target.max) ||
      (target.min !== undefined && value < target.min);
    if (failed) misses.push({ metric: target.metric, value, weight: target.weight, why: target.why });
  }
  return misses.sort((a, b) => b.weight - a.weight);
}
