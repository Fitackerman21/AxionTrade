/**
 * The Voice seam (P1). Hermetic: every test injects its own `ChatProvider`, so no
 * test ever hits the network and every fallback path is reachable.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { cannedDraft } from "./drafts";
import type { ChatProvider, ChatRequest, ChatResponse } from "./provider";
import { makeTurn, TEST_PERSONAS, TEST_TOPICS, TEST_WORLD } from "./test-utils";
import type { AgendaEvent, Persona } from "./types";
import { flawFor, voiceDraft } from "./voice";

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
  assert.match(system, /warm, emoji-heavy/);
  assert.ok(system.includes(MARA.sheet.sampleLines[0]!), "sample lines anchor the voice");

  const user = request.messages[0]?.content ?? "";
  assert.match(user, /<what the room is on>/);
  assert.ok(user.includes(TEST_WORLD.digest), "the world digest must reach the prompt");
  assert.match(user, /<message from jev>/);
  assert.match(user, /40-240 characters/, "the hard register band must be stated");

  // Same shared defaults the Gate's judge uses: one cheap, untruncated call.
  assert.equal(request.reasoning, "off");
  assert.ok((request.temperature ?? 0) >= 0.6 && (request.temperature ?? 2) <= 1.1);
  assert.equal(request.maxTokens, 260);
  assert.equal(request.timeoutMs, 15_000);
});

test("the recent transcript is threaded into the prompt so the line connects", async () => {
  const { provider, seen } = fake(() => answer("ok"));
  await voiceDraft({
    persona: voiced(),
    event: eventOf(),
    world: TEST_WORLD,
    seq: 20,
    recent: [
      makeTurn(18, { sender: "jev", text: "book net long, conviction 68%" }),
      makeTurn(19, { sender: "sol", text: "meanwhile btc is doing btc things" }),
    ],
    provider,
  });

  const user = seen[0]?.messages[0]?.content ?? "";
  assert.match(user, /<chat so far, most recent last>/);
  assert.ok(user.includes("meanwhile btc is doing btc things"), "recent lines must reach the prompt");
  assert.ok(user.includes("- sol:"), "recent lines are attributed to their sender");
});

test("the delivery hint varies between turns so the voice is not metronomic", async () => {
  const lines = new Set<string>();
  for (let seq = 1; seq <= 12; seq += 1) {
    const { provider, seen } = fake(() => answer("ok"));
    await voiceDraft({ persona: voiced(), event: eventOf(), world: TEST_WORLD, seq, provider });
    lines.add(seen[0]!.messages[0]!.content!);
  }
  assert.ok(lines.size > 5, "the same prompt was reused across turns");
});

test("a failing primary model fails over to the persona's fallbackModel", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    calls.push(body.model);
    if (body.model === "primary/model") {
      return new Response(JSON.stringify({ error: { message: "upstream down" } }), { status: 500 });
    }
    return new Response(
      JSON.stringify({
        model: body.model,
        choices: [{ message: { content: "backup line, still me" } }],
        usage: { prompt_tokens: 3, completion_tokens: 4, cost: 0.0001 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const persona: Persona = {
      ...MARA,
      model: "primary/model",
      fallbackModel: "backup/model",
    };
    const result = await voiceDraft({
      persona,
      event: eventOf(),
      world: TEST_WORLD,
      seq: 2,
      keys: ["test-key"],
    });

    assert.equal(result.usedVoice, true);
    assert.equal(result.model, "backup/model");
    assert.equal(result.text, "backup line, still me");
    assert.deepEqual(calls, ["primary/model", "backup/model"]);
  } finally {
    globalThis.fetch = original;
  }
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

test("the prompt licenses the flaws of human communication", async () => {
  const { provider, seen } = fake(() => answer("ok"));
  await voiceDraft({ persona: voiced(), event: eventOf(), world: TEST_WORLD, seq: 3, provider });

  const system = seen[0]!.system ?? "";
  assert.match(system, /go on tangents/, "the room must be allowed to leave the topic");
  assert.match(system, /Slang is American and current/, "the slang has to be the room's");
  assert.match(
    system,
    /never use slang from another country, another language or a local dialect/,
    "a persona's home city must not leak its dialect into the room",
  );
  assert.match(system, /annoyed, dismissive, mean or bored/, "rudeness must be licensed");
  assert.match(system, /misspell a word/, "imperfection must be licensed");
  assert.match(
    seen[0]!.messages[0]!.content ?? "",
    /<how you send it>/,
    "each turn gets its own flaw directive",
  );
});

test("the flaw varies per turn, and only some flaws drift off the subject", async () => {
  const flaws = new Set<string>();
  let drifting = 0;
  const seqs = 24;

  for (let seq = 1; seq <= seqs; seq += 1) {
    const { provider, seen } = fake(() => answer("ok"));
    const result = await voiceDraft({
      persona: voiced(),
      event: eventOf(),
      world: TEST_WORLD,
      seq,
      provider,
    });
    const match = /<how you send it>([\s\S]*?)<\/how you send it>/.exec(
      seen[0]!.messages[0]!.content ?? "",
    );
    flaws.add(match?.[1] ?? "missing");
    if (result.drift) drifting += 1;
  }

  assert.ok(flaws.size > 5, `the same flaw was reused across turns: ${[...flaws].join(" | ")}`);
  assert.ok(flaws.has("missing") === false, "a turn went out without a flaw directive");
  assert.ok(drifting > 0, "nothing ever left the subject");
  assert.ok(drifting < seqs / 2, `drift should be occasional, got ${drifting}/${seqs}`);
});

test("an engine turn is never handed a drifting flaw", async () => {
  const seenFlaws = new Set<string>();
  for (let seq = 1; seq <= 24; seq += 1) {
    const { provider, seen } = fake(() => answer("ok"));
    await voiceDraft({
      persona: voiced(),
      event: eventOf({ authoredBy: "engine", sender: "jev", quoted: TEST_WORLD.digest }),
      world: TEST_WORLD,
      seq,
      provider,
    });
    const match = /<how you send it>([\s\S]*?)<\/how you send it>/.exec(
      seen[0]!.messages[0]!.content ?? "",
    );
    seenFlaws.add(match?.[1] ?? "missing");
    // The tape is not a message from someone else, so the framing changes too.
    assert.match(seen[0]!.messages[0]!.content ?? "", /<the tape, and your own read of it>/);
  }
  assert.deepEqual([...seenFlaws], ["Just answer in your own voice. Nothing special needed."]);
});

test("a persona's own slang reaches the prompt, and a persona without any gets no line", async () => {
  const slangy: Persona = {
    ...voiced(),
    sheet: { ...MARA.sheet, slang: ["no cap", "cooked"] },
  };


  const first = fake(() => answer("ok"));
  await voiceDraft({ persona: slangy, event: eventOf(), world: TEST_WORLD, seq: 4, provider: first.provider });
  assert.match(
    first.seen[0]!.system ?? "",
    /Slang you actually reach for \(at most one per message\): no cap; cooked/,
  );

  // The engine carries no slang list, so it is never handed the slang flaw either.
  const second = fake(() => answer("ok"));
  await voiceDraft({
    persona: voiced(),
    event: eventOf(),
    world: TEST_WORLD,
    seq: 4,
    provider: second.provider,
  });
  assert.doesNotMatch(second.seen[0]!.system ?? "", /Slang you actually reach for/);

  // With a vocabulary some of the first forty turns roll the slang flaw; without
  // one, that roll becomes the neutral flaw rather than inventing a voice.
  const rolled = Array.from({ length: 40 }, (_, i) => i + 1).filter((seq) =>
    flawFor(slangy, seq).text.includes("American slang"),
  );
  assert.ok(rolled.length > 0, "the slang flaw must be reachable for a persona that has slang");
  for (let seq = 1; seq <= 40; seq += 1) {
    assert.doesNotMatch(
      flawFor(MARA, seq).text,
      /American slang/,
      `turn ${seq} handed slang to a persona with no vocabulary for it`,
    );
  }
});

test("a canned draft never claims the drift licence", async () => {
  const drifting = [1, 2, 3, 4, 5, 6, 7, 8].find((seq) => flawFor(MARA, seq).drift);
  const result = await voiceDraft({
    persona: MARA,
    event: eventOf(),
    world: TEST_WORLD,
    seq: drifting ?? 3,
  });

  assert.equal(result.usedVoice, false);
  assert.equal(result.drift, false, "a template line answers what it was given");
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
