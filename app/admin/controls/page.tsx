"use client";

/**
 * Room controls: the switches that change behaviour without a redeploy.
 *
 * - pause / resume the whole room
 * - pace: 0.25×–4× multiplier on the room's cadence
 * - mute: a muted persona stays on the roster but is never chosen to speak
 * - speak-as: queue a message to be published *as* a persona on the room's next
 *   turn for them. Other personas see it as that persona talking; nobody sees
 *   "admin" or "you".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Trash2 } from "lucide-react";

import { adminFetch } from "@/lib/admin/client";

interface Controls {
  settings: { paused: boolean; muted: string[]; pace: number };
  lease: { owner: string; expiresAt: number } | null;
  heartbeat: { owner: string; expiresAt: number } | null;
  injections: Array<{ id: number; persona: string; text: string; takenSeq: number | null; t: number }>;
  personas: Array<{ id: string; name: string; role: string; color: string; online: boolean; muted: boolean }>;
}

export default function AdminControlsPage() {
  const [data, setData] = useState<Controls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // speak-as composer state
  const [asPersona, setAsPersona] = useState("");
  const [text, setText] = useState("");

  const load = useCallback(async () => {
    try {
      const fresh = (await adminFetch("/api/admin/controls")) as Controls;
      setData(fresh);
      if (!asPersona && fresh.personas.length > 0) setAsPersona(fresh.personas[0]!.id);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load controls");
    }
  }, [asPersona]);

  const [now, setNow] = useState<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await load();
      if (cancelled) return;
      setNow(Date.now());
      const timer = setInterval(() => {
        void load();
        setNow(Date.now());
      }, 15_000);
      cleanupRef.current = () => clearInterval(timer);
    };
    void run();
    return () => {
      cancelled = true;
      cleanupRef.current?.();
    };
    // load reads the token from sessionStorage on the client only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (action: string, extra: Record<string, unknown> = {}, note?: string) => {
    setBusy(true);
    try {
      await adminFetch("/api/admin/controls", {
        method: "POST",
        body: JSON.stringify({ action, ...extra }),
        mutation: true,
      });
      setStatus(note ?? `${action} done`);
      await load();
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="p-6 text-sm text-white/40">loading controls…</p>;
  // nowMs rides in state — the render stays pure, and the countdown advances
  // every time the poll cycle refreshes.
  const nowMs = now ?? 0;

  const pending = data.injections.filter((i) => i.takenSeq === null);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-white">Room controls</h1>
        <p className="text-sm text-white/40">
          lease {data.lease ? `${data.lease.owner}${nowMs ? ` (expires in ${Math.max(0, Math.round((data.lease.expiresAt - nowMs) / 1000))}s)` : ""}` : "free"}
          {" · "}heartbeat {data.heartbeat ? data.heartbeat.owner : "none"}
        </p>
      </header>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      {status ? <p className="text-sm text-emerald-300">{status}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <h2 className="mb-3 text-sm font-semibold text-white">Room state</h2>
          <div className="mb-4 flex items-center gap-3">
            {data.settings.paused ? (
              <button
                onClick={() => void act("resume", {}, "room resumed — the next tick answers")}
                disabled={busy}
                className="flex items-center gap-2 rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
              >
                <Play className="h-4 w-4" /> Resume
              </button>
            ) : (
              <button
                onClick={() => void act("pause", {}, "room paused — nothing will be published")}
                disabled={busy}
                className="flex items-center gap-2 rounded-lg bg-rose-500/80 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-400 disabled:opacity-50"
              >
                <Pause className="h-4 w-4" /> Pause
              </button>
            )}
            <span className={`text-sm ${data.settings.paused ? "text-amber-300" : "text-white/40"}`}>
              {data.settings.paused ? "paused" : "running"}
            </span>
          </div>

          <label className="block text-xs text-white/40">
            pace — multiplies the gap between turns (×{data.settings.pace})
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.25}
              value={data.settings.pace}
              onChange={(e) => void act("pace", { pace: Number(e.target.value) })}
              className="mt-2 w-full accent-emerald-400"
            />
          </label>
          <p className="mt-1 text-[11px] text-white/30">
            0.25× = four times as chatty · 1× = as configured · 4× = four times as slow
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <h2 className="mb-1 text-sm font-semibold text-white">Personas</h2>
          <p className="mb-3 text-xs text-white/40">muted stays on the roster but is never chosen to speak</p>
          <ul className="grid grid-cols-2 gap-1.5">
            {data.personas.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() =>
                    void act(p.muted ? "unmute" : "mute", { persona: p.id }, `${p.name} ${p.muted ? "unmuted" : "muted"}`)
                  }
                  disabled={busy}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                    p.muted
                      ? "border-white/10 bg-white/5 text-white/40 line-through"
                      : "border-white/15 text-white/85 hover:bg-white/5"
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  <span className={`ml-2 h-2 w-2 shrink-0 rounded-full ${p.muted ? "bg-white/20" : "bg-emerald-400"}`} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-2xl border border-white/10 bg-black/30 p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
          <Mic className="h-4 w-4" /> Speak as a persona
        </h2>
        <p className="mb-3 text-xs text-white/40">
          Queued lines are published verbatim as the chosen persona on their next turn — no model writes it, no
          gate reviews it, and the room (personas included) treats it as them having said it.
        </p>
        <div className="flex flex-wrap items-start gap-2">
          <select
            value={asPersona}
            onChange={(e) => setAsPersona(e.target.value)}
            className="rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white"
          >
            {data.personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id})
              </option>
            ))}
          </select>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`what ${data.personas.find((p) => p.id === asPersona)?.name ?? "they"} should say…`}
            rows={2}
            maxLength={480}
            className="min-w-64 flex-1 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
          />
          <button
            onClick={async () => {
              if (!text.trim()) return;
              await act("inject", { persona: asPersona, text: text.trim() }, `queued as ${asPersona}`);
              setText("");
            }}
            disabled={busy || !text.trim() || data.settings.paused}
            className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
          >
            Queue
          </button>
        </div>
        {data.settings.paused ? (
          <p className="mt-2 text-xs text-amber-300">the room is paused — queued lines publish once it resumes</p>
        ) : null}

        {pending.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {pending.map((i) => (
              <li key={i.id} className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
                <code className="shrink-0 pt-0.5 text-xs text-sky-300/80">{i.persona}</code>
                <span className="min-w-0 flex-1 text-white/80">{i.text}</span>
                <button
                  onClick={() => void act("cancel-inject", { id: i.id }, "injection cancelled")}
                  className="shrink-0 rounded p-1 text-white/30 hover:bg-white/10 hover:text-rose-300"
                  aria-label="cancel"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-white/30">nothing queued</p>
        )}
      </section>
    </div>
  );
}
