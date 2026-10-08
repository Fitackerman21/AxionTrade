/**
 * GET /api/media/[id] — serve an uploaded image out of the database.
 *
 * The default sink for profile pictures when no object store is configured:
 * the bytes live in forum_media, and this route is their public URL. Immutable
 * caching — ids are unique per upload, so a re-upload is a new id, never a new
 * version of an old one.
 */

import { getMedia } from "@/lib/admin/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !/^[a-z0-9]+$/i.test(id)) {
    return new Response("bad media id", { status: 400 });
  }

  const media = await getMedia(id);
  if (!media) return new Response("not found", { status: 404 });

  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "content-type": media.contentType,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
