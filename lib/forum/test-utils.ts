/**
 * Test fixtures. Hermetic on purpose: each test writes its own small room into a
 * temp directory so nothing depends on data/forum or on a previous test.
 *
 * data/forum itself is covered separately, by data.test.ts.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FileStore } from "./store";
import type { ForumConfig, Persona, Side, Topic, TurnRecord, WorldState } from "./types";

export const TEST_PERSONAS: Persona[] = [
  {
    id: "jev",
    name: "Jev",
    role: "AxAI engine",
    g1: "#2e90fa",
    g2: "#00c896",
    color: "#9fc6ff",
    online: true,
    bot: true,
    sheet: {
      stance: "systematic, no opinion without a number",
      register: { minChars: 80, maxChars: 320, note: "session reports" },
      quirks: ["reports conviction percentages"],
      sampleLines: [
        "Session update: 6 fills, book net long, aggregate conviction 68%.",
        "Levels are public in the terminal for a reason.",
        "Path matters more than target.",
      ],
    },
  },
  {
    id: "mara",
    name: "Mara Okafor",
    role: "Swing trader",
    g1: "#f6465d",
    g2: "#f97316",
    color: "#fda4af",
    online: true,
    sheet: {
      stance: "patient, long gold, allergic to being outperformed by code",
      register: { minChars: 40, maxChars: 240, note: "warm, emoji-heavy" },
      quirks: ["calls it the patience trade"],
      sampleLines: ["It's been coiling all week.", "Small size, clean win.", "Refuse. 😤"],
    },
  },
  {
    id: "dmitri",
    name: "Dmitri V.",
    role: "Macro",
    g1: "#8b5cf6",
    g2: "#6366f1",
    color: "#c4b5fd",
    online: false,
    sheet: {
      stance: "rates explain everything; single names are noise",
      register: { minChars: 60, maxChars: 300, note: "flat declaratives" },
      quirks: ["calls other topics noise"],
      sampleLines: [
        "Bund spread widening again.",
        "Everything else is noise around it.",
        "US session will be the decider.",
      ],
    },
  },
  {
    id: "sol",
    name: "Solene",
    role: "Crypto degen",
    g1: "#00c896",
    g2: "#14b8a6",
    color: "#5eead4",
    online: true,
    sheet: {
      stance: "long crypto, impatient with macro tourists",
      register: { minChars: 30, maxChars: 220, note: "lowercase, emoji" },
      quirks: ["buys dips with her whole face"],
      sampleLines: ["grinding up 2% while everyone asleep", "cool story", "simply built different"],
    },
  },
];

export const TEST_TOPICS: Topic[] = [
  {
    id: "gold-coiling",
    title: "gold coiling into the dollar's next move",
    sides: {
      a: "the range breaks up and the metals complex runs",
      b: "flows are already leaving and the range breaks down",
    },
    friction: { a: "flows lag price, they always have", b: "a breakout without flows is a longer wick" },
  },
  {
    id: "semis-drawdown",
    title: "semis after the earnings spillover",
    sides: { a: "the drawdown is a gift", b: "leadership has rolled over" },
    friction: { a: "you are short the only growth story", b: "you are buying a rolled-over chart" },
  },
];

export const TEST_WORLD: WorldState = {
  version: "test#1",
  digest: "Risk-off day, semis leading the drawdown.",
  highlights: [
    { text: "Session update: 6 fills, book net long, conviction 68%.", topicId: "semis-drawdown", side: "a" },
    { text: "Fill logged: LONG XAU at 2,391.4, conviction 74%.", topicId: "gold-coiling", side: "a" },
  ],
};

export const TEST_CONFIG: ForumConfig = {
  roomId: "test-room",
  permissions: {
    allow: {
      human: ["jev", "mara"],
      jev: ["mara", "dmitri", "sol"],
      mara: ["jev", "dmitri"],
      dmitri: ["mara", "sol"],
      sol: ["mara", "jev"],
    },
    deny: {},
    allowSelfReply: false,
  },
  scheduling: {
    minTurnsBetweenPosts: 2,
    maxConsecutivePosts: 1,
    gapSec: [45, 180],
    worldEventEveryTurns: 5,
    frictionStreakTurns: 3,
    topicRotationTurns: 12,
  },
  agenda: {
    enginePersona: "jev",
    stageDirections: ["Nothing on the desk covers that yet."],
  },
  runtime: {
    catchUpMaxTurns: 12,
    staleAfterMin: 90,
    heartbeatTtlSec: 60,
  },
};

/** A fixed wall clock for the tests, so gaps and staleness are exact. */
export const TEST_BASE = 1_800_000_000_000;

/** Just after any seeded turn, but nowhere near the staleness threshold. */
export const TEST_NOW = TEST_BASE + 60_000;

export interface Fixture {
  store: FileStore;
  root: string;
  cleanup(): Promise<void>;
}

export interface FixtureOverrides {
  config?: ForumConfig;
  personas?: Persona[];
  topics?: Topic[];
  world?: WorldState;
}

export async function createFixture(overrides: FixtureOverrides = {}): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "forum-test-"));

  await mkdir(path.join(root, "topics"), { recursive: true });
  await mkdir(path.join(root, "world"), { recursive: true });

  const write = async (relative: string, value: unknown): Promise<void> => {
    await writeFile(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  };

  await write("config.json", overrides.config ?? TEST_CONFIG);
  await write("personas.json", overrides.personas ?? TEST_PERSONAS);
  await write("topics/deck.json", overrides.topics ?? TEST_TOPICS);
  await write("world/latest.json", overrides.world ?? TEST_WORLD);

  return {
    store: new FileStore(root),
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Real fixtures from data/forum, for the tests that check the shipped data. */
export function dataStore(): FileStore {
  return new FileStore(path.join(process.cwd(), "data", "forum"));
}

/** Build a log entry for the pure agenda/schedule tests. */
export function makeTurn(
  seq: number,
  spec: {
    sender: string;
    text?: string;
    topicId?: string;
    side?: Side;
    recipient?: string;
    /** false produces a hand-off turn with no message */
    withMessage?: boolean;
  },
): TurnRecord {
  const topicId = spec.topicId ?? TEST_TOPICS[0].id;
  const side = spec.side ?? "a";
  const t = TEST_BASE + seq * 1000;

  return {
    seq,
    t,
    driver: "test",
    trigger: "THREAD",
    event: { kind: "THREAD", reason: "test", sender: spec.sender, topicId, side },
    candidates: [],
    ordered: [],
    chosen: spec.sender,
    escalated: null,
    decision: "APPROVE",
    attempts: [],
    message:
      spec.withMessage === false
        ? null
        : {
            id: `m_${seq}`,
            seq,
            t,
            sender: spec.sender,
            primaryRecipient: spec.recipient ?? "room",
            mentions: [],
            text: spec.text ?? `line ${seq}`,
            topicId,
            side,
            system: false,
          },
    memoryWrites: [],
    worldVersion: TEST_WORLD.version,
    note: null,
    durationMs: 0,
  };
}
