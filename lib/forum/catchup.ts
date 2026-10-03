/**
 * Lazy catch-up — "comes to life when the community page is opened" (spec §3.2).
 *
 * The rule that matters: **catch up by skipping, never by replaying.** A room
 * that has been down for six hours does not generate six hours of conversation
 * on the next page visit; it generates a bounded burst, and if the gap is stale
 * it generates exactly one recap turn instead. Without that bound, the first
 * visit after a restart would be a cost spike and a nonsense torrent.
 */

import { advance } from "./advance";
import type { AdvanceStatus } from "./advance";
import { meanGapMs, turnsOwed } from "./clock";
import type { ForumStore } from "./store";
import type { RoomMode } from "./types";

export interface CatchUpOptions {
  now?: number;
  /** hard cap on turns generated in a single burst */
  maxTurns?: number;
  /** report what would happen without writing anything */
  dryRun?: boolean;
  driver?: string;
}

export interface CatchUpReport {
  mode: RoomMode;
  /** turns the room is behind by */
  owed: number;
  /** turns actually generated */
  ran: number;
  /** turns deliberately not generated */
  skipped: number;
  /** true when the gap was stale and one recap turn stood in for the rest */
  recapped: boolean;
  statuses: AdvanceStatus[];
  reason: string;
}

/** A worker with a fresh heartbeat is driving the room; nobody else should. */
export async function roomMode(store: ForumStore, now: number = Date.now()): Promise<RoomMode> {
  const beat = await store.readHeartbeat();
  return beat && beat.expiresAt > now ? "live" : "lazy";
}

export async function catchUp(
  store: ForumStore,
  options: CatchUpOptions = {},
): Promise<CatchUpReport> {
  const now = options.now ?? Date.now();
  const driver = options.driver ?? "lazy";
  const mode = await roomMode(store, now);

  if (mode === "live") {
    return {
      mode,
      owed: 0,
      ran: 0,
      skipped: 0,
      recapped: false,
      statuses: [],
      reason: "a worker is driving the room",
    };
  }

  const config = await store.readConfig();
  const maxTurns = Math.max(1, options.maxTurns ?? config.runtime.catchUpMaxTurns);
  const range = config.scheduling.gapSec;
  const last = await store.readLastTurn();

  // An empty log is the room opening, not a gap.
  if (!last) {
    if (options.dryRun) {
      return {
        mode,
        owed: 0,
        ran: 0,
        skipped: 0,
        recapped: false,
        statuses: [],
        reason: "the room has not opened yet",
      };
    }
    const result = await advance(store, { now, driver });
    return {
      mode,
      owed: 0,
      ran: result.record ? 1 : 0,
      skipped: 0,
      recapped: false,
      statuses: [result.status],
      reason: result.record ? "opened the room" : `no turn (${result.status})`,
    };
  }

  const gap = now - last.t;
  const owed = turnsOwed(gap, range);
  if (owed <= 0) {
    return {
      mode,
      owed: 0,
      ran: 0,
      skipped: 0,
      recapped: false,
      statuses: [],
      reason: "the room is up to date",
    };
  }

  const staleAfterMs = Math.max(0, config.runtime.staleAfterMin) * 60_000;
  const stale = staleAfterMs > 0 && gap >= staleAfterMs;
  const wanted = stale ? 1 : Math.min(owed, maxTurns);
  const skipped = Math.max(0, owed - wanted);
  const reason = stale
    ? `stale gap; one recap instead of ${owed} turns`
    : `${wanted} of ${owed} turns owed`;

  if (options.dryRun) {
    return { mode, owed, ran: 0, skipped, recapped: stale, statuses: [], reason };
  }

  const step = meanGapMs(range);
  const statuses: AdvanceStatus[] = [];
  let ran = 0;

  for (let n = 0; n < wanted; n += 1) {
    // Space the burst out on the intended cadence so each turn carries a
    // plausible timestamp. A stale gap is the exception: it must be handed to
    // the agenda at the *real* now, or the agenda would not see it as stale and
    // the recap would never be produced.
    const at = stale ? now : Math.min(now, last.t + (n + 1) * step);
    const result = await advance(store, { now: at, driver });
    statuses.push(result.status);
    if (result.record) ran += 1;

    // Somebody else took over mid-burst (or the clock moved). Stop quietly. An
    // UNPUBLISHED turn still produced a record, so the burst keeps going.
    if (result.record === null) break;
  }

  return { mode, owed, ran, skipped, recapped: stale, statuses, reason };
}
