import assert from "node:assert/strict";
import { test } from "node:test";

import { nextEvent } from "./agenda";
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
