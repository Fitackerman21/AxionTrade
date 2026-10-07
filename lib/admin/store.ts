/**
 * The admin half of the forum's state (nothing above `app/api/admin` imports this).
 *
 * Everything here lives in the **same Postgres** the forum already uses, in tables
 * the admin layer owns: the runtime never writes them, it only *reads* the two it
 * needs (`forum_admin_settings` for room behaviour, `forum_persona_overrides` for
 * how a persona is displayed). That split is what lets the dashboard change room
 * behaviour on a live deployment without a redeploy — and what keeps a broken
 * dashboard unable to corrupt the turn log: the only writes into forum-owned
 * tables from here go through the store's own methods.
 */

import { Pool } from "pg";

import type { PersonaId } from "@/lib/forum/types";

const SCHEMA = `
  create table if not exists forum_admin_settings (
    key        text   primary key,
    value      jsonb  not null,
    updated_by text   not null,
    updated_at bigint not null
  );
  create table if not exists forum_admin_log (
    id     bigint generated always as identity primary key,
    action text   not null,
    detail jsonb  not null,
    actor  text   not null,
    t      bigint not null
  );
  create table if not exists forum_persona_overrides (
    persona    text   primary key,
    display    jsonb  not null,
    updated_at bigint not null
  );
  create table if not exists forum_members (
    email    text   primary key,
    name     text   not null,
    bio      text,
    age      int,
    picture  text,
    batch    text,
    t        bigint not null
  );
  -- A message an admin wrote to be posted *as* a persona. Taken exactly once by
  -- the room's own turn loop, which is what makes the room (and every other
  -- persona) read it as that persona speaking — not as an admin announcement.
  create table if not exists forum_injections (
    id        bigint generated always as identity primary key,
    persona   text   not null,
    text      text   not null,
    taken_seq bigint,
    t         bigint not null
  );
`;

/** The keys the settings table is allowed to hold; anything else is rejected. */
export const SETTING_KEYS = ["paused", "muted", "pace"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export interface AdminSettings {
  paused: boolean;
  muted: PersonaId[];
  /** multiplies every gap in the room's cadence; 1 = as configured */
  pace: number;
}

export const DEFAULT_SETTINGS: AdminSettings = { paused: false, muted: [], pace: 1 };

export interface AdminLogRow {
  id: number;
  action: string;
  detail: Record<string, unknown>;
  actor: string;
  t: number;
}

export interface PersonaDisplayOverride {
  name?: string;
  role?: string;
  bio?: string;
  age?: number | null;
  picture?: string | null;
  g1?: string;
  g2?: string;
  color?: string;
  online?: boolean;
}

export interface MemberRow {
  email: string;
  name: string;
  bio?: string | null;
  age?: number | null;
  picture?: string | null;
  batch?: string | null;
  t: number;
}

export interface InjectionRow {
  id: number;
  persona: string;
  text: string;
  takenSeq: number | null;
  t: number;
}

let pool: Pool | null = null;
let ready: Promise<void> | null = null;

/** One pool per serverless instance, created on first admin call. */
function db(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new Error("admin: DATABASE_URL is not set — the admin layer is Postgres-only");
    const isLocal = /(^|@)(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
    pool = new Pool({
      connectionString: url,
      max: 2,
      ssl: !isLocal && !url.includes("sslmode=disable") ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

async function ensure(): Promise<void> {
  if (!ready) {
    const init = db().query(SCHEMA).then(() => undefined);
    ready = init.catch((error: unknown) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

export async function readAdminSettings(): Promise<AdminSettings> {
  await ensure();
  const { rows } = await db().query<{ key: string; value: unknown }>(
    "select key, value from forum_admin_settings",
  );
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const muted = byKey.get("muted");
  return {
    paused: byKey.get("paused") === true,
    muted: Array.isArray(muted) ? (muted as string[]) : [],
    pace: typeof byKey.get("pace") === "number" ? (byKey.get("pace") as number) : 1,
  };
}

export async function writeSetting(
  key: SettingKey,
  value: unknown,
  actor: string,
): Promise<void> {
  await ensure();
  await db().query(
    `insert into forum_admin_settings (key, value, updated_by, updated_at)
     values ($1, $2, $3, $4)
     on conflict (key) do update set value = $2, updated_by = $3, updated_at = $4`,
    [key, JSON.stringify(value), actor, Date.now()],
  );
}

// ---------------------------------------------------------------------------
// audit log
// ---------------------------------------------------------------------------

export async function logAction(
  action: string,
  detail: Record<string, unknown>,
  actor: string,
): Promise<void> {
  await ensure();
  await db().query(
    "insert into forum_admin_log (action, detail, actor, t) values ($1, $2, $3, $4)",
    [action, JSON.stringify(detail), actor, Date.now()],
  );
}

export async function readAdminLog(limit = 50): Promise<AdminLogRow[]> {
  await ensure();
  const { rows } = await db().query<{ id: string; action: string; detail: unknown; actor: string; t: string }>(
    "select id, action, detail, actor, t from forum_admin_log order by id desc limit $1",
    [Math.min(200, Math.max(1, limit))],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    action: row.action,
    detail: (row.detail ?? {}) as Record<string, unknown>,
    actor: row.actor,
    t: Number(row.t),
  }));
}

// ---------------------------------------------------------------------------
// persona display overrides
// ---------------------------------------------------------------------------

export async function readPersonaOverrides(): Promise<Record<string, PersonaDisplayOverride>> {
  await ensure();
  const { rows } = await db().query<{ persona: string; display: unknown }>(
    "select persona, display from forum_persona_overrides",
  );
  return Object.fromEntries(
    rows.map((row) => [row.persona, row.display as PersonaDisplayOverride]),
  );
}

export async function writePersonaOverride(
  persona: string,
  display: PersonaDisplayOverride,
  actor: string,
): Promise<void> {
  await ensure();
  await db().query(
    `insert into forum_persona_overrides (persona, display, updated_at)
     values ($1, $2, $3)
     on conflict (persona) do update set display = $2, updated_at = $3`,
    [persona, JSON.stringify(display), Date.now()],
  );
  await logAction("persona.update", { persona, display }, actor);
}

// ---------------------------------------------------------------------------
// member roster (CSV import)
// ---------------------------------------------------------------------------

export async function insertMembers(
  rows: Array<Omit<MemberRow, "t">>,
  batch: string,
): Promise<{ inserted: number; skipped: number }> {
  await ensure();
  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    // Email is the key, so a row without one has nothing to be upserted on.
    if (!row.email) {
      skipped += 1;
      continue;
    }
    const result = await db().query(
      `insert into forum_members (email, name, bio, age, picture, batch, t)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (email) do update set name = $2, bio = $3, age = $4, picture = $5, batch = $6`,
      [row.email, row.name, row.bio ?? null, row.age ?? null, row.picture ?? null, batch, Date.now()],
    );
    inserted += result.rowCount ?? 0;
  }
  await logAction("members.import", { batch, inserted, skipped }, "admin");
  return { inserted, skipped };
}

export async function listMembers(limit = 200): Promise<MemberRow[]> {
  await ensure();
  const { rows } = await db().query<{
    email: string; name: string; bio: string | null; age: number | null; picture: string | null; batch: string | null; t: string;
  }>("select email, name, bio, age, picture, batch, t from forum_members order by t desc limit $1", [
    Math.min(500, Math.max(1, limit)),
  ]);
  return rows.map((row) => ({
    email: row.email,
    name: row.name,
    bio: row.bio,
    age: row.age,
    picture: row.picture,
    batch: row.batch,
    t: Number(row.t),
  }));
}

// ---------------------------------------------------------------------------
// speak-as injections
// ---------------------------------------------------------------------------

export async function enqueueInjection(
  persona: string,
  text: string,
  actor: string,
): Promise<number> {
  await ensure();
  const { rows } = await db().query<{ id: string }>(
    "insert into forum_injections (persona, text, t) values ($1, $2, $3) returning id",
    [persona, text, Date.now()],
  );
  await logAction("speak.enqueue", { persona, chars: text.length }, actor);
  return Number(rows[0].id);
}

export async function listInjections(limit = 20): Promise<InjectionRow[]> {
  await ensure();
  const { rows } = await db().query<{ id: string; persona: string; text: string; taken_seq: number | null; t: string }>(
    "select id, persona, text, taken_seq, t from forum_injections order by id desc limit $1",
    [Math.min(100, Math.max(1, limit))],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    persona: row.persona,
    text: row.text,
    takenSeq: row.taken_seq === null ? null : Number(row.taken_seq),
    t: Number(row.t),
  }));
}

/**
 * Claim the oldest untaken injection for a persona the room is about to write as.
 * The conditional update is the once-only guarantee: two concurrent turns cannot
 * both take row 7, because the second `update` matches nothing.
 */
export async function takeInjection(persona: string): Promise<{ id: number; text: string } | null> {
  await ensure();
  const { rows } = await db().query<{ id: string; text: string }>(
    `update forum_injections set taken_seq = -1
     where id = (select id from forum_injections where taken_seq is null and persona = $1 order by id limit 1 for update skip locked)
     returning id, text`,
    [persona],
  );
  if (rows.length === 0) return null;
  return { id: Number(rows[0].id), text: rows[0].text };
}

/** Stamp the seq the injection was published at, for the audit trail. */
export async function markInjectionTaken(id: number, seq: number): Promise<void> {
  await ensure();
  await db().query("update forum_injections set taken_seq = $1 where id = $2 and taken_seq = -1", [seq, id]);
}

/** Drop an untaken injection (a typo caught before the room spoke). */
export async function cancelInjection(id: number, actor: string): Promise<boolean> {
  await ensure();
  const result = await db().query("delete from forum_injections where id = $1 and taken_seq is null", [id]);
  const removed = (result.rowCount ?? 0) > 0;
  if (removed) await logAction("speak.cancel", { id }, actor);
  return removed;
}
