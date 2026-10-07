/**
 * Canned drafts — what a persona says when the Voice has no model or the call
 * failed, and what the room publishes when the Gate has exhausted its retries.
 *
 * These are not a P0 stand-in: on the live room they were 13 of 124 published
 * turns, so they are read as often as anyone's real lines and they have to survive
 * the same reading. The previous version did not. It built a line by filling a
 * template and then *stretching* it to the turn's length, which produced two
 * things nobody types: a message cut off mid-clause ("...as an"), and a padded one
 * with the filler still attached ("...simply built different 🫡 and honestly that
 * is the whole"). It also prefixed the message it answered as a truncated
 * quotation, ellipsis and all, and in the retry path it prefixed a *second*
 * reference on top of the first — so the room published lines that quoted the same
 * clause twice and sounded like nothing at all.
 *
 * So a canned line is now **chosen to fit the turn** instead of stretched into it.
 * Each persona has a small repertoire per length tier: beats, one-liners, and
 * thoughts (whole sentences). A line is never cut inside a clause and never padded;
 * when one thought is too short for the turn, the fallback joins whole thoughts.
 *
 * A line also has to connect to the message it answers, because a persona with no
 * model has its canned line judged by the Gate like anyone else's (`checkAddressee`).
 * The old way was to quote it. The way people actually do it is to say who they are
 * answering, and `checkAddressee` accepts a sender's name — so that is what the
 * fallback does, and it cannot garble a quotation that no longer exists.
 */

import { contentTokens } from "./gate";
import { lengthTarget, type LengthTarget } from "./register";
import { hashPick } from "./rng";
import type { AgendaEvent, Persona, PersonaId, WorldState } from "./types";

export interface DraftContext {
  persona: Persona;
  event: AgendaEvent;
  world: WorldState;
  seq: number;
  attempt: number;
}

export interface Repertoire {
  /** Reactions: a verdict in two or three words. The `beat` tier is the only one
   * that uses them, and a beat is the one place a fragment is correct. */
  beat: string[];
  /** One-liners, sized to leave room for a name in front of them on a `short`
   * turn. A `short` turn is 8-80 characters and a name costs up to eight. */
  short: string[];
  /** Thoughts: one to three whole sentences, in the persona's own voice. Every
   * tier above `short` is served from here, which is why the set is mixed in
   * length: a `full` turn has a floor of 140 characters and the narrowest persona
   * caps it at 170, so the bank has to contain a pair of thoughts that fits
   * between them without being cut. */
  thought: string[];
}

/**
 * What each person says when the Voice cannot speak for them.
 *
 * Exported because the content carries a contract the fit logic depends on — every
 * line already fits the turn it serves, which is what makes "chosen to fit"
 * possible — and a contract that is only checked by the code that uses it is a
 * contract that drifts silently back into padding (`data.test.ts` holds the bands).
 *
 * Nothing here carries a placeholder or a quotation. Fixed text is what makes "this
 * line fits this turn" a fact rather than a hope: the previous version filled a
 * template with the topic and the message being answered, so its length moved with
 * the conversation and it had to be clamped afterwards, which is where the filler
 * and the half-clauses came from.
 */
export const REPERTOIRE: Record<PersonaId, Repertoire> = {
  mara: {
    beat: ["fair.", "I'm not arguing with that 😤", "patience trade.", "ok that's funny"],
    short: [
      "my patience is doing the work",
      "small size, clean mind",
      "i'm not adding to this yet",
    ],
    thought: [
      "i'm not chasing this. small size, clean mind, and i let it come to me",
      "coiled all week and my patience is the only thing holding this together",
      "you are all very confident for a room that got the last three of these wrong 😤",
      "i refuse to be outperformed by a screen, so my size stays small and my stop stays where it is",
    ],
  },
  dmitri: {
    beat: ["noise.", "that's not the driver.", "rates decide this.", "we'll see."],
    short: [
      "that is not the driver",
      "rates are still the driver",
      "you have the causality backwards",
    ],
    thought: [
      "you have the causality backwards. the bond market moved first",
      "rates explain this move. single names explain nothing about it",
      "the bund spread is widening again, so put it in your filter before you talk about levels",
      "i trade the bond market and the single names follow from it, which has been true all year",
    ],
  },
  sol: {
    beat: ["nah", "cooked", "eh it's fine", "lol ok", "down bad fr"],
    short: [
      "buying the dip with my whole face",
      "cooked, all of it",
      "nobody here reads the chart anyway",
    ],
    thought: [
      "nobody in this room understands this and i include myself in that 💀",
      "2am and i'm still in the crypto group chat, so yes i saw it before you",
      "buying dips with my whole face 🫡 and no i will not be taking questions",
      "you cannot fade a market that only goes up. it has done nothing else since you started complaining",
    ],
  },
  toko: {
    beat: ["one scalp and out.", "same script.", "30 minutes, that's it.", "mid."],
    short: [
      "one scalp and i'm out",
      "not holding this overnight",
      "you trade too much, that's the problem",
    ],
    thought: [
      "you trade too much. that is the whole problem with your results",
      "first thirty minutes or nothing. not holding anything past that",
      "2 of 3 green and i'm done by lunch. screen time is the enemy",
      "i counted eleven trades on your account today. that is a slot machine with extra steps やめ",
    ],
  },
  priya: {
    beat: ["watchlist.", "noted.", "flows say otherwise.", "I'd wait."],
    short: [
      "what is your invalidation though",
      "adding it to the watchlist",
      "hedged into the print already",
    ],
    thought: [
      "singapore was quiet. i'd rather be early on this than loud",
      "hedged into the print, so i'm not the person to ask about direction",
      "adding it to the watchlist with a one day lag, the flows need a session",
      "what is your invalidation on this, because my book is hedged and i need to know where i'm wrong",
    ],
  },
  kofi: {
    beat: ["bet", "cable decides it", "tight stop, then out", "salty ngl"],
    short: ["cable decides it, not gold", "tight stop then out", "that's the whole plan right there"],
    thought: [
      "cable decides it, everything else in here is decoration",
      "tight stop then out, that's the whole plan and it hasn't changed",
      "second monitor has the cable chart and the gold chart, i look at the cable one",
      "stopped out of this twice this week and i'll take it a third time if the level sets up",
    ],
  },
  lena: {
    beat: ["tbh that tracks.", "mid.", "flow screen disagrees.", "no notes."],
    short: [
      "the flow screen disagrees here",
      "that tracks, tbh",
      "allocation question, not timing",
    ],
    thought: [
      "tbh that tracks. it has been the same range for three weeks",
      "the flow screen disagrees with the price here and it's been right more often",
      "that's an allocation question for me, not a timing one, different books",
      "i'd frame this as a funds flow problem, the etf prints show money leaving and the chart doesn't care yet",
    ],
  },
  raul: {
    beat: ["flows lag.", "copper knew first.", "same as last week.", "meh."],
    short: ["flows lag, they always have", "not a real level", "nothing changed since last week"],
    thought: [
      "flows lag. copper knew about this a week before your screen did",
      "that's a chart level, not a real one. the physical trade sets the price",
      "same as last week and the week before. nothing in this market has changed",
      "the whole complex moves together and the chart people price them like separate markets",
    ],
  },
  nadia: {
    beat: ["half size.", "no new risk.", "know your gap.", "that's the job."],
    short: ["half size until the print", "no new risk here", "your size is the whole problem"],
    thought: [
      "no new risk into this. that's the whole job and it isn't interesting",
      "half size until the print passes, then we can talk about direction",
      "respectfully, your size is a bet on being right about one thing",
      "position sizing is the entire job. get it wrong and being right about direction doesn't save you",
    ],
  },
  rafa: {
    beat: ["tape says wait.", "no trade there.", "flat into the print.", "not my level."],
    short: ["thin tape, that's all it is", "flat and staying flat", "not a level, that's a chop range"],
    thought: [
      "the tape is thin and i'm not paying to find out where it goes",
      "i'm flat into the print. that's where my risk sits, not a prediction",
      "opened twenty ticks off yesterday's close and half the room already has a thesis about it",
      "everyone keeps quoting yesterday's close at me like it's today's print. it isn't though",
    ],
  },
  jess: {
    beat: ["no fills.", "checking the tape.", "that's a nothing level.", "flow's quiet."],
    short: ["what was the flow though", "no fills on that side", "i'd wait for the open"],
    thought: [
      "no fills on that side all morning, so what am i supposed to read here",
      "what's the flow on this, because the price is not telling me anything",
      "the statement is right there in the platform and nobody reads it before they post",
      "i'll take the other side of that all day, the flow screen disagrees and i trust it more than either of us",
    ],
  },
};

/**
 * The ids the room uses for a person, or for the room itself.
 *
 * `addressed()` puts the sender's name in front of a line that does not connect to
 * what they said, which is right for a member of the roster and wrong for these: a
 * fallback answering a visitor once began "human, i'm not chasing this". They are
 * not a name, so a fallback never greets them with one.
 */
const NOT_A_NAME = new Set(["human", "room", "you", "them"]);

/**
 * What the room says when the question is about the platform itself (spec §9.2).
 *
 * Shared across the roster on purpose, unlike `REPERTOIRE`: these are the only lines
 * in the room that speak about the product, so they are reviewed as one set rather
 * than as eleven variations on "i use it". The seed still carries the persona, so
 * two members answering in a row do not pick the same line.
 *
 * Safe by construction, which is what makes this the right thing to publish when a
 * product-question draft is rejected twice. Every line is one person's honest use of
 * the platform or a plain refusal to advise. Nothing claims anything about how it
 * performs, tells anyone what to do with their money, promises an outcome, or repeats
 * a shape the Gate's PRODUCT check rejects.
 */
export const PRODUCT_LINES: Repertoire = {
  beat: ["just use it", "not my call", "no idea tbh", "i just trade on it"],
  short: [
    "i just use it, that's my whole view",
    "not here to sell anyone on it",
    "nobody in here knows the business side",
    "i use it, that's all i can tell you",
    "no idea, i just trade on the thing",
  ],
  thought: [
    "i'm not the person to ask about that. i use it, and that's the whole of what i know about it",
    "you won't get a pitch out of me. i'm a trader, i use the thing and i'm not recommending it to anybody",
    "nobody in this room can promise you anything about your money, and anyone who does is lying to you",
    "i can't tell you what to do with your money and i'm not going to pretend i can. all i know is that i use it",
    "i'd rather tell you straight that it isn't my call than sell you something. i trade on it and that is the whole answer from me",
    "i'm not going to tell you what to do with your money because it isn't my call, and honestly nobody in this room knows the business side of it either",
    "all i can tell you is what i use it for, and i won't tell you anything here is a sure thing because nothing about trading ever is",
  ],
};

/** Used only if a persona reaches the fallback without a bank of its own. */
const GENERIC: Repertoire = {
  beat: ["fair.", "nah.", "hmm.", "ok then."],
  short: ["fair enough", "not sure about that", "let me check the book"],
  thought: [
    "not convinced, but i'm not going to argue about it in here",
    "the book is staying where it is until something actually changes",
    "i'd need to see the print before i say anything about this one",
    "let it come to me. chasing this is how you end up two sizes too big",
  ],
};

/**
 * Does this line answer the message it is standing in for?
 *
 * Mirrors `checkAddressee` deliberately: a shared content token, or the sender's
 * name. A canned line is judged by the Gate when a persona has no model, so the
 * test it has to pass is the Gate's own.
 */
function connects(text: string, ctx: DraftContext): boolean {
  if (ctx.event.authoredBy === "engine") return true;
  const quoted = ctx.event.quoted?.trim();
  if (!quoted) return true;
  const theirs = contentTokens(quoted);
  if (theirs.size === 0) return true;
  for (const token of contentTokens(text)) if (theirs.has(token)) return true;
  return false;
}

/**
 * Say who it is for, the way people actually do it in a group chat ("kofi, cable
 * decides it"). This is what replaces the truncated quotation: it costs a name
 * rather than a clause, and it cannot produce a fragment.
 *
 * Applied to a whole candidate, never to each half of a join — a message that says
 * the name twice ("nadia, ... did nadia, ...") is the same class of garble the
 * quotation prefix used to be.
 */
function addressed(line: string, ctx: DraftContext): string {
  if (connects(line, ctx)) return line;
  const sender = ctx.event.sender?.trim();
  if (!sender || NOT_A_NAME.has(sender.toLowerCase())) return line;
  return `${sender.toLowerCase()}, ${line}`;
}

/**
 * Two thoughts in one message, with a sentence break between them.
 *
 * The break is why this is a function and not a space: chat lines mostly do not
 * end in a full stop, so `"...your screen did" + "the whole complex"` would read as
 * one broken sentence instead of a person saying two things.
 */
function joinThoughts(first: string, second: string): string {
  return `${first}${/[.!?]$/.test(first) ? "" : "."} ${second}`;
}

/** Whole thoughts only: never cut inside a clause, so trimming drops sentences. */
function dropTrailingSentences(text: string, max: number): string {
  if (text.length <= max) return text;
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  let out = "";
  for (const sentence of sentences) {
    const next = out === "" ? sentence : `${out} ${sentence}`;
    if (next.length > max) break;
    out = next;
  }
  return out;
}

/**
 * Choose the line that fits this turn out of the persona's own repertoire.
 *
 * Order of preference: a single thought that fits, then two joined, then three.
 * Joining is the point — a `full` turn is a floor of 140 characters, and the old
 * fallback met that floor by appending filler word by word. Two of this person's
 * thoughts are still this person's writing; the filler was nobody's.
 */
function fitToTarget(
  singles: readonly string[],
  joined: readonly string[],
  target: LengthTarget,
  seed: string,
): string {
  const fits = (text: string): boolean => text.length >= target.min && text.length <= target.max;

  for (const pool of [singles, joined]) {
    const fitting = pool.filter(fits);
    if (fitting.length > 0) return hashPick(fitting, seed) ?? fitting[0]!;
  }

  // Nothing fits even joined: the turn's ceiling is below this persona's shortest
  // thought. Keep the shortest whole thought and drop any trailing sentences.
  const shortest = [...singles].sort((a, b) => a.length - b.length)[0] ?? "";
  return dropTrailingSentences(shortest, target.max);
}

/** Every way this turn could be filled from the persona's own writing. */
function candidates(
  lines: readonly string[],
  /** null for the product bank: there is no name to put on those lines (§9.2) */
  ctx: DraftContext | null,
  prefix = true,
): { singles: string[]; joined: string[] } {
  const singles = lines.map((line) => (prefix && ctx ? addressed(line, ctx) : line));
  const joined: string[] = [];
  for (let i = 0; i < singles.length; i += 1) {
    for (let j = 0; j < singles.length; j += 1) {
      if (i === j) continue;
      const name = (text: string): string => (prefix && ctx ? addressed(text, ctx) : text);
      joined.push(name(joinThoughts(lines[i]!, lines[j]!)));
      for (let k = 0; k < singles.length; k += 1) {
        if (k === i || k === j) continue;
        const pair = joinThoughts(lines[i]!, lines[j]!);
        joined.push(name(joinThoughts(pair, lines[k]!)));
      }
    }
  }
  return { singles, joined };
}

/**
 * The room's answer when a product question's own draft was rejected (§9.2).
 *
 * Chosen to fit the turn the same way `cannedDraft` is, and deliberately *not*
 * addressed by name: the person asked the room, there is no member to name, and the
 * sender id a person carries is not a name.
 */
export function productDraft(ctx: { persona: Persona; seq: number; attempt: number }): string {
  const target = lengthTarget(ctx.persona, ctx.seq);
  const seed = `product:${ctx.persona.id}:${ctx.seq}:${ctx.attempt}`;

  if (target.tier === "beat") {
    const fitting = PRODUCT_LINES.beat.filter((line) => line.length <= target.max);
    const pool = fitting.length > 0 ? fitting : [PRODUCT_LINES.beat[0]!];
    return hashPick(pool, `beat:${seed}`) ?? pool[0]!;
  }

  const source = target.tier === "short" ? PRODUCT_LINES.short : PRODUCT_LINES.thought;
  const { singles, joined } = candidates(source, null, false);
  return fitToTarget(singles, joined, target, seed);
}

export function cannedDraft(ctx: DraftContext): string {
  const target = lengthTarget(ctx.persona, ctx.seq);
  const bank = REPERTOIRE[ctx.persona.id] ?? GENERIC;
  // The retry number is in every seed, so a persona with no model does not repeat
  // itself into a Gate rejection it cannot escape.
  const seed = `${ctx.persona.id}:${ctx.seq}:${ctx.attempt}`;

  if (target.tier === "beat") {
    // A beat is a reaction and is exempt from the addressee rule, so nothing is
    // prefixed onto it. "kofi, nah" is not something anyone types.
    const fitting = bank.beat.filter((line) => line.length <= target.max);
    const pool = fitting.length > 0 ? fitting : [bank.beat[0] ?? GENERIC.beat[0]!];
    return hashPick(pool, `beat:${seed}`) ?? pool[0]!;
  }

  // The name is applied before the fit is computed, so a line that fits is a line
  // that fits *with* the name that makes it an answer.
  const source = target.tier === "short" ? bank.short : bank.thought;
  const { singles, joined } = candidates(source, ctx);
  return fitToTarget(singles, joined, target, seed);
}
