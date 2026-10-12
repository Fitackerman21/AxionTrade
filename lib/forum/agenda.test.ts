import assert from "node:assert/strict";
import { test } from "node:test";

import { nextEvent, threadReplyMode } from "./agenda";
import type { AgendaContext } from "./agenda";
import {
  makeTurn,
  TEST_BASE,
  TEST_CONFIG,
  TEST_NOW,
  TEST_PERSONAS,
  TEST_TOPICS,
  TEST_WORLD,
} from "./test-utils";
import type { ForumConfig } from "./types";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function context(overrides: Partial<AgendaContext> = {}): AgendaContext {
  return {
    seq: 2,
    now: TEST_NOW,
    turns: [],
    config: TEST_CONFIG,
    topics: TEST_TOPICS,
    world: TEST_WORLD,
    personas: TEST_PERSONAS,
    ...overrides,
  };
}

function withSchedule(scheduling: Partial<ForumConfig["scheduling"]>): ForumConfig {
  return { ...TEST_CONFIG, scheduling: { ...TEST_CONFIG.scheduling, ...scheduling } };
}

const gold = TEST_TOPICS[0].id;
const semis = TEST_TOPICS[1].id;

test("a person's message outranks everything else", () => {
  const event = nextEvent(context({ seq: 5, turns: [makeTurn(4, { sender: "human", text: "read on gold?" })] }));
  assert.equal(event.kind, "HUMAN");
  assert.equal(event.sender, "human");
  assert.equal(event.quoted, "read on gold?");
});

test("a question that is not about the open thread is marked off-topic", () => {
  const asking = makeTurn(4, {
    sender: "human",
    topicId: gold,
    text: "Hey does anyone here know how to make withdrawals on the platform? It's kinda complicated",
  });
  const event = nextEvent(context({ seq: 5, turns: [asking] }));

  assert.equal(event.kind, "HUMAN");
  assert.equal(event.offTopic, true, "the room must answer the question, not the thread");
  assert.match(event.reason, /not about the open thread/);
  // It is still a reply to that message, and it still lands in the thread.
  assert.equal(event.replyTo, 4);
  assert.equal(event.topic.id, gold);

  // A market question about the open thread is not off-topic, and neither is a bare
  // greeting — the room should not answer those differently.
  for (const text of ["what's the read on gold into the close?", "the range breaks up here", "oi"]) {
    const onTopic = nextEvent(
      context({ seq: 5, turns: [makeTurn(4, { sender: "human", topicId: gold, text })] }),
    );
    assert.notEqual(onTopic.offTopic, true, `"${text}" is about the thread and was flagged`);
    assert.match(onTopic.reason, /owed a reply/);
  }

  // Asking about a *different* market is off-topic too: the answer is about that
  // market, not a pivot back to gold.
  const other = nextEvent(
    context({
      seq: 5,
      turns: [makeTurn(4, { sender: "human", topicId: gold, text: "anyone watching bitcoin tonight?" })],
    }),
  );
  assert.equal(other.offTopic, true);
});

test("a question about the platform itself is flagged, and market talk is not", () => {
  const ask = (text: string) =>
    nextEvent(context({ seq: 5, turns: [makeTurn(4, { sender: "human", topicId: gold, text })] }));

  // The three sentences the live page was actually asked, verbatim, plus the
  // withdrawal question that started the off-topic work. All four are questions
  // about the product, and all four were once answered as if they were about gold.
  for (const text of [
    "Is this real?",
    "Is axion ai trading real ?, hope I am not going to lose my money in this?",
    "Hey, is Axion really a good platform to trade?",
    "how do i make a withdrawal",
  ]) {
    assert.equal(ask(text).productQuestion, true, `"${text}" asks about the platform`);
  }

  // Market talk stays market talk, including the messages that use the same words:
  // "real" alone is not enough, and a question that shares the topic's vocabulary
  // is about the topic.
  for (const text of [
    "what's the read on gold into the close?",
    "is gold for real here",
    "the range breaks up here",
    "where does the stop sit on this one",
    "oi",
  ]) {
    assert.notEqual(ask(text).productQuestion, true, `"${text}" is market talk`);
  }
});

test("a world tick hands the floor to the engine persona", () => {
  const turns = [makeTurn(3, { sender: "mara", topicId: semis })];
  const event = nextEvent(context({ seq: 5, turns }));

  assert.equal(event.kind, "WORLD");
  assert.equal(event.sender, TEST_CONFIG.agenda.enginePersona);
  assert.equal(event.authoredBy, "engine");
  assert.equal(event.topic.id, TEST_WORLD.highlights[0].topicId);
});

test("a long absence is recapped, not replayed", () => {
  const turns = [makeTurn(1, { sender: "mara", topicId: gold })];
  const now = TEST_BASE + 1000 + TWO_HOURS_MS;
  const event = nextEvent(context({ seq: 2, turns, now }));

  assert.equal(event.kind, "RECAP");
  assert.equal(event.authoredBy, "engine");
  assert.equal(event.sender, TEST_CONFIG.agenda.enginePersona);
  assert.equal(event.quoted, TEST_WORLD.digest);
  assert.match(event.reason, /minutes behind/);
});

test("a gap shorter than the stale threshold carries on normally", () => {
  const turns = [makeTurn(1, { sender: "mara", topicId: gold })];
  const now = TEST_BASE + 1000 + 5 * 60 * 1000;

  assert.equal(nextEvent(context({ seq: 2, turns, now })).kind, "THREAD");
});

test("a person speaking outranks even a recap", () => {
  const turns = [makeTurn(1, { sender: "human", text: "still there?" })];
  const now = TEST_BASE + 1000 + TWO_HOURS_MS;

  assert.equal(nextEvent(context({ seq: 2, turns, now })).kind, "HUMAN");
});

test("world ticks rotate through the highlights", () => {
  const turns = [makeTurn(5, { sender: "mara" })];
  const event = nextEvent(context({ seq: 10, turns }));
  assert.equal(event.topic.id, TEST_WORLD.highlights[1].topicId);
});

test("otherwise the room continues its open thread", () => {
  const turns = [makeTurn(1, { sender: "mara", side: "a", topicId: gold })];
  const event = nextEvent(context({ turns }));

  assert.equal(event.kind, "THREAD");
  assert.equal(event.sender, "mara");
  assert.equal(event.side, "a");
  assert.equal(event.topic.id, gold);
  assert.equal(event.quoted, "line 1");
});

test("the room's own turns are not all the same speech act", () => {
  const modes = new Map<string, number>();
  for (let seq = 1; seq <= 400; seq += 1) {
    const mode = threadReplyMode({ roomId: "axion-forum", seq });
    modes.set(mode, (modes.get(mode) ?? 0) + 1);
  }

  // A room whose every turn is an assertion is a row of broadcasts: 0.0% of the shipped
  // room's canned lines asked anything. Questions and verdicts are both minorities.
  for (const mode of ["answer", "askBack", "react"] as const) {
    assert.ok((modes.get(mode) ?? 0) > 0, `${mode} is unreachable: ${JSON.stringify([...modes])}`);
  }
  assert.ok((modes.get("answer") ?? 0) > 200, "answering must still be the norm");
  assert.ok(
    (modes.get("askBack") ?? 0) < 100 && (modes.get("react") ?? 0) < 100,
    `the unusual deliveries are not a minority: ${JSON.stringify([...modes])}`,
  );

  // The delivery is a property of the turn, not of the speaker: the agenda must roll it for
  // the turn the same way every time, or a replay is a different room.
  for (let seq = 1; seq <= 200; seq += 1) {
    assert.equal(threadReplyMode({ roomId: "axion-forum", seq }), threadReplyMode({ roomId: "axion-forum", seq }));
  }
});

test("a thread turn the room delivers as a question says so on the event", () => {
  const turns = [makeTurn(1, { sender: "mara", side: "a", topicId: gold })];
  const seqs = Array.from({ length: 60 }, (_, i) => i + 2);
  const asking = seqs.filter(
    (seq) => nextEvent(context({ seq, turns })).replyMode === "askBack",
  );
  assert.ok(asking.length > 0, "no thread turn in sixty was delivered as a question");

  for (const seq of asking) {
    const event = nextEvent(context({ seq, turns }));
    assert.equal(event.kind, "THREAD", `seq ${seq} asks a question on a ${event.kind} turn`);
    // A FRICTION turn is the room's counter-position to a topic it has been agreeing on, and a
    // counter-position has to be a statement.
    assert.notEqual(event.authoredBy, "engine");
  }

  // And a turn the room has forced onto the other side is never a question or a verdict.
  const frictionTurns = [
    makeTurn(1, { sender: "mara", side: "a", topicId: gold }),
    makeTurn(2, { sender: "jev", side: "a", topicId: gold }),
    makeTurn(3, { sender: "mara", side: "a", topicId: gold }),
  ];
  for (let seq = 4; seq <= 40; seq += 1) {
    // A world tick takes the turn on its own schedule.
    if (seq % TEST_CONFIG.scheduling.worldEventEveryTurns === 0) continue;
    const event = nextEvent(context({ seq, turns: frictionTurns }));
    assert.equal(event.kind, "FRICTION");
    assert.equal(event.replyMode, undefined, `the counter-position at ${seq} was delivered as a ${event.replyMode}`);
  }
});

test("a room that has agreed for too long is forced onto the other side", () => {
  const turns = [
    makeTurn(1, { sender: "mara", side: "a", topicId: gold }),
    makeTurn(2, { sender: "jev", side: "a", topicId: gold }),
    makeTurn(3, { sender: "mara", side: "a", topicId: gold }),
  ];
  const event = nextEvent(context({ seq: 4, turns }));

  assert.equal(event.kind, "FRICTION");
  assert.equal(event.side, "b");
  assert.equal(event.quoted, TEST_TOPICS[0].friction.b);
  assert.match(event.reason, /3 posts in a row/);
});

test("a streak only counts within one topic and one side", () => {
  const turns = [
    makeTurn(1, { sender: "mara", side: "a", topicId: gold }),
    makeTurn(2, { sender: "jev", side: "a", topicId: gold }),
    makeTurn(3, { sender: "mara", side: "a", topicId: semis }),
  ];
  const event = nextEvent(context({ seq: 4, turns }));

  assert.equal(event.kind, "THREAD");
  assert.equal(event.side, "a");
});

test("a topic that has run its course rotates", () => {
  const turns = [
    makeTurn(1, { sender: "mara", side: "a", topicId: gold }),
    makeTurn(2, { sender: "jev", side: "a", topicId: gold }),
    makeTurn(3, { sender: "mara", side: "a", topicId: gold }),
  ];
  const event = nextEvent(context({ seq: 4, turns, config: withSchedule({ topicRotationTurns: 3 }) }));

  assert.equal(event.kind, "IDLE");
  assert.equal(event.topic.id, semis);
  assert.equal(event.authoredBy, "engine");
  assert.match(event.reason, /rotating/);
});

test("an empty room opens on the first topic", () => {
  const event = nextEvent(context({ seq: 1, turns: [] }));

  assert.equal(event.kind, "IDLE");
  assert.equal(event.topic.id, gold);
  assert.equal(event.sender, TEST_CONFIG.agenda.enginePersona);
  assert.equal(event.authoredBy, "engine");
});
