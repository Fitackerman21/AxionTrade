/**
 * POST /api/auth/login — sign in with the username and password code issued at
 * registration. The code is compared exactly; the username is case-insensitive.
 */

import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/users/store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const DENIED = { error: "Wrong username or password code" };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { username?: unknown; password?: unknown }
    | null;

  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password.trim() : "";
  if (!username || !password) {
    return NextResponse.json(
      { error: "Enter your username and password code" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const user = await findUserByUsername(username);
    if (!user || user.password !== password) {
      // One message for both failures: whether a username exists is not public.
      return NextResponse.json(DENIED, { status: 401, headers: NO_STORE });
    }

    return NextResponse.json(
      {
        ok: true,
        user: {
          username: user.username,
          fullName: user.fullName,
          email: user.email,
          dateOfBirth: user.dateOfBirth,
          city: user.city,
        },
      },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: "sign-in is unavailable right now" },
      { status: 500, headers: NO_STORE },
    );
  }
}
