/**
 * The real Voice seam — P1.
 *
 * Replaces the P0 `cannedDraft` path for any persona that carries a `model`
 * (spec §15). When the Voice path is unavailable — no model, no key, every
 * provider erroring or coming back empty — the turn falls back to the canned
 * draft and records why, so the room degrades to a quiet canned line rather than
 * corrupting or stalling.
 *
 * The prompt's whole job is that a line should read like a person texting in a
 * traders' group chat, not like a model answering a question. So it carries the
 * character sheet, a recent slice of the real transcript, a per-turn delivery
 * hint, and an explicit licence to be casual, off-topic and slightly messy.
 *
 * On top of that sit the **human flaws** (HUMAN_FLAWS): a chat where every turn
 * is on-topic, polite and well-punctuated reads as a machine no matter how good
 * each individual line is. Most turns just get answered; a minority drift off
 * the subject, needle someone, reach for slang, or get typed too fast. A flaw
 * that leaves the quoted subject behind is reported as `drift`, which is what
 * lets `advance()` stop holding that turn to the Gate's ADDRESSEE rule.
 */

import { cannedDraft } from "./drafts";
import { FallbackProvider, OpenRouterProvider, openRouterKeys } from "./provider";
import type { ChatProvider } from "./provider";
import { lengthTarget, TEXTING_RULE } from "./register";
import { hashPick } from "./rng";
import type { AgendaEvent, Persona, TurnRecord, WorldState } from "./types";

export interface VoiceDraftOptions {
  persona: Persona;
  event: AgendaEvent;
  world: WorldState;
  seq: number;
  /** retry number; a canned fallback uses it to vary the line the way P0 did */
  attempt?: number;
  /** recent log, newest last — lets the line connect to the room, not just the quote */
  recent?: readonly TurnRecord[];
  /**
   * Agent 2's memory of this companion, already rendered (§7.3). Only the part the
   * shared transcript cannot show: an older digest plus older verbatim lines.
   */
  memory?: string;
  /** why the previous attempt was rejected (spec §8.4's REVISE arrow) */
  critique?: string;
  /** injectable keys; when absent the environment's keys are used (pass `[]` for none) */
  keys?: string[];
  /** injectable provider; when absent one is built from `model` + keys */
  provider?: ChatProvider;
}

export interface VoiceDraftResult {
  text: string;
  /** the model that actually answered, when the Voice ran */
  model: string | null;
  usage: { tokensIn: number; tokensOut: number; cost: number } | null;
  /** true when a model produced the text */
  usedVoice: boolean;
  /** true when the text came from the canned draft instead */
  fallback: boolean;
  /** why the canned draft was used, for the turn's audit note */
  reason: string | null;
  /**
   * true when this turn's flaw licensed it to leave the subject it was answering.
   * `advance()` reads this to drop the Gate's ADDRESSEE rule for that one turn —
   * a person who changes the subject mid-chat has not failed anything.
   */
  drift: boolean;
}

const NL = "\n";

/**
 * The marker a double-texting turn puts between its two messages.
 *
 * A visible sentinel rather than a blank line, because a blank line is also how a
 * model formats a memo — and "two paragraphs" is one of the shapes the Gate
 * rejects. `splitBeats` is exported so `advance()` splits the same way the prompt
 * asked for.
 */
export const BEAT_BREAK = "|||";

/** The two messages of a burst, or a single-element array for an ordinary turn. */
export function splitBeats(text: string): string[] {
  return text
    .split(BEAT_BREAK)
    .map((beat) => beat.trim())
    .filter((beat) => beat !== "")
    .slice(0, 2);
}

/** How the turn is delivered. One hint per turn, chosen so repeat turns differ. */
const DELIVERY_HINTS: readonly string[] = [
  "Answer them in your own words — one clear thought, not a report and not a list.",
  "Keep it short and a bit blunt, like you're in the middle of something else.",
  "Push back or disagree — you never just agree with the room.",
  "It's a group chat: once your point is made, it's fine to drift somewhere off-topic — the game, the weekend, food, whatever you're into.",
  "React like you only half-read it. Casual, a little distracted.",
  "Ask them something back — you're curious what they think.",
  "Vary how you start. Don't open the way your last message opened.",
  "Keep it real and a touch rough — a small typo or a dropped word is fine.",
];

/** Temperatures are named so the spread is intentional and reviewable. */
const TEMPERATURES = [0.65, 0.8, 0.95, 1.05] as const;

/** One way this turn can be imperfect. */
export interface VoiceFlaw {
  /** the directive handed to the model */
  text: string;
  /**
   * true when following it means the line stops answering the message it was
   * given. Drift is a legitimate human move, so those turns are not held to the
   * Gate's ADDRESSEE check (spec §8.1).
   */
  drift?: boolean;
  /**
   * true when following it means sending two messages, not one. `advance()` splits
   * on `BEAT_BREAK` and publishes each half as its own turn, so double-texting is a
   * real pair of bubbles rather than one message with a line break in it.
   */
  burst?: boolean;
  /**
   * Flaws that need material in the character file. A persona with no slang list,
   * or no results of its own, is never told to reach for either — that is how a
   * persona avoids inventing a vocabulary or a track record it does not have.
   */
  needs?: "slang" | "results";
}

/**
 * The flaws of human communication (spec §8.1's ADDRESSEE rule notwithstanding).
 *
 * The neutral entries are load-bearing: they are the majority, so the flaws stay
 * occasional. A room where every message drifts or sneers is a different kind of
 * metronome — a caricature instead of a person.
 *
 * Picked per (persona, turn) with `hashPick`, so the same log always produces the
 * same room and two consecutive turns rarely share a flaw.
 */
/** The one flaw that needs a vocabulary behind it (see `flawFor`). */
const SLANG_FLAW =
  "Use American slang the way you actually talk — one word, no explaining it, no quotation marks, no capitals if you never use them.";

const HUMAN_FLAWS: readonly VoiceFlaw[] = [
  { text: "Just answer in your own voice. Nothing special needed." },
  { text: "Just answer in your own voice. Nothing special needed." },
  // The beats. Half of what makes a group chat read as people is that not every
  // message is a sentence: sometimes it is "nah", "fair", "lol" or an emoji.
  { text: "React, do not explain. Two or three words, or one emoji, or a single word of agreement or dismissal. Nothing more." },
  { text: "Answer with the shortest thing that is still true. No context, no reason, no follow-up." },
  { text: "Just answer — short, the way you'd type it between two other things." },
  { text: "Answer the room, then get back to your screen." },
  {
    text: "Halfway through, drift onto something that has nothing to do with the topic — a game, your day, a plan, a grudge. Do not come back to it.",
    drift: true,
  },
  {
    text: "You only skimmed the last few messages. React to the part you caught, even if it is not the part that matters.",
    drift: true,
  },
  {
    text: "Answer something from a few messages back, as if you read the room at your own speed.",
    drift: true,
  },
  {
    text: "Open a completely unrelated thought. It can just sit there — you do not have to justify it.",
    drift: true,
  },
  { text: SLANG_FLAW, drift: true, needs: "slang" },
  {
    text: "Say one concrete thing about what you actually get out of this platform — something it has done for you, or something about it that still annoys you. No selling, no features list.",
    needs: "results",
  },
  {
    text: "Mention a real result you have had lately, the way you would tell a friend — including the part that did not work.",
    needs: "results",
  },
  { text: "Be a bit of a dick about it. Needle whoever is being smug." },
  { text: "Somebody in here is wrong and you have no patience for it today. Say so plainly." },
  { text: "Dunk on the worst take in the room instead of answering the question." },
  { text: "Type it like a text: lowercase, no full stop at the end, a typo you cannot be bothered to fix." },
  { text: "Say something that does not need a reply. Not everything has to move the conversation on." },
  {
    text: `Send it as two messages, the way you double-text when you are typing fast. Write the first, then a line with only ${BEAT_BREAK}, then the second. Keep both short and do not restate the first.`,
    burst: true,
  },
  { text: "Change your mind halfway through the sentence and leave it like that." },
  { text: "Be slightly too honest for a trading chat, then move on like you did not say it." },
  { text: "Sound bored. You have seen this setup before and you are not impressed." },
  { text: "Just answer in your own voice. Nothing special needed." },
];

/**
 * The flaw for one turn, once the persona and the turn's authorship are applied.
 * Exported so the rule is testable on its own.
 *
 * Two substitutions happen after the dice roll: an engine turn is never handed a
 * drifting flaw (its lines are book updates and world reports, where leaving the
 * subject is incoherent rather than human), and a persona with no slang list of
 * its own is never told to reach for slang it does not have.
 */
export function flawFor(persona: Persona, seq: number, engine = false): VoiceFlaw {
  const roll = hashPick(HUMAN_FLAWS, `flaw:${persona.id}:${seq}`) ?? HUMAN_FLAWS[0]!;
  if (engine) return HUMAN_FLAWS[0]!;
  if (roll.needs === "slang" && !(persona.sheet.slang?.length ?? 0)) return HUMAN_FLAWS[0]!;
  if (roll.needs === "results" && !(persona.sheet.results?.length ?? 0)) return HUMAN_FLAWS[0]!;
  return roll;
}

/**
 * Does this turn's flaw license two messages instead of one?
 *
 * `advance()` asks before it splits, so a stray marker in some other turn's text is
 * never treated as a burst — only the turns that were actually asked to double-text
 * can produce one.
 */
export function isBurstTurn(persona: Persona, seq: number, engine = false): boolean {
  return flawFor(persona, seq, engine).burst === true;
}

const VOICE_SYSTEM = [
  "You are one real person in a private traders' group chat.",
  "You are NOT an assistant and NOT a bot. Never say or imply that you are an AI or a model.",
  "Never offer help, never summarise, never explain what you are doing, never use markdown.",
  "Everyone here is a trader: they share ideas, argue, joke, and talk about ordinary life too.",
  "You write like a person texting — short, specific, a little imperfect — not like a terminal or a news report.",
  // The license that makes the room read like people rather than a chat log.
  "Real people in a group chat are not tidy: they go on tangents, give each other a hard time, use slang, misspell a word, leave a thought half-finished, and answer a message two messages late. Do that.",
  "You may be annoyed, dismissive, mean or bored. Not every message deserves a polite reply, and you do not have to be fair.",
  "Never write a tidy summary, never balance both sides, never wrap up neatly, and never end with a question just to keep the chat going.",
  // The slang half of "sound human". It is American on purpose and the rule is
  // explicit, because a persona written as Lagos or Accra will otherwise reach
  // for pidgin that nobody in a US room would say.
  "Slang is American and current — 'cooked', 'locked in', 'mid', 'delulu', 'aura', 'rent free', 'glazing', 'crash out', 'no cap', 'down bad', 'yapping', 'touch grass', whatever people your age actually say. Never explain it, never put it in quotes, and never use slang from another country, another language or a local dialect.",
  // The single most recognisable "a model wrote this" tell: the balanced
  // aphorism, and the clipped slogan fragment. Both are banned by shape, not by
  // example alone, because the shape is what the model reaches for.
  "Never write in slogans or aphorisms. 'It is not narrative, it is levels', 'I do not analyze shares, I analyze the plan', 'Patience trade, no touching stops' are machine-shaped and no trader texts like that. No parallel-contrast sentence (not X, it is Y), no slogan opened with someone's name, no three clipped fragments in a row.",
  "Talk in plain sentences, the way you would say it out loud with your mouth. Uneven, trailing, half-finished is fine. Polished, quotable and perfectly balanced is not.",
  TEXTING_RULE,
  // The other half of the same tell: advice that arrives with a label on it, or a
  // message split into paragraphs like a memo, is a document, not a text.
  "One message is one thought in one paragraph. Never label your own line ('Rule:', 'Reminder:', 'Note:', 'Takeaway:', 'Bottom line:'), never split it into paragraphs with a blank line, and never sign it off.",
  // Testimonials: real, occasional, mixed. A room that only praises the product
  // reads as an advert, which is exactly what it must not be.
  "You have used this platform long enough to have real results and real complaints about it. Now and then — not often — you mention one concrete detail about what it has actually done for you or for your week. Never as an advert: no percentage you cannot back, no feature list, no telling anyone they should try it.",
].join(" ");

/** The persona's character sheet, re-injected every turn so voice survives compaction. */
function personaSystem(persona: Persona): string {
  const { sheet } = persona;
  const lines: string[] = [
    VOICE_SYSTEM,
    "",
    `You are ${persona.name}, ${persona.role}.`,
    `Your view: ${sheet.stance}`,
    `How you talk: ${sheet.register.note}.`,
    `Things you do: ${sheet.quirks.join("; ")}.`,
  ];

  if (sheet.personality && sheet.personality.length > 0) {
    lines.push(`You as a person: ${sheet.personality.join("; ")}.`);
  }
  if (sheet.banter && sheet.banter.length > 0) {
    lines.push(`Stuff you bring up: ${sheet.banter.join("; ")}.`);
  }
  if (sheet.slang && sheet.slang.length > 0) {
    lines.push(`Slang you actually reach for (at most one per message): ${sheet.slang.join("; ")}.`);
  }
  if (sheet.results && sheet.results.length > 0) {
    lines.push(
      `Your own results on this platform, which you bring up rarely and only as a concrete detail: ${sheet.results.join("; ")}.`,
    );
  }
  if (sheet.forbiddenClaims && sheet.forbiddenClaims.length > 0) {
    lines.push(`Never claim: ${sheet.forbiddenClaims.join("; ")}.`);
  }

  lines.push("", "Real messages you have sent (your voice — match this, don't copy it):");
  lines.push(...sheet.sampleLines.map((line) => `- ${line}`));

  return lines.join(NL);
}

/**
 * How many messages of the shared transcript reach the Voice. Exported because the
 * memory block asks the same question from the other side: anything newer than this
 * window is already in the transcript, so sending it again would be paying twice.
 */
export const RECENT_CHAT_MESSAGES = 10;

/** A slice of the actual transcript, so the line is a reply and not a monologue. */
function recentChat(recent: readonly TurnRecord[] | undefined, me: string): string {
  if (!recent || recent.length === 0) return "";
  const lines = recent
    .filter((turn) => turn.message)
    .slice(-RECENT_CHAT_MESSAGES)
    .map((turn) => {
      const message = turn.message!;
      const who = message.sender === me ? "you" : message.sender;
      const text = message.text.replace(/\s+/g, " ").trim().slice(0, 180);
      return `- ${who}: ${text}`;
    });
  if (lines.length === 0) return "";
  return [`<chat so far, most recent last>`, ...lines, "</chat so far>"].join(NL);
}

/**
 * The turn the persona is answering: topic, side, world and the quoted message.
 *
 * Two shapes, because the engine addresses the room itself: a responder answers
 * a `<message from ...>`, while an engine turn is given the tape and its own read
 * of it, so it does not appear to be answering itself.
 */
function turnUser(args: {
  event: AgendaEvent;
  world: WorldState;
  persona: Persona;
  seq: number;
  recent?: readonly TurnRecord[];
  memory?: string;
  critique?: string;
}): string {
  const { event, world, persona, seq, recent, memory, critique } = args;
  const target = lengthTarget(persona, seq);
  const engine = event.authoredBy === "engine";
  const quoted =
    event.quoted == null
      ? "<opening the room>"
      : engine
        ? [`<the tape, and your own read of it>`, event.quoted, "</the tape>"].join(NL)
        : [`<message from ${event.sender}>`, event.quoted, "</message>"].join(NL);
  const hint = hashPick(DELIVERY_HINTS, `voice:${persona.id}:${seq}`) ?? DELIVERY_HINTS[0]!;
  const flaw = flawFor(persona, seq, engine).text;
  const chat = recentChat(recent, persona.id);

  return [
    memory ? `<what you remember about ${event.sender}>${NL}${memory}${NL}</what you remember>` : "",
    memory
      ? `You may use what you remember, the way a person uses a memory of a real conversation. Never recite it, never say that you remember it, never list it back.`
      : "",
    chat,
    `<what the room is on>${event.topic.title}</what the room is on>`,
    `<your side>${event.topic.sides[event.side]}</your side>`,
    `<today>${world.digest}</today>`,
    quoted,
    "",
    hint,
    critique
      ? `<your last attempt was rejected for this reason>${critique}${NL}Write a different line that fixes exactly that. Do not rephrase the rejected one.`
      : "",
    `<how you send it>${flaw}</how you send it>`,
    "",
    `Write ONE chat message as ${persona.name}.`,
    `Length for this one: ${target.label}. Roughly ${target.min} to ${target.max} characters; the length matters as much as the words.`,
    "Plain text only. No name prefix, no quotes, no markdown, no *asterisk actions*.",
    "Only mention a price or level that is already in the chat above or in <today>. Do not invent numbers, tickers or facts.",
  ]
    .filter((part) => part !== "")
    .join(NL);
}

export async function voiceDraft(opts: VoiceDraftOptions): Promise<VoiceDraftResult> {
  const { persona, event, world, seq } = opts;
  const engineFlaw = event.authoredBy === "engine";

  if (!persona.model) {
    return cannedResult(opts, `no model on ${persona.id}`);
  }

  const provider = opts.provider ?? resolveVoiceProvider(persona, opts.keys);
  if (!provider) {
    return cannedResult(opts, `no voice provider for ${persona.id}`);
  }

  const temperature =
    hashPick(TEMPERATURES, `temp:${persona.id}:${seq}`) ?? TEMPERATURES[1];

  try {
    const response = await provider.chat({
      system: personaSystem(persona),
      messages: [
        {
          role: "user",
          content: turnUser({
            event,
            world,
            persona,
            seq,
            recent: opts.recent,
            memory: opts.memory,
            critique: opts.critique,
          }),
        },
      ],
      // A line is one short message, not a problem to think about. Qwen is a
      // reasoning model, and left on it spends the whole budget on a scratchpad
      // and returns empty `content` — the same failure the Gate's judge hit, which
      // is why `reasoning: "off"` is the shared default here.
      reasoning: "off",
      temperature,
      maxTokens: 260,
      timeoutMs: 15_000,
    });

    const text = response.text.trim();
    if (!text) {
      return cannedResult(opts, `empty completion from ${provider.model}`);
    }

    return {
      text,
      model: response.model,
      usage: response.usage,
      usedVoice: true,
      fallback: false,
      reason: null,
      drift: flawFor(persona, seq, engineFlaw).drift ?? false,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return cannedResult(opts, `voice call failed for ${persona.id}: ${detail}`);
  }
}

/** The P0 draft, with the reason the Voice did not run. */
function cannedResult(opts: VoiceDraftOptions, reason: string): VoiceDraftResult {
  return {
    text: cannedDraft({
      persona: opts.persona,
      event: opts.event,
      world: opts.world,
      seq: opts.seq,
      attempt: opts.attempt ?? 1,
    }),
    model: null,
    usage: null,
    usedVoice: false,
    fallback: true,
    reason,
    // A canned line answers what it was given, so it never claims the drift licence.
    drift: false,
  };
}

/**
 * The persona's model, with its `fallbackModel` behind it (spec §10.3).
 *
 * A Voice failure is usually a single provider being flaky, not a bad prompt, so
 * the fallback is a failover to a *different* model rather than a retry of the
 * same one. Distinct families are the point: the spare should not fail for the
 * same reason the primary did.
 */
function resolveVoiceProvider(persona: Persona, keys?: string[]): ChatProvider | undefined {
  const allKeys = keys ?? openRouterKeys();
  if (allKeys.length === 0) return undefined;
  if (!persona.model) return undefined;

  const models = [persona.model, persona.fallbackModel].filter(
    (model): model is string => Boolean(model),
  );
  const providers = models.map(
    (model, index) => new OpenRouterProvider({ apiKey: allKeys[index % allKeys.length]!, model }),
  );

  return providers.length === 1 ? providers[0]! : new FallbackProvider(providers);
}
