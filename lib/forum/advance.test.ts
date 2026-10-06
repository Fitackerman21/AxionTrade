import assert from "node:assert/strict";
import { test } from "node:test";

import { advance, previewHumanReply } from "./advance";
import { catchUp } from "./catchup";
import { publish } from "./publisher";
import type { ChatProvider, ChatRequest } from "./provider";
import { FileStore } from "./store";
import type { ForumStore } from "./store";
import { lengthTarget, typographyFault } from "./register";
import {
  createFixture,
  fitLine,
  makeTurn,
  TEST_BASE,
  TEST_CONFIG,
  TEST_PERSONAS,
  TEST_TOPICS,
  TEST_WORLD,
} from "./test-utils";
import type { Fixture } from "./test-utils";
import { BEAT_BREAK, flawFor, isBurstTurn } from "./voice";
import type { ForumConfig, GateConfig, MemoryConfig, Persona } from "./types";

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
    for (const persona of TEST_PERSONAS.filter((p) => ["jev", "dmitri", "sol"].includes(p.id))) {
      if (flawFor(persona, seq).drift) return { id: persona.id, seq };
    }
  }
  throw new Error("no drifting turn found in the searched range");
}

/** The first pair in the same range whose flaw licenses a double-text. */
function burstTurn(): { id: string; seq: number } {
  for (let seq = 2; seq <= 30; seq += 1) {
    if (seq % 5 === 0) continue;
    for (const persona of TEST_PERSONAS.filter((p) => ["jev", "dmitri", "sol"].includes(p.id))) {
      if (isBurstTurn(persona, seq)) return { id: persona.id, seq };
    }
  }
  throw new Error("no bursting turn found in the searched range");
}

/** The first pair in the same range whose flaw stays on subject. */
function anchoredTurn(): { id: string; seq: number } {
  for (let seq = 2; seq <= 11; seq += 1) {
    if (seq % 5 === 0) continue;
    for (const persona of TEST_PERSONAS.filter((p) => ["jev", "dmitri", "sol"].includes(p.id))) {
      if (!flawFor(persona, seq).drift) return { id: persona.id, seq };
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

/**
 * A draft no turn can accept: longer than the widest length target there is.
 *
 * The old way to force a Gate rejection was a register band nothing could satisfy —
 * a persona registered for 1000-2000 characters. Tiers are absolute now, so every
 * persona has a reachable target and the rejection has to come from the draft
 * instead: this is over the widest ceiling there is, on any turn, so every attempt
 * fails LENGTH.
 */
const OVERSIZED = Array.from(
  { length: 10 },
  () => "coiling above the level into the dollar's next move",
).join(" ");

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
    // The lease is held on the real clock, not the room's simulated one (see
    // `advance`), so a test leases it with real time as well.
    await fixture.store.acquireLease("worker:999", 60_000, Date.now());
    const blocked = await advance(fixture.store, { now: BASE });

    assert.equal(blocked.status, "lease-held");
    assert.deepEqual(await fixture.store.readTurns(10), []);
  } finally {
    await fixture.cleanup();
  }
});

test("a catch-up burst is not wedged by the previous burst's lease", async () => {
  // A regression test for a room that stops dead. A catch-up burst back-dates each
  // turn so the timestamps are plausible, which means the lease it left behind had
  // an expiry *ahead* of the next burst's first turn. Comparing that row against the
  // simulated clock made every later turn "lease-held": the room reported `ran: 0`
  // on every tick while owing twenty turns. The lease is on real time now, so a row
  // left by an earlier driver is reclaimable.
  // Driven on the real clock, the way the deployed room is: the wedge only exists
  // when the room's clock is *behind* real time, which is what falling behind means.
  const realNow = Date.now();
  const fixture = await createFixture({
    config: { ...TEST_CONFIG, runtime: { ...TEST_CONFIG.runtime, catchUpMaxTurns: 4 } },
  });
  try {
    // A room that has been idle for ten minutes.
    await fixture.store.appendTurn({ ...makeTurn(1, { sender: "mara" }), t: realNow - 600_000 });
    await fixture.store.appendTurn({
      ...makeTurn(2, { sender: "sol", topicId: TEST_TOPICS[0].id }),
      t: realNow - 580_000,
    });
    // The row a previous burst would have left behind: its expiry written from the
    // room's own (back-dated) clock, so it sits behind real now but *ahead* of the
    // next burst's first turn.
    await fixture.store.acquireLease("tick:previous", 30_000, realNow - 580_000 + 45_000);

    const report = await catchUp(fixture.store, { now: realNow, driver: "tick" });
    assert.ok(report.ran > 0, `the burst must run, not stall (${report.reason})`);
    assert.ok(
      report.statuses.every((status) => status !== "lease-held"),
      `a stale lease must not block the burst: ${report.statuses.join(",")}`,
    );
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

test("everything published stays inside the length its turn asked for", async () => {
  const fixture = await createFixture();
  try {
    for (let n = 0; n < 8; n += 1) {
      await advance(fixture.store, { now: BASE + n * 1000 });
    }

    const turns = await fixture.store.readTurns(20);
    // A double-text turn publishes two records, so the log is longer than the
    // number of turns that ran. That is the point of the check below.
    assert.ok(turns.length >= 8);

    for (const turn of turns) {
      const message = turn.message;
      assert.ok(message);
      if (message.system) continue;
      const persona = TEST_PERSONAS.find((p) => p.id === message.sender);
      assert.ok(persona);
      // A second beat belongs to the turn it continues: same target, same speaker.
      const target = lengthTarget(persona, message.continuationOf ?? turn.seq);
      assert.ok(
        message.text.length >= target.min,
        `${persona.id} posted below its ${target.tier} target: "${message.text}"`,
      );
      assert.ok(
        message.text.length <= target.max,
        `${persona.id} posted above its ${target.tier} target: "${message.text}"`,
      );
      assert.equal(
        typographyFault(message.text),
        "",
        `${persona.id} posted keyboard punctuation: "${message.text}"`,
      );
    }
  } finally {
    await fixture.cleanup();
  }
});

test("a person's message is answered even when the Gate rejects every draft", async () => {
  const fixture = await createFixture({
    config: gated(),
    personas: TEST_PERSONAS.map((p) => ({ ...p, model: "test/model" })),
  });
  try {
    await fixture.store.appendHumanMessage({
      text: "elephant banjo, anybody?",
      sender: "human",
      t: BASE,
      topicId: TEST_TOPICS[0].id,
    });

    const result = await advance(fixture.store, {
      now: BASE + 1000,
      voiceProvider: voiceSaying(OVERSIZED),
    });
    assert.equal(result.status, "published");
    assert.equal(result.record?.decision, "APPROVE");
    assert.ok(result.record?.message, "a person must never be left with no reply");
    assert.match(result.record?.note ?? "", /published anyway \(human trigger\)/);
  } finally {
    await fixture.cleanup();
  }
});

test("a persona-to-persona turn still goes unpublished when the Gate rejects it", async () => {
  const fixture = await createFixture({
    config: gated(),
    personas: TEST_PERSONAS.map((p) => ({ ...p, model: "test/model" })),
  });
  try {
    const opening = await advance(fixture.store, { now: BASE });
    assert.equal(opening.status, "published", "an engine opening bypasses the Gate");

    const second = await advance(fixture.store, {
      now: BASE + 1000,
      voiceProvider: voiceSaying(OVERSIZED),
    });
    assert.equal(second.status, "unpublished");
    assert.equal(second.record?.decision, "UNPUBLISHED");
    assert.equal(second.record?.message, null);
  } finally {
    await fixture.cleanup();
  }
});

test("an ambient turn publishes its template when the Gate rejects every draft", async () => {
  // A line that shares nothing with what it answers, so every attempt is rejected
  // and the room is one line away from a hole in the conversation.
  const personas = TEST_PERSONAS.map((persona) => ({ ...persona, model: "test/model" }));
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
  const persona = TEST_PERSONAS.find((p) => p.id === id)!;
  const personas = TEST_PERSONAS.map((p) => (p.id === id ? { ...p, model: "test/model" } : p));
  const fixture = await createFixture({ config: gatedTo([id]), personas });
  // The subject here is the waived ADDRESSEE rule, so the line is the length its
  // turn asked for and LENGTH stays out of the way.
  const line = fitLine(OFF_TOPIC, persona, seq);
  try {
    await seedTurns(fixture, seq - 1);
    const result = await advance(fixture.store, {
      now: BASE,
      voiceProvider: voiceSaying(line),
    });

    assert.equal(result.record?.chosen, id);
    assert.equal(result.status, "published");
    assert.equal(
      result.record?.message?.text,
      line,
      "the drifting line must survive the Gate, not be replaced by a template",
    );
    assert.match(result.record?.note ?? "", /addressee rule was waived/);
  } finally {
    await fixture.cleanup();
  }
});

test("the same line is rejected on a turn whose flaw stays on subject", async () => {
  const { id, seq } = anchoredTurn();
  const persona = TEST_PERSONAS.find((p) => p.id === id)!;
  const personas = TEST_PERSONAS.map((p) => (p.id === id ? { ...p, model: "test/model" } : p));
  const fixture = await createFixture({
    config: gatedTo([id], { onExhausted: "canned" }),
    personas,
  });
  // Same length as the drifting turn, so the only thing that differs is the rule.
  const line = fitLine(OFF_TOPIC, persona, seq);
  try {
    await seedTurns(fixture, seq - 1);
    const result = await advance(fixture.store, {
      now: BASE,
      voiceProvider: voiceSaying(line),
    });

    assert.match(result.record?.note ?? "", /published the fallback line instead of a gap/);
    // The subject rule is what held it, not the length of the line.
    assert.match(result.record?.note ?? "", /ADDRESSEE/);
    assert.ok(result.record?.message, "the room still speaks");
    assert.notEqual(result.record?.message?.text, line, "the Gate held this one to its subject");
  } finally {
    await fixture.cleanup();
  }
});

/**
 * The question a live visitor actually asked, and the answer that has no word in
 * common with it ("settings" appears nowhere in what they wrote).
 */
const OFF_THREAD_QUESTION =
  "Hey does anyone here know how to make withdrawals on the platform? It's kinda complicated";
const OFF_THREAD_ANSWER = "yeah it is under settings, mine took two days";

/** A gated room whose only permitted responder for a person is `id`, with a Voice. */
function gatedPerson(id: string): { fixture: Promise<Fixture>; line: string } {
  const persona = TEST_PERSONAS.find((p) => p.id === id)!;
  return {
    fixture: createFixture({
      config: { ...withPermissions({ allow: { human: [id] } }), gate: gate() },
      personas: TEST_PERSONAS.map((p) => (p.id === id ? { ...p, model: "test/model" } : p)),
    }),
    line: fitLine(OFF_THREAD_ANSWER, persona, 2),
  };
}

test("a person's off-thread question is answered on its own terms", async () => {
  const id = TEST_CONFIG.permissions.allow.human[0]!;
  const { fixture: pending, line } = gatedPerson(id);
  const fixture = await pending;
  try {
    await personSays(fixture.store, OFF_THREAD_QUESTION, BASE);
    const voice = voiceRecording(line);

    const result = await advance(fixture.store, { now: BASE + 61_000, voiceProvider: voice.provider });

    assert.equal(result.status, "published");
    assert.equal(result.record?.chosen, id);
    assert.equal(result.record?.message?.text, line, "the answer must survive the Gate");
    assert.equal(voice.seen.length, 1, "an off-thread answer must not buy a retry");
    assert.match(result.record?.note ?? "", /off the thread; answered them/);
  } finally {
    await fixture.cleanup();
  }
});

test("the same answer is held to its subject on a market question", async () => {
  const id = TEST_CONFIG.permissions.allow.human[0]!;
  const { fixture: pending, line } = gatedPerson(id);
  const fixture = await pending;
  try {
    await personSays(fixture.store, "what's the read on gold into the close?", BASE);
    const voice = voiceRecording(line);

    const result = await advance(fixture.store, {
      now: BASE + 61_000,
      voiceProvider: voice.provider,
    });

    // On-topic, so the rule applies and this line earns a retry: it shares nothing
    // with a question about gold. §9 publishes a person's reply either way, so the
    // cost of the rule here is the extra call — which is exactly what the off-thread
    // waiver buys back, and the only thing it changes.
    assert.equal(voice.seen.length, 2, "the on-topic turn earned its retry");
    assert.match(result.record?.note ?? "", /ADDRESSEE/);
    assert.doesNotMatch(result.record?.note ?? "", /off the thread; answered them/);
  } finally {
    await fixture.cleanup();
  }
});

test("a double-text turn lands as two messages, tied to the first", async () => {
  const { id, seq } = burstTurn();
  const persona = TEST_PERSONAS.find((p) => p.id === id)!;
  const personas = TEST_PERSONAS.map((p) => (p.id === id ? { ...p, model: "test/model" } : p));
  const fixture = await createFixture({ config: gatedTo([id]), personas });

  // One line, cut in half and rejoined by the marker the prompt asks for. The joined
  // version is what the Gate reads, so it has to fit the turn like any other line —
  // and answer the message, which is why the seeded line is the topic itself.
  // The base mentions the topic *and* the topic's friction line, because which of
  // the two this turn is answering depends on the agenda, not on the test.
  const joined = fitLine(
    "watching the gold range all morning, flows still lag price here and nothing has broken either way",
    persona,
    seq,
  );
  // Cut on a word boundary: the joined halves are what the Gate reads, and a word
  // split down the middle would not be a word at all.
  const cut = joined.slice(0, Math.floor(joined.length / 2)).lastIndexOf(" ");
  const first = joined.slice(0, cut).trim();
  const second = joined.slice(cut).trim();

  try {
    for (let n = 1; n < seq; n += 1) {
      await fixture.store.appendTurn(
        makeTurn(n, { sender: "mara", text: "gold coiling into the dollar's next move" }),
      );
    }
    const result = await advance(fixture.store, {
      now: BASE,
      voiceProvider: voiceSaying(`${first} ${BEAT_BREAK} ${second}`),
    });

    assert.equal(result.status, "published");
    assert.equal(result.record?.chosen, id);

    const turns = await fixture.store.readTurns(40);
    const pair = turns.filter((t) => t.seq >= seq);
    assert.equal(pair.length, 2, "a double-text is two records");
    assert.equal(pair[0]?.message?.text, first);
    assert.equal(pair[1]?.message?.text, second);
    assert.equal(pair[1]?.message?.continuationOf, seq, "the second beat points at the first");
    assert.equal(pair[1]?.message?.sender, id, "same person, two bubbles");
    assert.equal(pair[1]?.message?.replyToSeq, pair[0]?.message?.replyToSeq);
    // The pair is one act of speaking, so the first record's trace is not repeated.
    assert.deepEqual(pair[1]?.attempts, []);
    assert.match(pair[1]?.note ?? "", /second beat of seq \d+/);
  } finally {
    await fixture.cleanup();
  }
});

test("a burst marker on a turn that was not asked to double-text is just text", async () => {
  const { id, seq } = anchoredTurn();
  const persona = TEST_PERSONAS.find((p) => p.id === id)!;
  const personas = TEST_PERSONAS.map((p) => (p.id === id ? { ...p, model: "test/model" } : p));
  const fixture = await createFixture({ config: gatedTo([id]), personas });
  const line = `${fitLine("watching the gold range all morning, flows still lag price here", persona, seq)} ${BEAT_BREAK} and that is it`;
  try {
    for (let n = 1; n < seq; n += 1) {
      await fixture.store.appendTurn(
        makeTurn(n, { sender: "mara", text: "gold coiling into the dollar's next move" }),
      );
    }
    const result = await advance(fixture.store, {
      now: BASE,
      voiceProvider: voiceSaying(line),
    });

    const turns = await fixture.store.readTurns(40);
    const after = turns.filter((t) => t.seq >= seq);
    assert.equal(after.length, 1, "only the turn that was asked to burst may split");
    assert.equal(result.record?.message?.text, line);
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

/* ------------------------------------------------------------------ *
 * Agent 2: memory files, the size check and compaction (spec §7, steps 8-10)
 * ------------------------------------------------------------------ */

const MEMORY: MemoryConfig = {
  enabled: true,
  recentTurns: 10,
  compactionTokens: 500,
  keepRecentTurns: 2,
  maxDigestChars: 300,
  models: ["archivist/one"],
};

function withMemory(
  overrides: Partial<MemoryConfig> = {},
  config: ForumConfig = TEST_CONFIG,
): ForumConfig {
  return { ...config, memory: { ...MEMORY, ...overrides } };
}

/** A Voice that answers with a fixed line and keeps every request it was given. */
function voiceRecording(text: string): { provider: ChatProvider; seen: ChatRequest[] } {
  const seen: ChatRequest[] = [];
  return {
    seen,
    provider: {
      id: "test-voice",
      model: "test/voice",
      family: "test",
      chat: async (request) => {
        seen.push(request);
        return { text, model: "test/voice", usage: { tokensIn: 1, tokensOut: 1, cost: 0 } };
      },
    },
  };
}

/** A store whose memory writes fail, for the "memory must not stall the room" path. */
function storeWithBrokenMemory(store: FileStore): ForumStore {
  const broken: ForumStore = Object.create(store) as ForumStore;
  broken.writeMemory = async () => {
    throw new Error("the store is down");
  };
  return broken;
}

async function personSays(
  store: { appendHumanMessage: (args: {
    text: string;
    sender: string;
    t: number;
    topicId: string;
    replyToSeq?: number;
  }) => Promise<unknown> },
  text: string,
  at: number,
  replyToSeq?: number,
): Promise<void> {
  await store.appendHumanMessage({
    text,
    sender: "human",
    t: at,
    topicId: TEST_TOPICS[0].id,
    replyToSeq,
  });
}

test("a published reply is folded into the responder's private thread", async () => {
  const fixture = await createFixture({ config: withMemory() });
  try {
    await personSays(fixture.store, "read on gold?", BASE);
    const result = await advance(fixture.store, { now: BASE + 1000 });
    const chosen = result.record?.chosen ?? "";

    assert.equal(result.status, "published");
    assert.deepEqual(result.record?.memoryWrites, [`${chosen}:human`]);

    const file = await fixture.store.readMemory(chosen, "human");
    assert.ok(file, "the thread must exist after the turn");
    assert.equal(file.recent.length, 2, "both sides of the exchange are recorded (§7.4)");
    assert.deepEqual(file.recent.map((entry) => entry.role), ["them", "me"]);
    assert.equal(file.recent[1]?.text, result.record?.message?.text);
    assert.match(result.record?.note ?? "", /memory 2 recent/);
  } finally {
    await fixture.cleanup();
  }
});

test("the Voice is handed what the persona remembers about this companion", async () => {
  const maraVoiced = TEST_PERSONAS.map((p) => (p.id === "mara" ? { ...p, model: "test/model" } : p));
  const fixture = await createFixture({
    config: withMemory({}, withPermissions({ allow: { human: ["mara"] } })),
    personas: maraVoiced,
  });
  try {
    await fixture.store.writeMemory({
      persona: "mara",
      companion: "human",
      seq: 1,
      version: 1,
      updatedAt: BASE - 5000,
      compactions: 1,
      digest: "You told them last week you were long gold and would not move the stop.",
      recent: [
        { seq: 1, t: BASE - 5000, role: "them", text: "are you still long gold from last week" },
        { seq: 1, t: BASE - 5000, role: "me", text: "still long, same stop" },
      ],
    });
    await personSays(fixture.store, "still in that gold trade?", BASE);

    const voice = voiceRecording("same stop, still long");
    const result = await advance(fixture.store, { now: BASE + 1000, voiceProvider: voice.provider });
    const prompt = voice.seen[0]?.messages[0]?.content ?? "";

    assert.equal(result.record?.chosen, "mara");
    assert.match(prompt, /<what you remember about human>/);
    assert.match(prompt, /would not move the stop/);
    assert.match(prompt, /Never recite it, never say that you remember it/);
    // The model is told what it is answering, and the transcript is still there.
    assert.match(prompt, /<message from human>/);
  } finally {
    await fixture.cleanup();
  }
});

test("Agent 2 compacts the thread when it outgrows its budget, and the file is versioned", async () => {
  const fixture = await createFixture({ config: withMemory({ compactionTokens: 1 }) });
  try {
    await personSays(fixture.store, "read on gold?", BASE);
    const digest = "Notes: still long gold, stop unchanged, and dmitri still does not buy the flows story.";
    const archive = voiceRecording(digest);

    const result = await advance(fixture.store, {
      now: BASE + 1000,
      archivistProvider: archive.provider,
    });
    const chosen = result.record?.chosen ?? "";
    const file = await fixture.store.readMemory(chosen, "human");

    assert.equal(file?.digest, digest);
    assert.equal(file?.version, 1);
    assert.equal(file?.compactions, 1);
    assert.equal(file?.recent.length, MEMORY.keepRecentTurns, "the tail is trimmed to the budget");
    assert.match(result.record?.note ?? "", /agent 2 compacted the human thread/);
    assert.ok(
      result.record?.usage?.some((entry) => entry.provider === "archivist"),
      "the compaction call is accounted for on the turn (§11)",
    );
    // The character file is fixed (v0 requirement #2): compaction writes memory,
    // and the roster the store hands out is byte-for-byte what the fixture wrote.
    assert.deepEqual(
      (await fixture.store.readPersonas()).find((p) => p.id === chosen),
      TEST_PERSONAS.find((p) => p.id === chosen),
    );
  } finally {
    await fixture.cleanup();
  }
});

test("a memory failure is reported on the turn and never stalls the room", async () => {
  const fixture = await createFixture({ config: withMemory() });
  try {
    await personSays(fixture.store, "read on gold?", BASE);
    const result = await advance(storeWithBrokenMemory(fixture.store), { now: BASE + 1000 });

    assert.equal(result.status, "published");
    assert.ok(result.record?.message, "the room still speaks");
    assert.match(result.record?.note ?? "", /memory write failed/);
    assert.deepEqual(result.record?.memoryWrites, []);
  } finally {
    await fixture.cleanup();
  }
});

test("threads are per companion, so one person cannot read another's notes", async () => {
  const fixture = await createFixture({
    config: withMemory({}, withPermissions({ allow: { human: ["mara"], mara: ["dmitri"] } })),
  });
  try {
    await personSays(fixture.store, "read on gold?", BASE);
    await advance(fixture.store, { now: BASE + 1000 });
    await advance(fixture.store, { now: BASE + 2000 });

    const files = await fixture.store.listMemory();
    assert.deepEqual(
      files.map((file) => `${file.persona}:${file.companion}`).sort(),
      ["dmitri:mara", "mara:human"],
    );
  } finally {
    await fixture.cleanup();
  }
});

test("the room runs without memory when the room does not configure it", async () => {
  const fixture = await createFixture();
  try {
    await personSays(fixture.store, "read on gold?", BASE);
    const result = await advance(fixture.store, { now: BASE + 1000 });

    assert.equal(result.status, "published");
    assert.match(result.record?.note ?? "", /memory disabled/);
    assert.deepEqual(await fixture.store.listMemory(), []);
  } finally {
    await fixture.cleanup();
  }
});

test("a reply carries the seq of the message it answers", async () => {
  const fixture = await createFixture();
  const fresh = await createFixture();
  try {
    await personSays(fixture.store, "read on gold?", BASE);
    const result = await advance(fixture.store, { now: BASE + 1000 });

    assert.equal(result.record?.message?.replyToSeq, 1, "the answer quotes the person's message");
    assert.equal(result.record?.event.kind, "HUMAN");

    // What the UI's swipe-to-reply sends: a quote that points at a real message.
    const quoted = await fixture.store.appendHumanMessage({
      text: "and the stop?",
      sender: "human",
      t: BASE + 2000,
      topicId: TEST_TOPICS[0].id,
      replyToSeq: 1,
    });
    assert.equal(quoted.message?.replyToSeq, 1);

    // An engine opening answers nothing, so it carries no quote.
    const opening = await advance(fresh.store, { now: BASE });
    assert.equal(opening.record?.trigger, "IDLE");
    assert.equal(opening.record?.message?.replyToSeq, undefined);
  } finally {
    await fixture.cleanup();
    await fresh.cleanup();
  }
});

test("a rejected draft's reason is handed to the next attempt", async () => {
  const fixture = await createFixture({
    // The Gate on, and exactly one persona allowed to answer the person.
    config: { ...withPermissions({ allow: { human: ["mara"] } }), gate: gate() },
    personas: TEST_PERSONAS.map((p) => (p.id === "mara" ? { ...p, model: "test/model" } : p)),
  });
  try {
    await personSays(fixture.store, "read on gold?", BASE);
    // A two-word non-answer, so the first attempt is rejected on its merits; the
    // retry must be told *which* rule it broke rather than asked to try again blind
    // (§8.4's REVISE arrow).
    const short = voiceRecording("no");
    const result = await advance(fixture.store, { now: BASE + 1000, voiceProvider: short.provider });

    assert.equal(short.seen.length, 2, "the rejected attempt happened twice");
    const retry = short.seen[1]?.messages[0]?.content ?? "";
    assert.match(retry, /<your last attempt was rejected for this reason>/);

    // Whichever codes fired are the codes the retry is told about — asserted against
    // the record rather than against one hard-coded rule, so the test proves the
    // reason is carried across, not that a particular check happens to be strict.
    const firstCodes = result.record?.attempts[0]?.codes ?? [];
    assert.ok(firstCodes.length > 0, "the first attempt has to be rejected for something");
    for (const code of firstCodes) assert.match(retry, new RegExp(code));
    assert.match(result.record?.note ?? "", /retry\/retries, each carrying the rejection reason/);
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
