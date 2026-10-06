/**
 * Canned drafts — the fallback when the Voice has no model or the call fails.
 *
 * These are no longer a P0 stand-in: they are what a persona says when the provider
 * is down, when the Gate has exhausted its retries, and on engine turns whose line
 * fell outside the register. So they have to survive the same reading as a real
 * message, which means the same thumb-typography rule the Gate enforces: no em
 * dashes, no semicolons, no ellipsis character, lowercase where the persona is
 * lowercase.
 *
 * There are two families, because a persona now has two shapes of turn. A short
 * turn gets a beat ("fair", "nah", a verdict), a normal or long turn gets the
 * sentence-shaped template. Trimming a template down to 20 characters would produce
 * a sentence with its head cut off, which is worse than a canned beat.
 */

import { contentTokens } from "./gate";
import { lengthTarget } from "./register";
import { hashPick } from "./rng";
import type { AgendaEvent, Persona, PersonaId, WorldState } from "./types";

export interface DraftContext {
  persona: Persona;
  event: AgendaEvent;
  world: WorldState;
  seq: number;
  attempt: number;
}

/** What a beat template needs to fill: only the persona's own posture. */
const BEATS: Record<PersonaId, string[]> = {
  mara: ["fair.", "I'm not arguing with that 😤", "patience trade.", "ok that's funny"],
  dmitri: ["noise.", "that's not the driver.", "rates decide this.", "we'll see."],
  sol: ["nah", "cooked", "eh it's fine", "lol ok", "down bad fr"],
  toko: ["one scalp and out.", "same script.", "30 minutes, that's it.", "mid."],
  priya: ["watchlist.", "noted.", "flows say otherwise.", "I'd wait."],
  kofi: ["bet", "cable decides it", "tight stop, then out", "salty ngl"],
  lena: ["tbh that tracks.", "mid.", "flow screen disagrees.", "no notes."],
  raul: ["flows lag.", "copper knew first.", "same as last week.", "meh."],
  nadia: ["half size.", "no new risk.", "know your gap.", "that's the job."],
  rafa: ["tape says wait.", "no trade there.", "flat into the print.", "not my level."],
  jess: ["no fills.", "checking the tape.", "that's a nothing level.", "flow's quiet."],
};

const TEMPLATES: Record<PersonaId, string[]> = {
  mara: [
    "ok I'll bite on {topic}. {side} and I'm not going to pretend otherwise 🔋",
    "{quoted}. this is why I don't rush. {side}. small size, clean mind.",
    "the patience trade doesn't care what the room thinks. {side}. 😤",
  ],
  dmitri: [
    "{topic} is downstream of the bond market. {side}. everything else is noise around it.",
    "macro funds are positioned for exactly this. {side}, and the spreads will confirm it.",
    "{quoted} is a single-name question. I don't trade single-name questions.",
  ],
  sol: [
    "lol ok. {topic}? {side}. simply built different 🫡",
    "{quoted}. cool story but I'm buying dips with my whole face",
    "nobody in this room understands {topic} and I include myself in that 💀",
  ],
  toko: [
    "{topic}: first 30 minutes or nothing. {side}.",
    "{quoted}. I'll scalp it and be hands off by lunch. screen time capped 🎯",
    "2 of 3 green on that level. {side}. tomorrow, same script.",
  ],
  priya: [
    "my book is hedged into the print, so {topic} is a flows question for me. {side}.",
    "{quoted}. adding this to the watchlist. {side}, with a one-day lag.",
    "singapore was quiet. {side}. I'd rather be early on this than loud.",
  ],
  kofi: [
    "cable is what matters, everything else is decoration. {topic}: {side}",
    "{quoted}. if the level gives way I'm in with a tight stop. {side}",
    "my level lives another day 😅 {side}",
  ],
  lena: [
    "my flow screen disagrees with the price on {topic}. {side}, tbh.",
    "{quoted}. divergences like this usually resolve in price's favour. {side}.",
    "I'd frame {topic} as an allocation question, not a timing one. {side}.",
  ],
  raul: [
    "the whole complex moves together on {topic}. {side}.",
    "{quoted}. flows lag. {side}.",
    "copper was already saying this last week. {side}.",
  ],
  nadia: [
    "risk desk view on {topic}: {side}. half size until the event passes.",
    "{quoted}. know your gap tolerance before the print. {side}.",
    "no new risk into the number. {side}. that's the whole job.",
  ],
  rafa: [
    "on {topic} the tape is fine, the macro driver is not. {side}.",
    "{quoted}. that's a desk level, not a level you can hold overnight. {side}.",
    "I'm flat into the print and I'll tell you why: {side}.",
  ],
  jess: [
    "flow on {topic} is one-sided and I don't love that. {side}.",
    "{quoted}. no fills on this side until the open settles. {side}.",
    "I checked the tape twice on {topic}. {side}, and no one is hedging it.",
  ],
};

const GENERIC = [
  "On {topic}: {side}. My book says {stance}, so I'm not moving.",
  "{quoted}. that's the part I'd argue with. {side}.",
];

/** Keep the quoted text short enough to sit inside a bubble. */
function snippet(text: string | undefined, max = 72): string {
  if (!text) return "no comment";
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}...`;
}

function fill(template: string, ctx: DraftContext): string {
  const { event, persona, world, seq } = ctx;
  const quirk = hashPick(persona.sheet.quirks, `${persona.id}:${seq}`) ?? "";

  return template
    .replaceAll("{topic}", event.topic.title)
    .replaceAll("{side}", event.topic.sides[event.side])
    .replaceAll("{friction}", event.topic.friction[event.side])
    .replaceAll("{quoted}", snippet(event.quoted))
    .replaceAll("{stance}", persona.sheet.stance)
    .replaceAll("{quirk}", quirk)
    .replaceAll("{digest}", snippet(world.digest, 90));
}

function trimToWord(text: string, max: number): string {
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut)
    .replace(/[,;:\s]+$/, "")
    .replace(/[—–]/g, ",");
}

/**
 * Honour this turn's length target, which is the same one the Gate will check.
 *
 * Padding is deliberate when the text is short of the floor, because a two-word
 * answer where a sentence was asked for is a different failure. It pads one word at
 * a time: appending a whole phrase could overshoot the ceiling and then be trimmed
 * back below the floor, which is how a "full" line came out shorter than the target
 * it was built for. A beat target never needs padding and never gets any.
 */
const PAD_WORDS =
  "and honestly that is the whole read on it from where I am sitting right now anyway if you want the long version".split(
    " ",
  );

function clampToTarget(text: string, persona: Persona, seq: number): string {
  const target = lengthTarget(persona, seq);
  let out = text.trim();
  if (out.length > target.max) out = trimToWord(out, target.max);

  // Word by word, and cycling if the narrowest ceiling needs more than one pass.
  // The bound is a guard, not a plan: a word is a few characters and every tier's
  // window is wider than that.
  for (let i = 0; out.length < target.min && i < 80; i += 1) {
    const next = `${out} ${PAD_WORDS[i % PAD_WORDS.length]!}`;
    if (next.length > target.max) break;
    out = next;
  }
  return out;
}

/**
 * Does the line connect to the message it is answering?
 *
 * The fallback is published on turns where nobody checks it (the Gate is skipped for
 * engine lines, and a rejected draft is replaced by this line *after* the Gate has
 * run), so it has to satisfy the rule itself rather than be repaired by a retry.
 */
function answersTheMessage(text: string, quoted: string | undefined): boolean {
  if (!quoted) return true;
  const theirs = contentTokens(quoted);
  if (theirs.size === 0) return true;
  for (const token of contentTokens(text)) if (theirs.has(token)) return true;
  return false;
}

export function cannedDraft(ctx: DraftContext): string {
  const target = lengthTarget(ctx.persona, ctx.seq);
  const beats = BEATS[ctx.persona.id] ?? BEATS.mara;

  // A beat answers on its own: it is a reaction, and it is exempt from the
  // addressee rule (see `checkAddressee`), so nothing may be prefixed onto it.
  if (target.tier === "beat") {
    return hashPick(beats, `beat:${ctx.persona.id}:${ctx.seq}:${ctx.attempt}`) ?? beats[0]!;
  }

  const template = hashPick(TEMPLATES[ctx.persona.id] ?? GENERIC, `${ctx.persona.id}:${ctx.seq}`);
  const base = fill(template ?? GENERIC[0]!, ctx);

  // One reference at most, separated by a full stop. A retry used to stack the
  // critique on top of the quote reference, which produced lines like
  // "a longer wick, flows lag, my level lives another day" — three sentences in a
  // trench coat, and worse than the draft they replaced.
  const reference = !answersTheMessage(base, ctx.event.quoted)
    ? snippet(ctx.event.quoted, 34)
    : ctx.attempt > 1
      ? snippet(ctx.event.topic.friction[ctx.event.side], 40)
      : "";

  return clampToTarget(reference === "" ? base : `${reference}. ${base}`, ctx.persona, ctx.seq);
}
