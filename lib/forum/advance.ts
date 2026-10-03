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
import { cannedDraft } from "./drafts";
import { resolveGateConfig, runGate } from "./gate";
import type { GateVerdict } from "./gate";
import { respondersFor } from "./permissions";
import { buildMessage, publish, publishUnpublished } from "./publisher";
import { resolveJudgeProvider } from "./provider";
import type { ChatProvider } from "./provider";
import { recencyFromTurns, pickSpeaker } from "./schedule";
import { hashPick } from "./rng";
import type { ForumStore } from "./store";
import type {
  AgendaEvent,
  Attempt,
  Decision,
  TurnGate,
  TurnRecord,
  TurnUsage,
  WorldState,
} from "./types";

/** How much history the agenda and scheduler get to look at. */
export const RECENT_TURNS_WINDOW = 40;
/** Long enough to cover a slow turn, short enough to recover from a crash. */
export const LEASE_TTL_MS = 30_000;

export type AdvanceStatus = "published" | "unpublished" | "lease-held" | "clock-rewind";

export interface AdvanceResult {
  status: AdvanceStatus;
  record: TurnRecord | null;
  reason?: string;
}

export interface AdvanceOptions {
  now?: number;
  driver?: string;
  recentTurns?: number;
  /** inject the Gate's judge; by default it is resolved from config + env (§8.2) */
  judge?: ChatProvider;
}

/** Used for lease ownership; 0 where there is no process to name. */
export function processId(): number {
  return typeof process !== "undefined" && typeof process.pid === "number" ? process.pid : 0;
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

  const owner = `${driver}:${processId()}`;
  if (!(await store.acquireLease(owner, LEASE_TTL_MS, now))) {
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

    const permissions = respondersFor(event.sender, config, personas);
    const recency = recencyFromTurns(turns, last?.seq ?? 0);
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
      text = cannedDraft({ persona: enginePersona, event, world, seq, attempt: 1 });
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
      text = cannedDraft({ persona, event, world, seq, attempt: 1 });
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

    if (gated && chosenPersona) {
      const judge = options.judge ?? resolveJudgeProvider(gateConfig);
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

      let verdict: GateVerdict | null = null;
      for (let n = 1; n <= gateConfig.maxAttempts; n += 1) {
        text = cannedDraft({ persona: chosenPersona, event, world, seq, attempt: n });
        verdict = await runGate({
          context: { persona: chosenPersona, text, event, world, turns, seq },
          config: gateConfig,
          priorPosts,
          attempt: n,
          voiceModel: chosenPersona.model,
          judge,
          threadStart,
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
      }

      const gateMode: TurnGate["mode"] =
        verdict?.mode === "llm" ? "llm" : gateConfig.mode === "off" ? "off" : "deterministic";
      gate = { mode: gateMode, model: verdict?.judgeModel, sampled: verdict?.sampled ?? false };

      if (verdict && verdict.decision !== "APPROVE") {
        // Spec §8.4: the draft is not published. The record keeps the full trace, and
        // the scheduler avoids this speaker on the next turn, so the room keeps moving.
        decision = "UNPUBLISHED";
        notes.push(
          `gate exhausted after ${gateConfig.maxAttempts} attempts (${verdict.codes.join(", ")}); thread stalled`,
        );
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
              text,
              topicId: event.topic.id,
              side: event.side,
              system,
            })
          : null,
      memoryWrites: [],
      gate,
      usage: usage.length > 0 ? usage : undefined,
      worldVersion: world.version,
      note: [
        notes.filter(Boolean).join("; "),
        gateNotes.length > 0 ? `gate: ${[...new Set(gateNotes)].join(", ")}` : "",
        `gate ${gateConfig.mode}`,
        "memory disabled (P3)",
      ]
        .filter(Boolean)
        .join("; "),
      durationMs: Date.now() - startedAt,
    };

    if (decision === "APPROVE") {
      await publish(store, record);
      return { status: "published", record };
    }

    await publishUnpublished(store, record);
    return { status: "unpublished", record };
  } finally {
    await store.releaseLease(owner, Date.now());
  }
}
