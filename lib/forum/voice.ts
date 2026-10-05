/**
 * The real Voice seam — P1 only.
 *
 * Replaces the P0 `cannedDraft` path for any persona that carries a `model`
 * (spec §15). When the Voice path is unavailable — no model, no key, a provider
 * error or an empty completion — the turn falls back to the canned draft and
 * records why, so the room degrades to a quiet canned line rather than corrupting
 * or stalling.
 */

import { cannedDraft } from "./drafts";
import { OpenRouterProvider, openRouterKeys } from "./provider";
import type { ChatProvider } from "./provider";
import type { AgendaEvent, Persona, WorldState } from "./types";

export interface VoiceDraftOptions {
  persona: Persona;
  event: AgendaEvent;
  world: WorldState;
  seq: number;
  /** retry number; a canned fallback uses it to vary the line the way P0 did */
  attempt?: number;
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
}

const NL = "\n";

const VOICE_SYSTEM = [
  "You are playing one persona in a trading-desk group chat.",
  "Answer as that persona, in that persona's own words, to the specific message the turn is addressed to.",
  "Do not break character. Do not narrate. Do not announce that you are an AI.",
  "Keep the line inside the persona's register band and stance.",
].join(" ");

/** The persona's character sheet, re-injected every turn so voice survives compaction. */
function personaSystem(persona: Persona): string {
  const { sheet } = persona;
  const lines: string[] = [
    VOICE_SYSTEM,
    "",
    `name: ${persona.name}`,
    `role: ${persona.role}`,
    `stance: ${sheet.stance}`,
    `register: ${sheet.register.minChars}-${sheet.register.maxChars} chars — ${sheet.register.note}`,
    `quirks: ${sheet.quirks.join("; ")}`,
  ];

  if (sheet.forbiddenClaims && sheet.forbiddenClaims.length > 0) {
    lines.push(`never claim: ${sheet.forbiddenClaims.join("; ")}`);
  }

  lines.push("", "recent sample lines (your voice):");
  lines.push(...sheet.sampleLines.map((line) => `- ${line}`));

  return lines.join(NL);
}

/** The turn the persona is answering: topic, side, world and the quoted message. */
function turnUser(event: AgendaEvent, world: WorldState): string {
  const quoted =
    event.quoted == null
      ? "<opening the room>"
      : [`<quoted from ${event.sender}>`, event.quoted, "</quoted>"].join(NL);

  return [
    `<topic>${event.topic.title}</topic>`,
    `<side>${event.topic.sides[event.side]}</side>`,
    `<world digest>${world.digest}</world digest>`,
    quoted,
    "",
    "Reply in one message. Stay inside the register band.",
  ].join(NL);
}

export async function voiceDraft(opts: VoiceDraftOptions): Promise<VoiceDraftResult> {
  const { persona, event, world } = opts;

  if (!persona.model) {
    return cannedResult(opts, `no model on ${persona.id}`);
  }

  const provider = opts.provider ?? resolveVoiceProvider(persona.model, opts.keys);
  if (!provider) {
    return cannedResult(opts, `no voice provider for ${persona.id}`);
  }

  try {
    const response = await provider.chat({
      system: personaSystem(persona),
      messages: [{ role: "user", content: turnUser(event, world) }],
      // A line is one short message, not a problem to think about. Qwen is a
      // reasoning model, and left on it spends the whole 220-token budget on a
      // scratchpad and returns empty `content` — the same failure the Gate's
      // judge hit, which is why `reasoning: "off"` is the shared default here.
      reasoning: "off",
      temperature: 0.7,
      maxTokens: 220,
      timeoutMs: 20_000,
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
  };
}

function resolveVoiceProvider(model: string, keys?: string[]): OpenRouterProvider | undefined {
  const allKeys = keys ?? openRouterKeys();
  if (allKeys.length === 0) return undefined;
  return new OpenRouterProvider({ apiKey: allKeys[0]!, model });
}
