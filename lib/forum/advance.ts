/**
 * `advance()` — one turn (spec §3.1).
 *
 * This is the whole runtime. A 24/7 worker loops it; the lazy "wake the room"
 * path on /community calls it too. The lease and the monotonic `seq` are what
 * let both drivers exist without racing.
 *
 * P0/P5 run with canned drafts: no LLM Voice. P2 adds the Gate, which reviews
 * responder drafts and can leave a turn recorded-but-unpublished (spec §8.4).
 * Memory writes still arrive in P3, behind the same seams.
 */

import { nextEvent } from "./agenda";
import { compactMemory, memoryNote } from "./archivist";
import type { CompactionResult } from "./archivist";
import { cannedDraft } from "./drafts";
import { foldTurn, injectionText, memoryKey, needsCompaction } from "./memory";
import { isBurstTurn, RECENT_CHAT_MESSAGES, splitBeats, voiceDraft } from "./voice";
import { lengthTarget, typographyFault } from "./register";
import { resolveGateConfig, runGate } from "./gate";
import type { GateVerdict } from "./gate";
import { respondersFor } from "./permissions";
import { buildMessage, publish, publishUnpublished } from "./publisher";
import { resolveJudgeProvider } from "./provider";
import type { ChatProvider } from "./provider";
import { recencyFromTurns, pickSpeaker } from "./schedule";
import type { SpeakerChoice } from "./schedule";
import { humanReplyDueAt, humanReplyRange } from "./clock";
import { hashPick } from "./rng";
import type { ForumStore } from "./store";
import type {
  AgendaEvent,
  Attempt,
  Decision,
  ForumConfig,
  MemoryFile,
  Persona,
  PersonaId,
  TurnGate,
  TurnRecord,
  TurnUsage,
  WorldState,
} from "./types";

/** How much history the agenda and scheduler get to look at. */
export const RECENT_TURNS_WINDOW = 40;
/** Long enough to cover a slow turn, short enough to recover from a crash. */
export const LEASE_TTL_MS = 30_000;

export type AdvanceStatus =
  | "published"
  | "unpublished"
  | "lease-held"
  | "clock-rewind"
  | "deferred";

export interface AdvanceResult {
  status: AdvanceStatus;
  record: TurnRecord | null;
  reason?: string;
  /** for `deferred`: when the owed reply comes due (epoch ms) */
  dueAt?: number;
}

/**
 * Is the newest turn a person's message still waiting on a reply?
 *
 * A human record is the only one with a message, no chosen speaker and the
 * `HUMAN` trigger — a persona's reply is also triggered by a human but names the
 * persona that wrote it, so the two are never confused.
 */
/**
 * Plain predicate, not a type guard: it narrows on a *property*, and a type
 * predicate whose output type equals its input would make the negative branch
 * `never` for a caller that already holds a `TurnRecord`.
 */
export function isPendingHumanTurn(turn: TurnRecord | null | undefined): boolean {
  return Boolean(turn && turn.trigger === "HUMAN" && turn.chosen === null && turn.message);
}

export interface AdvanceOptions {
  now?: number;
  driver?: string;
  recentTurns?: number;
  /** inject the Gate's judge; by default it is resolved from config + env (§8.2) */
  judge?: ChatProvider;
  /** inject the Voice's provider (tests, dry runs); by default it comes from the persona's model */
  voiceProvider?: ChatProvider;
  /** inject Agent 2's provider; by default the archivist chain resolves from config (§7.5) */
  archivistProvider?: ChatProvider;
}

/**
 * The oldest message the Voice's transcript window already shows.
 *
 * Memory is injected *behind* that boundary: an older digest plus older verbatim
 * lines. Forward of it the transcript is exact and current, so repeating it in the
 * memory block would cost tokens to say the same thing twice.
 */
function transcriptWindowSeq(turns: readonly TurnRecord[]): number {
  const posted = turns.filter((turn) => turn.message);
  return posted[Math.max(0, posted.length - RECENT_CHAT_MESSAGES)]?.seq ?? 0;
}

/** Used for lease ownership; 0 where there is no process to name. */
export function processId(): number {
  return typeof process !== "undefined" && typeof process.pid === "number" ? process.pid : 0;
}

/**
 * Does a published line sit inside the register this turn was asked for?
 *
 * The Gate enforces this for responder drafts, but an engine turn bypasses the
 * Gate, so its line is checked here instead of being clamped: a tape read cut off
 * mid-sentence would read worse than the template it replaced. The check is the
 * same one the Gate runs — the turn's length target plus the thumb-typography rule
 * (`register.ts`) — so an engine line is held to the standard a human line is.
 */
function withinRegister(persona: Persona, text: string, seq: number): boolean {
  const target = lengthTarget(persona, seq);
  const length = text.trim().length;
  return length >= target.min && length <= target.max && typographyFault(text) === "";
}

/**
 * The second bubble of a double-text (spec §8.1, the burst flaw).
 *
 * It is its own log record rather than a newline inside one message, because a
 * messenger shows two bubbles — and because a message with a line break in it is one
 * of the shapes the Gate rejects. The record keeps the first beat's event and
 * recipients so the pair reads as one act of speaking.
 */
function continuationRecord(record: TurnRecord, text: string): TurnRecord {
  const seq = record.seq + 1;
  const t = record.t + 1500;
  const first = record.message;

  return {
    ...record,
    seq,
    t,
    // The verdict is the first beat's; a second bubble is not a second review.
    attempts: [],
    message: first
      ? buildMessage({
          seq,
          t,
          sender: first.sender,
          primaryRecipient: first.primaryRecipient,
          text,
          topicId: first.topicId,
          side: first.side,
          system: first.system,
          replyToSeq: first.replyToSeq,
          continuationOf: record.seq,
        })
      : null,
    note: `double-text, second beat of seq ${record.seq}`,
  };
}

function stageDirection(event: AgendaEvent, world: WorldState): string {
  const template = hashPick(
    [
      `${event.topic.title} — nobody in the room is cleared to answer that. Moving on.`,
      `No one on this desk covers that. Book stands: ${world.digest}`,
      `Passing on the question. The room has other work.`,
    ],
    `stage:${event.sender}`,
  );
  return (template ?? "Moving on.").replace("{topic}", event.topic.title);
}

export interface ResponderPlan {
  /** the permitted pool the choice was drawn from */
  candidates: PersonaId[];
  escalated: TurnRecord["escalated"];
  choice: SpeakerChoice;
}

/**
 * Who answers, given an event (spec §6.2, §6.3).
 *
 * Extracted so the typing indicator can name the expected responder using the
 * exact same rules the real turn will use — the preview and the publish cannot
 * disagree about who is "typing".
 */
function chooseResponder(args: {
  event: AgendaEvent;
  config: ForumConfig;
  personas: readonly Persona[];
  turns: readonly TurnRecord[];
  lastSeq: number;
  seq: number;
}): ResponderPlan {
  const { event, config, personas, turns, lastSeq, seq } = args;
  const permissions = respondersFor(event.sender, config, personas);
  const recency = recencyFromTurns(turns, lastSeq);
  const scheduleInput = { ...recency, config, roomId: config.roomId, seq };

  let candidates = permissions.direct;
  let escalated: TurnRecord["escalated"] = null;
  let choice = pickSpeaker({ candidates, ...scheduleInput });

  // Escalation rung 1 (spec §6.3): widen to the reciprocal set before giving up.
  if (!choice.chosen && permissions.widened.length > 0) {
    candidates = permissions.widened;
    escalated = "pool-widened";
    choice = pickSpeaker({ candidates, ...scheduleInput });
  }

  return { candidates, escalated, choice };
}

/** What the room will look like while a person waits for their reply (§9). */
export interface HumanReplyPreview {
  /** the persona expected to answer */
  sender: PersonaId;
  /** true when the engine will post a stage direction rather than a reply */
  system: boolean;
  /** when the reply is due (epoch ms) */
  dueAt: number;
}

/**
 * Who is "typing" at a person, and when their reply lands.
 *
 * Returns null unless the newest turn is a person's unanswered message. That is
 * deliberately the only case: a generic room turn is not a reply to anyone, so
 * there is nothing to put a typing bubble under.
 */
export async function previewHumanReply(
  store: ForumStore,
  now: number = Date.now(),
): Promise<HumanReplyPreview | null> {
  const config = await store.readConfig();
  const last = await store.readLastTurn();
  if (!last || !isPendingHumanTurn(last)) return null;

  const dueAt = humanReplyDueAt(config.roomId, last.t, last.seq, humanReplyRange(config));
  const [personas, topics, world, turns] = await Promise.all([
    store.readPersonas(),
    store.readTopics(),
    store.readWorld(),
    store.readTurns(RECENT_TURNS_WINDOW),
  ]);

  const seq = last.seq + 1;
  const event = nextEvent({ seq, now, turns, config, topics, world, personas });
  if (event.authoredBy === "engine") {
    return { sender: config.agenda.enginePersona, system: true, dueAt };
  }

  const plan = chooseResponder({ event, config, personas, turns, lastSeq: last.seq, seq });
  const chosen = plan.choice.chosen;
  if (!chosen) return { sender: config.agenda.enginePersona, system: true, dueAt };

  const persona = personas.find((p) => p.id === chosen);
  return { sender: chosen, system: !persona, dueAt };
}

export async function advance(
  store: ForumStore,
  options: AdvanceOptions = {},
): Promise<AdvanceResult> {
  const now = options.now ?? Date.now();
  const driver = options.driver ?? "cli";
  const config = await store.readConfig();

  const last = await store.readLastTurn();
  if (last && now < last.t) {
    return {
      status: "clock-rewind",
      record: null,
      reason: `now (${now}) is before the last turn (${last.t})`,
    };
  }

  // A person's message is answered on its own, shorter clock (§9): the room is
  // "typing", not waiting out the 45–180s cadence. Deferring inside `advance`
  // (rather than in the POST handler) keeps every driver — the human POST, a
  // lazy page read, the worker — on the same rule.
  if (last && isPendingHumanTurn(last)) {
    const dueAt = humanReplyDueAt(config.roomId, last.t, last.seq, humanReplyRange(config));
    if (now < dueAt) {
      return {
        status: "deferred",
        record: null,
        dueAt,
        reason: "a reply is being composed",
      };
    }
  }

  // The lease is the one thing on the **real** clock.
  //
  // `now` is the room's simulated time, and a catch-up burst back-dates it so each
  // turn carries a plausible timestamp. A lease compared against that clock cannot
  // be reclaimed: the compare-and-swap keeps losing to a row whose expiry was
  // written by the previous burst (`last.t + gap + ttl` is always ahead of the next
  // burst's first turn), so the room stops dead — caught live, with 22 turns owed
  // and `ran: 0` on every tick. Who may write *right now* is a real-world question.
  const leaseNow = Date.now();
  const owner = `${driver}:${processId()}`;
  if (!(await store.acquireLease(owner, LEASE_TTL_MS, leaseNow))) {
    return { status: "lease-held", record: null, reason: "another driver holds the lease" };
  }

  const startedAt = Date.now();
  try {
    const [personas, topics, world, turns] = await Promise.all([
      store.readPersonas(),
      store.readTopics(),
      store.readWorld(),
      store.readTurns(options.recentTurns ?? RECENT_TURNS_WINDOW),
    ]);

    const seq = (last?.seq ?? 0) + 1;
    const event = nextEvent({ seq, now, turns, config, topics, world, personas });

    const plan = chooseResponder({
      event,
      config,
      personas,
      turns,
      lastSeq: last?.seq ?? 0,
      seq,
    });
    let candidates = plan.candidates;
    let escalated = plan.escalated;
    let choice = plan.choice;

    const enginePersona = personas.find((p) => p.id === config.agenda.enginePersona);
    if (!enginePersona) {
      throw new Error(`forum: engine persona ${config.agenda.enginePersona} is not on the roster`);
    }

    const notes: string[] = [];
    let chosen = choice.chosen;
    let system = false;
    let text = "";
    // Engine-authored turns are not replies, so they have no candidates to review.
    let candidatesForRecord = candidates;
    // Set when the chosen speaker is a responder, so the Voice is drafted once the
    // Gate's mode decides whether the Gate's retry loop or the Director owns it.
    let responder: Persona | null = null;
    // An engine turn drafts after `speak` exists, because its line goes through
    // the Voice too (and is checked against the band, since the Gate is skipped).
    let engineTurn = false;

    if (event.authoredBy === "engine") {
      // The engine addresses the room itself: it opens the session, reports world
      // state, and recaps a stale gap. Nothing to schedule, so the matrix is not
      // consulted — an opening is not a reply to a message that does not exist.
      const opening = event.kind === "IDLE" && last === null;
      chosen = enginePersona.id;
      candidatesForRecord = [];
      choice = {
        chosen: enginePersona.id,
        ordered: [],
        reason: opening ? "opening the room" : event.reason,
        relaxedCooldown: false,
      };
      notes.push(opening ? "opening the room" : `engine ${event.kind.toLowerCase()}`);
      engineTurn = true;
    } else if (chosen === null) {
      // Rung 2: the engine persona stage-directs, so the room never dead-ends.
      chosen = enginePersona.id;
      escalated = "stage-direction";
      system = true;
      text = stageDirection(event, world);
      notes.push(choice.reason, "no permitted responder; engine stage direction");
    } else {
      const persona = personas.find((p) => p.id === chosen);
      if (!persona) throw new Error(`forum: chosen responder ${chosen} is not on the roster`);
      notes.push(choice.reason);
      responder = persona;
      if (choice.relaxedCooldown) notes.push("every candidate was on cooldown");
    }

    // The Gate reviews responder drafts (spec §8). Engine turns — openings, world
    // reports, recaps and stage directions — are the room's own control voice and
    // bypass it: an empty room is worse than an un-reviewed control line.
    const gateConfig = resolveGateConfig(config.gate);
    const chosenPersona = personas.find((p) => p.id === chosen);
    const gated = gateConfig.mode !== "off" && event.authoredBy === "responder" && !system;

    const attempts: Attempt[] = [];
    const gateNotes: string[] = [];
    const usage: TurnUsage[] = [];
    let decision: Decision = "APPROVE";
    let gate: TurnGate | undefined;
    let voiceUsed = false;
    let voiceModel: string | null = null;
    let voiceFallback: string | null = null;
    /** the last draft was licensed to leave the subject it was answering (§8.1) */
    let voiceDrift = false;
    /**
     * The beats of the approved draft. One element for an ordinary turn; two when
     * the flaw licensed a double-text, in which case the second is published as its
     * own bubble after the first.
     */
    let beats: string[] = [];

    // ---- steps 8-10's substrate (spec §7): who this turn is remembering ------
    const memoryConfig = config.memory;
    const memoryEnabled = Boolean(memoryConfig?.enabled);
    // A responder answers a companion; the engine addresses the room, and a stage
    // direction is nobody's conversation, so neither writes a companion thread.
    const companion = responder ? event.sender : null;
    let memoryFile: MemoryFile | null = null;
    let memoryReadFailure: string | null = null;

    if (memoryEnabled && companion && chosenPersona) {
      try {
        memoryFile = await store.readMemory(chosenPersona.id, companion);
      } catch (error) {
        // Losing memory must not lose the turn (§10.5): the room speaks, and the
        // failure is visible on the turn rather than silent.
        memoryReadFailure = error instanceof Error ? error.message : String(error);
      }
    }

    const memoryBlock =
      memoryFile && memoryConfig
        ? injectionText(memoryFile, transcriptWindowSeq(turns))
        : "";

    /**
     * Draft one line in the persona's voice and account for it. The Voice is the
     * only model call a turn makes outside the Gate, so its cost is recorded the
     * same way the judge's is (§11).
     */
    const speak = async (persona: Persona, attempt = 1, critique?: string): Promise<string> => {
      const voice = await voiceDraft({
        persona,
        event,
        world,
        seq,
        attempt,
        recent: turns,
        memory: persona.id === chosenPersona?.id ? memoryBlock : "",
        critique,
        provider: options.voiceProvider,
      });
      voiceUsed = voice.usedVoice;
      voiceDrift = voice.drift;
      if (voice.model) voiceModel = voice.model;
      if (voice.usage) {
        usage.push({
          provider: "voice",
          model: voice.model ?? "",
          tokensIn: voice.usage.tokensIn,
          tokensOut: voice.usage.tokensOut,
          estCost: voice.usage.cost,
        });
      }
      // A persona with no model is meant to run canned; only a configured Voice
      // that failed is worth flagging on the turn.
      if (voice.fallback && persona.model) voiceFallback = voice.reason;

      // A double-texting turn writes two beats around the marker the prompt asked
      // for. They are split here rather than after the Gate, because the Gate judges
      // what the room actually says: one person's message, not a marker.
      if (isBurstTurn(persona, seq, event.authoredBy === "engine")) {
        beats = splitBeats(voice.text);
        if (beats.length > 1) return beats.join(" ");
      }
      beats = [voice.text];
      return voice.text;
    };

    if (engineTurn) {
      const drafted = await speak(enginePersona);
      if (withinRegister(enginePersona, drafted, seq)) {
        text = drafted;
      } else {
        // The Gate is skipped for engine turns, so this is the only place a line
        // outside the persona's band can be caught before it is published.
        text = cannedDraft({ persona: enginePersona, event, world, seq, attempt: 1 });
        // The replaced line is gone, so its beats are too.
        beats = [text];
        notes.push(`engine line fell outside ${enginePersona.id}'s register; used the template`);
      }
    }

    if (gated && chosenPersona) {
      // The voice's model is passed so the resolution can skip a judge from the
      // same family instead of losing the whole LLM half to the guard (§8.6).
      const judge = options.judge ?? resolveJudgeProvider(gateConfig, chosenPersona.model);
      // Warm-up sampling counts the persona's completed turns, which needs the whole
      // log rather than the recent window (spec §8.3). Only hybrid mode pays for it.
      const priorPosts =
        gateConfig.mode === "hybrid"
          ? (await store.readTurns(Number.POSITIVE_INFINITY)).filter(
              (turn) => turn.chosen === chosenPersona.id && turn.message,
            ).length
          : 0;
      const threadStart = !turns.some(
        (turn) =>
          turn.message?.sender === chosenPersona.id && turn.message.topicId === event.topic.id,
      );

      // A person is owed an answer, so a human-triggered turn is not put through
      // the full retry budget: it degrades to "published anyway" below, and each
      // retry is another slow Voice call on a request someone is waiting on.
      const maxAttempts =
        event.kind === "HUMAN" ? Math.min(gateConfig.maxAttempts, 2) : gateConfig.maxAttempts;

      let verdict: GateVerdict | null = null;
      // §8.4's REVISE arrow: the rejection that failed attempt n is handed to the
      // Voice for attempt n+1, so a retry aims at a fault instead of re-rolling.
      let critique: string | undefined;
      for (let n = 1; n <= maxAttempts; n += 1) {
        text = await speak(chosenPersona, n, critique);
        // A turn the Voice licensed to drift is not held to ADDRESSEE: changing
        // the subject is a human move, and failing it here would replace exactly
        // the lines the room was asked for with the canned ones. An answer to an
        // off-topic question is the same case for the same reason — "it's under
        // settings, mine took two days" shares no content word with "how do I make
        // a withdrawal", and that is a good answer, not a non-answer.
        const attemptConfig =
          (voiceDrift || event.offTopic === true) && gateConfig.requireAddressee
            ? { ...gateConfig, requireAddressee: false }
            : gateConfig;
        verdict = await runGate({
          context: { persona: chosenPersona, text, event, world, turns, seq },
          config: attemptConfig,
          priorPosts,
          attempt: n,
          voiceModel: chosenPersona.model,
          judge,
          threadStart,
          drift: voiceDrift,
        });
        attempts.push({
          n,
          decision: verdict.decision,
          codes: verdict.codes,
          detail: verdict.detail ?? undefined,
          reasons: verdict.reasons,
        });
        gateNotes.push(...verdict.notes);
        if (verdict.usage) usage.push(verdict.usage);
        if (verdict.decision === "APPROVE") break;
        critique = verdict.detail ?? verdict.codes.join(", ");
      }
      if (attempts.length > 1) {
        notes.push(`${attempts.length - 1} retry/retries, each carrying the rejection reason`);
      }

      const gateMode: TurnGate["mode"] =
        verdict?.mode === "llm" ? "llm" : gateConfig.mode === "off" ? "off" : "deterministic";
      gate = {
        mode: gateMode,
        model: verdict?.judgeModel ?? voiceModel ?? undefined,
        sampled: verdict?.sampled ?? false,
      };

      if (verdict && verdict.decision !== "APPROVE") {
        if (event.kind === "HUMAN") {
          // §9 beats §8.4: a person asked and the room must answer. An imperfect
          // line — even a canned one — is worth more than the silence that made
          // the room look dead. The override is recorded on the turn.
          decision = "APPROVE";
          notes.push(
            `gate exhausted after ${maxAttempts} attempts (${verdict.codes.join(", ")}); published anyway (human trigger)`,
          );
        } else if (gateConfig.onExhausted === "canned") {
          // The ambient room may not go quiet either (spec §8.4): with nobody in
          // the room to notice a hole, a rejected draft would simply be a gap in
          // the conversation. The template line is register-safe by construction,
          // so it is published instead of nothing.
          text = cannedDraft({ persona: chosenPersona, event, world, seq, attempt: maxAttempts + 1 });
          beats = [text];
          decision = "APPROVE";
          notes.push(
            `gate exhausted after ${maxAttempts} attempts (${verdict.codes.join(", ")}); published the fallback line instead of a gap`,
          );
        } else {
          // Spec §8.4: the draft is not published. The record keeps the full trace,
          // and the scheduler avoids this speaker on the next turn, so the room
          // keeps moving.
          decision = "UNPUBLISHED";
          notes.push(
            `gate exhausted after ${maxAttempts} attempts (${verdict.codes.join(", ")}); thread stalled`,
          );
        }
      }
    } else if (responder) {
      // Gate off: the Director owns the single draft, so the Voice runs exactly once.
      text = await speak(responder);
    }

    // The Gate and memory saw the line as one message; the log gets the bubbles the
    // person would actually have sent.
    if (beats.length > 1) notes.push("double-text: published as two messages");
    if (beats.length === 0) beats = [text];

    if (voiceFallback) notes.push(`voice fallback: ${voiceFallback}`);
    // §8.4 records what the Gate did; the drift licence is part of that trace.
    if (gated && voiceDrift) notes.push("off-topic turn; the addressee rule was waived for it");
    if (gated && event.offTopic) {
      notes.push("the person asked something off the thread; answered them, addressee rule waived");
    }

    // ---- steps 8-10: fold the exchange into memory, then compact if needed ----
    let memoryWrites: string[] = [];
    let memorySummary = memoryEnabled ? "memory: nothing to record" : "memory disabled";
    if (memoryReadFailure) {
      memorySummary = `memory read failed: ${memoryReadFailure.slice(0, 120)}`;
    } else if (memoryEnabled && memoryConfig && companion && chosenPersona && responder && decision === "APPROVE") {
      const key = memoryKey(chosenPersona.id, companion);
      try {
        const folded = foldTurn(
          memoryFile,
          chosenPersona.id,
          companion,
          {
            seq,
            t: now,
            // Only a turn that is actually answering a message records one: a
            // FRICTION prompt is the topic's canonical line, not something said.
            incoming:
              event.replyTo !== undefined && event.quoted
                ? { text: event.quoted, topicId: event.topic.id }
                : undefined,
            outgoing: { text, topicId: event.topic.id },
          },
          memoryConfig,
        );

        // Step 9 checks the size; step 10 calls Agent 2. A compaction that fails
        // leaves the buffer alone and the thread intact (§7.5).
        let written: CompactionResult = { file: folded, model: null, usage: null, skipped: null };
        if (needsCompaction(folded, memoryConfig)) {
          written = await compactMemory({
            persona: chosenPersona,
            file: folded,
            config: memoryConfig,
            provider: options.archivistProvider,
          });
          if (written.usage) usage.push(written.usage);
          notes.push(
            written.model
              ? `agent 2 compacted the ${companion} thread`
              : `agent 2 did not compact: ${written.skipped ?? "unknown"}`,
          );
        }

        await store.writeMemory(written.file);
        memoryWrites = [key];
        memorySummary = memoryNote(written.file, written);
      } catch (error) {
        memorySummary = `memory write failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)}`;
      }
    }

    const record: TurnRecord = {
      seq,
      t: now,
      driver,
      trigger: event.kind,
      event: {
        kind: event.kind,
        reason: event.reason,
        sender: event.sender,
        topicId: event.topic.id,
        side: event.side,
      },
      candidates: candidatesForRecord,
      ordered: choice.ordered,
      chosen,
      escalated,
      decision,
      attempts,
      message:
        decision === "APPROVE"
          ? buildMessage({
              seq,
              t: now,
              sender: chosen,
              // The engine addresses the room; a responder answers someone specific.
              primaryRecipient: event.authoredBy === "engine" ? "room" : event.sender,
              // The first bubble of the turn: the whole line, or the first beat of a
              // double-text (the second is published as its own record below).
              text: beats.length > 1 ? beats[0]! : text,
              topicId: event.topic.id,
              side: event.side,
              system,
              // The quoted strip under a bubble is the seq of what it answers.
              replyToSeq: event.replyTo,
            })
          : null,
      memoryWrites,
      gate,
      usage: usage.length > 0 ? usage : undefined,
      worldVersion: world.version,
      note: [
        notes.filter(Boolean).join("; "),
        gateNotes.length > 0 ? `gate: ${[...new Set(gateNotes)].join(", ")}` : "",
        `gate ${gateConfig.mode}`,
        `voice ${voiceUsed ? "on" : "off"}`,
        voiceModel ? `voiceModel ${voiceModel}` : "",
        memorySummary,
      ]
        .filter(Boolean)
        .join("; "),
      durationMs: Date.now() - startedAt,
    };

    if (decision === "APPROVE") {
      await publish(store, record);
      if (beats.length > 1) await publish(store, continuationRecord(record, beats[1]!));
      return { status: "published", record };
    }

    await publishUnpublished(store, record);
    return { status: "unpublished", record };
  } finally {
    await store.releaseLease(owner, Date.now());
  }
}
