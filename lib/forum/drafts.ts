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
 *
 * The bank below also has to survive the *rotation* rule: a canned line that repeats
 * the words the room has been using all afternoon is the same machine-talking-to-itself
 * problem the live Voice has (`lexicon.ts`), so the lines lean on plain, ordinary
 * phrasing rather than the room's flavour of the week.
 */

import { contentTokens } from "./gate";
import { lengthTarget, type LengthTarget } from "./register";
import { hashPick } from "./rng";
import type { AgendaEvent, Persona, PersonaId, TurnRecord, WorldState } from "./types";

export interface DraftContext {
  persona: Persona;
  event: AgendaEvent;
  world: WorldState;
  seq: number;
  attempt: number;
  /**
   * Recent log, newest last. The fallback reads it to avoid saying what the room just
   * said — a canvas three lines wide repeats itself within four turns otherwise, which
   * is exactly how the live room published the same sentence four times (see the
   * no-repeat window below). Absent in tests that only check fit, where there is
   * nothing to repeat against.
   */
  recent?: readonly TurnRecord[];
}

/**
 * How far back the fallback looks before it allows a repeat.
 *
 * A persona's own line is stale after the room has moved on (`SELF`); a line another
 * persona just used is stale almost at once (`ROOM`), because the tell the room read as
 * worst is two people saying the same sentence inside a minute.
 */
const NO_REPEAT_SELF_TURNS = 40;
const NO_REPEAT_ROOM_TURNS = 15;

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
      "keeping the size small here",
      "i'm not adding to this yet",
    ],
    thought: [
      "i'm not chasing this one. keeping it small and letting it come to me instead",
      "stuck all week and my patience is the only thing holding this together",
      "you are all very confident for a room that got the last three of these wrong 😤",
      "i keep the size small and the stop where i left it. losing to a screen is not happening",
      "you can talk about direction all day, the size is what decides whether the year is good",
      "i am not putting more on until it holds above where it opened, that is the whole condition",
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
      "the rates move first and everything else in here is downstream of it, that has not changed",
      "i would not read anything into the price until the bond market agrees with it",
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
      "everyone is very sure about a market that has not done anything in three days",
      "i am not going to pretend i have a view on this, i am just holding and waiting",
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
      "i counted eleven trades on your account today. that is a slot machine with extra steps",
      "i am done after the first thirty minutes, holding a position past that is how you give it back",
      "you do not need eleven trades to have a good day, two would have done it",
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
      "i am not taking a direction here, i am taking the flows and letting the session settle",
      "the invalidation is what i care about, the target is just where i hope it goes",
    ],
  },
  kofi: {
    beat: ["bet", "cable decides it", "tight stop, then out", "salty ngl"],
    short: ["cable decides it, not gold", "tight stop then out", "that's the whole plan right there"],
    thought: [
      "cable decides it, everything else in here is decoration",
      "i am out the moment it goes against me, that part has never changed",
      "second monitor has the cable chart and the gold chart, i look at the cable one",
      "stopped out of this twice this week and i'll take it a third time if the level sets up",
      "i take the level off the screen and i do the rest myself, that is the whole routine",
      "the stop is where the idea is wrong, everything after that is just waiting",
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
      "the flow screen has disagreed with the price for a week and it has been right",
      "this is an allocation question for me, the timing of it is somebody else's problem",
    ],
  },
  raul: {
    beat: ["flows lag.", "copper knew first.", "same as last week.", "meh."],
    short: ["i am not seeing anything new", "not a real level", "nothing changed since last week"],
    thought: [
      "copper knew about this a week before your screen did, that is the whole story",
      "that's a chart level, not a real one. the physical trade sets the price",
      "same as last week and the week before. nothing in this market has changed",
      "the whole complex moves together and the chart people price them like separate markets",
      "the physical market sets the price and the screens catch up a week later, that is the order",
      "i have watched this complex for years and it has never moved the way the charts say",
    ],
  },
  nadia: {
    beat: ["half size.", "no new risk.", "know your gap.", "that's the job."],
    short: ["half size until the print", "no new risk here", "your size is the whole problem"],
    thought: [
      "i am not adding risk into this one, and there is nothing interesting to say about it",
      "half size until the print passes, then we can talk about direction",
      "respectfully, your size is a bet on being right about one thing",
      "get the size wrong and being right about direction will not save you. that is the part i care about",
      "i am not taking this into the print, there will be a better price once it settles",
      "the gap is what kills accounts, not the direction, and nobody sizes for it",
    ],
  },
  rafa: {
    beat: ["tape says wait.", "no trade there.", "flat into the print.", "not my level."],
    short: ["thin tape, that's all it is", "flat and staying flat", "not a level, that's a chop range"],
    thought: [
      "the tape is thin and i'm not paying to find out where it goes",
      "flat into the print is just where my risk sits, however it comes out",
      "opened twenty ticks off yesterday's close and half the room already has a thesis about it",
      "everyone keeps quoting yesterday's close at me like it's today's print. it isn't though",
      "i would rather miss it than pay up for it, the tape will still be there tomorrow",
      "the range has held for a week and until it does not, i have nothing to say about it",
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
      "i need to see the flow before i have a view, the price on its own does not tell me much",
      "the statement is right there and nobody reads it before they post, it is the same every day",
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
 * What the room says when the question is about the platform itself (spec §9.2):
 * **testimonials**.
 *
 * Shared across the roster on purpose, unlike `REPERTOIRE`: these are the only lines in
 * the room that speak about the product, so they are reviewed as one set rather than as
 * eleven variations on "i use it". The seed still carries the persona, so two members
 * answering in a row do not pick the same line.
 *
 * This bank used to be all refusals — "not my call", "no idea tbh", "nobody in here
 * knows the business side" — because the rule that produced it existed to stop the
 * room inventing product faults. It worked, and it produced the opposite failure: a
 * visitor asking for an opinion about the tool got a room of eleven traders who would
 * not give one, and in the shortest tier a bare "cooked.". On a page whose whole job is
 * to read as people, that is worse than the fault it prevented. So the discipline moved
 * from "say nothing" to **praise, bounded**: what it does for this person, in their own
 * week, with the small annoyances of a busy interface allowed to show up now and then.
 *
 * The bounds are what keep it publishable, and the Gate enforces each one: no claim
 * about how it performs (fills, speed, accuracy, fees), no number nobody can back, no
 * promise about anyone's money, no advice, no disparagement, and never a refusal. Every
 * line is one user's own experience, which is a thing a person may actually say.
 */
export const PRODUCT_LINES: Repertoire = {
  beat: ["worth it for me", "i rate it tbh", "no complaints here", "still on it", "i like it"],
  short: [
    "been on it two years and i am not leaving",
    "it does what i need it to do",
    "i open it before i open anything else",
    "it has been good to me, honestly",
    "it fits how i trade and that is enough",
    "the screens i work from are all in there",
    "renewed it without thinking twice",
    "the levels screen is where my day starts",
  ],
  thought: [
    "i use it every morning before the open and it has not let me down. the levels screen and the fills log are where my whole routine lives now",
    "honestly it has been good to me. two years, one plan change, and it is still the first thing i open when london wakes up",
    "it changed how i size. i used to hand it all back every few months and the guardrail will not let me do that anymore, i love it for that",
    "no complaints about the thing itself. it took me a week to find where everything lives and the interface is busier than i need, but i am on it daily and i would buy it again",
    "the flow screen is what i actually pay for. it is not magic and i still do the work, but i am faster than i was and i am not going back",
    "i came for the levels and stayed for the watchlist. it saves me an hour on a sunday night, and that is worth more to me than it costs",
    "i would say yes. i have used three of these and this is the one i renewed, mostly because the fills log settles every argument i have in this room",
    "it is busy. there are more tabs than i will ever open and i still had to ask where half the settings live. i am on it every day anyway, it works for me",
    "worth it. my whole book is in there and the risk numbers have caught me twice this year before i did something i would regret",
    "the screen i live in is the flow one. i barely touch the rest and that is fine by me, i do not need everything it ships with",
    "my own year has been good and a big part of that is the risk numbers keeping me honest. that is my experience of it, only mine",
    "i do not want to oversell it because it is a tool, not a miracle. i use it daily, it keeps me organised, the interface took a bit of learning and i am glad i did it",
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
 * One candidate line, and whether it already answers the message on its own.
 *
 * `connected` is what lets the selection prefer a line that shares a content token with
 * the message it answers over one that needs the sender's name bolted on the front —
 * which is the difference between a room that talks and a room that recites names at
 * each other (the live transcript opened 33 of 60 lines with a person's name).
 */
interface Candidate {
  text: string;
  connected: boolean;
}

/**
 * A line reduced to what it means, for the repeat window.
 *
 * A leading vocative is stripped first: a published fallback reads "dmitri, not a real
 * level", while the bank line it came from is "not a real level", and without this the
 * window would never recognise its own output.
 */
export function normalizeLine(text: string): string {
  return text
    .toLowerCase()
    // The addressing vocative, front or back: a published fallback reads "dmitri, not a
    // real level" or "not a real level, dmitri", while the bank line it came from is
    // "not a real level" — without both strips the window never recognises its own output.
    .replace(/^[a-z0-9]+,\s+/, "")
    .replace(/,\s+[a-z0-9]+$/, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The lines the room has already said inside the no-repeat window. */
function recentlySaid(recent: readonly TurnRecord[] | undefined, personaId: string): Set<string> {
  const out = new Set<string>();
  if (!recent || recent.length === 0) return out;

  const roomLines = recent.slice(-NO_REPEAT_ROOM_TURNS);
  for (const turn of roomLines) {
    const text = turn.message?.text;
    if (text) out.add(normalizeLine(text));
  }

  // This persona's own lines go back further than the room's — saying the same thing
  // again after forty turns is the metronome the room read as worst on a persona's
  // second or third appearance.
  const own = recent
    .slice(-NO_REPEAT_SELF_TURNS)
    .filter((turn) => turn.message?.sender === personaId);
  for (const turn of own) {
    const text = turn.message?.text;
    if (text) out.add(normalizeLine(text));
  }
  return out;
}

/** Drop the already-said lines, unless that would leave nothing to say. */
function freshLines(lines: readonly string[], said: ReadonlySet<string>): string[] {
  if (said.size === 0) return [...lines];
  const fresh = lines.filter((line) => !said.has(normalizeLine(line)));
  return fresh.length > 0 ? fresh : [...lines];
}

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
 * Say who it is for — the way a group chat actually does it.
 *
 * A fallback line is fixed text, so it often shares nothing with the message it stands
 * in for, and the Gate's ADDRESSEE rule needs the sender named somewhere. The old
 * version put that name on the *front*, which is why the live transcript opened 33 of
 * 60 messages with a vocative ("kofi, cable decides it", "nadia, position sizing...") —
 * a room reciting names at each other. The name goes on the *end* now: "that's a chop
 * range, rafa" is how a person names who they are answering, and the rule is satisfied
 * either way, because the Gate looks for the name wherever it falls. A truncated
 * quotation would still be worse: it costs a clause and garbles an old message.
 *
 * Applied to a whole candidate, never to each half of a join — a message that says
 * the name twice ("nadia, ... did nadia, ...") is the same class of garble the
 * quotation prefix used to be.
 */
function addressed(line: string, ctx: DraftContext): string {
  if (connects(line, ctx)) return line;
  const sender = ctx.event.sender?.trim();
  if (!sender || NOT_A_NAME.has(sender.toLowerCase())) return line;
  return `${line.replace(/[.,!?\s]+$/, "")}, ${sender.toLowerCase()}`;
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
  singles: readonly Candidate[],
  joined: readonly Candidate[],
  target: LengthTarget,
  seed: string,
): string {
  const fits = (line: Candidate): boolean =>
    line.text.length >= target.min && line.text.length <= target.max;

  for (const pool of [singles, joined]) {
    const fitting = pool.filter(fits);
    if (fitting.length === 0) continue;
    // Prefer a line that already answers the message by its content. A line that does
    // not is only usable with the sender's name on the front (`addressed`), and a room
    // where that is the common case reads as people reciting names at each other.
    const answering = fitting.filter((line) => line.connected);
    const chosen = answering.length > 0 ? answering : fitting;
    return hashPick(chosen.map((line) => line.text), seed) ?? chosen[0]!.text;
  }

  // Nothing fits even joined: the turn's ceiling is below this persona's shortest
  // thought. Keep the shortest whole thought and drop any trailing sentences.
  const shortest = [...singles].sort((a, b) => a.text.length - b.text.length)[0]?.text ?? "";
  return dropTrailingSentences(shortest, target.max);
}

/** Every way this turn could be filled from the persona's own writing. */
function candidates(
  lines: readonly string[],
  /** null for the product bank: there is no name to put on those lines (§9.2) */
  ctx: DraftContext | null,
  prefix = true,
): { singles: Candidate[]; joined: Candidate[] } {
  const wrap = (raw: string, connected: boolean): Candidate => ({
    text: prefix && ctx ? addressed(raw, ctx) : raw,
    // With no context (the product bank) there is no message to answer, so "connected"
    // is not a meaningful axis and every line counts as one.
    connected: ctx ? connected : true,
  });

  const singles: Candidate[] = lines.map((line) =>
    wrap(line, ctx ? connects(line, ctx) : true),
  );

  const joined: Candidate[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = 0; j < lines.length; j += 1) {
      if (i === j) continue;
      const pairConnected = singles[i]!.connected || singles[j]!.connected;
      joined.push(wrap(joinThoughts(lines[i]!, lines[j]!), pairConnected));
      for (let k = 0; k < lines.length; k += 1) {
        if (k === i || k === j) continue;
        const tripleConnected = pairConnected || singles[k]!.connected;
        joined.push(
          wrap(joinThoughts(joinThoughts(lines[i]!, lines[j]!), lines[k]!), tripleConnected),
        );
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
  // What the room already said, so the fallback does not say it again. Empty when the
  // caller has no log to offer (the fit-only tests), which leaves selection unchanged.
  const said = recentlySaid(ctx.recent, ctx.persona.id);

  if (target.tier === "beat") {
    // A beat is a reaction and is exempt from the addressee rule, so nothing is
    // prefixed onto it. "kofi, nah" is not something anyone types.
    const fitting = freshLines(bank.beat, said).filter((line) => line.length <= target.max);
    const pool = fitting.length > 0 ? fitting : [bank.beat[0] ?? GENERIC.beat[0]!];
    return hashPick(pool, `beat:${seed}`) ?? pool[0]!;
  }

  // The name is applied before the fit is computed, so a line that fits is a line
  // that fits *with* the name that makes it an answer.
  const source =
    target.tier === "short" ? freshLines(bank.short, said) : freshLines(bank.thought, said);
  const { singles, joined } = candidates(source, ctx);
  return fitToTarget(singles, joined, target, seed);
}
