/**
 * The register module: the per-turn length tiers and the thumb-typography rule.
 *
 * Both are shared contracts — the Voice prompt and the Gate's checks read the same
 * functions — so the properties worth pinning are the ones that make the room sound
 * like people: every tier is reachable, no tier is empty, and the ceiling always
 * comes from the character sheet.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { lengthFault, lengthTarget, TEXTING_RULE, typographyFault } from "./register";
import { dataStore, TEST_PERSONAS } from "./test-utils";
import type { Persona } from "./types";

const PERSONA: Persona = TEST_PERSONAS.find((p) => p.id === "mara")!;

test("every tier is reachable, and no turn collapses into one length", () => {
  const tiers = new Set<string>();
  for (let seq = 1; seq <= 60; seq += 1) tiers.add(lengthTarget(PERSONA, seq).tier);

  assert.deepEqual(
    [...tiers].sort(),
    ["beat", "full", "normal", "short"],
    "all four tiers must actually be used by a run of turns",
  );

  // The tell this replaced was every message landing in one narrow band, so the
  // tiers must genuinely differ. Two of them differ in their *floor* rather than
  // their ceiling, because a persona's own band caps the ceiling of every tier.
  const windows = new Map<string, [number, number]>();
  for (let seq = 1; seq <= 60; seq += 1) {
    const target = lengthTarget(PERSONA, seq);
    windows.set(target.tier, [target.min, target.max]);
  }
  const [beatMin, beatMax] = windows.get("beat")!;
  const [shortMin, shortMax] = windows.get("short")!;
  const [normalMin, normalMax] = windows.get("normal")!;
  const [fullMin] = windows.get("full")!;

  assert.ok(beatMax < shortMax, "a beat must be shorter than a quick message");
  assert.ok(shortMax < normalMax, "a quick message must be shorter than an ordinary one");
  assert.ok(beatMin < shortMin && shortMin < normalMin, "the floors must step up too");
  assert.ok(fullMin > normalMin, "a long turn must ask for more than an ordinary one");
  assert.ok(beatMax < fullMin, "a beat can never satisfy a long turn");
});

test("a tier's window is never empty, and the sheet caps it", () => {
  const narrow: Persona = {
    ...PERSONA,
    sheet: { ...PERSONA.sheet, register: { minChars: 10, maxChars: 12, note: "terse" } },
  };
  const tiny: Persona = {
    ...PERSONA,
    sheet: { ...PERSONA.sheet, register: { minChars: 1, maxChars: 1, note: "one char" } },
  };

  for (const persona of [PERSONA, narrow, tiny]) {
    for (let seq = 1; seq <= 30; seq += 1) {
      const target = lengthTarget(persona, seq);
      assert.ok(
        target.min >= 1 && target.min <= target.max,
        `${persona.id} seq ${seq}: empty ${target.tier} window (${target.min}-${target.max})`,
      );
      assert.ok(
        target.max <= Math.max(16, persona.sheet.register.maxChars),
        `${persona.id} seq ${seq}: ${target.tier} outran the character's ceiling`,
      );
    }
  }
});

test("the length check allows a margin, because a model cannot count characters", () => {
  const seq = Array.from({ length: 60 }, (_, i) => i + 1).find(
    (n) => lengthTarget(PERSONA, n).tier === "normal",
  )!;
  const target = lengthTarget(PERSONA, seq);

  // A handful of characters short is not a judgement about the message.
  assert.equal(lengthFault("x".repeat(target.min - 3), PERSONA, seq), "");
  assert.equal(lengthFault("x".repeat(target.max + 3), PERSONA, seq), "");

  // Half the floor, or double the ceiling, is still a failure — the rule has teeth.
  assert.match(lengthFault("x".repeat(Math.floor(target.min / 2)), PERSONA, seq), /under the normal target/);
  assert.match(lengthFault("x".repeat(target.max * 2), PERSONA, seq), /over the normal target/);

  // And a beat can never satisfy a turn that asked for a paragraph.
  const fullSeq = Array.from({ length: 60 }, (_, i) => i + 1).find(
    (n) => lengthTarget(PERSONA, n).tier === "full",
  )!;
  assert.match(lengthFault("nah", PERSONA, fullSeq), /under the full target/);
});

test("keyboard punctuation is what a thumb never types", () => {
  assert.match(typographyFault("gold coiling — the range breaks up"), /em\/en dash/);
  assert.match(typographyFault("flows lag – price is what is left"), /em\/en dash/);
  assert.match(typographyFault("flows lag; price is what is left"), /semicolon/);
  assert.match(typographyFault("gold coiling… maybe"), /ellipsis/);
  assert.match(typographyFault("- gold up\n- semis down"), /bulleted/);

  assert.equal(typographyFault("gold coiling above 2400 and I am not touching it"), "");
  assert.equal(typographyFault("nah"), "");
  assert.equal(typographyFault("ok that's it for me today, good luck"), "");

  // The rule the model is given and the check it is judged by are the same rule.
  assert.match(TEXTING_RULE, /no em dashes or en dashes/);
  assert.match(TEXTING_RULE, /no semicolons/);
  assert.match(TEXTING_RULE, /no ellipsis character/);
});

test("the shipped room is typed by thumbs, not by a keyboard", async () => {
  const personas = await dataStore().readPersonas();

  for (const persona of personas) {
    for (const line of persona.sheet.sampleLines) {
      assert.equal(
        typographyFault(line),
        "",
        `${persona.id}'s sample line teaches keyboard punctuation: "${line}"`,
      );
    }
    for (const field of ["stance", "personality", "banter", "quirks"] as const) {
      const values = field === "stance" ? [persona.sheet.stance] : (persona.sheet[field] ?? []);
      for (const value of values) {
        assert.equal(
          typographyFault(value),
          "",
          `${persona.id}.${field} carries keyboard punctuation: "${value}"`,
        );
      }
    }
  }
});
