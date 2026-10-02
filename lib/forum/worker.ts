/**
 * The worker driver — the 24/7 half of spec §3.2.
 *
 * It keeps a heartbeat for as long as it is alive, which is how readers (and the
 * lazy catch-up) know a real driver exists. The heartbeat is deliberately a
 * separate file from the turn lease: the lease guards one turn against a race,
 * the heartbeat answers "is the room being driven at all?".
 */

import { advance, processId } from "./advance";
import type { AdvanceStatus } from "./advance";
import { gapMsFor } from "./clock";
import type { ForumStore } from "./store";
import type { TurnRecord } from "./types";

export interface WorkerTurnEvent {
  status: AdvanceStatus;
  record: TurnRecord | null;
  /** how long the worker will rest before the next turn */
  gapMs: number;
}

export interface WorkerOptions {
  driver?: string;
  /** give up after this many published turns (smoke runs, tests) */
  maxTurns?: number;
  /** injectable for tests; the default sleeps and is interruptible by stop() */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onTurn?: (event: WorkerTurnEvent) => void;
}

export interface WorkerHandle {
  /** Stops after the current turn, interrupting any sleep. */
  stop: () => void;
  finished: Promise<{ turns: number; reason: string }>;
}

export function runWorker(store: ForumStore, options: WorkerOptions = {}): WorkerHandle {
  const driver = options.driver ?? "worker";
  const owner = `${driver}:${processId()}-${Date.now()}`;
  const now = options.now ?? (() => Date.now());
  const maxTurns = options.maxTurns;

  let stopping = false;
  let wake: (() => void) | null = null;

  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wake = null;
          resolve();
        }, ms);
        wake = () => {
          clearTimeout(timer);
          wake = null;
          resolve();
        };
      }));

  const stop = (): void => {
    stopping = true;
    wake?.();
  };

  const finished = (async (): Promise<{ turns: number; reason: string }> => {
    let turns = 0;
    let reason = "stopped";

    try {
      while (!stopping) {
        const config = await store.readConfig();
        const at = now();
        await store.writeHeartbeat({ owner, expiresAt: at + config.runtime.heartbeatTtlSec * 1000 });

        const result = await advance(store, { now: at, driver });

        if (!result.record) {
          // Another driver holds the turn lease. Back off rather than spin.
          options.onTurn?.({ status: result.status, record: null, gapMs: 1000 });
          await sleep(1000);
          continue;
        }

        turns += 1;
        const gapMs = gapMsFor(config.roomId, result.record.seq, config.scheduling.gapSec);
        options.onTurn?.({ status: result.status, record: result.record, gapMs });

        if (maxTurns !== undefined && turns >= maxTurns) {
          reason = `hit the ${maxTurns}-turn cap`;
          break;
        }
        if (stopping) break;
        await sleep(gapMs);
      }
    } finally {
      // Never leave a heartbeat behind: it would make the room look live forever.
      await store.clearHeartbeat(owner);
    }

    return { turns, reason };
  })();

  return { stop, finished };
}
