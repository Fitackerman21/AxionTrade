/**
 * DELETE /api/admin/members/[email] — remove one imported member.
 *
 * The roster is keyed on email (CSV upserts and manual creates both land there),
 * so removal is by the same key. Returns 404 when there was nothing to remove so
 * the dashboard can tell a typo from a success.
 */

import { checkAdminAuth, adminDenied, adminJson } from "@/lib/admin/auth";
import { deleteMember } from "@/lib/admin/store";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, ctx: { params: Promise<{ email: string }> }) {
  const auth = checkAdminAuth(request, { mutation: true });
  if (!auth.ok) return adminDenied(auth);

  const { email } = await ctx.params;
  if (!email?.trim()) return adminJson({ error: "an email is required" }, 400);

  const deleted = await deleteMember(decodeURIComponent(email), "admin");
  if (!deleted) return adminJson({ error: `no member with email \"${email}\"` }, 404);
  return adminJson({ ok: true, email: email.toLowerCase() });
}
