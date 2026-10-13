"use client";

/**
 * The browser's half of the account session.
 *
 * The demo auth flag in `lib/demo-auth` records *that* someone is signed in; this
 * records *who* they are, so the workspace can show their own name instead of a
 * hardcoded one. The server remains the source of truth — the profile written here
 * is only what a successful login returned.
 */

import { useEffect, useState } from "react";

/** The profile the workspace shows. Never carries the password code. */
export interface SessionUser {
  username: string;
  fullName: string;
  email: string;
  dateOfBirth: string;
  city: string;
}

const KEY = "axion_user_v1";

export function readUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionUser>;
    if (typeof parsed.username !== "string" || typeof parsed.fullName !== "string") return null;
    return {
      username: parsed.username,
      fullName: parsed.fullName,
      email: typeof parsed.email === "string" ? parsed.email : "",
      dateOfBirth: typeof parsed.dateOfBirth === "string" ? parsed.dateOfBirth : "",
      city: typeof parsed.city === "string" ? parsed.city : "",
    };
  } catch {
    return null;
  }
}

export function saveUser(user: SessionUser): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(user));
}

export function clearUser(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

/**
 * The signed-in user, SSR-safe. Returns `null` until the first client render has
 * read storage, so a server-rendered page and its first client render agree.
 */
export function useUser(): { user: SessionUser | null; ready: boolean } {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUser(readUser());
    setReady(true);
  }, []);

  return { user, ready };
}

/** Two-letter monogram for the header avatar. */
export function initialsOf(user: SessionUser | null): string {
  const source = user?.fullName?.trim() || user?.username?.trim() || "";
  if (!source) return "AX";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}
