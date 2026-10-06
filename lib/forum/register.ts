/**
 * How long one message is (spec §8.1's register check).
 *
 * The per-persona band was the single biggest remaining tell in the room. A band
 * says "40 to 240 characters", and a model asked for 40–240 characters will hit
 * roughly the same middle every time — which is exactly what the room sounded
 * like: ten people, one message length, no beats, no reactions, no one ever just
 * saying "nah".
 *
 * So the band is now a *ceiling* and the floor comes from a per-turn tier. The
 * tiers are deterministic (`hashPick` on persona + seq), which matters: the Voice
 * prompt and the Gate's LENGTH check both call `lengthTarget`, so what the model
 * was asked for is what it is judged against, and a replay picks the same tier it
 * picked the first time.
 *
 * The weights are the point. Beats are common — in a real group chat a lot of
 * messages are four words — but they are not *most* messages, or the room reads as
 * a caricature the other way round.
 */

import { hashPick } from "./rng";
import type { Persona } from "./types";

export interface LengthTarget {
  min: number;
  max: number;
  /** the tier's name, for the audit note and the tests */
  tier: "beat" | "short" | "normal" | "full";
  /** how the tier is described to the model */
  label: string;
}

/**
 * Six draws, one per tier-shape. Repeating the shapes is how a weight is written
 * without a second data structure: `beat` is drawn twice, `normal` three times.
 */
const DRAWS: readonly LengthTarget["tier"][] = [
  "beat",
  "beat",
  "short",
  "short",
  "normal",
  "normal",
  "normal",
  "full",
];

const LABELS: Record<LengthTarget["tier"], string> = {
  beat: "one short beat. A reaction, a verdict, two or three words. You do not need a sentence",
  short: "one quick message, the length of a text you send while doing something else",
  normal: "one ordinary message. A sentence, maybe two",
  full: "a longer message, the kind where you actually explain yourself",
};

/**
 * The bounds of each tier, in characters.
 *
 * Absolute rather than derived from the persona's band, on purpose: a sheet that
 * says "1 to 10,000 characters" should still take human-sized messages, and a turn
 * that asks for a beat asks for a beat whatever the character's ceiling is. The
 * persona's `maxChars` is an upper bound on all of them and nothing else.
 */
const TIER_BOUNDS: Record<LengthTarget["tier"], readonly [number, number]> = {
  beat: [1, 28],
  short: [8, 80],
  normal: [30, 240],
  full: [140, 340],
};

/**
 * The length this turn is aiming at. `seq` and the persona id are the whole input,
 * so the same turn always gets the same target.
 */
export function lengthTarget(persona: Persona, seq: number): LengthTarget {
  const cap = Math.max(16, persona.sheet.register.maxChars);
  const tier = hashPick(DRAWS, `length:${persona.id}:${seq}`) ?? "normal";
  const [lo, hi] = TIER_BOUNDS[tier];
  const max = Math.min(hi, cap);

  return { tier, min: Math.min(lo, max), max, label: LABELS[tier] };
}

/**
 * The typography of a text message, as a rule rather than a list of examples.
 *
 * Every tell here came out of the room's own live transcript: `—` between clauses,
 * a semicolon joining two thoughts, and the single-glyph ellipsis are three things
 * nobody types with a thumb, and all three were in messages people were supposed
 * to find human. The Gate and the prompt share this: `TEXTING_RULE` is shown to the
 * model, and `typographyFault` is what the Gate runs over the draft, so the rule
 * and the check cannot drift apart.
 */
export const TEXTING_RULE =
  "Type it like a thumb, not a keyboard: no em dashes or en dashes, no semicolons, " +
  "no ellipsis character. If you would break a sentence, use a full stop, a comma, " +
  "or just start a new message. Most people in this room do not bother with capital " +
  "letters or a full stop at the end, and that is fine.";

/**
 * Does this line miss the turn's target badly enough to matter?
 *
 * The tolerance is the point. A model cannot count characters, and the live room
 * showed what a ruler costs: most rejected drafts were a handful of characters
 * outside the window — 138 where 140-180 was asked for — and every one of them bought
 * a retry or a fallback template, which read worse than the line it replaced. So the
 * ask stays precise and the check allows a margin: a quarter of the bound, or six
 * characters, whichever is larger. A three-word answer on a turn that asked for a
 * paragraph still fails, which is what the rule is for.
 */
export function lengthFault(text: string, persona: Persona, seq: number): string {
  const target = lengthTarget(persona, seq);
  const length = text.trim().length;
  const slack = (bound: number): number => Math.max(6, Math.round(bound * 0.25));
  const floor = target.min - slack(target.min);
  const ceiling = target.max + slack(target.max);

  if (length < floor) {
    return `${length} chars, under the ${target.tier} target (${target.min}-${target.max}, floor ${floor}) for ${persona.id}`;
  }
  if (length > ceiling) {
    return `${length} chars, over the ${target.tier} target (${target.min}-${target.max}, ceiling ${ceiling}) for ${persona.id}`;
  }
  return "";
}

/** Which typography tell a draft has, if any. Empty string means clean. */
export function typographyFault(text: string): string {
  if (/[—–]/.test(text)) return "an em/en dash — nobody types that punctuation in a text";
  if (/;/.test(text)) return "a semicolon";
  if (/…/.test(text)) return "the single-glyph ellipsis";
  if (/^\s*[-*•]\s/m.test(text)) return "a bulleted line, which is a list, not a message";
  return "";
}
