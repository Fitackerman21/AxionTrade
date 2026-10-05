/**
 * The Postgres store, against a real server.
 *
 * Skipped unless `TEST_DATABASE_URL` is set, so the default suite stays hermetic
 * and needs no database. To run it:
 *
 *   docker run -d --name forum-pg -e POSTGRES_PASSWORD=forum -e POSTGRES_USER=forum \
 *     -e POSTGRES_DB=forum -p 5432:5432 postgres:16-alpine
 *   TEST_DATABASE_URL=postgres://forum:forum@127.0.0.1:5432/forum npm test
 */

import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { Pool } from "pg";

import { PgStore } from "./pg-store";
import { openForumStore } from "./store";
import { makeTurn, TEST_BASE, TEST_TOPICS } from "./test-utils";

const URL = process.env.TEST_DATABASE_URL;
/** No server named: skip these rather than failing the suite. */
const skip = URL ? false : "needs TEST_DATABASE_URL";

const store = URL ? new PgStore({ connectionString: URL, maxConnections: 4 }) : null;
const admin = URL ? new Pool({ connectionString: URL, max: 1 }) : null;

beforeEach(async () => {
  if (!store || !admin) return;
  // Ensure the schema exists before truncating; then give every test a clean room.
  await store.readLastTurn();
  await admin.query("truncate forum_turns, forum_lease, forum_heartbeat");
});

after(async () => {
  await store?.end();
  await admin?.end();
});

test("the room definition ships with the build, not the filesystem", { skip }, async () => {
  const [config, personas, topics, world] = await Promise.all([
    store!.readConfig(),
    store!.readPersonas(),
    store!.readTopics(),
    store!.readWorld(),
  ]);

  assert.equal(config.roomId, "axion-forum");
  assert.ok(config.agenda.enginePersona.length > 0);
  assert.ok(personas.length >= 8, "the roster should be the shipped one");
  assert.ok(topics.length >= 4, "the topic deck should be the shipped one");
  assert.match(world.version, /#/, "the world version carries a content hash");
});

test("turns append, stay ordered, and the newest N returns in log order", { skip }, async () => {
  for (let seq = 1; seq <= 3; seq += 1) {
    await store!.appendTurn(makeTurn(seq, { sender: "jev" }));
  }

  assert.deepEqual(
    (await store!.readTurns()).map((turn) => turn.seq),
    [1, 2, 3],
  );
  assert.deepEqual(
    (await store!.readTurns(2)).map((turn) => turn.seq),
    [2, 3],
  );
  assert.equal((await store!.readLastTurn())?.seq, 3);
});

test("a duplicate seq is refused, so the log cannot fork", { skip }, async () => {
  await store!.appendTurn(makeTurn(1, { sender: "jev" }));
  await assert.rejects(
    () => store!.appendTurn(makeTurn(1, { sender: "mara" })),
    /already in the log/,
  );
  assert.equal((await store!.readTurns()).length, 1);
});

test("a human message claims the next seq and is recorded as a person", { skip }, async () => {
  await store!.appendTurn(makeTurn(1, { sender: "jev" }));

  const record = await store!.appendHumanMessage({
    text: "what is the read on gold?",
    sender: "human",
    t: TEST_BASE + 5_000,
    topicId: TEST_TOPICS[0].id,
  });

  assert.equal(record.seq, 2);
  assert.equal(record.message?.sender, "human");
  assert.equal(record.message?.text, "what is the read on gold?");
  assert.equal(record.note, "human input");
});

test("two people posting at once both land", { skip }, async () => {
  const args = (n: number) => ({
    text: `question ${n}`,
    sender: "human",
    t: TEST_BASE + n,
    topicId: TEST_TOPICS[0].id,
  });

  const [first, second] = await Promise.all([
    store!.appendHumanMessage(args(1)),
    store!.appendHumanMessage(args(2)),
  ]);

  assert.deepEqual(
    [first.seq, second.seq].sort((a, b) => a - b),
    [1, 2],
  );
  assert.equal((await store!.readTurns()).length, 2);
});

test("the lease is a compare-and-swap: reclaimable only once expired", { skip }, async () => {
  const now = TEST_BASE;

  assert.equal(await store!.acquireLease("a:1", 30_000, now), true);
  assert.equal(await store!.acquireLease("b:2", 30_000, now), false);
  assert.deepEqual(await store!.readLease(), { owner: "a:1", expiresAt: now + 30_000 });

  // Inside the TTL nobody may take it, not even the sitting owner.
  assert.equal(await store!.acquireLease("b:2", 30_000, now + 29_999), false);
  // Past the TTL it is reclaimable, which is how a crashed driver is recovered.
  assert.equal(await store!.acquireLease("b:2", 30_000, now + 30_001), true);
  assert.equal((await store!.readLease())?.owner, "b:2");

  // Only the holder may release.
  await store!.releaseLease("a:1");
  assert.equal((await store!.readLease())?.owner, "b:2");
  await store!.releaseLease("b:2");
  assert.equal(await store!.readLease(), null);
});

test("racing drivers cannot both win the lease", { skip }, async () => {
  const now = TEST_BASE;
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) => store!.acquireLease(`owner:${i}`, 30_000, now)),
  );
  assert.equal(results.filter(Boolean).length, 1, "exactly one driver should hold the lease");
});

test("the heartbeat is written, read, and cleared only by its owner", { skip }, async () => {
  await store!.writeHeartbeat({ owner: "worker:1", expiresAt: TEST_BASE + 60_000 });
  assert.deepEqual(await store!.readHeartbeat(), {
    owner: "worker:1",
    expiresAt: TEST_BASE + 60_000,
  });

  await store!.clearHeartbeat("worker:2");
  assert.ok(await store!.readHeartbeat(), "a different owner must not clear it");

  await store!.clearHeartbeat("worker:1");
  assert.equal(await store!.readHeartbeat(), null);
});

test("DATABASE_URL selects the Postgres store", { skip }, async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = URL;
  try {
    const opened = openForumStore("/does/not/exist");
    assert.ok(opened instanceof PgStore, `expected a PgStore, got ${opened.constructor.name}`);
    await (opened as PgStore).end();
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
