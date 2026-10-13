/**
 * The community's public identity: name and description (spec §13.2).
 *
 * Public by design — it is what the overview modal on /community shows. Lead with
 * the bundled default when the admin layer is not configured on this host, so the
 * page renders the overview without a database rather than an error.
 */

import { NextResponse } from "next/server";

import { DEFAULT_COMMUNITY, readCommunityProfile } from "@/lib/admin/store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  try {
    return NextResponse.json(await readCommunityProfile(), { headers: NO_STORE });
  } catch {
    return NextResponse.json(DEFAULT_COMMUNITY, { headers: NO_STORE });
  }
}
