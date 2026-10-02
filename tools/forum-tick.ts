/**
 * Run the P0 room from the terminal.
 *
 *   npm run forum:tick
 *   npm run forum:tick -- --turns 30
 *   npm run forum:tick -- --say "what is the room's read on gold?" --turns 6
 *
 * No LLM calls, no Gate, no memory writes — this exercises the agenda, the
 * permission matrix and the scheduler, and prints the log it produced.
 */

import path from "node:path";

import { advance } from "../lib/forum/advance";
import { FileStore, messagesFromTurns } from "../lib/forum/store";
import type { TurnRecord } from "../lib/forum/types";

interface Options {
  root: string;
  turns: number;
  say: string | null;
  /** milliseconds of simulated spacing between turns */
  step: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    root: path.join(process.cwd(), "data", "forum"),
    turns: 12,
    say: null,
    step: 1000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--turns":
        options.turns = Number(value ?? options.turns);
        i += 1;
        break;
      case "--root":
        options.root = path.resolve(value ?? options.root);
        i += 1;
        break;
      case "--say":
        options.say = value ?? "";
        i += 1;
        break;
      case "--step":
        options.step = Number(value ?? options.step);
        i += 1;
        break;
      default:
        if (flag?.startsWith("--")) {
          console.error(`forum-tick: unknown flag ${flag}`);
          process.exit(1);
        }
    }
  }

  return options;
}

function shorten(text: string, max = 96): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function printTurn(turn: TurnRecord): void {
  const seq = String(turn.seq).padStart(3);
  const kind = turn.trigger.padEnd(8);
  const who = (turn.chosen ?? "-").padEnd(7);
  const to = (turn.message?.primaryRecipient || "-").padEnd(7);
  const text = turn.message?.system ? `[system] ${turn.message.text}` : (turn.message?.text ?? "(nothing)");
  const flags = [
    turn.escalated ? `escalated:${turn.escalated}` : "",
    turn.note?.includes("cooldown") ? "cooldown-relaxed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  console.log(`[${seq}] ${kind} ${who} → ${to} ${shorten(text)}`);
  if (flags) console.log(`      ${flags} — ${shorten(turn.note ?? "", 110)}`);
}

function summarise(turns: TurnRecord[]): void {
  const byKind = new Map<string, number>();
  const bySpeaker = new Map<string, number>();

  for (const turn of turns) {
    byKind.set(turn.trigger, (byKind.get(turn.trigger) ?? 0) + 1);
    if (turn.chosen) bySpeaker.set(turn.chosen, (bySpeaker.get(turn.chosen) ?? 0) + 1);
  }

  console.log("\n--- turn kinds ---");
  for (const [kind, count] of [...byKind].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind.padEnd(9)} ${count}`);
  }

  console.log("\n--- speakers ---");
  for (const [speaker, count] of [...bySpeaker].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${speaker.padEnd(9)} ${count}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const store = new FileStore(options.root);

  const existing = await store.readTurns(Number.POSITIVE_INFINITY);
  console.log(`forum-tick: ${options.root}`);
  console.log(`forum-tick: ${existing.length} turns already logged, running ${options.turns}\n`);

  if (options.say !== null) {
    const topics = await store.readTopics();
    const topic = topics[0];
    if (!topic) throw new Error("forum-tick: the topic deck is empty");
    const record = await store.appendHumanMessage({
      text: options.say,
      sender: "human",
      t: Date.now(),
      topicId: topic.id,
    });
    console.log(`[${String(record.seq).padStart(3)}] HUMAN    human   → -       ${shorten(options.say)}\n`);
  }

  const base = Date.now();
  const produced: TurnRecord[] = [];

  for (let n = 0; n < options.turns; n += 1) {
    const result = await advance(store, { now: base + (n + 1) * options.step, driver: "cli" });
    if (!result.record) {
      console.log(`(no turn: ${result.status}${result.reason ? ` — ${result.reason}` : ""})`);
      break;
    }
    produced.push(result.record);
    printTurn(result.record);
  }

  const all = await store.readTurns(Number.POSITIVE_INFINITY);
  summarise(produced);
  console.log(`\n--- published projection (${messagesFromTurns(all).length} messages) ---`);
  console.log(`log: ${path.join(options.root, "log.jsonl")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
