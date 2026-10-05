/**
 * The Voice seam (P1). Hermetic: every test injects its own `ChatProvider`, so no
 * test ever hits the network and every fallback path is reachable.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { cannedDraft } from "./drafts";
import type { ChatProvider, ChatRequest, ChatResponse } from "./provider";
import { TEST_PERSONAS, TEST_TOPICS, TEST_WORLD } from "./test-utils";
import type { AgendaEvent, Persona } from "./types";
import { voiceDraft } from "./voice";

const MARA = TEST_PERSONAS.find((p) => p.id === "mara")!;

/** Mara with the Voice switched on. */
function voiced(model = "test/model"): Persona {
  return { ...MARA, model };
}

function eventOf(overrides: Partial<AgendaEvent> = {}): AgendaEvent {
  return {
    kind: "THREAD",
    reason: "test",
    sender: "jev",
    topic: TEST_TOPICS[0],
    side: "a",
    quoted: "gold is coiling into the dollar's next move",
    authoredBy: "responder",
    ...overrides,
  };
}

/** A provider that records every request and answers with a fixed body. */
function fake(chat: () => ChatResponse | Promise<ChatResponse>): {
  provider: ChatProvider;
  seen: ChatRequest[];
} {
  const seen: ChatRequest[] = [];
  return {
    seen,
    provider: {
      id: "fake",
      model: "test/model",
      family: "test",
      chat: async (request) => {
        seen.push(request);
        return chat();
      },
    },
  };
}

const answer = (text: string): ChatResponse => ({
  text,
  model: "test/model",
  usage: { tokensIn: 10, tokensOut: 5, cost: 0.0003 },
});

test("a persona without a model uses the canned draft, inside its own register", async () => {
  const event = eventOf();
  const result = await voiceDraft({ persona: MARA, event, world: TEST_WORLD, seq: 3 });

  assert.equal(result.usedVoice, false);
  assert.equal(result.fallback, true);
  assert.equal(result.model, null);
  assert.equal(result.usage, null);
  assert.match(result.reason ?? "", /no model on mara/);
  // The fallback must draft with the real persona — the old placeholder persona
  // had no `sheet` and clamped against a band that did not exist.
  assert.equal(
    result.text,
    cannedDraft({ persona: MARA, event, world: TEST_WORLD, seq: 3, attempt: 1 }),
  );
  assert.ok(result.text.length >= MARA.sheet.register.minChars);
});

test("a configured persona speaks through the injected provider, trimmed", async () => {
  const { provider, seen } = fake(() => answer("  gold is coiling, patience trade 🥱  "));
  const result = await voiceDraft({
    persona: voiced(),
    event: eventOf(),
    world: TEST_WORLD,
    seq: 9,
    provider,
  });

  assert.equal(result.text, "gold is coiling, patience trade 🥱");
  assert.equal(result.usedVoice, true);
  assert.equal(result.fallback, false);
  assert.equal(result.reason, null);
  assert.equal(result.model, "test/model");
  assert.deepEqual(result.usage, { tokensIn: 10, tokensOut: 5, cost: 0.0003 });
  assert.equal(seen.length, 1);
});

test("the prompt carries the character sheet, the world digest and the quoted line", async () => {
  const { provider, seen } = fake(() => answer("ok"));
  await voiceDraft({
    persona: voiced(),
    event: eventOf(),
    world: TEST_WORLD,
    seq: 1,
    provider,
  });

  const request = seen[0]!;
  const system = request.system ?? "";
  assert.match(system, /Mara Okafor/);
  assert.match(system, /allergic to being outperformed by code/);
  assert.match(system, /register: 40-240 chars/);
  assert.ok(system.includes(MARA.sheet.sampleLines[0]!), "sample lines anchor the voice");

  const user = request.messages[0]?.content ?? "";
  assert.match(user, /<topic>/);
  assert.ok(user.includes(TEST_WORLD.digest), "the world digest must reach the prompt");
  assert.match(user, /<quoted from jev>/);

  // Same shared defaults the Gate's judge uses: one cheap, untruncated call.
  assert.equal(request.reasoning, "off");
  assert.equal(request.temperature, 0.7);
  assert.equal(request.maxTokens, 220);
  assert.equal(request.timeoutMs, 20_000);
});

test("an opening turn has no quoted message", async () => {
  const { provider, seen } = fake(() => answer("ok"));
  await voiceDraft({
    persona: voiced(),
    event: eventOf({ quoted: undefined }),
    world: TEST_WORLD,
    seq: 1,
    provider,
  });
  assert.match(seen[0]?.messages[0]?.content ?? "", /<opening the room>/);
});

test("a failed call falls back and records the reason", async () => {
  const { provider } = fake(() => {
    throw new Error("429 rate limited");
  });
  const event = eventOf();
  const result = await voiceDraft({ persona: voiced(), event, world: TEST_WORLD, seq: 5, provider });

  assert.equal(result.usedVoice, false);
  assert.equal(result.fallback, true);
  assert.equal(result.model, null);
  assert.match(result.reason ?? "", /voice call failed for mara: 429 rate limited/);
  assert.equal(
    result.text,
    cannedDraft({ persona: voiced(), event, world: TEST_WORLD, seq: 5, attempt: 1 }),
  );
});

test("an empty completion falls back rather than posting whitespace", async () => {
  const { provider } = fake(() => answer("   "));
  const result = await voiceDraft({
    persona: voiced(),
    event: eventOf(),
    world: TEST_WORLD,
    seq: 7,
    provider,
  });

  assert.equal(result.usedVoice, false);
  assert.match(result.reason ?? "", /empty completion from test\/model/);
  assert.ok(result.text.trim().length > 0, "the fallback must not be blank");
});

test("a model with no key falls back instead of calling the network", async () => {
  const result = await voiceDraft({
    persona: voiced(),
    event: eventOf(),
    world: TEST_WORLD,
    seq: 1,
    keys: [],
  });

  assert.equal(result.usedVoice, false);
  assert.match(result.reason ?? "", /no voice provider for mara/);
});

test("the retry number reaches the canned fallback", async () => {
  const event = eventOf();
  const result = await voiceDraft({
    persona: voiced(),
    event,
    world: TEST_WORLD,
    seq: 4,
    attempt: 2,
  });
  assert.equal(
    result.text,
    cannedDraft({ persona: voiced(), event, world: TEST_WORLD, seq: 4, attempt: 2 }),
  );
});
