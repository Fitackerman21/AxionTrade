/**
 * Agent 2 and the memory files (spec §7, workflow steps 8–10).
 *
 * Hermetic: every test injects its own `ChatProvider` for the Archivist, so no test
 * touches the network, and every store is a fixture in a temp directory.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { compactMemory, memoryNote, resolveArchivistProvider } from "./archivist";
import { foldTurn, injectionText, memoryKey, memoryTokens, needsCompaction } from "./memory";
import type { ChatProvider, ChatRequest, ChatResponse } from "./provider";
import { createFixture, dataStore, TEST_PERSONAS, TEST_TOPICS } from "./test-utils";
import type { MemoryConfig, MemoryFile, Persona } from "./types";

const MARA = TEST_PERSONAS.find((p) => p.id === "mara")!;

const CONFIG: MemoryConfig = {
  enabled: true,
  recentTurns: 6,
  compactionTokens: 60,
  keepRecentTurns: 2,
  maxDigestChars: 200,
  models: ["archivist/one", "archivist/two"],
};

/** An Archivist that answers with a fixed digest and records what it was asked. */
function archivist(text = "Still long gold, argued with dmitri about flows, nothing resolved."): {
  provider: ChatProvider;
  seen: ChatRequest[];
} {
  const seen: ChatRequest[] = [];
  return {
    seen,
    provider: {
      id: "fake-archivist",
      model: "archivist/one",
      family: "archivist",
      chat: async (request) => {
        seen.push(request);
        return {
          text,
          model: "archivist/one",
          usage: { tokensIn: 120, tokensOut: 30, cost: 0.0002 },
        } satisfies ChatResponse;
      },
    },
  };
}

function turn(seq: number, incoming: string, outgoing: string) {
  return {
    seq,
    t: 1_800_000_000_000 + seq * 1000,
    incoming: { text: incoming, topicId: TEST_TOPICS[0].id },
    outgoing: { text: outgoing, topicId: TEST_TOPICS[0].id },
  };
}

function grown(config: MemoryConfig = CONFIG): MemoryFile {
  let file: MemoryFile | null = null;
  for (let n = 1; n <= 4; n += 1) {
    file = foldTurn(
      file,
      "mara",
      "dmitri",
      turn(n, `what is your read on gold, attempt ${n}`, `still long, patience trade ${n}`),
      config,
    );
  }
  return file!;
}

test("a turn folds both sides into the thread and the buffer stays capped", () => {
  const file = grown();

  assert.equal(file.persona, "mara");
  assert.equal(file.companion, "dmitri");
  assert.equal(file.seq, 4);
  // Both sides are recorded (§7.4): two entries per turn while under the cap.
  assert.deepEqual(file.recent.slice(0, 2).map((entry) => entry.role), ["them", "me"]);
  assert.ok(file.recent.length <= CONFIG.recentTurns, "the verbatim buffer must be capped");
  assert.equal(file.version, 0, "folding a turn is not a compaction");
});

test("the compaction trigger is a token budget, checked per thread", () => {
  const wide = { ...CONFIG, compactionTokens: 10_000 };
  assert.equal(needsCompaction(grown(wide), wide), false, "a wide budget does not compact");

  const tight = { ...CONFIG, compactionTokens: 10 };
  assert.equal(needsCompaction(grown(tight), tight), true, "a tight budget does");
  assert.ok(memoryTokens(grown(tight)) > tight.compactionTokens);
});

test("injection carries only what the shared transcript cannot show", () => {
  // A wide enough buffer that all four turns are still verbatim: the cap is 24 in
  // the shipped room, well above the 900-token compaction trigger.
  const file = grown({ ...CONFIG, recentTurns: 10 });
  // A transcript window that already covers turns 3 and 4 leaves 1 and 2 to memory.
  const block = injectionText(file, 3);

  assert.match(block, /still long, patience trade 1/);
  assert.match(block, /attempt 2/);
  assert.doesNotMatch(block, /patience trade 4/, "the window already shows the newest turn");
  assert.doesNotMatch(block, /patience trade 3/);
});

test("Agent 2 rewrites the thread and keeps a bounded verbatim tail", async () => {
  const { provider, seen } = archivist();
  const file = grown();
  const result = await compactMemory({ persona: MARA, file, config: CONFIG, provider });

  assert.equal(result.skipped, null);
  assert.equal(result.file.version, 1);
  assert.equal(result.file.compactions, 1);
  assert.match(result.file.digest ?? "", /Still long gold/);
  assert.equal(result.file.recent.length, CONFIG.keepRecentTurns);
  assert.equal(result.model, "archivist/one");
  assert.equal(result.usage?.provider, "archivist");
  // The digest is bounded, which is what keeps the per-turn cost flat.
  assert.ok((result.file.digest ?? "").length <= CONFIG.maxDigestChars);

  const prompt = seen[0]!;
  assert.match(prompt.system ?? "", /one person in a traders' group chat/);
  assert.match(prompt.system ?? "", /never invent a fact/i);
  assert.match(prompt.messages[0]!.content, /dmitri: what is your read on gold/);
  assert.match(prompt.messages[0]!.content, /Mara Okafor: still long, patience trade/);
  // A summary is not a reasoning problem: budget spent thinking is budget wasted.
  assert.equal(prompt.reasoning, "off");
});

test("a failing Archivist leaves the previous file exactly as it was", async () => {
  const file = grown();
  const before = JSON.stringify(file);
  const provider: ChatProvider = {
    id: "broken",
    model: "archivist/one",
    family: "archivist",
    chat: async () => {
      throw new Error("429 rate limited");
    },
  };

  const result = await compactMemory({ persona: MARA, file, config: CONFIG, provider });

  assert.equal(JSON.stringify(result.file), before, "no corruption, no partial write (§10.5)");
  assert.equal(result.model, null);
  assert.match(result.skipped ?? "", /archivist failed: 429/);
});

test("an empty completion is refused rather than stored as a digest", async () => {
  const { provider } = archivist("   ");
  const result = await compactMemory({ persona: MARA, file: grown(), config: CONFIG, provider });
  assert.equal(result.skipped, "archivist returned nothing");
  assert.equal(result.file.digest, null);
});

test("the Archivist is never the persona's own model", () => {
  // Mara speaks gpt-5.4-nano; the chain's first entry is hers and must be dropped,
  // because a model that compacts its own memory into its own style is drift.
  const persona: Persona = { ...MARA, model: "openai/gpt-5.4-nano" };
  const config: MemoryConfig = {
    ...CONFIG,
    models: ["openai/gpt-5.4-nano", "archivist/one", "openai/gpt-5.4-nano", "archivist/two"],
  };

  const provider = resolveArchivistProvider(persona, config, ["test-key"]);
  assert.equal(provider?.model, "archivist/one");
  assert.equal(resolveArchivistProvider(persona, config, []), undefined, "no key, no Archivist");
});

test("the turn note reports the memory state it produced", async () => {
  const { provider } = archivist();
  const result = await compactMemory({ persona: MARA, file: grown(), config: CONFIG, provider });
  const note = memoryNote(result.file, result);

  assert.match(note, /memory \d+ recent \/ digest v1/);
  assert.match(note, /compacted by archivist\/one/);
});

test("memory files survive a round trip through the store, with history", async () => {
  const fixture = await createFixture();
  try {
    const file = grown();
    assert.equal(await fixture.store.readMemory("mara", "dmitri"), null);

    await fixture.store.writeMemory(file);
    const read = await fixture.store.readMemory("mara", "dmitri");
    assert.deepEqual(read, file);

    // A per-turn fold rewrites the *same* version. Those writes must not snapshot:
    // a snapshot keyed by the version would otherwise be an arbitrary mid-stream
    // buffer standing in for the real pre-compaction file.
    const foldedAgain = { ...file, recent: [...file.recent, ...file.recent], updatedAt: file.updatedAt + 1 };
    await fixture.store.writeMemory(foldedAgain);
    assert.equal(
      await fixture.store.readMemoryVersion("mara", "dmitri", 0),
      null,
      "a rewrite at the same version leaves no snapshot",
    );

    // A compaction bumps the version, and *that* snapshot is the file as it was.
    await fixture.store.writeMemory({ ...file, version: 1, digest: "compacted" });
    const snapshot = await fixture.store.readMemoryVersion("mara", "dmitri", 0);
    assert.equal(snapshot?.version, 0);
    assert.equal(snapshot?.digest, null, "the snapshot is the file as it was");
    assert.equal(snapshot?.recent.length, foldedAgain.recent.length, "the pre-compaction buffer");
    assert.equal((await fixture.store.readMemory("mara", "dmitri"))?.digest, "compacted");

    const all = await fixture.store.listMemory("mara");
    assert.equal(all.length, 1);
    assert.equal(all[0]?.companion, "dmitri", "one row per thread, not per persona");
  } finally {
    await fixture.cleanup();
  }
});

test("the room's shipped memory config is usable", async () => {
  const config = await dataStore().readConfig();
  const memory = config.memory;

  assert.ok(memory?.enabled, "the shipped room runs with memory on");
  assert.ok(memory!.recentTurns >= memory!.keepRecentTurns);
  assert.ok(memory!.compactionTokens > 0 && memory!.maxDigestChars > 0);
  assert.ok(memory!.models.length >= 1, "Agent 2 needs a chain");

  // The chain has to be able to survive the family guard for every persona: if all
  // candidates shared every persona's family, no thread would ever compact.
  const personas = await dataStore().readPersonas();
  for (const persona of personas) {
    const chain = resolveArchivistProvider(persona, memory!, ["test-key"]);
    assert.ok(chain, `${persona.id} has no archivist after the family guard`);
  }
});

test("every persona carries the results its testimonials draw on", async () => {
  const personas = await dataStore().readPersonas();
  for (const persona of personas) {
    assert.ok(
      (persona.sheet.results?.length ?? 0) >= 2,
      `${persona.id} has no platform results to talk about`,
    );
  }
});

test("a thread is keyed by both sides, so one companion cannot read another's", () => {
  assert.equal(memoryKey("mara", "dmitri"), "mara:dmitri");
  assert.notEqual(memoryKey("mara", "dmitri"), memoryKey("dmitri", "mara"));
});
