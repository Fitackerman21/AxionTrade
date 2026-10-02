/**
 * The always-on driver.
 *
 *   npm run forum:worker
 *   npm run forum:worker -- --turns 5        # a bounded smoke run
 *
 * Leave it running and the room advances on its own cadence. Ctrl+C stops it
 * after the current turn and clears its heartbeat.
 */

import { openForumStore } from "../lib/forum/store";
import { runWorker } from "../lib/forum/worker";

function maxTurnsFromArgv(argv: string[]): number | undefined {
  const index = argv.findIndex((arg) => arg === "--turns");
  if (index === -1) return undefined;
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function time(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

async function main(): Promise<void> {
  const store = openForumStore();
  const last = await store.readLastTurn();

  console.log(`forum-worker: ${store.root}`);
  console.log(`forum-worker: ${last ? `resuming after turn ${last.seq}` : "opening a new room"}`);

  const worker = runWorker(store, {
    maxTurns: maxTurnsFromArgv(process.argv.slice(2)),
    onTurn: ({ status, record, gapMs }) => {
      if (!record) {
        console.log(`forum-worker: ${status} — another driver holds the lease, retrying`);
        return;
      }
      const who = record.chosen ?? "-";
      console.log(
        `[${String(record.seq).padStart(3)}] ${time(record.t)} ${record.trigger.padEnd(8)} ${who.padEnd(7)} rest ${Math.round(gapMs / 1000)}s`,
      );
    },
  });

  const shutdown = (signal: string): void => {
    console.log(`\nforum-worker: ${signal} received, finishing the current turn…`);
    worker.stop();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const outcome = await worker.finished;
  console.log(`forum-worker: ${outcome.turns} turns published (${outcome.reason})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
