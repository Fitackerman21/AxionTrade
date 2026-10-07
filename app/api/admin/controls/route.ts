/**
 * Admin: room controls.
 *
 * GET  /api/admin/controls — current settings, lease/heartbeat holders, the
 *      persona roster with mute state, and queued speak-as injections.
 * POST /api/admin/controls — mutations: pause, resume, mute, unmute, pace, tick
 *      (force one catch-up turn now), inject (speak as a persona), cancel-inject.
 */

import { checkAdminAuth, adminDenied, adminJson } from "@/lib/admin/auth";
import {
  readAdminSettings,
  writeSetting,
  logAction,
  enqueueInjection,
  cancelInjection,
  listInjections,
} from "@/lib/admin/store";
import { openForumStore } from "@/lib/forum/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = checkAdminAuth(request, { mutation: false });
  if (!auth.ok) return adminDenied(auth);

  const store = openForumStore();
  const [settings, lease, heartbeat, injections] = await Promise.all([
    readAdminSettings(),
    store.readLease(),
    store.readHeartbeat(),
    listInjections(20),
  ]);

  return adminJson({
    settings,
    lease,
    heartbeat,
    injections,
    personas: (await store.readPersonas()).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      color: p.color,
      online: p.online,
      muted: settings.muted.includes(p.id),
    })),
  });
}

export async function POST(request: Request) {
  const auth = checkAdminAuth(request, { mutation: true });
  if (!auth.ok) return adminDenied(auth);

  const body = (await request.json().catch(() => null)) as
    | { action?: string; persona?: string; pace?: number; text?: string; id?: number }
    | null;
  if (!body?.action) return adminJson({ error: "an action is required" }, 400);
  const actor = "admin";

  if (body.action === "pause") {
    await writeSetting("paused", true, actor);
    await logAction("room.pause", {}, actor);
    return adminJson({ ok: true, paused: true });
  }

  if (body.action === "resume") {
    await writeSetting("paused", false, actor);
    await logAction("room.resume", {}, actor);
    return adminJson({ ok: true, paused: false });
  }

  if (body.action === "mute" || body.action === "unmute") {
    const persona = body.persona?.trim();
    if (!persona) return adminJson({ error: "mute needs a persona id" }, 400);
    const settings = await readAdminSettings();
    const muted = new Set(settings.muted);
    if (body.action === "mute") muted.add(persona);
    else muted.delete(persona);
    await writeSetting("muted", [...muted], actor);
    await logAction(`persona.${body.action}`, { persona }, actor);
    return adminJson({ ok: true, muted: [...muted] });
  }

  if (body.action === "pace") {
    const pace = Number(body.pace);
    if (!Number.isFinite(pace) || pace < 0.25 || pace > 4) {
      return adminJson({ error: "pace must be between 0.25 and 4" }, 400);
    }
    await writeSetting("pace", pace, actor);
    await logAction("room.pace", { pace }, actor);
    return adminJson({ ok: true, pace });
  }

  if (body.action === "tick") {
    // Force one turn now by borrowing the tick path with the burst capped at 1.
    const { catchUp } = await import("@/lib/forum/catchup");
    const store = openForumStore();
    const report = await catchUp(store, { maxTurns: 1, driver: "admin-tick" });
    await logAction("room.tick", { ran: report.ran, reason: report.reason }, actor);
    return adminJson({ ok: true, report });
  }

  if (body.action === "inject") {
    const persona = body.persona?.trim();
    const text = body.text?.trim();
    if (!persona || !text) return adminJson({ error: "inject needs a persona and text" }, 400);
    if (text.length > 480) return adminJson({ error: "injections are capped at 480 characters" }, 400);
    const store = openForumStore();
    const roster = await store.readPersonas();
    if (!roster.some((p) => p.id === persona)) {
      return adminJson({ error: `unknown persona "${persona}"` }, 400);
    }
    const id = await enqueueInjection(persona, text, actor);
    return adminJson({ ok: true, id });
  }

  if (body.action === "cancel-inject") {
    const removed = await cancelInjection(Number(body.id), actor);
    return removed ? adminJson({ ok: true }) : adminJson({ error: "not found or already taken" }, 404);
  }

  return adminJson({ error: `unknown action "${body.action}"` }, 400);
}
