"use client";

/**
 * Client-side admin plumbing shared by the dashboard pages.
 *
 * Kept out of the layout file deliberately: Next's layout is a routing file, and
 * importing helpers from it works until the import specifier (`./layout` vs
 * `../layout`) means a different file from each page depth.
 */

const STORAGE_KEY = "axion_admin_token";

export function readAdminToken(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(STORAGE_KEY) ?? "";
}

export function saveAdminToken(token: string) {
  window.sessionStorage.setItem(STORAGE_KEY, token.trim());
}

/** Fetch with the admin token attached; JSON in, JSON out, errors surfaced. */
export async function adminFetch(
  path: string,
  init: RequestInit & { mutation?: boolean } = {},
): Promise<unknown> {
  const { mutation = init.method !== undefined && init.method !== "GET", ...rest } = init;
  const token = readAdminToken();
  const headers = new Headers(rest.headers);
  if (!headers.has("content-type") && !(rest.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  headers.set("x-admin-token", token);

  const separator = path.includes("?") ? "&" : "?";
  const url = mutation ? path : `${path}${separator}token=${encodeURIComponent(token)}`;
  const response = await fetch(url, { ...rest, headers, cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(body.error ?? `request failed (${response.status})`));
  }
  return body;
}
