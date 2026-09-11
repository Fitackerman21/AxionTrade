"use client";

import { useEffect, useState } from "react";

const KEY = "axion_demo_auth";

export function isAuthed(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(KEY) === "1";
}

export function signIn() {
  window.sessionStorage.setItem(KEY, "1");
}

export function signOut() {
  window.sessionStorage.removeItem(KEY);
}

/**
 * Demo-session gate. Returns null until the first client render has
 * checked sessionStorage (SSR-safe), then true/false.
 */
export function useRequireAuth(): boolean | null {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    setAuthed(isAuthed());
  }, []);
  return authed;
}
