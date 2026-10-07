/**
 * These tests validate the data in data/forum rather than the code: a malformed
 * character sheet or a matrix that names a persona who does not exist would
 * otherwise only show up as a strange room at runtime.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { cannedDraft, productDraft, PRODUCT_LINES, REPERTOIRE } from "./drafts";
import { contentTokens, resolveGateConfig, runDeterministicChecks } from "./gate";
import { lengthTarget, typographyFault } from "./register";
import { dataStore } from "./test-utils";
import type { AgendaEvent, Persona, Side } from "./types";

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

test("no character sheet puts a fault in the product", async () => {
  const personas = await store.readPersonas();
  // The sheets are the voice anchor, so a fault written into one comes back out of a
  // model as an unprompted line about the product. That is how the live transcript got
  // "still hate that the alerts fire late" and "the alerts fire late anyway, fills log
  // does more for me than the alerts ever did" — a persona complaining about a feature
  // it cannot evaluate, in the product's own voice, on the product's own page (§9.2).
  //
  // Scoped to reliability, not to opinion: "the top tier is mostly noise" is a
  // judgement about scope, and the sheet's honest mixed tone is deliberate. "It fires
  // late" is a claim that the thing does not work, which no persona can make.
  const productNoun =
    /\b(?:alerts?|fills?|fills log|screens?|flow screen|levels screen|watchlist|earnings calendar|guardrail|subscription|platform|the app|the site)\b/i;
  const reliability =
    /\b(?:late|slow|lag|mid|trash|garbage|useless|broken|buggy|glitchy|unreliable|inaccurate|misses|missed)\b/i;
  const slur = /\b(?:not real|scam|fake|stay away|don'?t trust|isn'?t real|ain'?t real)\b/i;
  // The comparative put-down: "the earnings calendar has saved her twice and the alerts
  // have not". No reliability word in it, so the proximity check misses it, and the
  // "the" plus the verb keeps it off an honest line ("the wallet of alerts he set up in
  // January has not been touched since, he considers that a feature").
  const dismissed =
    /\b(?:and|but)\s+the\s+(?:alerts?|fills?|screens?|platform|watchlist|calendar|guardrail)\s+(?:have|has|did|do|is|are)\s+(?:not|n'?t)\b/i;
  const near = (line: string): boolean => {
    const words = line.split(/\s+/);
    for (let i = 0; i < words.length; i += 1) {
      if (!productNoun.test(words[i]!)) continue;
      for (let j = Math.max(0, i - 6); j < Math.min(words.length, i + 7); j += 1) {
        if (reliability.test(words[j]!)) return true;
      }
    }
    return false;
  };

  for (const persona of personas) {
    const { sampleLines, banter, results, nitpicks } = persona.sheet;
    for (const line of [...sampleLines, ...(banter ?? []), ...(results ?? []), ...(nitpicks ?? [])]) {
      assert.equal(
        near(line) || slur.test(line) || dismissed.test(line),
        false,
        `${persona.id}'s sheet teaches a fault in the product: "${line}"`,
      );
    }
  }
});

test("every sheet carries what a testimonial needs, and the annoyances stay cosmetic", async () => {
  const personas = await store.readPersonas();
  // A product question is answered from the sheet: what this person gets out of the
  // platform, and at most one petty annoyance about using it. A sheet with no
  // testimonials at all makes the room improvise, which is exactly how it invented
  // "axion's fills are mid as hell"; a sheet with no annoyance makes every one of the
  // eleven sound like an advert.
  for (const persona of personas) {
    const { results, nitpicks } = persona.sheet;
    assert.ok((results?.length ?? 0) > 0, `${persona.id} has nothing to say about the platform`);
    assert.ok((nitpicks?.length ?? 0) > 0, `${persona.id} has no small annoyance to mention`);

    for (const nitpick of nitpicks ?? []) {
      assert.doesNotMatch(
        nitpick,
        /\b(?:late|slow|lag|mid|trash|garbage|useless|broken|buggy|glitchy|unreliable|inaccurate|fails?|misses|missed)\b/i,
        `${persona.id}'s annoyance is a fault in the product, not a cosmetic one: "${nitpick}"`,
      );
      assert.doesNotMatch(
        nitpick,
        /\d/,
        `${persona.id}'s annoyance quotes a number: "${nitpick}"`,
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

test("every member of the room has their own fallback lines, sized for the turn they serve", async () => {
  const personas = await store.readPersonas();

  for (const persona of personas) {
    const repertoire = REPERTOIRE[persona.id];
    assert.ok(
      repertoire,
      `${persona.id} has no repertoire of its own and would answer in the generic lines`,
    );

    for (const line of repertoire.beat) {
      assert.ok(line.length >= 1 && line.length <= 28, `${persona.id} beat is ${line.length} chars: "${line}"`);
    }
    for (const line of repertoire.short) {
      // A `short` turn is 8-80 characters, and the name that makes it an answer
      // costs up to eight, so a one-liner over 72 could never be addressed and fit.
      assert.ok(
        line.length >= 8 && line.length <= 72,
        `${persona.id} one-liner is ${line.length} chars: "${line}"`,
      );
    }
    for (const line of repertoire.thought) {
      assert.ok(
        line.length >= 40 && line.length <= 135,
        `${persona.id} thought is ${line.length} chars: "${line}"`,
      );
      assert.equal(typographyFault(line), "", `${persona.id} thought uses keyboard punctuation: "${line}"`);
    }
  }
});

test("a fallback line is chosen to fit the turn, and connects without quoting anyone in pieces", async () => {
  const [personas, topics, world] = await Promise.all([
    store.readPersonas(),
    store.readTopics(),
    store.readWorld(),
  ]);
  // The repertoire is fixed text with no placeholders, so the topic cannot change
  // what a fallback says — which is the property that makes "this line fits this
  // turn" true rather than probable. One topic is therefore the whole space.
  const topic = topics[0]!;
  const quoted = "flows are already leaving and the range breaks down first";

  for (const persona of personas) {
    for (let seq = 1; seq <= 240; seq += 1) {
      const event: AgendaEvent = {
        kind: "THREAD",
        reason: "test",
        sender: "dmitri",
        topic,
        side: "a",
        quoted,
        authoredBy: "responder",
      };
      for (const attempt of [1, 2, 3]) {
        const text = cannedDraft({ persona, event, world, seq, attempt });
        const target = lengthTarget(persona, seq);
        const where = `${persona.id}/${target.tier}/seq ${seq}/attempt ${attempt}`;

        assert.ok(
          text.length >= target.min && text.length <= target.max,
          `${where} missed its target (${target.min}-${target.max}, got ${text.length}): "${text}"`,
        );
        assert.equal(typographyFault(text), "", `${where} used keyboard punctuation: "${text}"`);
        // The two things the old fallback did to itself: it was cut with the
        // ellipsis still attached, and it was stretched with filler word by word.
        assert.doesNotMatch(text, /\.\./, `${where} arrived with a truncated clause: "${text}"`);
        assert.doesNotMatch(
          text,
          /and honestly that is the whole|read on it from where i am sitting/,
          `${where} arrived with the padding still attached: "${text}"`,
        );
        assert.equal(text, text.trim(), `${where} has stray whitespace: "${text}"`);
        assert.equal(text.includes("  "), false, `${where} has a double space: "${text}"`);

        // A canned line is judged by the Gate when a persona has no model, so it has
        // to satisfy the rule the Gate runs (`checkAddressee`): a shared content
        // token, or the sender's name.
        if (target.tier !== "beat") {
          const theirs = contentTokens(quoted);
          const shares = [...contentTokens(text)].some((token) => theirs.has(token));
          assert.ok(
            shares || text.toLowerCase().includes(event.sender),
            `${where} answers nobody: "${text}"`,
          );
        }
      }
    }
  }
});

test("the room's answer about the platform fits its turn and claims nothing", async () => {
  const [personas, topics, world] = await Promise.all([
    store.readPersonas(),
    store.readTopics(),
    store.readWorld(),
  ]);
  const topic = topics[0]!;
  // ADDRESSEE is off because the reply path waives it for this shape of turn
  // (`advance.ts`): the answer is the persona's own line about the platform, and it
  // shares no market vocabulary with the question by construction.
  const det = resolveGateConfig({ mode: "deterministic", requireAddressee: false });
  const question: AgendaEvent = {
    kind: "HUMAN",
    reason: "test",
    sender: "human",
    topic,
    side: "a",
    quoted: "Is axion ai trading real?, hope I am not going to lose my money in this?",
    authoredBy: "responder",
    offTopic: true,
    productQuestion: true,
  };

  // Across a run of seqs, because the tier changes per turn and the bank has to
  // reach every one of them — a product answer that only fits one tier is a product
  // answer that is published too long or too short on three turns out of four.
  for (const persona of personas) {
    for (let seq = 1; seq <= 240; seq += 1) {
      const text = productDraft({ persona, seq, attempt: 1 });
      const target = lengthTarget(persona, seq);
      const where = `${persona.id}/${target.tier}/seq ${seq}`;

      assert.ok(text.length > 0, `${persona.id} produced an empty product answer`);
      assert.ok(
        text.length >= target.min && text.length <= target.max,
        `${where} missed its target (${target.min}-${target.max}, got ${text.length}): "${text}"`,
      );
      assert.equal(typographyFault(text), "", `${where} used keyboard punctuation: "${text}"`);
      // The point of these lines is that the Gate's own product check accepts them,
      // so the fallback can never be the thing that gets rejected.
      const failures = runDeterministicChecks(
        { persona, text, event: question, world, turns: [], seq },
        det,
      );
      assert.deepEqual(failures.map((f) => f.code), [], `${where} was rejected: "${text}"`);
    }
  }

  // None of them is addressed by id. `addressed()` puts the sender's name in front of
  // a line that does not connect to what they said, and the id a person's message
  // carries is literally "human" — so the garble this guards is "human, i use it".
  for (const line of [
    ...PRODUCT_LINES.beat,
    ...PRODUCT_LINES.short,
    ...PRODUCT_LINES.thought,
  ]) {
    assert.doesNotMatch(line, /^human\b/i, `"${line}" greets the sender by id`);
  }
});

test("a fallback says the name once, and never repeats a phrase inside one message", async () => {
  const [personas, topics, world] = await Promise.all([
    store.readPersonas(),
    store.readTopics(),
    store.readWorld(),
  ]);
  const topic = topics[0]!;

  for (const persona of personas) {
    for (let seq = 1; seq <= 120; seq += 1) {
      const event: AgendaEvent = {
        kind: "THREAD",
        reason: "test",
        // A long quotation with no content word in common, which is the case the old
        // prefix handled by quoting it back — twice, in pieces, on a retry.
        sender: "nadia",
        topic,
        side: "a",
        quoted: "You are buying a narrative with a rolled-over chart and nobody cleared it.",
        authoredBy: "responder",
      };
      const text = cannedDraft({ persona, event, world, seq, attempt: 1 });
      const where = `${persona.id}/seq ${seq}`;

      const names = text.toLowerCase().split(event.sender).length - 1;
      assert.ok(names <= 1, `${where} says the name ${names} times: "${text}"`);

      const words = text.toLowerCase().split(/\s+/).filter(Boolean);
      const seen = new Set<string>();
      for (let i = 0; i + 4 <= words.length; i += 1) {
        const gram = words.slice(i, i + 4).join(" ");
        assert.equal(seen.has(gram), false, `${where} repeats "${gram}": "${text}"`);
        seen.add(gram);
      }
    }
  }
});
