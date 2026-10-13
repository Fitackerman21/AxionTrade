/**
 * The Voice seam (P1). Hermetic: every test injects its own `ChatProvider`, so no
 * test ever hits the network and every fallback path is reachable.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { cannedDraft, PRODUCT_LINES, productDraft } from "./drafts";
import type { ChatProvider, ChatRequest, ChatResponse } from "./provider";
import { makeTurn, TEST_PERSONAS, TEST_TOPICS, TEST_WORLD } from "./test-utils";
import type { AgendaEvent, Persona } from "./types";
import { BEAT_BREAK, flawFor, isBurstTurn, PRODUCT_FLAW, splitBeats, voiceDraft } from "./voice";

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
  // The length is the turn's own target, not one fixed band, so the prompt has to
  // state a range and the tier's name rather than a constant pair of numbers.
  assert.match(user, /Roughly \d+ to \d+ characters/, "the turn's length target must be stated");
  assert.match(user, /one short beat|one quick message|one ordinary message|a longer message/);

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

test("a person is never named by the room's raw external id", async () => {
  const { provider, seen } = fake(() => answer("hey, welcome in"));
  await voiceDraft({
    persona: voiced(),
    event: eventOf({
      sender: "human",
      quoted: "hello guys, i'm new here",
      greeting: true,
      replyMode: "answer",
    }),
    world: TEST_WORLD,
    seq: 2,
    recent: [makeTurn(1, { sender: "human", text: "hey everyone" })],
    provider,
  });

  const user = seen[0]?.messages[0]?.content ?? "";
  // The live page answered a greeting with "hey human, welcome" because the prompt handed
  // the model the external id as if it were the sender's name. Neither the quoted message
  // nor the transcript may carry it now.
  assert.equal(/\bhuman\b/.test(user), false, `the external id leaked into the prompt: ${user}`);
  assert.match(user, /<message from someone>/);
  assert.match(user, /- someone:/);
  // And the greeting is told not to invent a name for them.
  assert.match(user, /do not invent one/);
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

test("the Voice spends the whole key pool, not just the first two", async () => {
  const original = globalThis.fetch;
  const used: string[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    used.push(String(headers.Authorization ?? "").replace(/^Bearer /, ""));
    const body = JSON.parse(String(init?.body)) as { model: string };
    return new Response(
      JSON.stringify({
        model: body.model,
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const pool = ["key-0", "key-1", "key-2", "key-3"];
    for (let seq = 1; seq <= 24; seq += 1) {
      await voiceDraft({ persona: voiced(), event: eventOf(), world: TEST_WORLD, seq, keys: pool });
    }

    assert.equal(used.length, 24, "one call per turn while the primary answers");
    assert.deepEqual(
      [...new Set(used)].sort(),
      [...pool].sort(),
      "every account in the pool has to carry some of the room's turns",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("a replay spends the same keys, and the fallback never shares the primary's", async () => {
  const original = globalThis.fetch;
  let calls: string[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const key = String(headers.Authorization ?? "").replace(/^Bearer /, "");
    const body = JSON.parse(String(init?.body)) as { model: string };
    calls.push(`${body.model}@${key}`);
    if (body.model === "primary/model") {
      return new Response(JSON.stringify({ error: { message: "upstream down" } }), { status: 500 });
    }
    return new Response(
      JSON.stringify({
        model: body.model,
        choices: [{ message: { content: "backup line" } }],
        usage: { prompt_tokens: 3, completion_tokens: 3, cost: 0 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const pool = ["key-0", "key-1", "key-2"];
    const persona: Persona = { ...MARA, model: "primary/model", fallbackModel: "backup/model" };
    const run = async () => {
      calls = [];
      const result = await voiceDraft({
        persona,
        event: eventOf(),
        world: TEST_WORLD,
        seq: 9,
        keys: pool,
      });
      return { keys: calls.map((call) => call.slice(call.indexOf("@") + 1)), result };
    };

    const first = await run();
    const second = await run();

    assert.equal(first.result.model, "backup/model");
    assert.equal(first.keys.length, 2, "the failing primary is followed by the fallback");
    assert.notEqual(
      first.keys[0],
      first.keys[1],
      "an exhausted account must not take both halves of the failover",
    );
    assert.deepEqual(second.keys, first.keys, "a replay spends the keys it spent the first time");
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

test("a question that is not about the thread is answered on its own terms", async () => {
  const { provider, seen } = fake(() => answer("yeah it's under settings, took mine two days"));
  await voiceDraft({
    persona: voiced(),
    event: eventOf({
      kind: "HUMAN",
      sender: "human",
      quoted: "Hey does anyone here know how to make withdrawals on the platform?",
      offTopic: true,
    }),
    world: TEST_WORLD,
    seq: 6,
    provider,
  });

  const user = seen[0]!.messages[0]!.content ?? "";
  assert.match(user, /not about that thread/);
  assert.match(user, /Do not steer it back to the market/);
  assert.match(user, /Do not invent a feature, a menu, a fee or a number/);
  assert.ok(user.includes("make withdrawals"), "the question itself must reach the model");
  // The market stance is what produced "the withdrawal thing is dead, gold's still
  // coiling" on the live room, so it is withheld on this shape of turn.
  assert.doesNotMatch(user, /<your side>/);
});

test("a question about the platform is answered from the room's facts, never a refusal or a claim", async () => {
  // The measured failure this test now stands against: six messages from a newcomer, six
  // replies, and none of them answered the question that was asked. The material is the
  // reviewed fact sheet for the **question's own shape** (`knowledge.ts`) plus the
  // member's own nitpicks, and the three things it may never do are invent a fact about
  // performance, promise anyone an outcome, and refuse to engage.
  const withResults: Persona = {
    ...voiced(),
    sheet: {
      ...MARA.sheet,
      results: ["the position-size alerts killed her worst habit"],
      nitpicks: ["the interface is busier than she needs"],
    },
  };
  const { provider, seen } = fake(() => answer("ok"));
  await voiceDraft({
    persona: withResults,
    event: eventOf({
      kind: "HUMAN",
      sender: "human",
      quoted: "Is axion ai trading real ?, hope I am not going to lose my money in this?",
      offTopic: true,
      productQuestion: true,
      productIntent: "trust",
    }),
    world: TEST_WORLD,
    seq: 6,
    provider,
  });

  const user = seen[0]!.messages[0]!.content ?? "";
  assert.match(user, /asking about the platform itself/);
  // The turn names the question it is answering, so the model answers *that* one.
  assert.match(user, /What they are asking is: whether it is real and whether the money is safe/);
  // The facts, and only the facts: the funded balance, the released portion, the loss
  // limit and the profit goal. A persona holding no product fact can only praise, deflect
  // or invent, and all three read as a bot on a page about the product.
  assert.match(user, /<the only facts you know about the platform>/);
  assert.match(user, /the part of it that trades/);
  assert.match(user, /inside the loss limit and the profit goal you set/);
  assert.match(user, /the way you would to somebody sitting next to you/);
  // The member's own nitpicks are still offered, and still bounded.
  assert.match(user, /the interface is busier than she needs/, "their own nitpicks are offered");
  // ...bounded by the bans that survive: no invented performance fact, no promise, no advice.
  assert.match(user, /Do not invent anything about performance or money/);
  assert.match(user, /never promise an outcome/);
  assert.match(user, /never tell them whether to put their money in it or to stay away from it/);
  // ...and for a question the facts do not cover, the honest gap rather than a shrug.
  assert.match(user, /If what they asked is not covered by those facts, say plainly/);
  assert.ok(user.includes("Is axion ai trading real"), "the question itself must reach the model");
  // The market stance is withheld here exactly as it is on an off-topic turn.
  assert.doesNotMatch(user, /<your side>/);

  // The flaw is fixed and there is no dice roll on this turn shape: every other roll
  // competes with the ask (a beat asks for two words, a drift flaw invites leaving the
  // subject), and the weakest model in the roster answered a trust question with
  // "yeah nah, 2400 mid" on the live page with the restriction sitting in the prompt
  // above it (§9.2).
  for (let seq = 1; seq <= 120; seq += 1) {
    assert.equal(flawFor(withResults, seq, false, true), PRODUCT_FLAW);
    assert.match(flawFor(withResults, seq, false, true).text, /Answer the question they actually asked/);
    assert.equal(isBurstTurn(withResults, seq, false, true), false);
  }
  assert.ok(
    Array.from({ length: 120 }, (_, i) => i + 1).some((seq) =>
      flawFor(withResults, seq).text.includes("this platform"),
    ),
    "the licence still exists for every other kind of turn",
  );

  // A fixed delivery note, because half of DELIVERY_HINTS licenses exactly the
  // drift and half-reading that produced the market answer.
  assert.match(user, /This one is about the platform, so the market does not come into it/);
  for (let seq = 1; seq <= 200; seq += 1) {
    assert.doesNotMatch(
      flawFor(withResults, seq, false, true).text + user,
      /only half-read it|fine to drift somewhere off-topic/,
      `turn ${seq} kept the licence to be distracted`,
    );
  }
});

test("a product question with no model answers in the room's own safe words", async () => {
  // The Voice failing is the other way the old room answered a trust question with
  // a view on gold; the fallback for this shape of turn is the product bank.
  const result = await voiceDraft({
    persona: MARA,
    event: eventOf({
      kind: "HUMAN",
      sender: "human",
      quoted: "Is this real?",
      offTopic: true,
      productQuestion: true,
    }),
    world: TEST_WORLD,
    seq: 6,
  });

  assert.equal(result.fallback, true);
  assert.equal(result.text, productDraft({ persona: MARA, seq: 6, attempt: 1 }));
  assert.ok(
    [...PRODUCT_LINES.beat, ...PRODUCT_LINES.short, ...PRODUCT_LINES.thought].includes(result.text),
    "the fallback must be one of the reviewed product lines",
  );
});

test("an ordinary thread turn still carries the topic and its side", async () => {
  const { provider, seen } = fake(() => answer("ok"));
  await voiceDraft({ persona: voiced(), event: eventOf(), world: TEST_WORLD, seq: 7, provider });

  const user = seen[0]!.messages[0]!.content ?? "";
  assert.match(user, /<what the room is on>/);
  assert.match(user, /<your side>/);
  assert.doesNotMatch(user, /Do not steer it back to the market/);
});

test("the prompt bans the machine aphorism and licenses occasional platform talk", async () => {
  const withResults: Persona = {
    ...voiced(),
    sheet: { ...MARA.sheet, results: ["the position-size alerts killed her worst habit"] },
  };
  const { provider, seen } = fake(() => answer("ok"));
  await voiceDraft({ persona: withResults, event: eventOf(), world: TEST_WORLD, seq: 6, provider });

  const system = seen[0]!.system ?? "";
  assert.match(system, /Never write in slogans or aphorisms/);
  assert.match(system, /it is not narrative, it is levels|It is not narrative, it is levels/i);
  assert.match(system, /You use this platform every day and you are glad you do/);
  assert.match(system, /the position-size alerts killed her worst habit/);
  // The testimonial licence, and the refusal ban that has to sit beside it: a model with
  // the enthusiasm forbidden and the question still open reaches for "not my call".
  assert.match(system, /If they ask whether it is good, you say yes and you say why/);
  assert.match(system, /You never answer a question about the platform by deflecting, refusing/);
});

test("memory and a rejection reason both reach the prompt when they exist", async () => {
  const { provider, seen } = fake(() => answer("ok"));
  await voiceDraft({
    persona: voiced(),
    event: eventOf(),
    world: TEST_WORLD,
    seq: 8,
    memory: "You told them you were long gold and would not move the stop.",
    critique: "LENGTH: 2 chars, under mara's 40-char floor",
    provider,
  });

  const user = seen[0]!.messages[0]!.content ?? "";
  assert.match(user, /<what you remember about jev>/);
  assert.match(user, /would not move the stop/);
  assert.match(user, /<your last attempt was rejected for this reason>LENGTH/);
  assert.match(user, /Do not rephrase the rejected one/);
});

test("with no memory and no critique the prompt stays clean", async () => {
  const { provider, seen } = fake(() => answer("ok"));
  await voiceDraft({ persona: voiced(), event: eventOf(), world: TEST_WORLD, seq: 8, provider });
  const user = seen[0]!.messages[0]!.content ?? "";
  assert.doesNotMatch(user, /<what you remember about/);
  assert.doesNotMatch(user, /rejected for this reason/);
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

test("the system prompt asks for thumb typography, not keyboard punctuation", async () => {
  const { provider, seen } = fake(() => answer("ok"));
  await voiceDraft({ persona: voiced(), event: eventOf(), world: TEST_WORLD, seq: 1, provider });

  const system = seen[0]!.system ?? "";
  assert.match(system, /no em dashes or en dashes/);
  assert.match(system, /no semicolons/);
  assert.match(system, /do not bother with capital letters/);
  // The old prompt handed the model its own sample lines and then told it to write
  // plain sentences; that contradiction is gone.
  assert.doesNotMatch(system, /half-finished is fine; polished/);
});

test("a burst turn is told how to send two messages, and the marker splits", async () => {
  const seq = Array.from({ length: 200 }, (_, i) => i + 1).find((n) => isBurstTurn(MARA, n));
  assert.ok(seq, "the flaw list must contain a double-text flaw");
  assert.match(flawFor(MARA, seq!).text, /two messages/);

  const { provider, seen } = fake(() => answer(`first beat ${BEAT_BREAK} second beat`));
  const result = await voiceDraft({
    persona: voiced(),
    event: eventOf(),
    world: TEST_WORLD,
    seq: seq!,
    provider,
  });

  const user = seen[0]!.messages[0]?.content ?? "";
  assert.ok(user.includes(BEAT_BREAK), "the split marker has to be shown, not described");
  assert.match(user, /two messages/);
  assert.deepEqual(splitBeats(result.text), ["first beat", "second beat"]);
  // An ordinary turn never sees the marker, so only the licensed turns can burst.
  assert.equal(isBurstTurn(MARA, nextNonBurst(seq!)), false);
});

/** A later turn that is not a burst, as a control for the assertion above. */
function nextNonBurst(seq: number): number {
  for (let n = seq + 1; n < seq + 40; n += 1) if (!isBurstTurn(MARA, n)) return n;
  return seq;
}

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
