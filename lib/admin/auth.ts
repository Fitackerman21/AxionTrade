/**
 * The admin gate. One shared secret in an env var, checked by every admin route.
 *
 * The site's own auth is a sessionStorage demo flag — fine for the trading pages,
 * worthless for a dashboard that can mute personas, prune the live log and speak
 * into the room. So admin carries its own credential: `ADMIN_TOKEN`. Unset means
 * the dashboard renders read-only and every mutating route answers 503, which is
 * what a fresh checkout and the test suite want.
 */

export function adminToken(): string | null {
  const token = process.env.ADMIN_TOKEN?.trim();
  return token ? token : null;
}

/** Read-only admin: configured, or nobody has turned it on yet. */
export function adminConfigured(): boolean {
  return adminToken() !== null;
}

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Check the request against `ADMIN_TOKEN`. Accepts a bearer header or an
 * `x-admin-token` header; GETs may also pass `?token=` for manual browsing,
 * which no mutating route accepts.
 */
export function checkAdminAuth(request: Request, options: { mutation: boolean }): AdminAuthResult {
  const expected = adminToken();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: options.mutation
        ? "admin is disabled: ADMIN_TOKEN is not configured on the server"
        : "admin is read-only: ADMIN_TOKEN is not configured on the server",
    };
  }

  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const presented = bearer ?? request.headers.get("x-admin-token")?.trim() ?? null;
  if (options.mutation) {
    // A mutating route never reads the token from the URL: access logs, proxies
    // and browser history would all retain it.
    return presented === expected ? { ok: true } : { ok: false, status: 401, error: "bad admin token" };
  }

  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  return presented === expected || queryToken === expected
    ? { ok: true }
    : { ok: false, status: 401, error: "bad admin token" };
}

/** Constant-shape rejection used by every admin route. */
export function adminDenied(result: Extract<AdminAuthResult, { ok: false }>): Response {
  return new Response(JSON.stringify({ error: result.error }), {
    status: result.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Standard success JSON for admin routes: always no-store, admin data is live. */
export function adminJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
