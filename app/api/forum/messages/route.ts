/**
 * The room's published projection (spec §13.3).
 *
 * Reading this is what "wakes" the room: when no worker holds a heartbeat, the
 * handler runs a bounded catch-up before answering, so opening /community brings
 * the conversation forward instead of showing a room that stopped hours ago.
 * `?catchup=0` reads without advancing, and `?since=<seq>` returns only what is
 * new.
 *
 * Only published messages cross this boundary. Prompts, character sheets, world
 * state, gate verdicts and costs never do (spec §13.2).
 */

import { NextResponse } from "next/server";

import { catchUp } from "@/lib/forum/catchup";
import { nextTurnAt } from "@/lib/forum/clock";
import { messagesFromTurns, openForumStore } from "@/lib/forum/store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const since = Number(url.searchParams.get("since") ?? "0");
  const shouldWake = url.searchParams.get("catchup") !== "0";
  const store = openForumStore();

  try {
    const now = Date.now();
    const config = await store.readConfig();

    const report = shouldWake ? await catchUp(store, { now }) : null;

    const turns = await store.readTurns(Number.POSITIVE_INFINITY);
    const last = turns[turns.length - 1] ?? null;
    const messages = messagesFromTurns(turns).filter(
      (message) => message.seq > (Number.isFinite(since) ? since : 0),
    );

    return NextResponse.json(
      {
        mode: report?.mode ?? "lazy",
        roomId: config.roomId,
        seq: last?.seq ?? 0,
        lastTurnAt: last?.t ?? null,
        nextExpectedAt: last ? nextTurnAt(last.t, config.scheduling.gapSec) : null,
        messages,
        catchUp: report
          ? { owed: report.owed, ran: report.ran, skipped: report.skipped, recapped: report.recapped, reason: report.reason }
          : null,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // No room on this host: report it instead of failing the page.
    return NextResponse.json(
      {
        mode: "unavailable",
        messages: [],
        error: error instanceof Error ? error.message : "the room is unavailable",
      },
      { status: 200, headers: NO_STORE },
    );
  }
}
