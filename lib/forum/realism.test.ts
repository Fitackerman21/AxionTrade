/**
 * The realism audit's teeth.
 *
 * The score is only worth having if it separates the two rooms this codebase has actually
 * produced: the one that shipped — a four-line bank recited, every line naming its target,
 * replies quoting messages they shared nothing with, an answer to everything within a minute
 * and not one question in 270 lines — and the one the fixes aim at. So the test builds both
 * and asserts the audit tells them apart, and that the fixed one clears the 90 the target was
 * set at.
 *
 * The fixed transcript is built the way the runtime builds one when the Voice is down: the
 * per-persona fallback line, delivered the way the agenda delivers it — a verdict, a question
 * of the responder's own, or an answer — with a person's message every seventh turn and the
 * room's handling of it, which is occasionally nothing at all.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { humanReplyMode, threadReplyMode } from "./agenda";
import { askBackFor, cannedDraft } from "./drafts";
import { auditTurns, realismMisses, realismScore } from "./realism";
import { dataStore, makeTurn, TEST_CONFIG } from "./test-utils";
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

/** What people actually send this room: short lines with no question in them, mostly. */
const PERSON_LINES: readonly string[] = [
  "the tape is dead today",
  "watching the open here",
  "gold looks stuck again",
  "morning all",
  "nothing moving overnight",
];

/**
 * A transcript the way the room produces one when the Voice is down.
 *
 * This is the path that was live for ~90% of published turns, and it is where the tells the
 * audit counts were measured. Built through the room's own delivery rules rather than by
 * hand: `threadReplyMode` decides whether a turn between members is an answer, a question or
 * a bare verdict, and `humanReplyMode` decides how a person's message is handled — including
 * the turn the room reads it and has nothing to add, which is written the way `advance()`
 * writes it (a record with no message and the note that says so).
 */
function fallbackTranscript(seed: Room, count: number): TurnRecord[] {
  const turns: TurnRecord[] = [];
  const roomId = TEST_CONFIG.roomId;

  const personaAt = (seq: number): Persona =>
    seed.personas[(seq - 1) % seed.personas.length]!;

  for (let seq = 1; seq <= count; seq += 1) {
    const previous = turns[turns.length - 1];
    const previousMessage = previous?.message;

    // A person's line every seventh turn: the room's silences and its questions back only
    // exist beside something a person said.
    if (seq % 7 === 3) {
      const text = PERSON_LINES[Math.floor(seq / 7) % PERSON_LINES.length]!;
      turns.push(makeTurn(seq, { sender: "human", text, topicId: seed.topic.id }));
      continue;
    }

    const speaker = personaAt(seq);
    const answering = previousMessage?.sender === "human" ? previousMessage : null;
    const event: AgendaEvent = {
      kind: answering ? "HUMAN" : "THREAD",
      reason: "audit",
      sender: answering ? "human" : (previousMessage?.sender ?? "human"),
      topic: seed.topic,
      side: "a",
      quoted: answering?.text ?? previousMessage?.text ?? "what is the read on this one",
      authoredBy: "responder",
      ...(answering ? { replyTo: answering.seq, offTopic: true } : {}),
    };

    if (answering) {
      const mode = humanReplyMode({
        roomId,
        seq,
        text: answering.text,
        product: false,
        greeting: false,
        first: false,
      });
      if (mode === "quiet") {
        // Exactly the record `advance()` writes for a quiet turn: no message, a chosen
        // speaker, and the note that tells an audit — or a person reading the log — why.
        turns.push({
          ...makeTurn(seq, { sender: speaker.id, topicId: seed.topic.id, withMessage: false }),
          trigger: "HUMAN",
          event: { kind: "HUMAN", reason: "audit", sender: "human", topicId: seed.topic.id, side: "a" },
          chosen: speaker.id,
          decision: "UNPUBLISHED",
          note: "the room read it and had nothing to add (quiet turn)",
        });
        continue;
      }
      event.replyMode = mode;
    } else {
      event.replyMode = threadReplyMode({ roomId, seq });
    }

    const text =
      event.replyMode === "askBack"
        ? askBackFor({ persona: speaker, event, world: seed.world, seq, attempt: 1, recent: turns })
        : cannedDraft({ persona: speaker, event, world: seed.world, seq, attempt: 1, recent: turns });

    const turn = makeTurn(seq, { sender: speaker.id, text, topicId: seed.topic.id });
    if (turn.message) {
      turn.message.replyToSeq = answering ? answering.seq : previousMessage?.seq;
    }
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
  // 120 turns went by, of which the ones the room passed on carry no message: the audit
  // reads the published ones and the quiet records are the silence it also reports.
  assert.equal(turns.length, 120, "the transcript changed shape");
  assert.equal(
    report.messages,
    turns.filter((turn) => turn.message).length,
    "the audit counted the wrong number of messages",
  );
  assert.ok(report.messages < 120, "no turn in the window was a quiet one");

  // The two tells that are about the shape of the room rather than about a line: it asks
  // things, and it does not answer every person immediately, every time.
  assert.ok(
    report.questionRate >= 0.05,
    `only ${(report.questionRate * 100).toFixed(1)}% of the room's lines asked anything`,
  );
  assert.ok(
    report.silenceRate > 0,
    "the room answered every single person, which is the tell the shipped room had",
  );
  // The share it does not answer is the minority of it: the room is a room, not an empty one.
  assert.ok(report.silenceRate < 0.35, `the room passed on ${report.silenceRate} of the people`);
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
  // And the shape tell: 0.0% of the room's lines asked anything at all.
  assert.equal(report.questionRate, 0, `questionRate was ${report.questionRate}`);

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
