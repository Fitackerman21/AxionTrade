/**
 * The room's product knowledge, and the answer it gives when no model is available.
 *
 * The measurement this file exists for: on the live room, six messages from a newcomer got
 * six replies in 40-70 seconds, and by the room's own `contentTokens` **none of the six
 * shared a content word with the question**. Three of the six were the same testimonial in
 * three different names, because every product question was served from one shared praise
 * bank. Since the free model pool is spent for most of the day, that bank *is* the room for a
 * large part of the time — which makes the fallback the highest-value thing to get right.
 *
 * So the tests here are the claims the fix makes:
 *  1. a question routes to the right shape of answer,
 *  2. the answer is one the Gate would publish,
 *  3. it fits the turn it is standing in for,
 *  4. it shares words with the question it answers,
 *  5. and the room greets people, asks things back, and now and then says nothing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { humanReplyMode, nextEvent } from "./agenda";
import { cannedDraft } from "./drafts";
import { contentTokens, resolveGateConfig, runGate } from "./gate";
import {
  CHECK_IN_LINES,
  GREETINGS,
  KNOWLEDGE,
  PRODUCT_INTENTS,
  greetingFor,
  isCheckIn,
  isGreeting,
  productIntentOf,
  type ProductIntent,
} from "./knowledge";
import { lengthTarget, tierOptionsFor, typographyFault } from "./register";
import { advance } from "./advance";
import type { ChatProvider } from "./provider";
import {
  createFixture,
  dataStore,
  makeTurn,
  seqForTier,
  TEST_BASE,
  TEST_CONFIG,
  TEST_PERSONAS,
  TEST_TOPICS,
  TEST_WORLD,
} from "./test-utils";
import type { AgendaEvent, Persona } from "./types";

const store = dataStore();

async function roster(): Promise<Persona[]> {
  return store.readPersonas();
}

/**
 * The six messages the live room was actually sent, in order, with the question shape each
 * one is.
 *
 * Captured by driving the deployed page as a newcomer (`chat-probe.cjs`). Every one of them
 * was answered with something that shared nothing with it, and the third got a testimonial
 * about position sizing as its answer to how to fund an account.
 */
const MEASURED_MESSAGES: ReadonlyArray<{
  text: string;
  intent: ProductIntent | null;
  greeting?: boolean;
  market?: boolean;
}> = [
  { text: "yo, just joined. what is this place 😅", intent: "room", greeting: true },
  { text: "wait so is this a real trading room or is it the app's own chat?", intent: "room" },
  { text: "how do i put money in btw? cant find the deposit thing", intent: "deposit" },
  { text: "lol im new to all this, started trading like last week. am i gonna lose everything", intent: "trust" },
  { text: "gold looks like its stuck. feels like it just sits there all day", intent: null, market: true },
  { text: "everyone in here seems to know each other lol. who talks the most?", intent: null },
];

test("every measured question routes to the question shape it actually is", () => {
  for (const { text, intent } of MEASURED_MESSAGES) {
    if (intent === null) continue;
    assert.equal(
      productIntentOf(text),
      intent,
      `"${text}" routed to ${productIntentOf(text)} rather than ${intent}`,
    );
  }
  // A couple the classifier must not confuse: the money-out question is not money-in, and
  // "is this real" is about the money while "is this a real trading room" is about the room.
  assert.equal(productIntentOf("how do i make a withdrawal"), "withdraw");
  assert.equal(productIntentOf("Is this real?"), "trust");
  assert.equal(productIntentOf("Is axion ai trading real ?, hope I am not going to lose my money in this?"), "trust");
  assert.equal(productIntentOf("how does the trading work"), "how-it-works");
  // The live room answered this one with "support in the app is who i would ask": the shape
  // only matched with the pronoun hard against "make money", so the intervening words sent it
  // to `other` and a how-it-works question got the generic account line.
  assert.equal(productIntentOf("so how do you all actually make money on this thing"), "how-it-works");
  assert.equal(productIntentOf("how do they make money"), "how-it-works");
  assert.equal(productIntentOf("does the ai trade for me or do i place them"), "autonomy");
  assert.equal(productIntentOf("can i set a loss limit"), "limits");
  assert.equal(productIntentOf("what does it cost"), "cost");
  // A social question is not a platform question.
  assert.equal(productIntentOf("who talks the most?"), "other");
});

test("isGreeting takes a hello and leaves a market question alone", () => {
  assert.equal(isGreeting("yo, just joined. what is this place 😅"), true);
  assert.equal(isGreeting("hey"), true);
  assert.equal(isGreeting("good morning"), true);
  // A desk greeting with a question attached is a market question, and the greeting does
  // not take the turn over.
  assert.equal(isGreeting("morning, what's the read on gold?"), false);
  assert.equal(isGreeting("gold looks like its stuck"), false);
  assert.equal(isGreeting("how do i put money in"), false);

  // The exact greetings from the live chats, each of which the room answered with a market
  // verdict ("not a level", "you have the causality backwards", "that's a nothing level").
  for (const hello of ["Hi", "Hello", "Hello guys", "hiya", "morning all"]) {
    assert.equal(isGreeting(hello), true, `"${hello}" was not read as a greeting`);
  }
  for (const checkIn of [
    "how is everyone doing?",
    "I'm just greeting, how is everyone doing?",
    "what's up everyone",
    "how's it going in here",
    "how are things",
  ]) {
    assert.equal(isCheckIn(checkIn), true, `"${checkIn}" was not read as a check-in`);
    assert.equal(isGreeting(checkIn), true, `"${checkIn}" was not read as a greeting`);
  }
  // A market question is never a check-in, however it opens.
  assert.equal(isCheckIn("morning, what's the read on gold?"), false);
});

test("a check-in gets a line about the room, not a welcome", async () => {
  const personas = await roster();
  const world = await store.readWorld();
  const event: AgendaEvent = {
    kind: "HUMAN",
    reason: "test",
    sender: "human",
    topic: TEST_TOPICS[0],
    side: "a",
    quoted: "how is everyone doing?",
    authoredBy: "responder",
    offTopic: true,
    greeting: true,
    replyMode: "answer",
  };
  // Every answer is built from the check-in bank: a single line, or two joined to reach a
  // longer turn. None of them is a welcome, which is the failure this shape was routed away
  // from.
  const welcomes = new Set(personas.flatMap((persona) => greetingFor(persona.id)));
  let total = 0;
  for (const persona of personas) {
    for (let seq = 1; seq <= 40; seq += 1) {
      const text = cannedDraft({ persona, event, world, seq, attempt: 1 });
      total += 1;
      assert.ok(
        CHECK_IN_LINES.some((line) => text.includes(line)),
        `${persona.id} answered a check-in from outside the bank: "${text}"`,
      );
      assert.equal(welcomes.has(text), false, `${persona.id} welcomed a check-in: "${text}"`);
    }
  }
  assert.ok(total > 200, `the sample was too small to mean anything (${total})`);
});

/**
 * The core claim: a fallback line answers the question it was given.
 *
 * Measured the way the room's own analyser measures it (`contentTokens`, the same definition
 * of "a shared word" the Gate's ADDRESSEE check uses), so "it answers" is not a matter of
 * opinion. Only the product questions are held to it — a social question is answered
 * socially and a market question is answered from the market bank.
 */
test("no measured question is answered with something that shares nothing with it", async () => {
  const personas = await roster();
  const world = await store.readWorld();

  for (const entry of MEASURED_MESSAGES) {
    if (entry.intent === null) continue;
    const event: AgendaEvent = {
      kind: "HUMAN",
      reason: "test",
      sender: "human",
      topic: TEST_TOPICS[0],
      side: "a",
      quoted: entry.text,
      authoredBy: "responder",
      offTopic: true,
      productQuestion: true,
      productIntent: entry.intent,
      ...(entry.greeting ? { greeting: true } : {}),
      replyMode: "answer",
    };

    const theirs = contentTokens(entry.text);
    let answered = 0;
    let total = 0;
    for (const persona of personas) {
      for (let seq = 1; seq <= 60; seq += 1) {
        const text = cannedDraft({ persona, event, world, seq, attempt: 1 });
        total += 1;
        const mine = contentTokens(text);
        if ([...mine].some((token) => theirs.has(token))) answered += 1;
      }
    }
    assert.ok(total > 100, "the sample was too small to mean anything");
    assert.ok(
      answered / total > 0.75,
      `only ${answered}/${total} answers to "${entry.text}" shared a content word with it`,
    );
  }
});

test("every member has their own answer to every question the room can be asked", async () => {
  const personas = await roster();
  // The variety is not decoration: a question answered in one shared voice is the tell the
  // live page shipped, where eleven names delivered the same testimonial to a newcomer. So
  // the coverage is a rule rather than a nice-to-have — every shape of question has a line
  // from every member, in their own words.
  for (const intent of PRODUCT_INTENTS) {
    const own = KNOWLEDGE[intent].personal;
    assert.ok(own, `${intent} has no lines in the members' own words`);
    const missing = personas.filter((persona) => (own?.[persona.id]?.length ?? 0) === 0).map((p) => p.id);
    assert.equal(
      missing.length,
      0,
      `${intent} is answered in one voice for: ${missing.join(", ")}`,
    );
  }
});

test("the same question is answered a different way, whoever is asked and whenever", async () => {
  const personas = await roster();
  const world = await store.readWorld();

  for (const intent of PRODUCT_INTENTS) {
    const event: AgendaEvent = {
      kind: "HUMAN",
      reason: "test",
      sender: "human",
      topic: TEST_TOPICS[0],
      side: "a",
      quoted: KNOWLEDGE[intent].label,
      authoredBy: "responder",
      offTopic: true,
      productQuestion: true,
      productIntent: intent,
      replyMode: "answer",
    };
    const answers = new Set<string>();
    for (const persona of personas) {
      for (let seq = 1; seq <= 12; seq += 1) {
        answers.add(cannedDraft({ persona, event, world, seq, attempt: 1 }));
      }
    }
    assert.ok(
      answers.size >= 8,
      `${intent} produced only ${answers.size} different answers: ${[...answers].slice(0, 6).join(" | ")}`,
    );
  }
});

test("the product fallback is different people answering, not one bank", async () => {
  const personas = await roster();
  const world = await store.readWorld();
  const event: AgendaEvent = {
    kind: "HUMAN",
    reason: "test",
    sender: "human",
    topic: TEST_TOPICS[0],
    side: "a",
    quoted: "how does the depositing work on here",
    authoredBy: "responder",
    offTopic: true,
    productQuestion: true,
    productIntent: "deposit",
    replyMode: "answer",
  };

  // Each member's answer to the same question, at one turn. A shared bank would give one
  // voice; the whole point of `KNOWLEDGE[..].personal` is that it does not.
  const answers = new Set<string>();
  for (const persona of personas) {
    answers.add(cannedDraft({ persona, event, world, seq: 3, attempt: 1 }));
  }
  assert.ok(
    answers.size >= 8,
    `only ${answers.size} distinct answers from ${personas.length} members: ${[...answers].join(" | ")}`,
  );
});

test("every product answer would survive the Gate", async () => {
  const personas = await roster();
  const world = await store.readWorld();
  const config = resolveGateConfig(await store.readConfig().then((c) => c.gate));

  for (const intent of PRODUCT_INTENTS) {
    for (const persona of personas) {
      for (let seq = 1; seq <= 40; seq += 1) {
        const event: AgendaEvent = {
          kind: "HUMAN",
          reason: "test",
          sender: "human",
          topic: TEST_TOPICS[0],
          side: "a",
          quoted: KNOWLEDGE[intent].label,
          authoredBy: "responder",
          offTopic: true,
          productQuestion: true,
          productIntent: intent,
          replyMode: "answer",
        };
        const text = cannedDraft({ persona, event, world, seq, attempt: 1 });
        // The Gate is what decides whether a line is publishable, so the bank is held to the
        // Gate's own rule rather than to a reviewer's taste. `requireAddressee` is waived
        // exactly as `advance()` waives it on this shape of turn.
        const verdict = await runGate({
          context: { persona, text, event, world, turns: [], seq, roster: [] },
          config: { ...config, mode: "deterministic", sampleRate: 0, requireAddressee: false },
          priorPosts: 0,
          attempt: 1,
        });
        assert.equal(
          verdict.decision,
          "APPROVE",
          `${persona.id}/${intent} seq ${seq} was rejected: ${verdict.detail} — "${text}"`,
        );
      }
    }
  }
});

test("every product answer fits the turn it is standing in for", async () => {
  const personas = await roster();
  const world = await store.readWorld();

  for (const intent of PRODUCT_INTENTS) {
    for (const persona of personas) {
      for (let seq = 1; seq <= 120; seq += 1) {
        const event: AgendaEvent = {
          kind: "HUMAN",
          reason: "test",
          sender: "human",
          topic: TEST_TOPICS[0],
          side: "a",
          quoted: KNOWLEDGE[intent].label,
          authoredBy: "responder",
          offTopic: true,
          productQuestion: true,
          productIntent: intent,
          replyMode: "answer",
        };
        const text = cannedDraft({ persona, event, world, seq, attempt: 1 });
        // The turn's own tier, including the floor a product question carries: a two-word
        // reaction is not an answer however well chosen.
        const target = lengthTarget(persona, seq, tierOptionsFor(event));
        assert.ok(text.trim().length > 0, `${persona.id}/${intent} seq ${seq} produced nothing`);
        assert.ok(
          target.tier !== "beat",
          `${persona.id}/${intent} was delivered as a beat`,
        );
        // The tolerance the Gate uses, so a line that is a hair over is not a failure.
        const slack = (bound: number): number => Math.max(6, Math.round(bound * 0.25));
        assert.ok(
          text.trim().length <= target.max + slack(target.max),
          `${persona.id}/${intent} seq ${seq} (${target.tier}) ran to ${text.trim().length} chars, ceiling ${target.max + slack(target.max)}: "${text}"`,
        );
        assert.equal(
          typographyFault(text),
          "",
          `${persona.id}/${intent} seq ${seq} carries a keyboard tell: "${text}"`,
        );
      }
    }
  }
});

test("the banks carry no line the room may not publish about the product", () => {
  const forbidden =
    /\b(?:not my call|no idea|can'?t tell|not the person to ask|nobody here knows|scam|fake platform|stay away|guaranteed|risk-free|fills? (?:are|is) (?:instant|mid|trash)|mid (?:as hell )?fills?)\b/i;
  for (const intent of PRODUCT_INTENTS) {
    const entry = KNOWLEDGE[intent];
    assert.ok(entry.facts.length > 0, `${intent} has no facts`);
    assert.ok(entry.beat.length > 0 && entry.short.length > 0 && entry.thought.length > 0, `${intent} is missing a tier`);
    const lines = [
      ...entry.beat,
      ...entry.short,
      ...entry.thought,
      ...Object.values(entry.personal ?? {}).flatMap((own) => own ?? []),
    ];
    for (const line of lines) {
      assert.equal(forbidden.test(line), false, `${intent} carries an unpublishable line: "${line}"`);
      assert.equal(typographyFault(line), "", `${intent} carries a keyboard tell: "${line}"`);
    }
    // A beat is the tier that produces a shrug, and a shrug was published as the room's whole
    // answer to a worried visitor ("cooked."). Every bank has at least one real reaction.
    for (const line of entry.beat) {
      assert.ok(line.trim().length <= 28, `${intent} beat is too long to ever be chosen: "${line}"`);
    }
  }
});

test("every line a member may answer with is one the Gate would publish", async () => {
  const personas = await roster();
  const world = await store.readWorld();
  const config = resolveGateConfig(await store.readConfig().then((c) => c.gate));

  // The static guard above is a hand-copied regex, and it drifted: it listed `can't tell` while
  // the Gate refuses `i cannot tell you`, so a line passed the audit and was then refused when a
  // member actually said it. This runs the Gate itself over every line, at a turn whose length
  // covers the line, so the two cannot disagree about what is publishable.
  const tierOf = (length: number): "short" | "normal" | "full" =>
    length <= 80 ? "short" : length <= 240 ? "normal" : "full";

  let checked = 0;
  for (const intent of PRODUCT_INTENTS) {
    for (const persona of personas) {
      const cap = Math.min(340, Math.max(16, persona.sheet.register.maxChars));
      for (const line of KNOWLEDGE[intent].personal?.[persona.id] ?? []) {
        // A pool line longer than this member's ceiling is never offered to them, so there is
        // no turn to judge it on.
        if (line.length > cap) continue;
        const event: AgendaEvent = {
          kind: "HUMAN",
          reason: "test",
          sender: "human",
          topic: TEST_TOPICS[0],
          side: "a",
          quoted: KNOWLEDGE[intent].label,
          authoredBy: "responder",
          offTopic: true,
          productQuestion: true,
          productIntent: intent,
          replyMode: "answer",
        };
        const seq = seqForTier(persona, tierOf(line.length));
        const verdict = await runGate({
          context: { persona, text: line, event, world, turns: [], seq, roster: [] },
          config: { ...config, mode: "deterministic", sampleRate: 0, requireAddressee: false },
          priorPosts: 0,
          attempt: 1,
        });
        checked += 1;
        assert.equal(
          verdict.decision,
          "APPROVE",
          `${intent}/${persona.id} carries a line the Gate refuses (${verdict.detail}): "${line}"`,
        );
      }
    }
  }
  assert.ok(checked > 200, `only ${checked} personal lines were audited`);
});

test("every member has a greeting, and a greeting turn gets one", async () => {
  const personas = await roster();
  const world = await store.readWorld();
  for (const persona of personas) {
    assert.ok(greetingFor(persona.id).length > 0, `${persona.id} has no greeting`);
    assert.ok(GREETINGS[persona.id], `${persona.id} is missing from the greeting table`);
  }
  // Every line the greeting path may publish, checked as text: a greeting opens with a hello
  // and is typed like a thumb. The check-in lines share the first rule so one can stand as the
  // reply to a fresh "hey everyone, how's it going".
  for (const lines of [...Object.values(GREETINGS), CHECK_IN_LINES]) {
    for (const line of lines) {
      assert.equal(typographyFault(line), "", `greeting carries a keyboard tell: "${line}"`);
      assert.match(
        line,
        /^(?:hey|hi|hello|yo|sup|welcome|good (?:morning|evening|afternoon))/i,
        `greeting does not open with a hello: "${line}"`,
      );
    }
  }

  const event: AgendaEvent = {
    kind: "HUMAN",
    reason: "test",
    sender: "human",
    topic: TEST_TOPICS[0],
    side: "a",
    quoted: "yo, just joined. what is this place 😅",
    authoredBy: "responder",
    offTopic: true,
    greeting: true,
    replyMode: "answer",
  };
  for (const persona of personas) {
    for (let seq = 1; seq <= 40; seq += 1) {
      const text = cannedDraft({ persona, event, world, seq, attempt: 1 });
      assert.match(
        text,
        /^(?:hey|hi|hello|yo|sup|welcome|good (?:morning|evening|afternoon))/i,
        `${persona.id} answered a hello without one: "${text}"`,
      );
    }
  }
});

test("a question the room cannot answer says so instead of guessing", async () => {
  const personas = await roster();
  const world = await store.readWorld();
  const event: AgendaEvent = {
    kind: "HUMAN",
    reason: "test",
    sender: "human",
    topic: TEST_TOPICS[0],
    side: "a",
    quoted: "how do i change the tax residency on my account",
    authoredBy: "responder",
    offTopic: true,
    productQuestion: true,
    productIntent: "other",
    replyMode: "answer",
  };

  let mentionsSupport = 0;
  let total = 0;
  for (const persona of personas) {
    for (let seq = 1; seq <= 60; seq += 1) {
      const text = cannedDraft({ persona, event, world, seq, attempt: 1 });
      total += 1;
      if (/support/i.test(text)) mentionsSupport += 1;
    }
  }
  assert.ok(
    mentionsSupport / total > 0.5,
    `only ${mentionsSupport}/${total} answers to an unknown question pointed at support`,
  );
});

test("the room does not answer everything the same way any more", () => {
  const modes = new Map<string, number>();
  for (let seq = 1; seq <= 400; seq += 1) {
    const mode = humanReplyMode({
      roomId: "axion-forum",
      seq,
      text: "lol the tape is dead today",
      product: false,
      greeting: false,
      first: false,
    });
    modes.set(mode, (modes.get(mode) ?? 0) + 1);
  }
  // Every delivery is reachable, and each of the unusual ones is a minority.
  for (const mode of ["answer", "askBack", "react", "quiet"] as const) {
    const count = modes.get(mode) ?? 0;
    assert.ok(count > 0, `${mode} is unreachable: ${JSON.stringify([...modes])}`);
  }
  assert.ok((modes.get("answer") ?? 0) > 200, "answering must still be the norm");

  // The shapes that must always be answered, whatever the dice say.
  for (let seq = 1; seq <= 200; seq += 1) {
    assert.equal(
      humanReplyMode({ roomId: "axion-forum", seq, text: "how do i put money in", product: true, greeting: false, first: false }),
      "answer",
      "a question about the platform was not answered",
    );
    assert.equal(
      humanReplyMode({ roomId: "axion-forum", seq, text: "yo", product: false, greeting: true, first: true }),
      "answer",
      "a greeting was not answered",
    );
    assert.notEqual(
      humanReplyMode({ roomId: "axion-forum", seq, text: "am i gonna lose everything", product: false, greeting: false, first: true }),
      "quiet",
      "somebody's first message was met with silence",
    );
  }
});

/**
 * The whole thing, end to end: the room runs its own runtime, with no model available.
 *
 * This is the state the deployed room spends most of the day in — the free pool is exhausted
 * and every Voice call fails — so this is what a visitor reads. The run goes through
 * `advance()`, the Gate, the publisher and the agenda exactly as production does; the only
 * injection is a provider that throws, which is what a rate-limited account looks like.
 */
test("six messages from a newcomer, answered by the room's own runtime with no model", async () => {
  const [realPersonas, realConfig, realTopics, realWorld] = await Promise.all([
    store.readPersonas(),
    store.readConfig(),
    store.readTopics(),
    store.readWorld(),
  ]);
  const fixture = await createFixture({
    config: realConfig,
    personas: realPersonas,
    topics: realTopics,
    world: realWorld,
  });
  const dead: ChatProvider = {
    id: "dead",
    model: "dead/model",
    family: "dead",
    chat: async () => {
      throw new Error("429 Rate limit exceeded: free-models-per-day");
    },
  };

  try {
    let now = TEST_BASE;
    const replies: Array<{ mine: string; said: string[]; quiet: boolean; quietFor: string[] }> = [];

    for (const entry of MEASURED_MESSAGES) {
      const topic = realTopics[0]!;
      now += 60_000;
      await fixture.store.appendHumanMessage({
        text: entry.text,
        sender: "human",
        t: now,
        topicId: topic.id,
      });

      // Run the room until it is no longer sitting on the person's message. The shipped
      // room paces a reply 30-60s out, so the clock moves further than that each step, and
      // the extra steps are where a second member's line lands.
      const appended = await fixture.store.readLastTurn();
      const humanSeq = appended!.seq;
      for (let step = 0; step < 3; step += 1) {
        now += 95_000;
        await advance(fixture.store, {
          now,
          driver: "test",
          voiceProvider: dead,
          peekInjections: async () => null,
        });
      }

      const turns = await fixture.store.readTurns(200);
      const added = turns.filter((turn) => turn.seq > humanSeq);
      const said = added
        .filter((turn) => turn.message?.replyToSeq === humanSeq)
        .map((turn) => turn.message!.text);
      const quietFor = added
        .filter(
          (turn) => !turn.message && turn.chosen && String(turn.note ?? "").includes("quiet turn"),
        )
        .map((turn) => String(turn.chosen));
      replies.push({ mine: entry.text, said, quiet: said.length === 0, quietFor });
    }

    // A readable transcript, so a failure here shows the room rather than only a number.
    for (const reply of replies) {
      console.log(`\n  me: ${reply.mine}`);
      if (reply.said.length === 0) console.log(`      (the room read it and moved on)`);
      for (const line of reply.said) console.log(`      ${line}`);
    }

    const answered = replies.filter((reply) => reply.said.length > 0);
    assert.ok(
      answered.length >= 5,
      `only ${answered.length}/6 messages got anything back from the room`,
    );

    // Not one of these six may be a line that shares nothing with the question — that was the
    // measured failure, six times out of six.
    for (let i = 0; i < MEASURED_MESSAGES.length; i += 1) {
      const entry = MEASURED_MESSAGES[i]!;
      const reply = replies[i]!;
      if (reply.said.length === 0) continue;
      if (entry.greeting) {
        assert.match(
          reply.said[0]!,
          /(?:hey|hi|hello|yo|sup|welcome)/i,
          `the newcomer's opening line got no welcome: "${reply.said[0]}"`,
        );
        continue;
      }
      if (entry.intent === null) continue;
      const theirs = contentTokens(entry.text);
      const shares = reply.said.some((line) =>
        [...contentTokens(line)].some((token) => theirs.has(token)),
      );
      assert.ok(shares, `"${entry.text}" was answered with "${reply.said.join(" | ")}"`);
    }

    // Deliberately *not* asserted here: how often two members answer the same person. That is
    // a rule of the agenda and it is tested on its own below, where it can be exercised over
    // hundreds of turns rather than over six.
    const piledOn = replies.filter((reply) => reply.said.length > 1).length;
    console.log(`\n  messages answered by more than one member: ${piledOn}/${replies.length}\n`);
  } finally {
    await fixture.cleanup();
  }
});

test("somebody else sometimes answers the same person", () => {
  const config = { ...TEST_CONFIG, roomId: "axion-forum" };
  let piled = 0;
  let single = 0;

  for (let seq = 1; seq < 300; seq += 3) {
    const human = {
      ...makeTurn(seq, { sender: "human", text: "the tape is dead today" }),
      trigger: "HUMAN" as const,
    };
    const reply = makeTurn(seq + 1, { sender: "mara", text: "yeah it is", recipient: "human" });
    reply.message!.replyToSeq = seq;

    const event = nextEvent({
      seq: seq + 2,
      now: TEST_BASE + 60_000,
      turns: [human, reply],
      config,
      topics: TEST_TOPICS,
      world: TEST_WORLD,
      personas: TEST_PERSONAS,
    });
    if (event.kind === "HUMAN" && event.sender === "human" && event.replyTo === seq) piled += 1;
    else single += 1;
  }

  assert.ok(piled > 0, "the room never lets a second member add a line");
  assert.ok(
    piled < single / 2,
    `the pile-on is the rule rather than the texture: ${piled} of ${piled + single}`,
  );
});

test("a quiet turn does not make the agenda answer the message twice", () => {
  const human = makeTurn(4, { sender: "human", text: "lol the tape is dead today" });
  // Exactly the record `advance()` writes for a quiet turn: no message, a chosen speaker, and
  // the trigger of the event it passed on.
  const quiet = {
    ...makeTurn(5, { sender: "mara", withMessage: false }),
    trigger: "HUMAN" as const,
    note: "the room read it and had nothing to add (quiet turn)",
  };

  const config = { ...TEST_CONFIG, roomId: "axion-forum" };
  const ctx = {
    seq: 6,
    now: TEST_BASE + 60_000,
    turns: [human, quiet],
    config,
    topics: TEST_TOPICS,
    world: TEST_WORLD,
    personas: TEST_PERSONAS,
  };

  // The quiet record is the room's own note that it read the message, so the human message
  // under it is not owed a reply again.
  const event = nextEvent(ctx);
  assert.notEqual(event.kind, "HUMAN", "the room answered a message it had already passed on");

  // Without the record, the same log is owed a reply — the marker is the whole mechanism.
  assert.equal(nextEvent({ ...ctx, turns: [human] }).kind, "HUMAN");
});
