/**
 * The roster the community chat renders, with admin overrides applied.
 *
 * The chat component currently imports a static array; this endpoint exists so a
 * profile edited on the dashboard (name, colours, role, online flag) is what the
 * room actually shows. Public by design — the roster is public in the bundle too —
 * and cheap to read: two bundled JSON reads and at most one small table.
 */

import { NextResponse } from "next/server";

import { readPersonaOverrides } from "@/lib/admin/store";
import { openForumStore } from "@/lib/forum/store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  try {
    const store = openForumStore();
    const [personas, overrides] = await Promise.all([store.readPersonas(), readPersonaOverrides()]);
    const merged = personas.map((p) => ({ ...p, ...(overrides[p.id] ?? {}) }));
    return NextResponse.json(
      {
        personas: merged.map((p) => ({
          id: p.id,
          name: p.name,
          role: p.role,
          g1: p.g1,
          g2: p.g2,
          color: p.color,
          online: p.online,
          bot: p.bot,
        })),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "roster unavailable" },
      { status: 200, headers: NO_STORE },
    );
  }
}
