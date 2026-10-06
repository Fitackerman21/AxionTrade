/** Public surface of the AI forum core. See docs/ai-forum-spec.md. */

export type * from "./types";
export {
  advance,
  isPendingHumanTurn,
  previewHumanReply,
  LEASE_TTL_MS,
  RECENT_TURNS_WINDOW,
} from "./advance";
export type {
  AdvanceOptions,
  AdvanceResult,
  AdvanceStatus,
  HumanReplyPreview,
  ResponderPlan,
} from "./advance";
export { FileStore, forumRoot, messagesFromTurns, openForumStore } from "./store";
export type { ForumStore, HumanMessageArgs } from "./store";
export { PgStore } from "./pg-store";
export type { PgStoreOptions } from "./pg-store";
export { catchUp, roomMode } from "./catchup";
export type { CatchUpOptions, CatchUpReport } from "./catchup";
export { runWorker } from "./worker";
export type { WorkerHandle, WorkerOptions, WorkerTurnEvent } from "./worker";
export {
  DEFAULT_HUMAN_REPLY_SEC,
  gapMsFor,
  humanReplyDueAt,
  humanReplyRange,
  meanGapMs,
  nextTurnAt,
  turnsOwed,
} from "./clock";
export { buildMessage, publish, publishUnpublished } from "./publisher";
export { contentTokens } from "./gate";
export {
  DEFAULT_GATE_CONFIG,
  GATE_CODES,
  RUBRIC_ITEMS,
  buildJudgePrompt,
  parseRubric,
  resolveGateConfig,
  rubricFailures,
  runDeterministicChecks,
  runGate,
  shouldSampleLlm,
} from "./gate";
export type {
  GateCode,
  GateContext,
  GateFailure,
  GateRunOptions,
  GateVerdict,
  JudgePrompt,
  LlmRubric,
  RubricItem,
} from "./gate";
export {
  FallbackProvider,
  OPENROUTER_URL,
  OpenRouterProvider,
  ProviderError,
  judgeModels,
  modelFamily,
  openRouterKey,
  openRouterKeys,
  resolveJudgeProvider,
  sameFamily,
} from "./provider";
export type { ChatMessage, ChatProvider, ChatRequest, ChatResponse, ChatUsage } from "./provider";
export { nextEvent } from "./agenda";
export type { AgendaContext } from "./agenda";
export { pickSpeaker, recencyFromTurns } from "./schedule";
export type { SpeakerChoice, SpeakerContext } from "./schedule";
export { respondersFor } from "./permissions";
export type { PermissionLookup } from "./permissions";
export { cannedDraft } from "./drafts";
export type { DraftContext } from "./drafts";
export {
  BEAT_BREAK,
  flawFor,
  isBurstTurn,
  RECENT_CHAT_MESSAGES,
  splitBeats,
  voiceDraft,
} from "./voice";
export { lengthFault, lengthTarget, TEXTING_RULE, typographyFault } from "./register";
export type { LengthTarget } from "./register";
export type { VoiceDraftOptions, VoiceDraftResult, VoiceFlaw } from "./voice";
export {
  clampDigest,
  companionLabel,
  emptyMemory,
  estimateTokens,
  foldTurn,
  injectionText,
  memoryKey,
  memoryTokens,
  needsCompaction,
} from "./memory";
export type { MemoryTurn } from "./memory";
export { buildArchivistPrompt, compactMemory, memoryNote, resolveArchivistProvider } from "./archivist";
export type { ArchivistPrompt, CompactionResult } from "./archivist";
export { hashPick, hashString, mulberry32, orderByWeightThenSeed } from "./rng";
