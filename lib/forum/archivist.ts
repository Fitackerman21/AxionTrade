/**
 * The Archivist — Agent 2 (spec §7.5, and steps 9–10 of the workflow).
 *
 * A thread's memory only grows; this is what keeps it from growing forever. When a
 * file crosses its token budget the Archivist is handed the existing digest plus
 * the new verbatim entries, and returns a replacement digest: one rolling
 * paragraph, in the persona's own voice, that preserves what a reader of the thread
 * would need — what was argued, what was decided, what is unresolved, and the
 * details that make a person recognisable (levels, tickers, names, jokes).
 *
 * Two rules are structural rather than conventional:
 *
 *   - **The character file is never touched.** This module writes digests into
 *     memory files; `personas.json` is bundled at build time and has no writer.
 *   - **The Archivist is never the persona's own model.** A model that compacts its
 *     own memory into its own style is silent persona drift, so the chain drops
 *     every candidate sharing the persona's family (the same guard the Gate uses).
 *
 * Failure is never fatal (§10.5): a failed compaction leaves the old file exactly
 * as it was and the room keeps talking with a longer buffer.
 */

import { clampDigest, companionLabel, estimateTokens, memoryTokens } from "./memory";
import { FallbackProvider, OpenRouterProvider, openRouterKeys, sameFamily } from "./provider";
import type { ChatProvider } from "./provider";
import type { MemoryConfig, MemoryEntry, MemoryFile, Persona, TurnUsage } from "./types";

export interface ArchivistPrompt {
  system: string;
  user: string;
}

/**
 * The compaction prompt.
 *
 * Written to be *voice-preserving*, not factual: a summary that reads like a
 * briefing would make the persona answer from it in briefing voice, which is the
 * failure the whole per-persona design exists to avoid.
 */
export function buildArchivistPrompt(args: {
  persona: Persona;
  companion: string;
  digest: string | null;
  entries: readonly MemoryEntry[];
  maxDigestChars: number;
}): ArchivistPrompt {
  const { persona, companion, digest, entries, maxDigestChars } = args;
  const who = companionLabel(companion);

  const system = [
    `You keep the private memory of one person in a traders' group chat: ${persona.name}, ${persona.role}.`,
    `Their way of talking: ${persona.sheet.register.note}.`,
    `Their view: ${persona.sheet.stance}.`,
    "",
    `Rewrite their notes about ${who} as ONE short paragraph of at most ${maxDigestChars} characters.`,
    "Write it in their own voice, first person, the way they would actually remember it — not as a report, not as a briefing, no bullet points, no headings.",
    "Keep: concrete levels, tickers, positions, decisions, disagreements, running jokes, who they were talking to, and anything still unresolved.",
    "Drop: greetings, pleasantries, restatements of other people's messages, and anything you are not sure about.",
    "Never invent a fact, a number or an event that is not in the notes. If the notes are thin, say less.",
    "Return the paragraph and nothing else — no preamble, no labels.",
  ].join("\n");

  const user = [
    digest ? `<notes-so-far>\n${digest}\n</notes-so-far>` : "<notes-so-far>(nothing yet)</notes-so-far>",
    "",
    `<new-messages with="${companion}">`,
    ...entries.map((entry) => `${entry.role === "me" ? persona.name : who}: ${entry.text}`),
    "</new-messages>",
    "",
    "Write the updated notes paragraph.",
  ].join("\n");

  return { system, user };
}

/**
 * The Archivist chain (spec §7.5, §10.3).
 *
 * Same shape as the judge chain: an ordered list of models, one logical caller,
 * failover on availability. Candidates sharing the persona's family are dropped at
 * resolution so a persona never quietly rewrites its own memory in its own style.
 */
export function resolveArchivistProvider(
  persona: Persona,
  config: MemoryConfig,
  keys: string[] = openRouterKeys(),
): ChatProvider | undefined {
  if (keys.length === 0) return undefined;

  const models = config.models
    .map((model) => model?.trim())
    .filter((model): model is string => Boolean(model))
    .filter((model) => !persona.model || !sameFamily(persona.model, model));
  if (models.length === 0) return undefined;

  const providers = models.map(
    (model, index) => new OpenRouterProvider({ apiKey: keys[index % keys.length]!, model }),
  );
  return providers.length === 1 ? providers[0]! : new FallbackProvider(providers);
}

export interface CompactionResult {
  file: MemoryFile;
  /** the model that wrote the digest, when one did */
  model: string | null;
  usage: TurnUsage | null;
  /** why nothing was compacted, when nothing was */
  skipped: string | null;
}

/**
 * Run Agent 2 on one thread.
 *
 * Returns the file with a new digest and a trimmed buffer. The result is *not*
 * written by this function: the caller owns durability, so a crash between here
 * and the write leaves the previous file in place (spec §7.5, never
 * truncate-then-write).
 */
export async function compactMemory(args: {
  persona: Persona;
  file: MemoryFile;
  config: MemoryConfig;
  provider?: ChatProvider;
  timeoutMs?: number;
}): Promise<CompactionResult> {
  const { persona, file, config } = args;
  const provider = args.provider ?? resolveArchivistProvider(persona, config);

  if (!provider) {
    return { file, model: null, usage: null, skipped: "no archivist provider available" };
  }
  if (file.recent.length === 0 && !file.digest) {
    return { file, model: null, usage: null, skipped: "nothing to compact" };
  }

  // Everything not kept verbatim is what the digest has to carry.
  const keep = Math.max(0, config.keepRecentTurns);
  const folded = file.recent.slice(0, Math.max(0, file.recent.length - keep));
  const entries = folded.length > 0 ? folded : file.recent;

  const prompt = buildArchivistPrompt({
    persona,
    companion: file.companion,
    digest: file.digest,
    entries,
    maxDigestChars: config.maxDigestChars,
  });

  try {
    const response = await provider.chat({
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      // A summary is not a problem to reason about: a reasoning model left on
      // spends its budget on a scratchpad and returns empty `content`.
      reasoning: "off",
      temperature: 0.4,
      maxTokens: 600,
      timeoutMs: args.timeoutMs ?? 20_000,
    });

    const digest = clampDigest(response.text, config.maxDigestChars);
    if (!digest) {
      return { file, model: null, usage: null, skipped: "archivist returned nothing" };
    }

    const kept = file.recent.slice(-keep);
    const next: MemoryFile = {
      ...file,
      recent: kept,
      digest,
      version: file.version + 1,
      updatedAt: Date.now(),
      compactions: file.compactions + 1,
      compactedBy: response.model,
    };

    return {
      file: next,
      model: response.model,
      usage: {
        provider: "archivist",
        model: response.model,
        tokensIn: response.usage.tokensIn,
        tokensOut: response.usage.tokensOut,
        estCost: response.usage.cost,
      },
      skipped: null,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { file, model: null, usage: null, skipped: `archivist failed: ${detail.slice(0, 160)}` };
  }
}

/** What a turn's note says about memory, for the log (spec §13.1). */
export function memoryNote(file: MemoryFile, compacted: CompactionResult): string {
  const tier = file.digest ? `digest v${file.version}` : "no digest yet";
  const parts = [
    `memory ${file.recent.length} recent / ${tier} / ${memoryTokens(file)} tok`,
    `~${estimateTokens(file.recent.map((entry) => entry.text).join(" "))} verbatim`,
  ];
  if (compacted.model) parts.push(`compacted by ${compacted.model}`);
  if (compacted.skipped) parts.push(compacted.skipped);
  return parts.join("; ");
}
