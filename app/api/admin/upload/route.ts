/**
 * POST /api/admin/upload — store one profile picture, get a public URL back.
 *
 * The persona editor's drag-and-drop target posts the file here as multipart
 * `file`. Storage sinks, in order:
 *
 *   1. Supabase Storage, when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
 *      set — the `avatars` bucket is created on first use, uploads are keyed by
 *      persona so a re-upload replaces in place.
 *   2. The app's own Postgres (forum_media), served back through
 *      /api/media/[id] — the default, because the database is the one store the
 *      deployment already has and avatars need no more than that.
 *
 * 5 MB cap — these are avatars, not galleries. Admin-token gated like every
 * other mutation: an open upload endpoint would make this site a free image
 * host.
 */

import { checkAdminAuth, adminDenied, adminJson } from "@/lib/admin/auth";
import { putMedia } from "@/lib/admin/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "avatars";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);

function supabaseEnv(): { base: string; key: string } | null {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return base && key ? { base, key } : null;
}

async function ensureBucket(key: string, base: string): Promise<void> {
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

async function uploadToSupabase(
  base: string,
  key: string,
  persona: string,
  contentType: string,
  bytes: Buffer,
  ext: string,
): Promise<string> {
  await ensureBucket(key, base);
  const path = persona ? `${persona}.${ext}` : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const uploaded = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": contentType,
      "x-upsert": "true",
    },
    body: new Uint8Array(bytes),
  });
  if (!uploaded.ok) {
    const detail = await uploaded.text().catch(() => "");
    throw new Error(`storage rejected the upload: ${detail.slice(0, 200)}`);
  }
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

export async function POST(request: Request) {
  const auth = checkAdminAuth(request, { mutation: true });
  if (!auth.ok) return adminDenied(auth);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return adminJson({ error: "send the image as multipart field `file`" }, 400);
  if (file.size > MAX_BYTES) return adminJson({ error: "image is over the 5 MB limit" }, 400);
  if (file.type && !ALLOWED.has(file.type)) return adminJson({ error: `unsupported type ${file.type}` }, 400);

  const persona = String(form?.get("persona") ?? "").replace(/[^a-z0-9-]/gi, "");
  const ext = (file.name.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
  const contentType = file.type || "application/octet-stream";
  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    const supabase = supabaseEnv();
    if (supabase) {
      const url = await uploadToSupabase(supabase.base, supabase.key, persona, contentType, bytes, ext);
      return adminJson({ ok: true, url, sink: "supabase" });
    }
    const id = await putMedia(persona || null, contentType, bytes);
    const origin = new URL(request.url).origin;
    return adminJson({ ok: true, url: `${origin}/api/media/${id}`, sink: "database" });
  } catch (e) {
    return adminJson({ error: e instanceof Error ? e.message : "upload failed" }, 502);
  }
}
