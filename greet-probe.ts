/**
 * What the room answers when somebody just says hello.
 *
 * Drives the real `advance()` runtime with no model available (the state the deployed room
 * spends most of the day in) over the exact greetings people sent in the live chats, and
 * prints every line the room answered with.
 */
import { advance } from "./lib/forum/advance";
import type { ChatProvider } from "./lib/forum/provider";
import { FileStore } from "./lib/forum/store";
import { createFixture } from "./lib/forum/test-utils";

const dead: ChatProvider = {
  id: "dead",
  model: "dead/model",
  family: "dead",
  chat: async () => {
    throw new Error("429 Rate limit exceeded: free-models-per-day");
  },
};

const GREETINGS = [
  "Hi",
  "Hi",
  "Hello",
  "Hello guys",
  "I'm just greeting, how is everyone doing?",
  "how is everyone doing?",
  "hey everyone",
  "what's up everyone",
  "just joined, glad to be here",
  "morning all",
];

(async () => {
  const real = new FileStore(`${process.cwd()}/data/forum`);
  const [personas, config, topics, world] = await Promise.all([
    real.readPersonas(),
    real.readConfig(),
    real.readTopics(),
    real.readWorld(),
  ]);
  const fixture = await createFixture({ personas, config, topics, world });
  try {
    let now = 1_800_000_000_000;
    for (const greeting of GREETINGS) {
      now += 600_000;
      const topic = topics[0]!;
      await fixture.store.appendHumanMessage({
        text: greeting,
        sender: "human",
        t: now,
        topicId: topic.id,
      });
      const before = (await fixture.store.readTurns(Number.POSITIVE_INFINITY)).length;
      const replies: string[] = [];
      for (let step = 0; step < 4; step += 1) {
        now += 45_000;
        await advance(fixture.store, {
          now,
          driver: "greet-probe",
          voiceProvider: dead,
          peekInjections: async () => null,
        });
      }
      const turns = await fixture.store.readTurns(Number.POSITIVE_INFINITY);
      for (const turn of turns.slice(before)) {
        if (turn.message && turn.message.sender !== "human") {
          const note = String(turn.note ?? "");
          const via = /voice call failed|voice fumble|no model|fallback/.test(note)
            ? "fallback"
            : "model";
          replies.push(`      ${turn.message.sender} [${via}]: ${turn.message.text}`);
        }
      }
      console.log(`\n  "${greeting}"`);
      console.log(replies.length > 0 ? replies.join("\n") : "      (no reply)");
    }
  } finally {
    await fixture.cleanup();
  }
})().catch((error) => {
  console.error("PROBE_FAIL:", error);
  process.exit(1);
});
