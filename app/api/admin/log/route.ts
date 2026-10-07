/**
 * Admin: log moderation.
 *
 * GET  /api/admin/log?limit=&persona=&trigger=&q= — browse the turn log with the
 *      full trace on every turn (attempts, usage, notes), filterable.
 * POST /api/admin/log — destructive actions: `prune` a seq range out of the live
 *      room, or `delete` one turn. Both are audit-logged with what went and why.
 */

import { checkAdminAuth, adminDenied, adminJson } from "@/lib/admin/auth";
import { logAction } from "@/lib/admin/store";
import { openForumStore } from "@/lib/forum/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = checkAdminAuth(request, { mutation: false });
  if (!auth.ok) return adminDenied(auth);

  const url = new URL(request.url);
  const limit = Math.min(300, Math.max(1, Number(url.searchParams.get("limit") ?? 80)));
  const persona = url.searchParams.get("persona") ?? "";
  const trigger = url.searchParams.get("trigger") ?? "";
  const q = (url.searchParams.get("q") ?? "").toLowerCase();

  const store = openForumStore();
  // The log reads oldest-first; the dashboard wants the newest page first.
  const turns = (await store.readTurns(Number.POSITIVE_INFINITY)).slice().reverse();
  const filtered = turns
    .filter((t) => (persona ? t.message?.sender === persona || t.event.sender === persona : true))
    .filter((t) => (trigger ? t.trigger === trigger : true))
    .filter((t) => (q ? (t.message?.text ?? "").toLowerCase().includes(q) : true))
    .slice(0, limit);

  return adminJson({
    total: turns.length,
    turns: filtered,
  });
}

export async function POST(request: Request) {
  const auth = checkAdminAuth(request, { mutation: true });
  if (!auth.ok) return adminDenied(auth);

  const body = (await request.json().catch(() => null)) as
    | { action?: string; from?: number; to?: number; seq?: number; reason?: string }
    | null;
  if (!body?.action) return adminJson({ error: "an action is required" }, 400);

  const store = openForumStore();
  const actor = "admin";

  if (body.action === "prune") {
    const from = Number(body.from);
    const to = Number(body.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      return adminJson({ error: "prune needs a valid from/to seq range" }, 400);
    }
    const removed = await store.deleteTurns(from, to);
    await logAction("log.prune", { from, to, removed, reason: body.reason ?? "" }, actor);
    return adminJson({ ok: true, removed });
  }

  if (body.action === "delete") {
    const seq = Number(body.seq);
    if (!Number.isFinite(seq)) return adminJson({ error: "delete needs a seq" }, 400);
    const removed = await store.deleteTurns(seq, seq);
    await logAction("log.delete", { seq, removed, reason: body.reason ?? "" }, actor);
    return adminJson({ ok: true, removed });
  }

  return adminJson({ error: `unknown action "${body.action}"` }, 400);
}
