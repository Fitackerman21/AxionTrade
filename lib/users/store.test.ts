import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  createUser,
  DuplicateUserError,
  generatePasswordCode,
  listUsers,
  validateRegistration,
} from "./store";

const VALID = {
  fullName: "Ada Lovelace",
  username: "ada_l",
  email: "ada@example.com",
  dateOfBirth: "1990-05-01",
  city: "London",
};

let root: string;

before(() => {
  root = mkdtempSync(path.join(tmpdir(), "axion-users-"));
  process.env.USER_ROOT = root;
  delete process.env.DATABASE_URL;
});

after(() => {
  delete process.env.USER_ROOT;
  rmSync(root, { recursive: true, force: true });
});

test("password codes are three readable blocks", () => {
  const code = generatePasswordCode();
  assert.match(code, /^AXN-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(!/[01OI]/.test(code.slice(4)), "no ambiguous characters in the blocks");
  assert.notEqual(generatePasswordCode(), generatePasswordCode());
});

test("validateRegistration accepts a complete sign-up", () => {
  const result = validateRegistration(VALID);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.username, "ada_l");
});

test("validateRegistration points at each bad field", () => {
  const cases: Array<[Record<string, string>, string]> = [
    [{ ...VALID, fullName: "" }, "fullName"],
    [{ ...VALID, username: "a" }, "username"],
    [{ ...VALID, username: "has space" }, "username"],
    [{ ...VALID, email: "nope" }, "email"],
    [{ ...VALID, dateOfBirth: "not-a-date" }, "dateOfBirth"],
    [{ ...VALID, dateOfBirth: "2999-01-01" }, "dateOfBirth"],
    [{ ...VALID, city: "" }, "city"],
  ];
  for (const [input, field] of cases) {
    const result = validateRegistration(input);
    assert.equal(result.ok, false, `${field} should be rejected`);
    if (!result.ok) assert.equal(result.field, field);
  }
});

test("registration issues a unique user and a password code", async () => {
  const user = await createUser(VALID);
  assert.equal(user.username, "ada_l");
  assert.match(user.password, /^AXN-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(user.fullName, "Ada Lovelace");

  const second = await createUser({ ...VALID, username: "grace_h", email: "grace@example.com" });
  assert.notEqual(second.id, user.id);

  const listed = await listUsers();
  assert.equal(listed.length, 2);
  assert.equal(listed[0]!.username, "grace_h", "newest first");
});

test("username and email collisions are reported by field", async () => {
  await assert.rejects(
    () => createUser({ ...VALID, email: "other@example.com" }),
    (error: unknown) => error instanceof DuplicateUserError && error.field === "username",
  );
  await assert.rejects(
    () => createUser({ ...VALID, username: "someone_else" }),
    (error: unknown) => error instanceof DuplicateUserError && error.field === "email",
  );
});
