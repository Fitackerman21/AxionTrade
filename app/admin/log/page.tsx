"use client";

/**
 * Log & moderation: the room's transcript with its machinery visible. Filter by
 * persona, trigger or text; open a turn to see the attempts, the gate verdicts
 * and the token spend; delete a single message or prune a seq range.
 */

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

import { adminFetch } from "@/lib/admin/client";

interface Attempt {
  n: number;
  decision: string;
  codes: string[];
  reasons: string[];
}
interface Turn {
  seq: number;
  t: number;
  driver: string;
  trigger: string;
  chosen: string | null;
  decision: string;
  escalated: string | null;
  attempts: Attempt[];
  note: string | null;
  message: { sender: string; text: string; primaryRecipient: string; system: boolean } | null;
  event?: { sender: string };
  usage?: Array<{ provider: string; model: string; tokensIn: number; tokensOut: number; estCost: number }>;
}

const TRIGGERS = ["HUMAN", "RECAP", "WORLD", "FRICTION", "THREAD", "IDLE"];

function clock(t: number): string {
  return new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminLogPage() {
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState("");
  const [trigger, setTrigger] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [pruneRange, setPruneRange] = useState("");
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (persona) params.set("persona", persona);
      if (trigger) params.set("trigger", trigger);
      if (q) params.set("q", q);
      params.set("limit", "120");
      const data = (await adminFetch(`/api/admin/log?${params}`)) as { turns: Turn[]; total: number };
      setTurns(data.turns);
      setTotal(data.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load the log");
    }
  }, [persona, trigger, q]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await load();
      // load() reports its own errors; the guard only stops a late write to an
      // unmounted page — no synchronous setState inside the effect body.
      if (cancelled) return;
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const remove = async (action: "delete" | "prune", seq?: number) => {
    try {
      const body =
        action === "delete"
          ? { action, seq, reason: "deleted from dashboard" }
          : (() => {
              const [from, to] = pruneRange.split("-").map((n) => Number.parseInt(n.trim(), 10));
              return { action, from, to: Number.isFinite(to) ? to : from, reason: "pruned from dashboard" };
            })();
      const result = (await adminFetch("/api/admin/log", {
        method: "POST",
        body: JSON.stringify(body),
        mutation: true,
      })) as { removed?: number };
      setError(null);
      setConfirming(false);
      setPruneRange("");
      window.alert(`done — ${result.removed ?? 0} turn(s) removed`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "action failed");
    }
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-white">Log &amp; moderation</h1>
        <p className="text-sm text-white/40">{total} turns in the room — showing the newest {turns?.length ?? 0}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search text…"
          className="w-48 rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-sm text-white outline-none focus:border-emerald-400/60"
        />
        <select
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          className="rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
        >
          <option value="">any sender</option>
          {(turns ?? []).length > 0
            ? [...new Set((turns ?? []).map((t) => t.message?.sender ?? t.event?.sender).filter(Boolean))].map((id) => (
                <option key={id as string} value={id as string}>{id as string}</option>
              ))
            : null}
        </select>
        <select
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          className="rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
        >
          <option value="">any trigger</option>
          {TRIGGERS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={pruneRange}
            onChange={(e) => setPruneRange(e.target.value)}
            placeholder="prune seq e.g. 643-644"
            className="w-40 rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-sm text-white outline-none focus:border-rose-400/60"
          />
          {pruneRange.trim() && !confirming ? (
            <button onClick={() => setConfirming(true)} className="rounded-lg bg-rose-500/80 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-400">
              Prune
            </button>
          ) : null}
          {confirming ? (
            <button
              onClick={() => void remove("prune")}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white"
            >
              Really remove {pruneRange}?
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      <div className="space-y-1.5">
        {(turns ?? []).map((turn) => (
          <div key={turn.seq} className="rounded-xl border border-white/10 bg-black/30">
            <button
              className="flex w-full items-start gap-3 px-3 py-2 text-left"
              onClick={() => setOpen(open === turn.seq ? null : turn.seq)}
            >
              <span className="w-10 shrink-0 pt-0.5 text-xs text-white/30">#{turn.seq}</span>
              <span className="w-16 shrink-0 pt-0.5 text-xs text-white/30">{clock(turn.t)}</span>
              <span className="w-20 shrink-0 pt-0.5 text-xs font-semibold uppercase text-sky-300/80">{turn.trigger}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-white/80">
                {turn.message ? (
                  <>
                    <b className="text-white">{turn.message.sender}</b>
                    {turn.message.system ? <i className="ml-1 text-xs text-white/40"> (system)</i> : null}
                    {": "}
                    {turn.message.text}
                  </>
                ) : (
                  <i className="text-white/40">no message published ({turn.decision.toLowerCase()})</i>
                )}
              </span>
              {turn.message ? (
                <span
                  role="button"
                  tabIndex={0}
                  className="shrink-0 rounded p-1 text-white/30 hover:bg-white/10 hover:text-rose-300"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete message #${turn.seq} from the live room? This cannot be undone.`)) {
                      void remove("delete", turn.seq);
                    }
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.click()}
                >
                  <Trash2 className="h-4 w-4" />
                </span>
              ) : null}
            </button>
            {open === turn.seq ? (
              <div className="border-t border-white/10 px-4 py-3 text-sm text-white/60">
                <p className="mb-1 text-xs text-white/40">
                  driver {turn.driver} · chosen {turn.chosen ?? "—"} · decision {turn.decision}
                  {turn.escalated ? ` · escalated (${turn.escalated})` : ""}
                </p>
                <p className="mb-2 text-xs text-white/50">{turn.note}</p>
                {turn.attempts.length > 0 ? (
                  <ul className="mb-2 space-y-1">
                    {turn.attempts.map((a) => (
                      <li key={a.n} className="text-xs">
                        attempt {a.n}: <span className={a.decision === "APPROVE" ? "text-emerald-300" : "text-rose-300"}>{a.decision}</span>
                        {a.codes.length > 0 ? <code className="ml-1 text-white/70">[{a.codes.join(", ")}]</code> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {turn.usage && turn.usage.length > 0 ? (
                  <p className="text-xs text-white/40">
                    {turn.usage.map((u) => `${u.provider}: ${u.tokensIn}+${u.tokensOut} tok`).join(" · ")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        {turns !== null && turns.length === 0 ? <p className="text-sm text-white/40">nothing matches those filters</p> : null}
      </div>
    </div>
  );
}
