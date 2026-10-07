import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseMembersCsv } from "./csv";

describe("parseMembersCsv", () => {
  it("parses the documented columns", () => {
    const csv = "name,email,bio,age,picture\nAda Lovelace,ada@example.com,first programmer,36,https://x/y.png";
    const result = parseMembersCsv(csv);
    assert.equal(result.errors.length, 0);
    assert.equal(result.members.length, 1);
    assert.deepEqual(result.members[0], {
      name: "Ada Lovelace",
      email: "ada@example.com",
      bio: "first programmer",
      age: 36,
      picture: "https://x/y.png",
    });
  });

  it("accepts the aliased headers a spreadsheet exports", () => {
    const result = parseMembersCsv("Full Name,Mail,About,Age,Avatar\nG Hopper,grace@example.com,,45,");
    assert.equal(result.members.length, 1);
    assert.equal(result.members[0]!.email, "grace@example.com");
    assert.equal(result.members[0]!.name, "G Hopper");
    assert.equal(result.members[0]!.age, 45);
  });

  it("handles quoted fields containing commas and escaped quotes", () => {
    const csv = 'name,email,bio\n"Doe, Jane",jane@example.com,"said ""hi"" once"';
    const result = parseMembersCsv(csv);
    assert.equal(result.members[0]!.name, "Doe, Jane");
    assert.equal(result.members[0]!.bio, 'said "hi" once');
  });

  it("tolerates CRLF and a BOM", () => {
    const csv = "\uFEFFname,email\r\nR Mera,rem@example.com\r\n";
    const result = parseMembersCsv(csv);
    assert.equal(result.members.length, 1);
  });

  it("rejects rows with a bad email and keeps going", () => {
    const csv = "name,email\nGood,good@example.com\nBad,not-an-email\nAlso Good,ok@example.com";
    const result = parseMembersCsv(csv);
    assert.equal(result.members.length, 2);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0]!.reason, /not a usable email/);
  });

  it("rejects rows missing a name", () => {
    const csv = "name,email\n,nope@example.com";
    const result = parseMembersCsv(csv);
    assert.equal(result.members.length, 0);
    assert.match(result.errors[0]!.reason, /missing name/);
  });

  it("rejects ages outside 13-120", () => {
    const csv = "name,email,age\nKid,kid@example.com,9";
    const result = parseMembersCsv(csv);
    assert.equal(result.members.length, 0);
    assert.match(result.errors[0]!.reason, /between 13 and 120/);
  });

  it("fails loudly when there is no email column", () => {
    const result = parseMembersCsv("name,phone\nA,123");
    assert.equal(result.members.length, 0);
    assert.match(result.errors[0]!.reason, /no email column/);
  });

  it("normalises the email to lower case", () => {
    const result = parseMembersCsv("name,email\nA,UPPER@Example.COM");
    assert.equal(result.members[0]!.email, "upper@example.com");
  });
});
