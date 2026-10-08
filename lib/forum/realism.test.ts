/**
 * The realism audit's teeth.
 *
 * The score is only worth having if it separates the two rooms this codebase has actually
 * produced: the one that shipped — a four-line bank recited, every line naming its target,
 * replies quoting messages they shared nothing with — and the one the fixes aim at. So the
 * test builds both and asserts the audit tells them apart, and that the fixed one clears
 * the 90 the target was set at.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { cannedDraft } from "./drafts";
import { auditTurns, realismMisses, realismScore } from "./realism";
import { dataStore, makeTurn } from "./test-utils";
import type { AgendaEvent, Persona, Topic, TurnRecord, WorldState } from "./types";

const store = dataStore();

interface Room {
  personas: Persona[];
  topic: Topic;
  world: WorldState;
}

async function room(): Promise<Room> {
  const [personas, topics, world] = await Promise.all([
    store.readPersonas(),
    store.readTopics(),
    store.readWorld(),
  ]);
  return { personas, topic: topics[0]!, world };
}

/**
 * A transcript the way the room actually produces one when the Voice is down: each turn is
 * this persona's own fallback line, chosen with the log so far — the exact path that was
 * live when ~90% of turns were served from the bank.
 */
function fallbackTranscript(seed: Room, count: number): TurnRecord[] {
  const turns: TurnRecord[] = [];
  for (let seq = 1; seq <= count; seq += 1) {
    const speaker = seed.personas[(seq - 1) % seed.personas.length]!;
    const previous = turns[turns.length - 1];
    const event: AgendaEvent = {
      kind: "THREAD",
      reason: "audit",
      sender: previous?.message?.sender ?? "human",
      topic: seed.topic,
      side: "a",
      quoted: previous?.message?.text ?? "what is the read on this one",
      authoredBy: "responder",
    };
    const text = cannedDraft({
      persona: speaker,
      event,
      world: seed.world,
      seq,
      attempt: 1,
      recent: turns.slice(-60),
    });
    const turn = makeTurn(seq, { sender: speaker.id, text, topicId: seed.topic.id });
    if (previous && turn.message) turn.message.replyToSeq = previous.seq;
    turns.push(turn);
  }
  return turns;
}

/** The failures the live room actually shipped, in miniature. */
function brokenTranscript(): TurnRecord[] {
  const lines: Array<[string, string]> = [
    ["kofi", "kofi, tight stop then out, that's the whole plan and it hasn't changed"],
    ["mara", "kofi, tight stop then out, that's the whole plan and it hasn't changed"],
    ["rafa", "kofi, tight stop then out, that's the whole plan and it hasn't changed"],
    ["sol", "cooked, all of it"],
    ["rafa", "rafa, flows lag."],
    // Two in a row from rafa, so the second quotes the first: the self-quote that
    // reached the live room through a speak-as line jumping the queue (seq 886 → 885).
    ["rafa", "rafa, flows lag."],
    ["sol", "cooked, all of it"],
    ["mara", "mara, flows lag."],
    ["toko", "mid. やめ"],
    ["rafa", "rafa, flows lag."],
    ["sol", "cooked, all of it"],
    ["kofi", "rafa, flows lag."],
  ];
  const turns = lines.map(([sender, text], i) =>
    makeTurn(i + 1, { sender, text, topicId: "t" }),
  );
  for (let i = 1; i < turns.length; i += 1) {
    if (turns[i]!.message) turns[i]!.message!.replyToSeq = turns[i - 1]!.seq;
  }
  return turns;
}

test("the fallback room clears the realism gate", async () => {
  const seed = await room();
  const turns = fallbackTranscript(seed, 120);
  const report = auditTurns(turns, seed.personas.map((p) => p.id));

  const misses = realismMisses(report);
  assert.equal(
    misses.length,
    0,
    `the shipped fallback misses ${misses.map((m) => `${m.metric}=${m.value.toFixed(3)}`).join(", ")}`,
  );
  assert.ok(
    realismScore(report) >= 90,
    `the fallback room scored ${realismScore(report)}, under the 90 target`,
  );
  assert.ok(report.messages === 120, "the audit counted the wrong number of messages");
});

test("the audit fails the room that actually shipped", () => {
  const turns = brokenTranscript();
  const report = auditTurns(turns, ["kofi", "mara", "rafa", "sol", "toko", "raj"]);

  // The three tells read straight off the live transcript: lines repeated inside the
  // window, most lines opening with a name, and a reply nobody asked for.
  assert.ok(report.repeatRate > 0, `repeatRate was ${report.repeatRate}`);
  assert.ok(report.namePrefixRate > 0.5, `namePrefixRate was ${report.namePrefixRate}`);
  assert.ok(report.selfQuoteRate > 0, `selfQuoteRate was ${report.selfQuoteRate}`);
  assert.ok(report.nonAsciiRate > 0, `nonAsciiRate was ${report.nonAsciiRate}`);

  // And the score says so, well below the bar the fixed room clears.
  assert.ok(
    realismScore(report) < 70,
    `the broken room scored ${realismScore(report)}, expected well under 70`,
  );
});

test("an empty window is not a failure", () => {
  const report = auditTurns([]);
  assert.equal(report.messages, 0);
  assert.equal(realismScore(report) >= 90, true);
});
