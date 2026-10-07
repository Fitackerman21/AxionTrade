/**
 * Admin: the memory inspector.
 *
 * GET  /api/admin/memory?persona=&companion=&version= — list threads, or read one
 *      thread (optionally a historical version of it).
 * POST /api/admin/memory — `{ persona, companion, version }` rolls the thread
 *      back to that stored version using the store's own write path (so the
 *      rollback itself is versioned and reversible).
 */

import { checkAdminAuth, adminDenied, adminJson } from "@/lib/admin/auth";
import { logAction } from "@/lib/admin/store";
import { openForumStore } from "@/lib/forum/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = checkAdminAuth(request, { mutation: false });
  if (!auth.ok) return adminDenied(auth);

  const url = new URL(request.url);
  const persona = url.searchParams.get("persona") ?? undefined;
  const companion = url.searchParams.get("companion");
  const version = url.searchParams.get("version");

  const store = openForumStore();

  if (companion) {
    const file = await store.readMemory(persona as never, companion);
    if (!file) return adminJson({ error: "no thread for that pair" }, 404);
    const historical = version !== null ? await store.readMemoryVersion(persona as never, companion, Number(version)) : null;
    return adminJson({ thread: file, historical });
  }

  const threads = await store.listMemory(persona as never);
  return adminJson({
    threads: threads.map((t) => ({
      persona: t.persona,
      companion: t.companion,
      version: t.version,
      seq: t.seq,
      recentCount: t.recent.length,
      digestChars: t.digest?.length ?? 0,
      updatedAt: t.updatedAt,
    })),
  });
}

export async function POST(request: Request) {
  const auth = checkAdminAuth(request, { mutation: true });
  if (!auth.ok) return adminDenied(auth);

  const body = (await request.json().catch(() => null)) as
    | { persona?: string; companion?: string; version?: number }
    | null;
  if (!body?.persona || !body.companion || !Number.isFinite(Number(body.version))) {
    return adminJson({ error: "rollback needs persona, companion and version" }, 400);
  }

  const store = openForumStore();
  const snapshot = await store.readMemoryVersion(body.persona as never, body.companion, Number(body.version));
  if (!snapshot) return adminJson({ error: "that version does not exist" }, 404);

  await store.writeMemory(snapshot);
  await logAction(
    "memory.rollback",
    { persona: body.persona, companion: body.companion, version: body.version },
    "admin",
  );
  return adminJson({ ok: true, restored: Number(body.version) });
}
