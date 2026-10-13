/**
 * POST /api/auth/register — create an Axion account.
 *
 * There is no password field on the form: the server generates the code, returns it
 * once for the user to save, and keeps it in the directory so the dashboard can hand
 * it back if it is lost.
 */

import { NextResponse } from "next/server";

import { createUser, DuplicateUserError, validateRegistration } from "@/lib/users/store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "invalid request body" }, { status: 400, headers: NO_STORE });
  }

  const validation = validateRegistration(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, field: validation.field },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const user = await createUser(validation.value);
    return NextResponse.json(
      {
        ok: true,
        username: user.username,
        fullName: user.fullName,
        password: user.password,
      },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof DuplicateUserError) {
      return NextResponse.json(
        {
          error:
            error.field === "username"
              ? "That username is taken — try another"
              : "That email already has an account",
          field: error.field,
        },
        { status: 409, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { error: "the account could not be created right now" },
      { status: 500, headers: NO_STORE },
    );
  }
}
