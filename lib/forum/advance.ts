/**
 * `advance()` — one turn (spec §3.1).
 *
 * This is the whole runtime. A 24/7 worker loops it; the lazy "wake the room"
 * path on /community calls it too. The lease and the monotonic `seq` are what
 * let both drivers exist without racing.
 *
 * P0 runs with canned drafts: no LLM calls, no Gate, no memory writes. Those
 * arrive in P1–P3, behind the same three seams (drafts, publisher, store).
 */

import { nextEvent } from "./agenda";
import { cannedDraft } from "./drafts";
import { respondersFor } from "./permissions";
import { buildMessage, publish } from "./publisher";
import { recencyFromTurns, pickSpeaker } from "./schedule";
import { hashPick } from "./rng";
import type { ForumStore } from "./store";
import type { AgendaEvent, TurnRecord, WorldState } from "./types";

/** How much history the agenda and scheduler get to look at. */
export const RECENT_TURNS_WINDOW = 40;
/** Long enough to cover a slow turn, short enough to recover from a crash. */
export const LEASE_TTL_MS = 30_000;

export type AdvanceStatus = "published" | "lease-held" | "clock-rewind";

export interface AdvanceResult {
  status: AdvanceStatus;
  record: TurnRecord | null;
  reason?: string;
}

export interface AdvanceOptions {
  now?: number;
  driver?: string;
  recentTurns?: number;
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
    let text: string;
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
      decision: "APPROVE",
      attempts: [],
      message: buildMessage({
        seq,
        t: now,
        sender: chosen,
        // The engine addresses the room; a responder answers someone specific.
        primaryRecipient: event.authoredBy === "engine" ? "room" : event.sender,
        text,
        topicId: event.topic.id,
        side: event.side,
        system,
      }),
      memoryWrites: [],
      worldVersion: world.version,
      note: `${notes.filter(Boolean).join("; ")}; P0: gate and memory disabled`,
      durationMs: Date.now() - startedAt,
    };

    await publish(store, record);
    return { status: "published", record };
  } finally {
    await store.releaseLease(owner, Date.now());
  }
}
