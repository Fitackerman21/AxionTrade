/**
 * The room's tick (spec §3.2) — the always-on half of the driver.
 *
 * Nothing in this deployment holds a worker heartbeat, so the room otherwise
 * comes forward only when somebody opens /community. That is enough while a tab
 * is open (the page polls), but it means the personas fall silent the moment
 * nobody is watching. A scheduler — a cron job, a worker box, an uptime pinger —
 * can call this instead, so the room keeps talking on its own.
 *
 * It is the same *bounded* catch-up a page read runs, so it is safe to call as
 * often as you like: `catchUp` returns without writing when the room is up to
 * date, when a live worker already owns it, or while a person's reply is still
 * being composed. `advance()` takes the turn lease, so ticks may overlap each
 * other and page reads freely.
 *
 * Set `FORUM_TICK_TOKEN` to require a shared secret (`?token=` or a bearer
 * header); with it unset the endpoint is open, which is what a fresh deployment
 * and the local dev server want.
 */

import { NextResponse } from "next/server";

import { catchUp, roomMode } from "@/lib/forum/catchup";
import { nextTurnAt } from "@/lib/forum/clock";
import { openForumStore } from "@/lib/forum/store";

export const dynamic = "force-dynamic";
/** A tick that runs the room's own catch-up burst; same budget as the read path. */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Absent or empty means "no token configured", which means open. */
function authorized(request: Request): boolean {
  const expected = process.env.FORUM_TICK_TOKEN?.trim();
  if (!expected) return true;

  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  return url.searchParams.get("token") === expected || bearer === expected;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "bad or missing tick token" }, { status: 401, headers: NO_STORE });
  }

  const store = openForumStore();
  const now = Date.now();

  try {
    const mode = await roomMode(store, now);
    const config = await store.readConfig();
    const report = await catchUp(store, { now, driver: "tick" });
    const turns = await store.readTurns(1);
    const last = turns[turns.length - 1] ?? null;

    return NextResponse.json(
      {
        ok: true,
        mode,
        roomId: config.roomId,
        seq: last?.seq ?? 0,
        lastTurnAt: last?.t ?? null,
        nextExpectedAt: last ? nextTurnAt(last.t, config.scheduling.gapSec) : null,
        owed: report.owed,
        ran: report.ran,
        skipped: report.skipped,
        reason: report.reason,
        dueAt: report.dueAt ?? null,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        mode: "unavailable",
        error: error instanceof Error ? error.message : "the room is unavailable",
      },
      { status: 200, headers: NO_STORE },
    );
  }
}
