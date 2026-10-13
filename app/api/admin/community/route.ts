/**
 * Admin: the community profile the overview modal shows.
 *
 * GET  /api/admin/community — current name and description
 * POST /api/admin/community — set them (name and description are both required,
 *      bounded so a pasted novel cannot become the room's description)
 */

import { adminDenied, adminJson, checkAdminAuth } from "@/lib/admin/auth";
import { readCommunityProfile, writeCommunityProfile } from "@/lib/admin/store";

export const dynamic = "force-dynamic";

const MAX_NAME = 60;
const MAX_DESCRIPTION = 600;

export async function GET(request: Request) {
  const auth = checkAdminAuth(request, { mutation: false });
  if (!auth.ok) return adminDenied(auth);
  return adminJson({ community: await readCommunityProfile() });
}

export async function POST(request: Request) {
  const auth = checkAdminAuth(request, { mutation: true });
  if (!auth.ok) return adminDenied(auth);

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    description?: string;
  } | null;
  const name = body?.name?.trim() ?? "";
  const description = body?.description?.trim() ?? "";
  if (name === "") return adminJson({ error: "the community needs a name" }, 400);
  if (name.length > MAX_NAME) {
    return adminJson({ error: `the name is capped at ${MAX_NAME} characters` }, 400);
  }
  if (description === "") return adminJson({ error: "the community needs a description" }, 400);
  if (description.length > MAX_DESCRIPTION) {
    return adminJson({ error: `the description is capped at ${MAX_DESCRIPTION} characters` }, 400);
  }

  await writeCommunityProfile({ name, description }, "admin");
  return adminJson({ ok: true, community: { name, description } });
}
