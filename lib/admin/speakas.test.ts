import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

/**
 * The speak-as path end to end on a real Postgres: the dashboard queues a line,
 * the room's next turn publishes it verbatim as the persona — no Voice model, no
 * Gate — and the claim is consumed exactly once. Runs against TEST_DATABASE_URL
 * and refuses anything non-local (same rule as the pg suite: these tests write
 * rows, and a live room must never be pointed at this file).
 */

import { advance } from "@/lib/forum/advance";
import { PgStore } from "@/lib/forum/pg-store";

const URL = process.env.TEST_DATABASE_URL?.trim() ?? "";
const host = URL ? new globalThis.URL(URL).host : "";
const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])/.test(host) || host.startsWith("0.0.0.0");

let store: PgStore | null = null;

beforeEach(async () => {
  store = null;
});

test("environment is a local database", { skip: !URL || !isLocal }, () => {
  assert.ok(isLocal, `refusing non-local database ${host}`);
});

test(
  "a queued injection publishes verbatim as the persona, once",
  { skip: !URL || !isLocal },
  async () => {
    process.env.DATABASE_URL = URL;
    const { enqueueInjection, takeInjection } = await import("@/lib/admin/store");
    const { createFixture, TEST_TOPICS } = await import("@/lib/forum/test-utils");
    const { humanMessageRecord } = await import("@/lib/forum/human");

    // The room's bundled roster is what PgStore.readPersonas returns, so the
    // persona must come from it.
    const persona = "sol";

    const fixture = await createFixture({});
    try {
      store = new PgStore({ connectionString: URL });
      await store.appendTurn(humanMessageRecord(1, {
        text: "read on gold?",
        sender: "human",
        t: Date.now(),
        topicId: TEST_TOPICS[0]!.id,
      }));

      const text = `e2e speak-as ${Date.now()} — tape is flat, watching the metals`;
      await enqueueInjection(persona, text, "test");

      const result = await advance(store, {
        now: Date.now() + 90_000,
        driver: "test",
      });

      assert.equal(result.status, "published");
      assert.equal(result.record?.chosen, persona, "the queued persona must be the speaker");
      assert.equal(result.record?.message?.text, text, "the line must be published verbatim");
      assert.match(result.record?.note ?? "", /admin injection/, "the turn must say why");
      assert.equal(result.record?.attempts.length, 0, "no Gate retries: the admin line bypasses the Gate");

      // The claim was consumed: a second turn for the same persona drafts
      // normally (no injection left), and takeInjection now returns null.
      const gone = await takeInjection(persona);
      assert.equal(gone, null, "the claim must be spent by the publish");
    } finally {
      await fixture.cleanup();
      // PgStore pools close lazily; in tests just let the process exit reap them.
      delete process.env.DATABASE_URL;
    }
  },
);
