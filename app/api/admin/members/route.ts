/**
 * Admin: member roster management (CSV upload + listing).
 *
 * GET  /api/admin/members — the imported member list.
 * POST /api/admin/members — multipart CSV upload (field name `file`), or JSON
 *      `{ csv: "..." }`. Parsed, validated, upserted on email, audit-logged.
 */

import { checkAdminAuth, adminDenied, adminJson } from "@/lib/admin/auth";
import { insertMembers, listMembers, logAction } from "@/lib/admin/store";

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t.slice(0, max) : undefined;
}
import { parseMembersCsv } from "@/lib/admin/csv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = checkAdminAuth(request, { mutation: false });
  if (!auth.ok) return adminDenied(auth);

  const url = new URL(request.url);
  const members = await listMembers(Number(url.searchParams.get("limit") ?? 200));
  return adminJson({ members });
}

export async function POST(request: Request) {
  const auth = checkAdminAuth(request, { mutation: true });
  if (!auth.ok) return adminDenied(auth);

  let csv: string | null = null;
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (file instanceof File) csv = await file.text();
    else if (typeof form.get("csv") === "string") csv = form.get("csv") as string;
  } else {
    const body = (await request.json().catch(() => null)) as
      | { csv?: string; name?: string; email?: string; bio?: string; age?: number; picture?: string }
      | null;
    // A single member created by hand in the dashboard goes through the same
    // validation and upsert as a CSV row — same table, same key, no special case.
    if (body?.name && body?.email && !body.csv) {
      const result = await insertMembers(
        [
          {
            email: body.email.trim().toLowerCase(),
            name: body.name.trim(),
            bio: body.bio?.trim() || null,
            age: Number.isFinite(Number(body.age)) && Number(body.age) > 0 ? Math.floor(Number(body.age)) : null,
            picture: body.picture?.trim() || null,
            batch: "manual",
          },
        ],
        "manual",
      );
      if (result.inserted === 0) return adminJson({ error: "the member needs a valid email" }, 400);
      await logAction("members.create", { email: clean(body.email, 200), name: clean(body.name, 120) }, "admin");
      return adminJson({ ok: true, inserted: result.inserted });
    }
    csv = body?.csv ?? null;
  }

  if (!csv || !csv.trim()) return adminJson({ error: "no CSV content received" }, 400);

  const parsed = parseMembersCsv(csv);
  if (parsed.members.length === 0) {
    return adminJson(
      { error: "no usable rows", errors: parsed.errors, headers: parsed.headers },
      400,
    );
  }

  const batch = new Date().toISOString().slice(0, 19);
  const result = await insertMembers(
    parsed.members.map((m) => ({ email: m.email, name: m.name, bio: m.bio ?? null, age: m.age ?? null, picture: m.picture ?? null, batch })),
    batch,
  );
  await logAction("members.csv", { batch, rows: parsed.members.length, errors: parsed.errors.length }, "admin");

  return adminJson({
    ok: true,
    inserted: result.inserted,
    skipped: result.skipped,
    errors: parsed.errors,
    batch,
  });
}
