/**
 * These tests validate the data in data/forum rather than the code: a malformed
 * character sheet or a matrix that names a persona who does not exist would
 * otherwise only show up as a strange room at runtime.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { cannedDraft } from "./drafts";
import { lengthTarget, typographyFault } from "./register";
import { dataStore } from "./test-utils";
import type { AgendaEvent, Side } from "./types";

const store = dataStore();
const SIDES: Side[] = ["a", "b"];

test("the shipped room loads", async () => {
  const [config, personas, topics, world] = await Promise.all([
    store.readConfig(),
    store.readPersonas(),
    store.readTopics(),
    store.readWorld(),
  ]);

  assert.ok(personas.length >= 8, "the room should have a real roster");
  assert.ok(topics.length >= 4, "the topic deck needs enough topics to rotate");
  assert.ok(world.digest.length > 0);
  assert.ok(config.agenda.enginePersona.length > 0);
});

test("the shipped room is tuned to keep talking, not to go quiet", async () => {
  const [config, personas] = await Promise.all([store.readConfig(), store.readPersonas()]);
  const { gapSec, humanReplySec } = config.scheduling;

  assert.ok(gapSec[0] > 0 && gapSec[0] < gapSec[1], "the ambient cadence must be a real range");
  assert.ok(gapSec[1] <= 90, `an ambient gap of ${gapSec[1]}s reads as silence, not chatter`);
  assert.ok(humanReplySec && humanReplySec[0] > 0, "a person's reply must be paced, not instant");
  // A rejected ambient draft becomes the persona's own line instead of a hole in
  // the conversation, which is the difference between a stalled room and a live one.
  assert.equal(config.gate?.onExhausted, "canned");

  for (const persona of personas) {
    assert.ok(
      (persona.sheet.personality?.length ?? 0) >= 3,
      `${persona.id} needs a personality, not only a book`,
    );
    assert.ok(
      (persona.sheet.banter?.length ?? 0) >= 2,
      `${persona.id} needs something off-market to bring up`,
    );
  }
});

test("the room's slang is American, never a persona's home dialect", async () => {
  const personas = await store.readPersonas();
  const withSlang = personas.filter((p) => (p.sheet.slang?.length ?? 0) > 0);

  assert.ok(withSlang.length >= 6, "most of the roster needs its own slang vocabulary");
  // The personas are written as Lagos, Accra, Bogotá and Tokyo. Without this, one
  // writes "abeg" into a room that reads as a US desk, which is what happened.
  const regionalSlang = [
    "abeg",
    "wahala",
    "chale",
    "oyinbo",
    "wetin",
    "sabi",
    "shakara",
    "na so",
    "dey ",
    "parce",
  ];

  for (const persona of personas) {
    const everything = JSON.stringify(persona.sheet).toLowerCase();
    for (const word of regionalSlang) {
      assert.equal(
        everything.includes(word),
        false,
        `${persona.id}'s sheet carries the regional term "${word.trim()}"`,
      );
    }
  }
});

test("no character sheet teaches a memo shape", async () => {
  const personas = await store.readPersonas();
  // The sheets are the voice anchor: a labelled line in one of them comes back out
  // as "Risk desk rule: …" in the room, which is the shape §4.2's third rule exists
  // to stop. This is the guard on the data that rule depends on.
  const labelled =
    /(^|\s)(rule|reminder|note|takeaway|bottom line|key point|lesson|pro tip|tl;?dr|discipline|checklist|hot take)[^.\n]{0,32}:/i;

  for (const persona of personas) {
    const { sampleLines, banter, results } = persona.sheet;
    for (const line of [...sampleLines, ...(banter ?? []), ...(results ?? [])]) {
      assert.equal(
        labelled.test(line),
        false,
        `${persona.id}'s sheet teaches a labelled fragment: "${line}"`,
      );
    }
  }
});

test("the matrix only names personas that exist, and nobody answers themselves", async () => {
  const [config, personas] = await Promise.all([store.readConfig(), store.readPersonas()]);
  const ids = new Set(personas.map((p) => p.id));
  const { allow, deny, allowSelfReply } = config.permissions;
  const senders = [...Object.keys(allow), ...Object.keys(deny)];

  for (const sender of senders) {
    // A sender may be external (a person), so ids are only checked for targets.
    for (const target of [...(allow[sender] ?? []), ...(deny[sender] ?? [])]) {
      assert.ok(ids.has(target), `${sender} names unknown persona ${target}`);
    }
    if (allowSelfReply) continue;
    for (const target of allow[sender] ?? []) {
      assert.notEqual(target, sender, `${sender} is allowed to answer itself`);
    }
  }

  assert.ok(senders.some((s) => !ids.has(s)), "a human sender should be modelled in the matrix");
});

test("every persona has a usable character sheet", async () => {
  const personas = await store.readPersonas();
  const seen = new Set<string>();

  for (const persona of personas) {
    assert.equal(seen.has(persona.id), false, `duplicate persona id ${persona.id}`);
    seen.add(persona.id);

    const { register, sampleLines, quirks, stance } = persona.sheet;
    assert.ok(stance.length > 0, `${persona.id} has no stance`);
    assert.ok(register.minChars < register.maxChars, `${persona.id} has an inverted register band`);
    assert.ok(quirks.length > 0, `${persona.id} has no quirks`);
    // The Gate compares drafts against these, so three is the floor (spec §8.2).
    assert.ok(sampleLines.length >= 3, `${persona.id} needs at least 3 sample lines`);
    assert.ok(persona.g1.length > 0 && persona.g2.length > 0, `${persona.id} has no avatar colours`);
  }
});

test("the topic deck carries two sides and a friction line for each", async () => {
  const topics = await store.readTopics();
  const ids = new Set<string>();

  for (const topic of topics) {
    assert.equal(ids.has(topic.id), false, `duplicate topic id ${topic.id}`);
    ids.add(topic.id);
    assert.ok(topic.title.length > 0);
    for (const side of SIDES) {
      assert.ok(topic.sides[side].length > 0, `${topic.id} is missing side ${side}`);
      assert.ok(topic.friction[side].length > 0, `${topic.id} is missing friction ${side}`);
    }
    assert.notEqual(topic.sides.a, topic.sides.b, `${topic.id} has identical sides`);
  }
});

test("world highlights point at real topics", async () => {
  const [topics, world] = await Promise.all([store.readTopics(), store.readWorld()]);
  const ids = new Set(topics.map((t) => t.id));

  assert.ok(world.highlights.length > 0);
  assert.match(world.version, /#/, "the world version should carry a content hash");
  for (const highlight of world.highlights) {
    assert.ok(ids.has(highlight.topicId), `world highlight names unknown topic ${highlight.topicId}`);
    assert.ok(highlight.text.length > 0);
  }
});

test("canned drafts fit the turn they stand in for, and never read as a memo", async () => {
  const [personas, topics, world] = await Promise.all([
    store.readPersonas(),
    store.readTopics(),
    store.readWorld(),
  ]);

  // Across a run of seqs, because the length target changes per turn: a canned line
  // that only fits one tier is a canned line that fails on three turns out of four.
  for (const persona of personas) {
    for (const topic of topics) {
      for (const side of SIDES) {
        for (let seq = 1; seq <= 12; seq += 1) {
          const event: AgendaEvent = {
            kind: "THREAD",
            reason: "test",
            sender: persona.id,
            topic,
            side,
            quoted: "so where does that leave the book?",
            authoredBy: "responder",
          };
          const text = cannedDraft({ persona, event, world, seq, attempt: 1 });
          const target = lengthTarget(persona, seq);
          const where = `${persona.id}/${topic.id}/${side}/seq ${seq}`;

          assert.ok(text.length > 0, `${persona.id} produced an empty draft`);
          assert.ok(
            text.length >= target.min && text.length <= target.max,
            `${where} missed its ${target.tier} target (${target.min}-${target.max}, got ${text.length}): "${text}"`,
          );
          assert.equal(
            typographyFault(text),
            "",
            `${where} used keyboard punctuation: "${text}"`,
          );
          assert.equal(text.includes("{"), false, `${persona.id} left a placeholder unfilled: "${text}"`);
        }
      }
    }
  }
});

test("every member of the room is a person, and the UI agrees with the Voice", async () => {
  const personas = await store.readPersonas();
  const config = await store.readConfig();

  for (const persona of personas) {
    assert.notEqual(persona.bot, true, `${persona.id} is marked as a bot and would be badged in the chat`);
    assert.doesNotMatch(
      `${persona.name} ${persona.role}`,
      /\b(AI|AxAI|engine|bot|assistant|model)\b/i,
      `${persona.id} advertises itself as a machine: "${persona.name} · ${persona.role}"`,
    );
  }

  // The engine is still a mechanism, but it speaks as a member of the roster now, so
  // there is nothing in the transcript to label.
  const engine = personas.find((p) => p.id === config.agenda.enginePersona);
  assert.ok(engine, `engine persona ${config.agenda.enginePersona} is not on the roster`);
  assert.ok(!engine!.bot);

  // The chat UI renders names and roles from its own module, so a roster edited in
  // one place and not the other shows the wrong person on screen.
  const { PERSONAS } = await import("../community-chat");
  assert.deepEqual(
    PERSONAS.map((p) => `${p.id}|${p.name}|${p.role}|${p.online}`),
    personas.map((p) => `${p.id}|${p.name}|${p.role}|${p.online}`),
    "lib/community-chat.ts and data/forum/personas.json disagree about the roster",
  );
});
