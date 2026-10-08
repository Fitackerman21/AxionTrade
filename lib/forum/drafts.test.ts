/**
 * The canned fallback's two new jobs: do not repeat the room, and prefer a line that
 * answers the message by its content over one that needs the sender's name bolted on
 * the front.
 *
 * Both are responses to the live transcript: with the Voice down, ~90% of turns are
 * served from this bank, and a four-line bank against a 15-line window published the
 * same sentence four times in sixty messages (see `drafts.ts`, the no-repeat window).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { cannedDraft } from "./drafts";
import { lengthTarget } from "./register";
import { dataStore, makeTurn, seqForTier } from "./test-utils";
import type { AgendaEvent } from "./types";

const store = dataStore();

test("the fallback does not say again what the room just said", async () => {
  const [personas, topics, world] = await Promise.all([
    store.readPersonas(),
    store.readTopics(),
    store.readWorld(),
  ]);
  const rafa = personas.find((p) => p.id === "rafa")!;
  const topic = topics[0]!;

  // A real line from rafa's own bank, already on the log inside the window.
  const said = "the tape is thin and i'm not paying to find out where it goes";
  const recent = [makeTurn(100, { sender: "rafa", text: said, topicId: topic.id })];

  const event: AgendaEvent = {
    kind: "THREAD",
    reason: "test",
    sender: "nadia",
    topic,
    side: "a",
    quoted: "what do you make of this range",
    authoredBy: "responder",
  };

  const from = seqForTier(rafa, "normal", 1);
  let checked = 0;
  for (let seq = from; seq < from + 60; seq += 1) {
    if (lengthTarget(rafa, seq).tier === "beat") continue;
    checked += 1;
    const text = cannedDraft({ persona: rafa, event, world, seq, attempt: 1, recent });
    assert.ok(
      !text.toLowerCase().includes("not paying to find out"),
      `seq ${seq} said the room's line again: "${text}"`,
    );
  }
  assert.ok(checked > 10, "the sample was too small to mean anything");
});

test("the fallback prefers a line that answers the message over one that needs a name", async () => {
  const [personas, topics, world] = await Promise.all([
    store.readPersonas(),
    store.readTopics(),
    store.readWorld(),
  ]);
  const rafa = personas.find((p) => p.id === "rafa")!;
  const topic = topics[0]!;

  // Shares "tape" and "thin" with the line rafa already has for exactly this shape of
  // message — so a well-chosen fallback answers it without a name on the front.
  const event: AgendaEvent = {
    kind: "THREAD",
    reason: "test",
    sender: "nadia",
    topic,
    side: "a",
    quoted: "the tape is thin and there is nothing in it",
    authoredBy: "responder",
  };

  let total = 0;
  let answered = 0;
  for (let seq = 1; seq <= 120; seq += 1) {
    if (lengthTarget(rafa, seq).tier !== "normal") continue;
    total += 1;
    const text = cannedDraft({ persona: rafa, event, world, seq, attempt: 1 });
    // A name on the front is the fallback's own tell; an answer carries the subject.
    if (/\btape\b/i.test(text) && !/^nadia, /i.test(text)) answered += 1;
  }

  assert.ok(total > 10, "the sample was too small to mean anything");
  assert.ok(
    answered / total > 0.5,
    `only ${answered}/${total} normal turns answered by content instead of a name`,
  );
});
