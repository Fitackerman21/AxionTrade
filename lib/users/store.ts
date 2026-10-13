/**
 * The Axion user directory.
 *
 * Registration is server-side because recovering a lost password code is an admin
 * action: the code has to live somewhere both the sign-in screen and the dashboard
 * can read, which is a table, not a browser. `DATABASE_URL` selects Postgres — the
 * deployment case, the same database the room already runs on. Without it the
 * directory is a JSON file, which is what local development and the test suite want.
 *
 * The password code is stored in plain text on purpose: this is a demo broker, and
 * the product asks that a lost code be recoverable from the dashboard. Do not reuse
 * this store for anything real.
 */

import { randomInt } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

/** The stored shape. `password` is the generated code, shown once at registration. */
export interface UserRecord {
  id: string;
  username: string;
  fullName: string;
  email: string;
  dateOfBirth: string;
  city: string;
  password: string;
  createdAt: number;
}

/** What a registration submits, after validation. */
export interface NewUser {
  username: string;
  fullName: string;
  email: string;
  dateOfBirth: string;
  city: string;
}

/** Thrown by `createUser` when the username or email is already taken. */
export class DuplicateUserError extends Error {
  constructor(public readonly field: "username" | "email") {
    super(`${field} is already registered`);
    this.name = "DuplicateUserError";
  }
}

/* ------------------------------------------------------------------ */
/* password codes                                                      */
/* ------------------------------------------------------------------ */

/** No 0/O/1/I: the code is read off a screen and typed back in by hand. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function codeBlock(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** `AXN-4F7K-9Q2M` — three blocks, easy to read and hard to guess. */
export function generatePasswordCode(): string {
  return `AXN-${codeBlock(4)}-${codeBlock(4)}`;
}

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

export type ValidationResult =
  | { ok: true; value: NewUser }
  | { ok: false; field: string; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Validate one registration. Every rule returns the first failure with the field
 * that caused it, so the form can point at the offending input rather than showing
 * a single generic error.
 */
export function validateRegistration(input: {
  fullName?: unknown;
  username?: unknown;
  email?: unknown;
  dateOfBirth?: unknown;
  city?: unknown;
}): ValidationResult {
  const fullName = str(input.fullName);
  const username = str(input.username);
  const email = str(input.email);
  const dateOfBirth = str(input.dateOfBirth);
  const city = str(input.city);

  if (fullName.length < 2) return { ok: false, field: "fullName", error: "Enter your full name" };
  if (fullName.length > 80) return { ok: false, field: "fullName", error: "That name is too long" };
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      field: "username",
      error: "Usernames are 3–24 letters, numbers or underscores",
    };
  }
  if (!EMAIL_RE.test(email)) return { ok: false, field: "email", error: "Enter a valid email address" };
  if (email.length > 200) return { ok: false, field: "email", error: "That email is too long" };

  const born = new Date(`${dateOfBirth}T00:00:00Z`);
  if (!dateOfBirth || Number.isNaN(born.getTime())) {
    return { ok: false, field: "dateOfBirth", error: "Enter your date of birth" };
  }
  const now = Date.now();
  if (born.getTime() > now) {
    return { ok: false, field: "dateOfBirth", error: "That date is in the future" };
  }
  const age = (now - born.getTime()) / (365.25 * 86_400_000);
  if (age < 13) return { ok: false, field: "dateOfBirth", error: "You must be at least 13 to open an account" };
  if (age > 120) return { ok: false, field: "dateOfBirth", error: "Check that date of birth" };

  if (city.length < 1) return { ok: false, field: "city", error: "Enter your city of residence" };
  if (city.length > 80) return { ok: false, field: "city", error: "That city name is too long" };

  return { ok: true, value: { fullName, username, email, dateOfBirth, city } };
}

/* ------------------------------------------------------------------ */
/* Postgres                                                            */
/* ------------------------------------------------------------------ */

const SCHEMA = `
  create table if not exists axion_users (
    id            bigint generated always as identity primary key,
    username      text   not null,
    full_name     text   not null,
    email         text   not null,
    date_of_birth text   not null,
    city          text   not null,
    password_code text   not null,
    t             bigint not null
  );
  create unique index if not exists axion_users_username_key on axion_users (lower(username));
  create unique index if not exists axion_users_email_key on axion_users (lower(email));
`;

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  email: string;
  date_of_birth: string;
  city: string;
  password_code: string;
  t: string;
}

function mapRow(row: UserRow): UserRecord {
  return {
    id: String(row.id),
    username: row.username,
    fullName: row.full_name,
    email: row.email,
    dateOfBirth: row.date_of_birth,
    city: row.city,
    password: row.password_code,
    createdAt: Number(row.t),
  };
}

let pool: Pool | null = null;
let ready: Promise<void> | null = null;

function db(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new Error("users: DATABASE_URL is not set");
    const isLocal = /(^|@)(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
    pool = new Pool({
      connectionString: url,
      max: 2,
      ssl: !isLocal && !url.includes("sslmode=disable") ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

async function ensurePg(): Promise<void> {
  if (!ready) {
    const init = db().query(SCHEMA).then(() => undefined);
    ready = init.catch((error: unknown) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function conflictField(error: unknown): "username" | "email" | null {
  const e = error as { code?: string; constraint?: string };
  if (e?.code !== "23505") return null;
  if (e.constraint === "axion_users_email_key") return "email";
  if (e.constraint === "axion_users_username_key") return "username";
  return "username";
}

/* ------------------------------------------------------------------ */
/* file fallback                                                       */
/* ------------------------------------------------------------------ */

/** Serialise file writes so two concurrent registrations cannot clobber each other. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function filePath(): string {
  return process.env.USER_ROOT
    ? path.resolve(process.env.USER_ROOT, "users.json")
    : path.join(process.cwd(), "data/users/users.json");
}

async function readFileUsers(): Promise<UserRecord[]> {
  try {
    const raw = await fs.readFile(filePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as UserRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeFileUsers(users: UserRecord[]): Promise<void> {
  const file = filePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(users, null, 2)}\n`, "utf8");
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Register a user and return the record including the generated password code.
 * Throws `DuplicateUserError` when the username or email is already taken.
 */
export async function createUser(input: NewUser): Promise<UserRecord> {
  const password = generatePasswordCode();
  const t = Date.now();

  if (hasDatabase()) {
    await ensurePg();
    try {
      const { rows } = await db().query<UserRow>(
        `insert into axion_users (username, full_name, email, date_of_birth, city, password_code, t)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, username, full_name, email, date_of_birth, city, password_code, t`,
        [input.username, input.fullName, input.email, input.dateOfBirth, input.city, password, t],
      );
      return mapRow(rows[0]!);
    } catch (error) {
      const field = conflictField(error);
      if (field) throw new DuplicateUserError(field);
      throw error;
    }
  }

  return serial(async () => {
    const users = await readFileUsers();
    const lowerUser = input.username.toLowerCase();
    const lowerEmail = input.email.toLowerCase();
    if (users.some((u) => u.username.toLowerCase() === lowerUser)) throw new DuplicateUserError("username");
    if (users.some((u) => u.email.toLowerCase() === lowerEmail)) throw new DuplicateUserError("email");
    const record: UserRecord = {
      id: String(users.length + 1),
      username: input.username,
      fullName: input.fullName,
      email: input.email,
      dateOfBirth: input.dateOfBirth,
      city: input.city,
      password,
      createdAt: t,
    };
    await writeFileUsers([...users, record]);
    return record;
  });
}

/** Look a user up by username, case-insensitively. */
export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const wanted = username.trim().toLowerCase();
  if (!wanted) return null;

  if (hasDatabase()) {
    await ensurePg();
    const { rows } = await db().query<UserRow>(
      `select id, username, full_name, email, date_of_birth, city, password_code, t
       from axion_users where lower(username) = $1 limit 1`,
      [wanted],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  const users = await readFileUsers();
  return users.find((u) => u.username.toLowerCase() === wanted) ?? null;
}

/** Every registered user, newest first. */
export async function listUsers(limit = 500): Promise<UserRecord[]> {
  const capped = Math.min(500, Math.max(1, limit));

  if (hasDatabase()) {
    await ensurePg();
    const { rows } = await db().query<UserRow>(
      `select id, username, full_name, email, date_of_birth, city, password_code, t
       from axion_users order by t desc limit $1`,
      [capped],
    );
    return rows.map(mapRow);
  }

  const users = await readFileUsers();
  return [...users].sort((a, b) => b.createdAt - a.createdAt).slice(0, capped);
}
