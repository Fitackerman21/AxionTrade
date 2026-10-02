/**
 * Canned drafts — **P0 stand-in only, deleted in P1 when the real Voice lands.**
 *
 * There are no LLM calls in P0 (spec §14). These templates exist so the log
 * reads like a room, which is what makes the scheduling visible. They are
 * per-persona so that a wrong speaker is obvious at a glance.
 */

import { hashPick } from "./rng";
import type { AgendaEvent, Persona, PersonaId, WorldState } from "./types";

export interface DraftContext {
  persona: Persona;
  event: AgendaEvent;
  world: WorldState;
  seq: number;
  attempt: number;
}

const TEMPLATES: Record<PersonaId, string[]> = {
  jev: [
    "Session note on {topic}: conviction holding, no change to the book. {side}.",
    "Logged. {quoted} Read stands — path matters more than target.",
    "Book update — {side}. Nothing changes until the level breaks or the fill prints.",
  ],
  mara: [
    "ok I'll bite on {topic}. {side} and I'm not going to pretend otherwise 🔋",
    "{quoted} — this is why I don't rush. {side}. Small size, clean mind.",
    "the patience trade doesn't care what the room thinks. {side}. 😤",
  ],
  dmitri: [
    "{topic} is downstream of the bond market. {side}. Everything else is noise around it.",
    "macro funds are positioned for exactly this. {side} — and the spreads will confirm it.",
    "{quoted} is a single-name question. I don't trade single-name questions.",
  ],
  sol: [
    "lol ok. {topic}? {side}. I'm simply built different 🫡",
    "{quoted} — cool story but I'm buying dips with my whole face",
    "nobody in this room understands {topic} and I include myself in that 💀",
  ],
  toko: [
    "{topic}: first 30 minutes or nothing. {side}.",
    "{quoted} — I'll scalp it and be hands off by lunch. Screen time capped 🎯",
    "2 of 3 green on that level. {side}. Tomorrow, same script.",
  ],
  priya: [
    "my book is hedged into the print, so {topic} is a flows question for me. {side}.",
    "{quoted} — adding this to the watchlist. {side}, with a one-day lag.",
    "Singapore was quiet. {side} — I'd rather be early on this than loud.",
  ],
  kofi: [
    "cable is what matters, everything else is decoration. {topic}: {side}",
    "{quoted} — if the level gives way I'm in with a tight stop. {side}",
    "my level lives another day 😅 {side}",
  ],
  lena: [
    "my flow screen disagrees with the price on {topic}. {side}, tbh.",
    "{quoted} — divergences like this usually resolve in price's favour. {side}.",
    "I'd frame {topic} as an allocation question, not a timing one. {side}.",
  ],
  raul: [
    "the whole complex moves together on {topic}. {side}.",
    "{quoted} — flows lag. {side}.",
    "copper was already saying this last week. {side}.",
  ],
  nadia: [
    "risk desk view on {topic}: {side}. Half size until the event passes.",
    "{quoted} — know your gap tolerance before the print. {side}.",
    "no new risk into the number. {side}. That's the whole job.",
  ],
};

const GENERIC = [
  "On {topic}: {side}. My book says {stance}, so I'm not moving.",
  "{quoted} — that's the part I'd argue with. {side}.",
];

/** Keep the quoted text short enough to sit inside a bubble. */
function snippet(text: string | undefined, max = 72): string {
  if (!text) return "no comment";
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
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
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, "");
}

/**
 * Honour the persona's own register band. This is the same envelope the Gate's
 * LENGTH check will read in P2, which is how the room avoids flattening every
 * voice into one casual register.
 */
function clampToRegister(text: string, persona: Persona): string {
  const { minChars, maxChars } = persona.sheet.register;
  let out = text.trim();
  if (out.length > maxChars) out = trimToWord(out, maxChars);
  if (out.length < minChars) out = `${out} ${persona.sheet.stance}`.trim();
  return out;
}

export function cannedDraft(ctx: DraftContext): string {
  const templates = TEMPLATES[ctx.persona.id] ?? GENERIC;
  const template = hashPick(templates, `${ctx.persona.id}:${ctx.seq}`) ?? GENERIC[0];

  let text = fill(template ?? "", ctx);
  // A retry gets a short acknowledgement of the critique so the attempt is
  // visibly different rather than a re-roll of the same line.
  if (ctx.attempt > 1) text = `${snippet(ctx.event.topic.friction[ctx.event.side], 40)} — ${text}`;

  return clampToRegister(text, ctx.persona);
}
