/**
 * POST /api/admin/upload — store one profile picture, get a public URL back.
 *
 * The persona editor's drag-and-drop target posts the file here as multipart
 * `file`. The server uploads it to the project's Supabase Storage bucket
 * (`avatars`, created on first use) and returns the permanent public URL.
 * 5 MB cap — these are avatars, not galleries.
 *
 * Admin-token gated like every other mutation: an open upload endpoint would
 * make this site a free image host. Needs SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in the server environment.
 */

import { checkAdminAuth, adminDenied, adminJson } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "avatars";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);

function apiBase(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) return "";
  return url.replace(/\/+$/, "");
}

async function ensureBucket(key: string): Promise<void> {
  const base = apiBase();
  const head = await fetch(`${base}/storage/v1/bucket/${BUCKET}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (head.ok) {
    const bucket = (await head.json()) as { public?: boolean };
    if (bucket.public) return;
    // exists but private — make it public so avatars render without signed URLs
    await fetch(`${base}/storage/v1/bucket/${BUCKET}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ public: true }),
    });
    return;
  }
  const created = await fetch(`${base}/storage/v1/bucket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
  if (!created.ok && created.status !== 409) {
    const detail = await created.text().catch(() => "");
    throw new Error(`could not create the ${BUCKET} bucket: ${detail.slice(0, 200)}`);
  }
}

export async function POST(request: Request) {
  const auth = checkAdminAuth(request, { mutation: true });
  if (!auth.ok) return adminDenied(auth);

  const base = apiBase();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    return adminJson({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server" }, 503);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return adminJson({ error: "send the image as multipart field `file`" }, 400);
  if (file.size > MAX_BYTES) return adminJson({ error: "image is over the 5 MB limit" }, 400);
  if (file.type && !ALLOWED.has(file.type)) return adminJson({ error: `unsupported type ${file.type}` }, 400);

  try {
    await ensureBucket(key);

    // deterministic path per persona so a re-upload replaces in place
    const persona = String(form?.get("persona") ?? "").replace(/[^a-z0-9-]/gi, "");
    const ext = (file.name.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
    const path = persona ? `${persona}.${ext}` : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const uploaded = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": file.type || "application/octet-stream",
        "x-upsert": "true",
      },
      body: await file.arrayBuffer(),
    });
    if (!uploaded.ok) {
      const detail = await uploaded.text().catch(() => "");
      return adminJson({ error: `storage rejected the upload: ${detail.slice(0, 200)}` }, 502);
    }

    return adminJson({ ok: true, url: `${base}/storage/v1/object/public/${BUCKET}/${path}` });
  } catch (e) {
    return adminJson({ error: e instanceof Error ? e.message : "upload failed" }, 502);
  }
}
