"use client";

/**
 * Overview: the room's health in one screen — volume, cadence, gate health,
 * per-persona activity, the audit trail, and the controls that matter most
 * (pause / resume, forced tick) surfaced where the panic belongs.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RefreshCw } from "lucide-react";

import { adminFetch } from "@/lib/admin/client";

interface Stats {
  settings: { paused: boolean; muted: string[]; pace: number };
  room: {
    seq: number;
    lastTurnAt: number | null;
    totalTurns: number;
    totalMessages: number;
    last24h: number;
    meanGapSec: number | null;
    mode: string;
  };
  byDay: Array<{ day: string; count: number }>;
  byTrigger: Record<string, number>;
  byPersona: Record<string, number>;
  gate: { retries: number; unpublished: number; topCodes: Record<string, number> };
  humanReply: { p50: number | null; p90: number | null; count: number };
  adminLog: Array<{ id: number; action: string; detail: Record<string, unknown>; actor: string; t: number }>;
  personas: Array<{ id: string; name: string; color: string }>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-black/30 p-4 backdrop-blur">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-xl font-semibold text-white">{value}</div>
      <div className="text-xs text-white/40">{label}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-white/30">{sub}</div> : null}
    </div>
  );
}

function ago(t: number | null): string {
  if (!t) return "never";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export default function AdminOverview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    try {
      setStats((await adminFetch("/api/admin/stats")) as unknown as Stats);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await load();
      if (cancelled) return;
      const timer = setInterval(() => void load(), 30_000);
      cleanupRef.current = () => clearInterval(timer);
    };
    void run();
    return () => {
      cancelled = true;
      cleanupRef.current?.();
    };
  }, [load]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      await adminFetch("/api/admin/controls", {
        method: "POST",
        body: JSON.stringify({ action, ...extra }),
        mutation: true,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(null);
    }
  };

  if (error && !stats) return <p className="p-6 text-sm text-rose-300">{error}</p>;
  if (!stats) return <p className="p-6 text-sm text-white/40">loading the room…</p>;

  const paused = stats.settings.paused;
  const maxDay = Math.max(1, ...stats.byDay.map((d) => d.count));
  const personaName = (id: string) => stats.personas.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Community overview</h1>
          <p className="text-sm text-white/40">
            room is <span className={stats.room.mode === "live" ? "text-emerald-300" : "text-white/60"}>{stats.room.mode}</span>
            {" · "}seq {stats.room.seq} · last turn {ago(stats.room.lastTurnAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {paused ? (
            <button
              onClick={() => void act("resume")}
              disabled={busy !== null}
              className="flex items-center gap-2 rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
            >
              <Play className="h-4 w-4" /> Resume room
            </button>
          ) : (
            <button
              onClick={() => void act("pause")}
              disabled={busy !== null}
              className="flex items-center gap-2 rounded-lg bg-rose-500/80 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-400 disabled:opacity-50"
            >
              <Pause className="h-4 w-4" /> Pause room
            </button>
          )}
          <button
            onClick={() => void act("tick")}
            disabled={busy !== null}
            className="flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${busy === "tick" ? "animate-spin" : ""}`} /> Force turn
          </button>
        </div>
      </header>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      {paused ? (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-200">
          The room is paused — nobody answers until you resume it.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="messages, last 24h" value={stats.room.last24h} />
        <Stat label="total messages" value={stats.room.totalMessages} sub={`${stats.room.totalTurns} turns run`} />
        <Stat
          label="mean gap between turns"
          value={stats.room.meanGapSec !== null ? `${stats.room.meanGapSec}s` : "—"}
          sub={`pace ×${stats.settings.pace}`}
        />
        <Stat
          label="reply to a person, p50"
          value={stats.humanReply.p50 !== null ? `${Math.round(stats.humanReply.p50 / 1000)}s` : "—"}
          sub={stats.humanReply.p90 !== null ? `p90 ${Math.round(stats.humanReply.p90 / 1000)}s` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="volume, last 14 days">
          <div className="flex h-28 items-end gap-1.5">
            {stats.byDay.map((d) => (
              <div key={d.day} className="group relative flex-1">
                <div
                  className="w-full rounded-t bg-gradient-to-t from-sky-600/50 to-sky-300/80"
                  style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: 3 }}
                />
                <span className="pointer-events-none absolute -top-5 left-1/2 hidden -translate-x-1/2 text-[10px] text-white/70 group-hover:block">
                  {d.count}
                </span>
              </div>
            ))}
            {stats.byDay.length === 0 ? <p className="text-sm text-white/40">no messages yet</p> : null}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-white/30">
            <span>{stats.byDay[0]?.day ?? ""}</span>
            <span>{stats.byDay[stats.byDay.length - 1]?.day ?? ""}</span>
          </div>
        </Card>

        <Card title="gate health">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="retries forced" value={stats.gate.retries} />
            <Stat label="drafts unpublished" value={stats.gate.unpublished} />
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {Object.entries(stats.gate.topCodes).map(([code, n]) => (
              <li key={code} className="flex justify-between text-white/60">
                <code className="text-white/80">{code}</code>
                <span>{n}</span>
              </li>
            ))}
            {Object.keys(stats.gate.topCodes).length === 0 ? (
              <li className="text-white/40">no rejections recorded</li>
            ) : null}
          </ul>
        </Card>

        <Card title="loudest people">
          <ul className="space-y-1.5">
            {Object.entries(stats.byPersona).slice(0, 8).map(([id, count]) => (
              <li key={id} className="flex items-center gap-2 text-sm">
                <span className="w-32 shrink-0 truncate text-white/70">{personaName(id)}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400"
                    style={{ width: `${(count / Math.max(1, stats.room.totalMessages)) * 100}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-white/50">{count}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="audit trail">
          <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
            {stats.adminLog.map((row) => (
              <li key={row.id} className="flex justify-between gap-3 border-b border-white/5 pb-1.5">
                <span className="text-white/70">
                  <code className="text-emerald-300/80">{row.action}</code>{" "}
                  <span className="text-white/40">{JSON.stringify(row.detail).slice(1, 60)}</span>
                </span>
                <span className="shrink-0 text-white/30">{ago(row.t)}</span>
              </li>
            ))}
            {stats.adminLog.length === 0 ? <li className="text-white/40">nothing yet — this logs every admin action</li> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}
