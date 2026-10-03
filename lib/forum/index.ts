/** Public surface of the AI forum core. See docs/ai-forum-spec.md. */

export type * from "./types";
export { advance, LEASE_TTL_MS, RECENT_TURNS_WINDOW } from "./advance";
export type { AdvanceOptions, AdvanceResult, AdvanceStatus } from "./advance";
export { FileStore, forumRoot, messagesFromTurns, openForumStore } from "./store";
export type { ForumStore, HumanMessageArgs } from "./store";
export { catchUp, roomMode } from "./catchup";
export type { CatchUpOptions, CatchUpReport } from "./catchup";
export { runWorker } from "./worker";
export type { WorkerHandle, WorkerOptions, WorkerTurnEvent } from "./worker";
export { gapMsFor, meanGapMs, nextTurnAt, turnsOwed } from "./clock";
export { buildMessage, publish, publishUnpublished } from "./publisher";
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
  OPENROUTER_URL,
  OpenRouterProvider,
  ProviderError,
  modelFamily,
  openRouterKey,
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
export { hashPick, hashString, mulberry32, orderByWeightThenSeed } from "./rng";
