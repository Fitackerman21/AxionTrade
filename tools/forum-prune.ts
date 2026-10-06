/**
 * Take a range of turns back out of a room's log.
 *
 *   npm run forum:prune -- --from 118 --to 129
 *   npm run forum:prune -- --from 118 --to 129 --yes
 *
 * The audience is a room someone has already written to — a non-hermetic e2e run
 * against a deployed room, most often. `community.spec.ts` posts as a visitor, so
 * every run appends to the transcript it is testing; the live room had collected
 * "fair point — but what's the stop on that?" six times before anyone noticed, which
 * is exactly the kind of thing that makes a room read as generated. The spec now
 * varies its line per run, and this removes what the fixed wording already left
 * behind.
 *
 * It is deliberately awkward to fire. Nothing happens without a range, the turns are
 * printed first, and the write needs `--yes` (or a range of one turn). The log is the
 * room's whole state, so this is the one operation in the forum that cannot be
 * undone from inside the forum.
 */

import { openForumStore } from "../lib/forum/store";
import type { TurnRecord } from "../lib/forum/types";

interface Options {
  from: number;
  to: number;
  yes: boolean;
}

/** A prune wide enough to be a mistake rather than a correction. */
const LARGE = 40;

function parseArgs(argv: string[]): Options | null {
  let from: number | null = null;
  let to: number | null = null;
  let yes = false;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--from":
        from = Number(value);
        i += 1;
        break;
      case "--to":
        to = Number(value);
        i += 1;
        break;
      case "--yes":
        yes = true;
        break;
      case "--help":
      case "-h":
        return null;
      default:
        if (flag?.startsWith("--")) {
          console.error(`forum-prune: unknown flag ${flag}`);
          process.exit(1);
        }
    }
  }

  if (from === null || to === null || !Number.isInteger(from) || !Number.isInteger(to)) {
    console.error("forum-prune: --from and --to are both required, as whole seqs");
    return null;
  }
  if (from > to) {
    console.error(`forum-prune: --from ${from} is above --to ${to}`);
    return null;
  }
  if (from < 1) {
    console.error("forum-prune: seqs start at 1");
    return null;
  }

  return { from, to, yes };
}

function describe(turn: TurnRecord): string {
  const text = turn.message?.text ?? `(${turn.decision})`;
  const flat = text.replace(/\s+/g, " ").trim();
  const short = flat.length <= 78 ? flat : `${flat.slice(0, 77).trimEnd()}…`;
  return `  ${String(turn.seq).padStart(4)}  ${(turn.chosen ?? turn.message?.sender ?? "-").padEnd(8)}  ${short}`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.log("usage: npm run forum:prune -- --from <seq> --to <seq> [--yes]");
    return;
  }

  const store = openForumStore();
  const turns = await store.readTurns(Number.POSITIVE_INFINITY);
  const doomed = turns.filter((turn) => turn.seq >= options.from && turn.seq <= options.to);

  console.log(`forum-prune: ${store.root} (${turns.length} turns in the log)`);
  if (doomed.length === 0) {
    console.log(`forum-prune: nothing between seq ${options.from} and ${options.to}`);
    return;
  }

  console.log(`\nforum-prune: ${doomed.length} turn(s) would be removed:\n`);
  for (const turn of doomed) console.log(describe(turn));
  const missing = options.to - options.from + 1 - doomed.length;
  if (missing > 0) {
    console.log(`\n  (${missing} seq(s) in the range carry no turn)`);
  }

  // Memory files name the turns they folded, so an agent-2 thread can still mention
  // something that is no longer in the transcript. That is a stale digest, not a
  // corrupt one, and it ages out on the next compaction — say so rather than surprise.
  const memories = await store.listMemory().catch(() => []);
  const touched = memories.filter((file) =>
    file.recent.some((entry) => entry.seq >= options.from && entry.seq <= options.to),
  );
  if (touched.length > 0) {
    console.log(
      `\n  note: ${touched.length} memory thread(s) folded turns in this range — their digests ` +
        "outlive the transcript, which is a stale sentence rather than a broken one",
    );
  }

  if (!options.yes && doomed.length > 1) {
    console.log(`\nforum-prune: nothing written. Re-run with --yes to remove them.`);
    return;
  }
  if (doomed.length > LARGE && !options.yes) {
    console.log(`\nforum-prune: refusing ${doomed.length} turns without --yes`);
    return;
  }

  const removed = await store.deleteTurns(options.from, options.to);
  const after = await store.readTurns(Number.POSITIVE_INFINITY);
  console.log(`\nforum-prune: removed ${removed} turn(s); the log now holds ${after.length}`);
  console.log(`forum-prune: the room continues from seq ${after[after.length - 1]?.seq ?? 0}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
