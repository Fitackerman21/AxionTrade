import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * The admin↔runtime contract: what the dashboard sets is what the room does.
 *
 * Runs on the forum's own fixture store, with settings injected through the
 * `settings` option both entry points accept — the same option a worker uses —
 * so no database is needed and the seam under test is the real one.
 */

import { advance } from "@/lib/forum/advance";
import { catchUp } from "@/lib/forum/catchup";
import { createFixture, makeTurn, TEST_BASE, TEST_TOPICS } from "@/lib/forum/test-utils";
import type { AdminSettings } from "@/lib/admin/store";

const off: AdminSettings = { paused: false, muted: [], pace: 1 };

describe("runtime × admin settings", () => {
  it("a paused room defers: catchUp runs nothing and says why", async () => {
    const fixture = await createFixture({});
    try {
      const report = await catchUp(fixture.store, {
        now: TEST_BASE + 120_000,
        settings: { paused: true, muted: [], pace: 1 },
      });
      assert.equal(report.ran, 0);
      assert.match(report.reason, /paused by an admin/);
    } finally {
      await fixture.cleanup();
    }
  });

  it("pace multiplies the cadence the burst is spaced on", async () => {
    const fixture = await createFixture({});
    try {
      // A seeded log, because an empty room owes nothing to stretch.
      await fixture.store.appendTurn(makeTurn(1, { sender: "mara", topicId: TEST_TOPICS[0]!.id }));
      // At ×1 the room has long gone stale after an hour; at ×4 the stretched
      // gap keeps it inside the normal-catch-up path instead.
      const normal = await catchUp(fixture.store, {
        now: TEST_BASE + 3_600_000,
        dryRun: true,
        settings: off,
      });
      const slow = await catchUp(fixture.store, {
        now: TEST_BASE + 3_600_000,
        dryRun: true,
        settings: { paused: false, muted: [], pace: 4 },
      });
      assert.ok(
        slow.owed < normal.owed || (!slow.recapped && normal.recapped),
        `a slower room must be less behind (${JSON.stringify({ slow: slow.owed, normal: normal.owed, slowRecap: slow.recapped, normalRecap: normal.recapped })})`,
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("a queued speak-as line makes that persona the next speaker", async () => {
    const fixture = await createFixture({});
    try {
      await fixture.store.appendHumanMessage({
        text: "read on gold?",
        sender: "human",
        t: TEST_BASE,
        topicId: TEST_TOPICS[0]!.id,
      });

      const result = await advance(fixture.store, {
        now: TEST_BASE + 90_000,
        settings: off,
        // The dashboard has a line queued for sol: they jump cooldowns and
        // recency, so the scheduler cannot make the message sit for hours.
        peekInjections: async () => ({ persona: "sol" }),
        voiceProvider: async () => ({
          text: "gold is doing what gold does",
          usedVoice: false,
          drift: false,
          model: null,
          usage: null,
          fallback: false,
          reason: "test",
        }),
      } as never);

      assert.equal(result.status, "published");
      assert.equal(result.record?.chosen, "sol", "the queued persona must be picked ahead of the schedule");
      assert.match(result.record?.note ?? "", /speak-as|queued/, "the reason must be auditable on the turn");
    } finally {
      await fixture.cleanup();
    }
  });

  it("a muted persona is never chosen to speak", async () => {
    const fixture = await createFixture({});
    try {
      await fixture.store.appendHumanMessage({
        text: "read on gold?",
        sender: "human",
        t: TEST_BASE,
        topicId: TEST_TOPICS[0]!.id,
      });

      // Mute the ONLY permitted responder; the engine persona is exempt from
      // muting (it is the control voice), so the room must stage-direct rather
      // than hand the turn to someone the admin silenced.
      const muted = ["mara"];
      const result = await advance(fixture.store, {
        now: TEST_BASE + 90_000,
        settings: { paused: false, muted, pace: 1 },
        voiceProvider: async () => ({
          text: "Nothing on the desk covers that yet.",
          usedVoice: false,
          drift: false,
          model: null,
          usage: null,
          fallback: false,
          reason: "test",
        }),
      } as never);

      assert.equal(result.status, "published");
      assert.equal(result.record?.chosen, "jev", "the engine covers the turn when every responder is muted");
      assert.notEqual(result.record?.message, null, "the room must not go silent");
    } finally {
      await fixture.cleanup();
    }
  });
});
