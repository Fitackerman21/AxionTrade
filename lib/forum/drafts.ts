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
import {
  answerCandidates,
  CHECK_IN_LINES,
  greetingFor,
  isCheckIn,
  MARKET_WORDS,
  ownLinesFor,
  productIntentOf,
  type ProductIntent,
} from "./knowledge";
import { lengthTarget, tierOptionsFor, type LengthTarget } from "./register";
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
      "not going to pretend i have a view on this one, i am just holding and waiting",
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
      "no direction from me here, just taking the flows and letting the session settle",
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
      // The engine persona carries the openings, the world ticks and every recap, so it
      // speaks several times as often as anyone else and its bank is the one that runs dry
      // first. Measured, that was the whole of the remaining repetition in the audit: one of
      // these lines came back eight times inside twenty-five messages. A deeper bank is the
      // fix, because no join can hide a run that lives inside a single line.
      "i would rather sit out a session than take a position i have to explain to myself in the morning",
      "someone always has a reason for a move after it happens, and before it happens the room is quiet",
      "two sessions in a row where nothing happens and you start inventing a setup out of boredom",
      "whether it goes up today matters less to me than whether i am still trading in a month",
      "i have watched this handle four times today and it has not done anything any of those times",
      "keep it small enough that being wrong is boring, that is the size i am after",
      "the first hour is where the bad ideas get made and the middle of the session is where they get paid for",
      "everyone in here got their level off the same three accounts, so of course it looks like it works",
      "i do not need a view on every hour of the day, most of them are not worth having one about",
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
  /**
   * This line is the member's own writing, not one of the shared reviewed pools.
   *
   * Only the product and greeting banks carry the distinction, because they are the only
   * ones built from two sources. Measured on the live question shapes, the shared pool was
   * winning far more than it should: asked "what is this place exactly", **0%** of 264
   * answers came from the member's own lines, because the shared pool held a line with the
   * word "place" in it and the member's own lines did not. Eleven names, four distinct
   * answers. A member answers in their own words whenever they have any that fit; the
   * shared pools are the fallback for the length a member has nothing of their own at.
   */
  own: boolean;
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
 *
 * A question keeps its question mark, and the name moves in front of it: "what's your read,
 * rafa?" is how somebody asks a person something, and stripping the mark turned every
 * ask-back line into a statement — the exact tell the question rate is there to catch.
 */
function addressed(line: string, ctx: DraftContext): string {
  if (connects(line, ctx)) return line;
  const sender = ctx.event.sender?.trim();
  if (!sender || NOT_A_NAME.has(sender.toLowerCase())) return line;
  const name = sender.toLowerCase();
  const body = line.replace(/[.,!?\s]+$/, "");
  return /\?\s*$/.test(line) ? `${body}, ${name}?` : `${body}, ${name}`;
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

  // Four passes, in this order: the member's own line that uses the question's words, then
  // the bank's line that does, then the member's own line that does not, then the bank's. A
  // single whole thought is tried before two joined, within each pass.
  //
  // Why the question's words outrank the member's name: measured over the live messages, the
  // failure that started all of this was the room answering a person with something that
  // shared **nothing** with what they asked, and the shared pools were written to fix exactly
  // that. So a line that echoes the asker beats a line that only sounds like the member — and
  // when a member has both, they win, which is the whole point of writing their lines in the
  // words their questions actually use.
  const passes: Array<(line: Candidate) => boolean> = [
    (line) => line.own && line.connected,
    (line) => !line.own && line.connected,
    (line) => line.own,
    () => true,
  ];

  // Whole thoughts before joins, always: a join can be made to fit any length, so trying it
  // first would make every turn a paragraph and every line longer than it needed to be.
  for (const pool of [singles, joined]) {
    for (const wanted of passes) {
      const fitting = pool.filter((line) => fits(line) && wanted(line));
      if (fitting.length === 0) continue;
      return hashPick(fitting.map((line) => line.text), seed) ?? fitting[0]!.text;
    }
  }

  // Nothing fits even joined: the turn's ceiling is below this persona's shortest
  // thought. Keep the shortest whole thought and drop any trailing sentences.
  const shortest = [...singles].sort((a, b) => a.text.length - b.text.length)[0]?.text ?? "";
  return dropTrailingSentences(shortest, target.max);
}

/**
 * Do these two lines say the same thing?
 *
 * Joining is how a longer turn is met from a bank of whole thoughts, and it is a good move
 * until the two thoughts are the same thought. Measured in the room: a join produced "that's an
 * allocation question for me, not a timing one, different books. this is an allocation question
 * for me, the timing of it is somebody else's problem" — one message, the same clause twice,
 * and a reader sees a machine rather than somebody repeating themselves. Two shared runs of
 * four words is that, where one is usually a stock phrase the whole room uses ("what is the
 * read on").
 */
function tooSimilar(first: string, second: string): boolean {
  const runs = (text: string): Set<string> => {
    const words = normalizeLine(text).split(" ").filter(Boolean);
    const out = new Set<string>();
    for (let i = 0; i + 4 <= words.length; i += 1) out.add(words.slice(i, i + 4).join(" "));
    return out;
  };
  const mine = runs(first);
  const theirs = runs(second);
  if (mine.size === 0 || theirs.size === 0) return false;
  let shared = 0;
  for (const run of mine) if (theirs.has(run)) shared += 1;
  return shared >= 2;
}

/** Every way this turn could be filled from the persona's own writing. */
function candidates(
  lines: readonly string[],
  /** null for the product bank: there is no name to put on those lines (§9.2) */
  ctx: DraftContext | null,
  prefix = true,
  own: ReadonlySet<string> = EMPTY_OWN,
): { singles: Candidate[]; joined: Candidate[] } {
  const wrap = (raw: string, connected: boolean): Candidate => ({
    text: prefix && ctx ? addressed(raw, ctx) : raw,
    // With no context (the product bank) there is no message to answer, so "connected"
    // is not a meaningful axis and every line counts as one.
    connected: ctx ? connected : true,
    own: own.has(normalizeLine(raw)),
  });

  const singles: Candidate[] = lines.map((line) =>
    wrap(line, ctx ? connects(line, ctx) : true),
  );

  const joined: Candidate[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = 0; j < lines.length; j += 1) {
      if (i === j) continue;
      if (tooSimilar(lines[i]!, lines[j]!)) continue;
      const pairConnected = singles[i]!.connected || singles[j]!.connected;
      joined.push(wrap(joinThoughts(lines[i]!, lines[j]!), pairConnected));
      for (let k = 0; k < lines.length; k += 1) {
        if (k === i || k === j) continue;
        if (tooSimilar(lines[i]!, lines[k]!) || tooSimilar(lines[j]!, lines[k]!)) continue;
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
/** Does this line use a word the message it answers used? */
function sharesWord(line: string, question: string | undefined): boolean {
  if (!question) return false;
  const theirs = contentTokens(question);
  if (theirs.size === 0) return false;
  for (const token of contentTokens(line)) if (theirs.has(token)) return true;
  return false;
}

/**
 * The same whole-thought joiners `candidates` builds, with "answers the question" measured
 * against the question rather than against a name.
 *
 * The shared banks answer a question that came from a person the room has no name for, so
 * there is nothing to address: what makes one of them the right line is that it uses the
 * words the person used. That is the difference between "it's in the account, the funding
 * screen" and "worth it for me" as an answer to "how do i put money in".
 */
function answeringCandidates(
  lines: readonly string[],
  question: string | undefined,
  own: ReadonlySet<string> = EMPTY_OWN,
): { singles: Candidate[]; joined: Candidate[] } {
  const wrap = (raw: string): Candidate => ({
    text: raw,
    connected: sharesWord(raw, question),
    own: own.has(normalizeLine(raw)),
  });
  const singles = lines.map(wrap);
  const joined: Candidate[] = [];
  const ownPair = (i: number, j: number): boolean =>
    singles[i]!.own && singles[j]!.own;
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = 0; j < lines.length; j += 1) {
      if (i === j) continue;
      if (tooSimilar(lines[i]!, lines[j]!)) continue;
      const pair = joinThoughts(lines[i]!, lines[j]!);
      joined.push({ ...wrap(pair), own: ownPair(i, j) });
      for (let k = 0; k < lines.length; k += 1) {
        if (k === i || k === j) continue;
        if (tooSimilar(lines[i]!, lines[k]!) || tooSimilar(lines[j]!, lines[k]!)) continue;
        joined.push({ ...wrap(joinThoughts(pair, lines[k]!)), own: ownPair(i, j) && singles[k]!.own });
      }
    }
  }
  return { singles, joined };
}

/** No member has written any of these lines — the default for a shared bank. */
const EMPTY_OWN: ReadonlySet<string> = new Set<string>();

interface TierPools {
  beat: string[];
  short: string[];
  thought: string[];
}

/**
 * Choose the line for a turn out of a tiered bank: fresh first, then the one that answers.
 *
 * The order is deliberate. A line the room has already published is a repeat whatever else
 * is true of it, so the no-repeat window is applied before the fit and the fit before the
 * preference for an answer — and when a bank is exhausted the freshest pool is still used
 * rather than a name being bolted onto a line that answers nothing.
 */
function pickFromBanks(args: {
  pools: TierPools;
  target: LengthTarget;
  seed: string;
  personaId: string;
  question?: string;
  recent?: readonly TurnRecord[];
  /** the lines in these pools that the persona wrote; see `Candidate.own` */
  own?: ReadonlySet<string>;
}): string {
  const { pools, target, seed, personaId, question, recent, own } = args;
  const said = recentlySaid(recent, personaId);

  if (target.tier === "beat") {
    const fitting = freshLines(pools.beat, said).filter((line) => line.length <= target.max);
    const pool = fitting.length > 0 ? fitting : [pools.beat[0] ?? "ok."];
    const answering = pool.filter((line) => sharesWord(line, question));
    return hashPick(answering.length > 0 ? answering : pool, `beat:${seed}`) ?? pool[0]!;
  }

  const source = freshLines(
    target.tier === "short" ? pools.short : pools.thought,
    said,
  );
  const { singles, joined } = answeringCandidates(source, question, own);
  // A whole line first, then two of them joined. The order matters and was measured: pushing
  // a turn onto a join whenever the bank is dry swaps one tell for a worse one — an exact
  // line repeated (weight 0.32 in the audit) becomes an eight-word run shared between two
  // different lines (weight 0.14). Deeper banks are the answer to a dry bank, not joins.
  return fitToTarget(singles, joined, target, seed);
}

/**
 * What the room says when the question is about the platform (spec §9.2): an **answer**.
 *
 * This used to be a shared bank of twenty-five testimonials, and the live measurement is
 * what condemned it: asked "how do i put money in btw", the room could only ever reply
 * "worth it. my whole book is in there", in whichever name the scheduler drew — because
 * nothing in a testimonial can be an answer to a question about mechanics. The lines now
 * come from `knowledge.ts`, chosen for the question's own shape, so a funding question gets
 * the funding screen and a loss-limit question gets the loss limit, in the member's own
 * words where they have any and in a reviewed pooled line where they do not.
 *
 * `PRODUCT_LINES` is still the fallback for the one case with no intent: a caller that has
 * no event to read (a test, or an older path) still gets a reviewed line rather than a shrug.
 */
export function productDraft(ctx: {
  persona: Persona;
  seq: number;
  attempt: number;
  event?: AgendaEvent;
  recent?: readonly TurnRecord[];
}): string {
  const target = lengthTarget(ctx.persona, ctx.seq, tierOptionsFor(ctx.event));
  const intent = ctx.event?.productIntent;
  const question = ctx.event?.quoted;
  const seed = `product:${intent ?? "generic"}:${ctx.persona.id}:${ctx.seq}:${ctx.attempt}`;

  const pools = intent
    ? {
        beat: answerCandidates(intent, ctx.persona.id, "beat"),
        short: answerCandidates(intent, ctx.persona.id, "short"),
        thought: answerCandidates(intent, ctx.persona.id, "normal"),
      }
    : PRODUCT_LINES;

  return pickFromBanks({
    pools,
    target,
    seed,
    personaId: ctx.persona.id,
    question,
    recent: ctx.recent,
    own: intent ? ownSet(ownLinesFor(intent, ctx.persona.id)) : undefined,
  });
}

/** The lines this member wrote, in the form the banks compare in. */
function ownSet(lines: readonly string[]): ReadonlySet<string> {
  return new Set(lines.map(normalizeLine));
}

/**
 * What the room says when somebody walks in (knowledge.ts: `GREETINGS`).
 *
 * The measured room greeted nobody: 0 of 6 replies to a visitor opened with a welcome, and
 * the opening line of a newcomer's chat — "yo, just joined. what is this place" — came back
 * as a view on position sizing. A greeting is the one turn where the answer is a hello, so
 * it is its own bank rather than a roll of the dice, and when the greeting also asks what the
 * place is, the room's answer to that question is appended to it.
 */
export function greetingDraft(ctx: DraftContext): string {
  const target = lengthTarget(ctx.persona, ctx.seq, tierOptionsFor(ctx.event));
  // "how is everyone doing" is a greeting with a question in it, and the question is about
  // the room rather than the market. Answering it with a welcome reads as a bot that did not
  // read past the hello; the room says how it actually is instead.
  if (isCheckIn(ctx.event.quoted ?? "")) {
    return pickFromBanks({
      pools: { beat: CHECK_IN_LINES, short: CHECK_IN_LINES, thought: CHECK_IN_LINES },
      target,
      seed: `checkin:${ctx.persona.id}:${ctx.seq}:${ctx.attempt}`,
      personaId: ctx.persona.id,
      question: ctx.event.quoted,
      recent: ctx.recent,
    });
  }
  const welcome = greetingFor(ctx.persona.id);
  // "what is this place" is a question the room has a reviewed answer for (the `room`
  // intent), and a greeting that asks it deserves both halves: the hello, then the answer.
  const asksWhatThisIs = productIntentOf(ctx.event.quoted ?? "") === "room";
  const room = answerCandidates("room", ctx.persona.id, "short");
  // The hello always comes first: a line that answers "what is this place" without greeting
  // somebody who just walked in is a room answering a question at nobody. So the combined
  // lines are built hello-first, and the short pool is filtered to what actually fits a
  // one-liner tier rather than letting a bare answer line in.
  const joined = welcome.flatMap((hello) => room.map((line) => joinThoughts(hello, line)));
  const joinedShort = joined.filter((line) => line.length <= 80);
  const pools: TierPools = asksWhatThisIs
    ? {
        beat: welcome,
        short: joinedShort.length > 0 ? joinedShort : welcome,
        thought: joined,
      }
    : { beat: welcome, short: welcome, thought: welcome };

  return pickFromBanks({
    pools,
    target,
    seed: `greet:${ctx.persona.id}:${ctx.seq}:${ctx.attempt}`,
    personaId: ctx.persona.id,
    question: ctx.event.quoted,
    recent: ctx.recent,
    own: ownSet(ownLinesFor("room", ctx.persona.id)),
  });
}

/**
 * Small questions the room does not have product facts for are answered socially.
 *
 * "who talks the most" is not a market question and not a product question, and the room
 * used to answer it with a tape read ("not a level, that's a chop range") because the only
 * bank it had was market talk. Answering a person's actual question with a plausible social
 * answer is what a room of people does; the generic pool is the deflection, which is also
 * what a person says when they do not know.
 */
const SOCIAL_ANSWERS: ReadonlyArray<{ match: RegExp; lines: string[] }> = [
  {
    match: /\bwho talks (?:the )?most\b|\bwho (?:is|'?s) the (?:most|chatty)|\bwho posts\b/i,
    lines: [
      // Short enough to be a beat as well as an answer, because "who talks the most" is
      // exactly the kind of question the room answers with three words.
      "rafa talks the most",
      "rafa talks the most and it is not close 😂",
      "rafa talks the most by a mile, then sol when crypto is moving",
      "rafa talks the most. you will work it out in about ten minutes",
    ],
  },
  {
    match: /\bwhere (?:is|are) (?:everyone|you all|y'?all|you) from\b|\bwhich (?:countries|cities)\b/i,
    lines: [
      "all over. lagos, chicago, london, tokyo, singapore",
      "spread out. most of us are on at odd hours because of it",
      "everywhere honestly. the timestamps in here are a mess 😅",
    ],
  },
  {
    match: /\bhow long (?:have you|you been|has everyone)\b/i,
    lines: [
      "a few years on my own, two on here",
      "long enough to have opinions about people's stops",
      "years. some of us longer than we will admit",
    ],
  },
  {
    match: /\b(?:do you|you all) know each other|\bis this a private (?:group|room)\b/i,
    lines: [
      "we are just the people who use the app at the same time of day",
      "nah, we all ended up here the same way you did",
      "some of us talk every day, i have never met any of them 😅",
    ],
  },
];

const SOCIAL_GENERIC: readonly string[] = [
  "no idea honestly 😅",
  "you would have to ask them",
  "not something i know anything about",
  "i have genuinely never thought about that",
  "pass on that one, somebody else will know",
  "fair question and i have no answer for it",
];

/**
 * The question shapes an off-thread message is still answered from the fact base.
 *
 * `agenda.ts` flags a message as a product question when it names the platform or asks a
 * trust question; a plain "what does it cost" uses neither, so it arrives here as off-topic.
 * Answering it with the room's own cost lines is the difference between an answer and "no
 * idea honestly". `trust` is deliberately absent: "real" and "legit" are ordinary words in a
 * trading room, and a social question that happens to contain one should not be answered
 * with a statement about the visitor's money.
 */
const SOCIAL_PLATFORM_INTENTS = new Set<ProductIntent>([
  "deposit",
  "withdraw",
  "limits",
  "autonomy",
  "how-it-works",
  "start",
  "cost",
  "room",
]);

/** The room's answer to a question that is neither about the market nor the platform. */
export function socialDraft(ctx: DraftContext): string {
  const question = ctx.event.quoted ?? "";
  const intent = productIntentOf(question);
  if (SOCIAL_PLATFORM_INTENTS.has(intent)) {
    return productDraft({
      persona: ctx.persona,
      seq: ctx.seq,
      attempt: ctx.attempt,
      // The turn was not flagged as a product question, so the intent is attached here for
      // the answer to route by.
      event: { ...ctx.event, productIntent: intent },
      recent: ctx.recent,
    });
  }

  const target = lengthTarget(ctx.persona, ctx.seq, tierOptionsFor(ctx.event));
  const matched = SOCIAL_ANSWERS.filter((entry) => entry.match.test(question));
  const pool = matched.length > 0 ? matched.flatMap((entry) => entry.lines) : [...SOCIAL_GENERIC];
  const said = recentlySaid(ctx.recent, ctx.persona.id);

  if (target.tier === "beat") {
    // A matched answer beats a shrug even at two or three words: "rafa talks the most" is the
    // same length as "no idea honestly" and it is an answer.
    const fit = (lines: readonly string[]): string[] =>
      freshLines(lines, said).filter((line) => line.length <= target.max);
    const matchedFit = fit(pool);
    const genericFit = fit(SOCIAL_GENERIC);
    const chosen = matchedFit.length > 0 ? matchedFit : genericFit.length > 0 ? genericFit : ["no idea"];
    return hashPick(chosen, `social:${ctx.seq}`) ?? chosen[0]!;
  }

  const source = freshLines(pool, said);
  const { singles, joined } = answeringCandidates(source, question);
  const picked = fitToTarget(singles, joined, target, `social:${ctx.persona.id}:${ctx.seq}`);
  return picked;
}

/**
 * A question the room cannot answer gets asked back, on the turns delivered that way.
 *
 * The measured room never asked anything: 0 questions in 270 canned lines and 5.4% in the
 * lines a model wrote. A reply that ends in a question is the commonest way a person keeps a
 * conversation alive, and it costs nothing when the room has nothing to add.
 */
export function askBackFor(ctx: DraftContext): string {
  const target = lengthTarget(ctx.persona, ctx.seq, tierOptionsFor(ctx.event));
  const bank = ASK_BACKS[ctx.persona.id] ?? ASK_BACK_GENERIC;
  const said = recentlySaid(ctx.recent, ctx.persona.id);
  // The same name-on-the-end treatment every other fallback gets. A question rarely uses
  // the words of the message it answers — "what's your read?" shares nothing with "flows
  // lag" — and the Gate's ADDRESSEE rule asks a non-beat line to name the person it answers
  // or share a word with them. Without this, the one turn shape that is *supposed* to have
  // no subject in it would be the one shape the Gate reliably threw out. On a person's
  // message the sender is not a name (`NOT_A_NAME`), so nothing is appended and the line
  // stays a question at them rather than about them.
  const pool = freshLines(bank, said).map((line) => addressed(line, ctx));
  const { singles, joined } = answeringCandidates(pool, ctx.event.quoted);
  return fitToTarget(singles, joined, target, `ask:${ctx.persona.id}:${ctx.seq}:${ctx.attempt}`);
}

const ASK_BACKS: Record<PersonaId, string[]> = {
  mara: [
    "what are you watching in here?",
    "what is your read on it?",
    "how long have you been on this one?",
    "i only do gold and indices really, what are you trading mostly? and are you on here all day or just the open?",
  ],
  jess: [
    "what was the flow though?",
    "are you in it or watching?",
    "how long have you been trading?",
    "i am mostly options flow, so i never have a clean read on the outright. what are you looking at, and do you trade the open or later?",
  ],
  dmitri: [
    "what is your read on rates?",
    "where do you get your prints?",
    "what is the driver from where you sit?",
    "i trade rates and treat everything else as downstream of them. what do you trade, and is it a rates story for you at all?",
  ],
  sol: [
    "what are you holding?",
    "are you in or watching?",
    "what's your bag?",
    "i am mostly crypto and i ape first and think later, as everyone here will tell you. what do you trade, and how long have you been doing it?",
  ],
  toko: [
    "you scalping or holding?",
    "what time do you start?",
    "what's your plan for the first thirty minutes?",
    "i do the first thirty minutes and then i am gone, that is the whole strategy. what is yours, do you hold things overnight?",
  ],
  priya: [
    "what's your invalidation?",
    "how long do you hold usually?",
    "do you hedge the prints?",
    "i keep a watchlist and hedge into the prints, so my timing is boring on purpose. what do you trade, and where is your invalidation on it?",
  ],
  kofi: [
    "you trade cable or gold?",
    "what's your stop?",
    "you on this all day or just the open?",
    "i am fx, cable mostly, tight stop and out. what do you trade, and are you on it all day or just around the open?",
  ],
  lena: [
    "do you look at flows at all?",
    "how do you size it?",
    "what are you allocating to?",
    "i am funds and etfs so i am slower than everyone in here. what are you in, and do you read the flow before you size it?",
  ],
  raul: [
    "do you watch the physicals?",
    "what were you trading before this?",
    "are you long the complex?",
    "i do commodities and i care about the physical side more than the screen. what do you trade, and do you look at the physicals at all?",
  ],
  rafa: [
    "what's your read?",
    "you in this or flat?",
    "what do you trade mostly?",
    "index futures for me, and i would rather miss it than pay up for it. what do you trade, and are you in this one or flat?",
  ],
  nadia: [
    "where's your stop?",
    "how much are you risking?",
    "what's your size on it?",
    "i am the risk desk so i ask this of everyone. what do you trade, and how much of the account are you putting on it?",
  ],
};

const ASK_BACK_GENERIC: readonly string[] = [
  "what do you trade?",
  "what's your read?",
  "how long have you been at this?",
  "what do you trade mostly, and are you on here all day or just around the open?",
];


export function cannedDraft(ctx: DraftContext): string {
  // One router, so every caller and every test sees the same answer for the same turn. The
  // four shapes this bank was never written for, in the order they take precedence: a
  // greeting is answered with a greeting; a question about the platform is answered from the
  // fact base; a turn the room is delivering as a question is that question; and a question
  // off the thread that names no market is answered socially. A question off the thread that
  // *does* name a market is market talk and falls through to the member's own bank.
  // A question about the platform wins over the hello when a message is both ("hey, how do i
  // deposit"). Answering the question is the thing the person is waiting for, and the greeting
  // still reaches the prompt on the Voice path.
  if (ctx.event.productQuestion) {
    return productDraft({
      persona: ctx.persona,
      seq: ctx.seq,
      attempt: ctx.attempt,
      event: ctx.event,
      recent: ctx.recent,
    });
  }
  if (ctx.event.greeting) return greetingDraft(ctx);
  if (ctx.event.replyMode === "askBack") return askBackFor(ctx);
  if (ctx.event.offTopic && !MARKET_WORDS.test(ctx.event.quoted ?? "")) return socialDraft(ctx);

  const target = lengthTarget(ctx.persona, ctx.seq, tierOptionsFor(ctx.event));
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
