/**
 * Admin: the registered-user directory.
 *
 * GET /api/admin/users — every account created through /signin, newest first, with
 * the password code, so a user who lost theirs can be given it back.
 */

import { checkAdminAuth, adminDenied, adminJson } from "@/lib/admin/auth";
import { listUsers } from "@/lib/users/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = checkAdminAuth(request, { mutation: false });
  if (!auth.ok) return adminDenied(auth);

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 500);

  try {
    const users = await listUsers(Number.isFinite(limit) ? limit : 500);
    return adminJson({ users });
  } catch {
    return adminJson({ error: "the user directory is unavailable right now" }, 500);
  }
}
