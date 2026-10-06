import assert from "node:assert/strict";
import { test } from "node:test";

import { advance, previewHumanReply } from "./advance";
import { publish } from "./publisher";
import type { ChatProvider } from "./provider";
import {
  createFixture,
  makeTurn,
  TEST_BASE,
  TEST_CONFIG,
  TEST_PERSONAS,
  TEST_TOPICS,
  TEST_WORLD,
} from "./test-utils";
import type { Fixture } from "./test-utils";
import { flawFor } from "./voice";
import type { ForumConfig, GateConfig, Persona } from "./types";

/** A minute after the seeded turns, so nothing looks stale and time moves forward. */
const BASE = TEST_BASE + 60_000;

function withPermissions(permissions: Partial<ForumConfig["permissions"]>): ForumConfig {
  return { ...TEST_CONFIG, permissions: { ...TEST_CONFIG.permissions, ...permissions } };
}

/** The Gate on, deterministic only — no judge provider and no network. */
function gate(overrides: Partial<GateConfig> = {}): GateConfig {
  return {
    ...TEST_CONFIG.gate!,
    mode: "deterministic",
    maxAttempts: 3,
    requireAddressee: true,
    ...overrides,
  };
}

function gated(overrides: Partial<GateConfig> = {}): ForumConfig {
  return { ...TEST_CONFIG, gate: gate(overrides) };
}

/** The Gate on, with the room's responder pool narrowed to one persona. */
function gatedTo(responders: string[], overrides: Partial<GateConfig> = {}): ForumConfig {
  return { ...withPermissions({ allow: { mara: responders } }), gate: gate(overrides) };
}

/** A Voice that answers with a fixed line, so a test can choose the text. */
function voiceSaying(text: string): ChatProvider {
  return {
    id: "test-voice",
    model: "test/voice",
    family: "test",
    chat: async () => ({
      text,
      model: "test/voice",
      usage: { tokensIn: 1, tokensOut: 1, cost: 0 },
    }),
  };
}

/**
 * A line that shares no content token with any seeded turn, so ADDRESSEE is the
 * only deterministic check it can fail.
 */
const OFF_TOPIC =
  "anyway the espresso machine finally died so i am drinking hotel coffee like an animal and this whole week has been a write off honestly";

/** The first (persona, turn) pair in the searched range whose flaw says drift. */
function driftingTurn(): { id: string; seq: number } {
  for (let seq = 2; seq <= 11; seq += 1) {
    // A WORLD turn is engine-authored, so no responder is drafted for it.
    if (seq % 5 === 0) continue;
    for (const id of ["jev", "dmitri", "sol"]) {
      if (flawFor(id, seq).drift) return { id, seq };
    }
  }
  throw new Error("no drifting turn found in the searched range");
}

/** The first pair in the same range whose flaw stays on subject. */
function anchoredTurn(): { id: string; seq: number } {
  for (let seq = 2; seq <= 11; seq += 1) {
    if (seq % 5 === 0) continue;
    for (const id of ["jev", "dmitri", "sol"]) {
      if (!flawFor(id, seq).drift) return { id, seq };
    }
  }
  throw new Error("no anchored turn found in the searched range");
}

/** Seed `count` turns from the same persona, as a room already mid-thread. */
async function seedTurns(fixture: Fixture, count: number): Promise<void> {
  for (let n = 1; n <= count; n += 1) {
    await fixture.store.appendTurn(makeTurn(n, { sender: "mara", topicId: TEST_TOPICS[0].id }));
  }
}

/** A register band no canned line can satisfy, so the Gate always rejects it. */
function unreachableRegisters(): Persona[] {
  return TEST_PERSONAS.map((persona) => ({
    ...persona,
    sheet: { ...persona.sheet, register: { minChars: 1000, maxChars: 2000, note: "unreachable" } },
  }));
}

function paced(humanReplySec: [number, number]): ForumConfig {
  return { ...TEST_CONFIG, scheduling: { ...TEST_CONFIG.scheduling, humanReplySec } };
}

test("each call publishes exactly one turn, numbered in sequence", async () => {
  const fixture = await createFixture();
  try {
    const statuses: string[] = [];
    for (let n = 1; n <= 3; n += 1) {
      statuses.push((await advance(fixture.store, { now: BASE + n * 1000, driver: "test" })).status);
    }
    assert.deepEqual(statuses, ["published", "published", "published"]);

    const turns = await fixture.store.readTurns(10);
    assert.deepEqual(turns.map((t) => t.seq), [1, 2, 3]);

    for (const turn of turns) {
      assert.ok(turn.message, `turn ${turn.seq} published with no message`);
      assert.equal(turn.worldVersion, TEST_WORLD.version);
      assert.equal(turn.driver, "test");
      assert.equal(turn.decision, "APPROVE");
      assert.ok(
        TEST_PERSONAS.some((p) => p.id === turn.message?.sender),
        `${turn.message?.sender} is not on the roster`,
      );
    }
  } finally {
    await fixture.cleanup();
  }
});

test("the room opens on the engine persona and then rotates speakers", async () => {
  const fixture = await createFixture();
  try {
    const first = await advance(fixture.store, { now: BASE });
    assert.equal(first.record?.chosen, TEST_CONFIG.agenda.enginePersona);
    assert.equal(first.record?.trigger, "IDLE");
    // The opening is authored by the engine, not scheduled among candidates, and
    // it is not an escalation.
    assert.deepEqual(first.record?.candidates, []);
    assert.equal(first.record?.escalated, null);
    assert.equal(first.record?.message?.primaryRecipient, "room");
    assert.equal(first.record?.message?.system, false);

    const second = await advance(fixture.store, { now: BASE + 1000 });
    assert.equal(second.record?.trigger, "THREAD");
    assert.equal(second.record?.event.sender, TEST_CONFIG.agenda.enginePersona);
    // Nobody may reply to themselves, so the second voice is a different one.
    assert.notEqual(second.record?.chosen, TEST_CONFIG.agenda.enginePersona);
  } finally {
    await fixture.cleanup();
  }
});

test("a turn never goes backwards in time", async () => {
  const fixture = await createFixture();
  try {
    await advance(fixture.store, { now: BASE + 5000 });
    const rewound = await advance(fixture.store, { now: BASE });

    assert.equal(rewound.status, "clock-rewind");
    assert.equal(rewound.record, null);
    assert.deepEqual((await fixture.store.readTurns(10)).map((t) => t.seq), [1]);
  } finally {
    await fixture.cleanup();
  }
});

test("an identical timestamp is still allowed to advance", async () => {
  const fixture = await createFixture();
  try {
    await advance(fixture.store, { now: BASE });
    const second = await advance(fixture.store, { now: BASE });
    assert.equal(second.status, "published");
    assert.deepEqual((await fixture.store.readTurns(10)).map((t) => t.seq), [1, 2]);
  } finally {
    await fixture.cleanup();
  }
});

test("a turn is skipped while another driver holds the lease", async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.acquireLease("worker:999", 60_000, BASE);
    const blocked = await advance(fixture.store, { now: BASE });

    assert.equal(blocked.status, "lease-held");
    assert.deepEqual(await fixture.store.readTurns(10), []);
  } finally {
    await fixture.cleanup();
  }
});

test("the lease is released even when a turn completes", async () => {
  const fixture = await createFixture();
  try {
    await advance(fixture.store, { now: BASE });
    assert.equal(await fixture.store.readLease(), null);
  } finally {
    await fixture.cleanup();
  }
});

test("a person's message is answered by someone the matrix permits", async () => {
  const fixture = await createFixture();
  try {
    await fixture.store.appendHumanMessage({
      text: "what is the room's read on gold?",
      sender: "human",
      t: BASE,
      topicId: TEST_TOPICS[0].id,
    });

    const result = await advance(fixture.store, { now: BASE + 1000 });
    assert.equal(result.record?.trigger, "HUMAN");
    assert.deepEqual(result.record?.candidates, ["jev", "mara"]);
    assert.equal(result.record?.message?.primaryRecipient, "human");
    assert.ok(["jev", "mara"].includes(result.record?.chosen ?? ""));
  } finally {
    await fixture.cleanup();
  }
});

test("a sender with no permitted responder falls back to the reciprocal pool", async () => {
  const fixture = await createFixture({ config: withPermissions({ allow: { dmitri: ["jev"] } }) });
  try {
    // Seed a turn so the room is already open and the escalation path runs.
    await fixture.store.appendTurn(makeTurn(1, { sender: "jev", topicId: TEST_TOPICS[0].id }));
    const result = await advance(fixture.store, { now: BASE });

    assert.equal(result.record?.seq, 2);
    assert.equal(result.record?.escalated, "pool-widened");
    assert.equal(result.record?.chosen, "dmitri");
    assert.deepEqual(result.record?.candidates, ["dmitri"]);
    assert.equal(result.record?.message?.system, false);
  } finally {
    await fixture.cleanup();
  }
});

test("a sender nobody covers gets an engine stage direction instead of silence", async () => {
  const fixture = await createFixture({ config: withPermissions({ allow: {} }) });
  try {
    await fixture.store.appendTurn(makeTurn(1, { sender: "jev", topicId: TEST_TOPICS[0].id }));
    const result = await advance(fixture.store, { now: BASE });

    assert.equal(result.record?.escalated, "stage-direction");
    assert.equal(result.record?.chosen, TEST_CONFIG.agenda.enginePersona);
    assert.equal(result.record?.message?.system, true);
    assert.deepEqual(result.record?.candidates, []);
    assert.match(result.record?.note ?? "", /stage direction/);
  } finally {
    await fixture.cleanup();
  }
});

test("everything published stays inside the persona's register", async () => {
  const fixture = await createFixture();
  try {
    for (let n = 0; n < 8; n += 1) {
      await advance(fixture.store, { now: BASE + n * 1000 });
    }

    const turns = await fixture.store.readTurns(20);
    assert.equal(turns.length, 8);

    for (const turn of turns) {
      const message = turn.message;
      assert.ok(message);
      if (message.system) continue;
      const persona = TEST_PERSONAS.find((p) => p.id === message.sender);
      assert.ok(persona);
      assert.ok(
        message.text.length >= persona.sheet.register.minChars,
        `${persona.id} posted below its register: "${message.text}"`,
      );
      assert.ok(
        message.text.length <= persona.sheet.register.maxChars,
        `${persona.id} posted above its register: "${message.text}"`,
      );
    }
  } finally {
    await fixture.cleanup();
  }
});

test("a person's message is answered even when the Gate rejects every draft", async () => {
  const fixture = await createFixture({ config: gated(), personas: unreachableRegisters() });
  try {
    await fixture.store.appendHumanMessage({
      text: "elephant banjo, anybody?",
      sender: "human",
      t: BASE,
      topicId: TEST_TOPICS[0].id,
    });

    const result = await advance(fixture.store, { now: BASE + 1000 });
    assert.equal(result.status, "published");
    assert.equal(result.record?.decision, "APPROVE");
    assert.ok(result.record?.message, "a person must never be left with no reply");
    assert.match(result.record?.note ?? "", /published anyway \(human trigger\)/);
  } finally {
    await fixture.cleanup();
  }
});

test("a persona-to-persona turn still goes unpublished when the Gate rejects it", async () => {
  const fixture = await createFixture({ config: gated(), personas: unreachableRegisters() });
  try {
    const opening = await advance(fixture.store, { now: BASE });
    assert.equal(opening.status, "published", "an engine opening bypasses the Gate");

    const second = await advance(fixture.store, { now: BASE + 1000 });
    assert.equal(second.status, "unpublished");
    assert.equal(second.record?.decision, "UNPUBLISHED");
    assert.equal(second.record?.message, null);
  } finally {
    await fixture.cleanup();
  }
});

test("an ambient turn publishes its template when the Gate rejects every draft", async () => {
  // A register band no draft can satisfy, so every attempt is rejected and the
  // room is one line away from a hole in the conversation.
  const personas = unreachableRegisters().map((persona) => ({ ...persona, model: "test/model" }));
  const fixture = await createFixture({ config: gated({ onExhausted: "canned" }), personas });
  try {
    const opening = await advance(fixture.store, { now: BASE });
    assert.equal(opening.status, "published", "an engine opening bypasses the Gate");

    // A person's absence must not be a hole in the transcript: the room keeps
    // talking, even if the only line it has left is the persona's own template.
    const second = await advance(fixture.store, {
      now: BASE + 1000,
      voiceProvider: voiceSaying(OFF_TOPIC),
    });
    assert.equal(second.status, "published");
    assert.equal(second.record?.decision, "APPROVE");
    assert.ok(second.record?.message, "an ambient turn must never be silent");
    assert.match(second.record?.note ?? "", /published the fallback line instead of a gap/);
    assert.notEqual(second.record?.message?.text, OFF_TOPIC);
    assert.ok(second.record?.attempts.every((a) => a.decision !== "APPROVE"));
  } finally {
    await fixture.cleanup();
  }
});

test("an off-topic turn is not held to the addressee rule", async () => {
  const { id, seq } = driftingTurn();
  const personas = TEST_PERSONAS.map((p) => (p.id === id ? { ...p, model: "test/model" } : p));
  const fixture = await createFixture({ config: gatedTo([id]), personas });
  try {
    await seedTurns(fixture, seq - 1);
    const result = await advance(fixture.store, {
      now: BASE,
      voiceProvider: voiceSaying(OFF_TOPIC),
    });

    assert.equal(result.record?.chosen, id);
    assert.equal(result.status, "published");
    assert.equal(
      result.record?.message?.text,
      OFF_TOPIC,
      "the drifting line must survive the Gate, not be replaced by a template",
    );
    assert.match(result.record?.note ?? "", /addressee rule was waived/);
  } finally {
    await fixture.cleanup();
  }
});

test("the same line is rejected on a turn whose flaw stays on subject", async () => {
  const { id, seq } = anchoredTurn();
  const personas = TEST_PERSONAS.map((p) => (p.id === id ? { ...p, model: "test/model" } : p));
  const fixture = await createFixture({
    config: gatedTo([id], { onExhausted: "canned" }),
    personas,
  });
  try {
    await seedTurns(fixture, seq - 1);
    const result = await advance(fixture.store, {
      now: BASE,
      voiceProvider: voiceSaying(OFF_TOPIC),
    });

    assert.match(result.record?.note ?? "", /published the fallback line instead of a gap/);
    assert.ok(result.record?.message, "the room still speaks");
    assert.notEqual(result.record?.message?.text, OFF_TOPIC, "the Gate held this one to its subject");
  } finally {
    await fixture.cleanup();
  }
});

test("a person's reply is paced out rather than returned on the same call", async () => {
  const fixture = await createFixture({ config: paced([30, 60]) });
  try {
    await fixture.store.appendHumanMessage({
      text: "what's the read on gold?",
      sender: "human",
      t: BASE,
      topicId: TEST_TOPICS[0].id,
    });

    const early = await advance(fixture.store, { now: BASE + 1000 });
    assert.equal(early.status, "deferred");
    assert.ok((early.dueAt ?? 0) >= BASE + 30_000, "due inside the window");
    assert.ok((early.dueAt ?? 0) <= BASE + 60_000, "due inside the window");
    assert.equal((await fixture.store.readTurns(10)).length, 1, "nothing is posted while typing");

    const late = await advance(fixture.store, { now: BASE + 61_000 });
    assert.equal(late.status, "published");
    assert.equal(late.record?.trigger, "HUMAN");
  } finally {
    await fixture.cleanup();
  }
});

test("the typing preview names the responder without writing anything", async () => {
  const fixture = await createFixture({ config: paced([30, 60]) });
  try {
    await fixture.store.appendHumanMessage({
      text: "what's the read on gold?",
      sender: "human",
      t: BASE,
      topicId: TEST_TOPICS[0].id,
    });

    const preview = await previewHumanReply(fixture.store, BASE + 1000);
    assert.ok(preview);
    assert.ok(["jev", "mara"].includes(preview!.sender));
    assert.equal(preview!.system, false);
    assert.ok(preview!.dueAt >= BASE + 30_000);
    assert.equal((await fixture.store.readTurns(10)).length, 1);

    await advance(fixture.store, { now: BASE + 61_000 });
    assert.equal(await previewHumanReply(fixture.store, BASE + 62_000), null);
  } finally {
    await fixture.cleanup();
  }
});

test("the publisher refuses anything that is not approved", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      () => publish(fixture.store, { ...makeTurn(1, { sender: "mara" }), decision: "SKIP" }),
      /refusing to publish/,
    );
    await assert.rejects(
      () => publish(fixture.store, { ...makeTurn(1, { sender: "mara" }), message: null }),
      /no message/,
    );
    assert.deepEqual(await fixture.store.readTurns(10), []);
  } finally {
    await fixture.cleanup();
  }
});
