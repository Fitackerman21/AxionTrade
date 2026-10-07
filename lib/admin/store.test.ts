import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

/**
 * The admin store is Postgres-only by design (the deployment's room state lives
 * there), so these run against `TEST_DATABASE_URL` and skip otherwise — the same
 * contract the forum's own pg-store tests use.
 */

const url = process.env.TEST_DATABASE_URL?.trim();
const hasDb = Boolean(url);

interface StoreModule {
  readAdminSettings: () => Promise<unknown>;
  writeSetting: (key: string, value: unknown, actor: string) => Promise<void>;
  enqueueInjection: (persona: string, text: string, actor: string) => Promise<number>;
  takeInjection: (persona: string) => Promise<{ id: number; text: string } | null>;
  markInjectionTaken: (id: number, seq: number) => Promise<void>;
  cancelInjection: (id: number, actor: string) => Promise<boolean>;
  writePersonaOverride: (persona: string, display: unknown, actor: string) => Promise<void>;
  readPersonaOverrides: () => Promise<Record<string, unknown>>;
  insertMembers: (rows: Array<{ email: string; name: string }>, batch: string) => Promise<{ inserted: number; skipped: number }>;
  listMembers: () => Promise<Array<{ email: string; name: string }>>;
  logAction: (action: string, detail: Record<string, unknown>, actor: string) => Promise<void>;
  readAdminLog: () => Promise<Array<{ action: string }>>;
}

// A unique marker per run so concurrent test databases do not collide.
const marker = `admin-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe("admin store", { skip: !hasDb }, () => {
  let store: StoreModule;

  beforeEach(async () => {
    process.env.DATABASE_URL = url;
    const mod = await import("./store");
    store = mod as unknown as StoreModule;
  });

  it("round-trips settings", async () => {
    await store.writeSetting("paused", true, marker);
    await store.writeSetting("pace", 2, marker);
    const settings = (await store.readAdminSettings()) as { paused: boolean; pace: number };
    assert.equal(settings.paused, true);
    assert.equal(settings.pace, 2);
    // reset for other tests / environments sharing the DB
    await store.writeSetting("paused", false, marker);
    await store.writeSetting("pace", 1, marker);
  });

  it("hands each queued injection out exactly once", async () => {
    const id = await store.enqueueInjection("rafa", `${marker} first`, marker);
    const first = (await store.takeInjection("rafa")) as { id: number; text: string } | null;
    const second = await store.takeInjection("rafa");
    assert.ok(first, "the first claim must succeed");
    assert.equal(first!.id, id);
    assert.match(first!.text, new RegExp(marker));
    assert.equal(second, null, "a claimed injection must not be handed out twice");
    await store.markInjectionTaken(id, 999_999);
    await store.cancelInjection(999_999, marker); // no-op on a taken row
  });

  it("cancels an untaken injection but not a taken one", async () => {
    const id = await store.enqueueInjection("sol", `${marker} cancel-me`, marker);
    assert.equal(await store.cancelInjection(id, marker), true);
    assert.equal(await store.cancelInjection(id, marker), false);
  });

  it("stores and layers persona overrides", async () => {
    await store.writePersonaOverride("kofi", { name: `Kofi ${marker}` }, marker);
    const overrides = (await store.readPersonaOverrides()) as Record<string, { name?: string }>;
    assert.equal(overrides.kofi?.name, `Kofi ${marker}`);
  });

  it("upserts members on email and skips rows without one", async () => {
    const batch = marker;
    const first = await store.insertMembers(
      [{ email: `m-${marker}@example.com`, name: "First" }],
      batch,
    );
    assert.equal(first.inserted, 1);
    const second = await store.insertMembers(
      [{ email: `m-${marker}@example.com`, name: "Second" }, { email: "", name: "NoMail" }],
      batch,
    );
    assert.equal(second.inserted, 1, "the existing email is updated, not duplicated");
    assert.equal(second.skipped, 1);
    const members = (await store.listMembers()) as Array<{ email: string; name: string }>;
    const row = members.find((m) => m.email === `m-${marker}@example.com`);
    assert.equal(row?.name, "Second");
  });

  it("writes to the audit log", async () => {
    await store.logAction("test.action", { marker }, marker);
    const log = (await store.readAdminLog()) as Array<{ action: string }>;
    assert.ok(log.some((row) => row.action === "test.action"));
  });
});
