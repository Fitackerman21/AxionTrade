import assert from "node:assert/strict";
import { test } from "node:test";

import { respondersFor } from "./permissions";
import { TEST_CONFIG, TEST_PERSONAS } from "./test-utils";
import type { ForumConfig, PersonaId } from "./types";

const roster = TEST_PERSONAS;

function withAllow(allow: Record<string, PersonaId[]>, deny: Record<string, PersonaId[]> = {}) {
  return {
    ...TEST_CONFIG,
    permissions: { ...TEST_CONFIG.permissions, allow, deny },
  } satisfies ForumConfig;
}

test("returns the personas the matrix permits to reply", () => {
  assert.deepEqual(respondersFor("jev", TEST_CONFIG, roster).direct, ["mara", "dmitri", "sol"]);
});

test("deny always beats allow", () => {
  const config = { ...TEST_CONFIG, permissions: { ...TEST_CONFIG.permissions, deny: { jev: ["sol"] } } };
  assert.deepEqual(respondersFor("jev", config, roster).direct, ["mara", "dmitri"]);
});

test("deny also blocks a widened responder", () => {
  // Drop only jev's own allow entry, so widening has to fall back to whoever
  // lists jev as a companion: mara and sol. Denying sol removes it there too.
  const allow = { ...TEST_CONFIG.permissions.allow };
  delete allow.jev;

  const open = withAllow(allow);
  assert.deepEqual(respondersFor("jev", open, roster).direct, []);
  assert.deepEqual(respondersFor("jev", open, roster).widened, ["mara", "sol"]);

  const denied = withAllow(allow, { jev: ["sol"] });
  assert.deepEqual(respondersFor("jev", denied, roster).widened, ["mara"]);
});

test("a persona never answers itself unless allowSelfReply is set", () => {
  const config = withAllow({ mara: ["mara", "jev"] });
  assert.deepEqual(respondersFor("mara", config, roster).direct, ["jev"]);

  const permissive = {
    ...config,
    permissions: { ...config.permissions, allowSelfReply: true },
  };
  assert.deepEqual(respondersFor("mara", permissive, roster).direct, ["mara", "jev"]);
});

test("ids that are not on the roster are ignored", () => {
  const config = withAllow({ jev: ["mara", "ghost"] });
  assert.deepEqual(respondersFor("jev", config, roster).direct, ["mara"]);
});

test("an unknown sender has no permitted responder", () => {
  assert.deepEqual(respondersFor("stranger", TEST_CONFIG, roster).direct, []);
  assert.deepEqual(respondersFor("stranger", TEST_CONFIG, roster).widened, []);
});

test("widening adds personas that list the sender as a companion", () => {
  // allow.dmitri = [mara, sol]; both mara and jev list dmitri in their own lists.
  const { direct, widened } = respondersFor("dmitri", TEST_CONFIG, roster);
  assert.deepEqual(direct, ["mara", "sol"]);
  assert.deepEqual(widened, ["mara", "sol", "jev"]);
});

test("widening never duplicates a direct responder", () => {
  const { widened } = respondersFor("mara", TEST_CONFIG, roster);
  assert.equal(new Set(widened).size, widened.length);
});
