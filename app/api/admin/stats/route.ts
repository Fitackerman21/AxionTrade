/**
 * Admin: the one number that matters, plus everything the overview needs.
 *
 * GET /api/admin/stats — read-only, `?token=` allowed so the page can render
 * server-side without storing the token anywhere but the request.
 */

import { checkAdminAuth, adminDenied, adminJson, adminConfigured } from "@/lib/admin/auth";
import { readAdminSettings, readAdminLog, readPersonaOverrides, listMembers, listInjections } from "@/lib/admin/store";
import { openForumStore } from "@/lib/forum/store";
import type { TurnRecord } from "@/lib/forum/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = checkAdminAuth(request, { mutation: false });
  if (!auth.ok) return adminDenied(auth);

  const store = openForumStore();
  // The log reads oldest-first; walk it ascending for streaks/latency, but the
  // "latest" numbers read off the tail, not the head.
  const turns = await store.readTurns(Number.POSITIVE_INFINITY);
  const posted = turns.filter((t) => t.message);
  const lastPosted = posted[posted.length - 1] ?? null;

  const byDay = new Map<string, number>();
  for (const turn of posted) {
    const day = new Date(turn.t).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  const byPersona = new Map<string, number>();
  for (const turn of posted) {
    if (turn.message) byPersona.set(turn.message.sender, (byPersona.get(turn.message.sender) ?? 0) + 1);
  }

  const byTrigger = new Map<string, number>();
  for (const turn of turns) byTrigger.set(turn.trigger, (byTrigger.get(turn.trigger) ?? 0) + 1);

  // Gate health: how often drafts needed a retry, and what they died of.
  const gateCodes = new Map<string, number>();
  let retries = 0;
  let unpublished = 0;
  for (const turn of turns) {
    if (turn.decision === "UNPUBLISHED") unpublished += 1;
    for (const attempt of turn.attempts) {
      if (attempt.n > 1) retries += 1;
      for (const code of attempt.codes) gateCodes.set(code, (gateCodes.get(code) ?? 0) + 1);
    }
  }

  // Reply latency to humans: the gap between the message and its answer.
  const latencies: number[] = [];
  for (let i = 0; i < turns.length - 1; i += 1) {
    if (turns[i]!.trigger === "HUMAN" && turns[i]!.chosen === null && turns[i + 1]!.chosen) {
      latencies.push(turns[i + 1]!.t - turns[i]!.t);
    }
  }
  latencies.sort((a, b) => a - b);
  const percentile = (p: number) => (latencies.length ? latencies[Math.floor(p * (latencies.length - 1))]! : null);

  // The room cadence: mean gap between the last 30 posted turns.
  const recent = posted.slice(-30);
  let meanGapSec: number | null = null;
  if (recent.length >= 2) {
    const gaps = recent.slice(1).map((t, i) => t.t - recent[i]!.t);
    meanGapSec = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length / 1000);
  }

  const [settings, adminLog, overrides, members, injections] = await Promise.all([
    readAdminSettings(),
    readAdminLog(30),
    readPersonaOverrides(),
    listMembers(500),
    listInjections(20),
  ]);

  const lastSeq = turns.length ? turns[turns.length - 1]!.seq : 0;
  const last24h = posted.filter((t) => t.t > Date.now() - 86_400_000).length;

  return adminJson({
    configured: adminConfigured(),
    settings,
    room: {
      seq: lastSeq,
      lastTurnAt: lastPosted?.t ?? null,
      totalTurns: turns.length,
      totalMessages: posted.length,
      last24h,
      meanGapSec,
      mode: await (async () => {
        const beat = await store.readHeartbeat();
        return beat && beat.expiresAt > Date.now() ? "live" : "lazy";
      })(),
    },
    byDay: [...byDay.entries()].slice(-14).map(([day, count]) => ({ day, count })),
    byTrigger: Object.fromEntries(byTrigger),
    byPersona: Object.fromEntries([...byPersona.entries()].sort((a, b) => b[1] - a[1])),
    gate: {
      retries,
      unpublished,
      topCodes: Object.fromEntries([...gateCodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)),
    },
    humanReply: {
      p50: percentile(0.5),
      p90: percentile(0.9),
      count: latencies.length,
    },
    members: { total: members.length, rows: members.slice(0, 50) },
    injections: injections.filter((i) => i.takenSeq === null),
    adminLog,
    overrides,
    personas: (await store.readPersonas()).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      color: p.color,
      g1: p.g1,
      g2: p.g2,
      online: p.online,
    })),
    topics: (await store.readTopics()).map((t) => ({ id: t.id, title: t.title })),
  });
}
