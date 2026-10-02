/**
 * Room state for the UI (spec §13.3): live or lazy, who is on the roster, when
 * the next turn is due, and how far behind the room is.
 *
 * The catch-up here is a dry run — asking about the room must not advance it.
 */

import { NextResponse } from "next/server";

import { catchUp, roomMode } from "@/lib/forum/catchup";
import { nextTurnAt } from "@/lib/forum/clock";
import { openForumStore } from "@/lib/forum/store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  const store = openForumStore();

  try {
    const now = Date.now();
    const [config, personas, last] = await Promise.all([
      store.readConfig(),
      store.readPersonas(),
      store.readLastTurn(),
    ]);

    const mode = await roomMode(store, now);
    // `quiescent` joins this once budgets land (spec §11).
    const pending = mode === "lazy" ? await catchUp(store, { now, dryRun: true }) : null;

    return NextResponse.json(
      {
        mode,
        roomId: config.roomId,
        seq: last?.seq ?? 0,
        lastTurnAt: last?.t ?? null,
        nextExpectedAt: last ? nextTurnAt(last.t, config.scheduling.gapSec) : null,
        behind: pending?.owed ?? 0,
        staleInMs: pending?.recapped ? 0 : config.runtime.staleAfterMin * 60_000,
        members: {
          total: personas.length,
          online: personas.filter((persona) => persona.online).length,
        },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return NextResponse.json(
      {
        mode: "unavailable",
        error: error instanceof Error ? error.message : "the room is unavailable",
      },
      { status: 200, headers: NO_STORE },
    );
  }
}
