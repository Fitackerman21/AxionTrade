"use client";

/**
 * Memory: Agent 2's threads, readable. Pick a (persona, companion) thread, read
 * its digest and verbatim buffer, flip through stored versions, and roll back if
 * a compaction went wrong. Rollbacks go through the store's own write path, so
 * even a rollback is itself versioned.
 */

import { useCallback, useEffect, useState } from "react";

import { adminFetch } from "@/lib/admin/client";

interface ThreadRow {
  persona: string;
  companion: string;
  version: number;
  seq: number;
  recentCount: number;
  digestChars: number;
  updatedAt: number;
}
interface MemoryEntry {
  seq: number;
  t: number;
  role: "me" | "them";
  text: string;
}
interface Thread {
  persona: string;
  companion: string;
  version: number;
  digest: string | null;
  recent: MemoryEntry[];
}

export default function AdminMemoryPage() {
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [selected, setSelected] = useState<{ persona: string; companion: string } | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [historical, setHistorical] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = (await adminFetch("/api/admin/memory")) as { threads: ThreadRow[] };
      setThreads(data.threads);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load threads");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await load();
      if (cancelled) return;
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const open = useCallback(async (persona: string, companion: string, v: number | null = null) => {
    setSelected({ persona, companion });
    setVersion(v);
    try {
      const params = new URLSearchParams({ persona, companion });
      if (v !== null) params.set("version", String(v));
      const data = (await adminFetch(`/api/admin/memory?${params}`)) as { thread: Thread; historical: Thread | null };
      setThread(data.thread);
      setHistorical(data.historical);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load the thread");
    }
  }, []);

  const rollback = async () => {
    if (!selected || version === null) return;
    try {
      await adminFetch("/api/admin/memory", {
        method: "POST",
        body: JSON.stringify({ persona: selected.persona, companion: selected.companion, version }),
        mutation: true,
      });
      window.alert(`rolled ${selected.persona} ↔ ${selected.companion} back to version ${version}`);
      await load();
      await open(selected.persona, selected.companion);
    } catch (e) {
      setError(e instanceof Error ? e.message : "rollback failed");
    }
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-white">Memory inspector</h1>
        <p className="text-sm text-white/40">
          {threads ? `${threads.length} threads` : "loading…"} — one per persona-companion pair that has talked
        </p>
      </header>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="max-h-[70dvh] space-y-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/30 p-3">
          {(threads ?? []).map((t) => (
            <button
              key={`${t.persona}:${t.companion}`}
              onClick={() => void open(t.persona, t.companion)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                selected?.persona === t.persona && selected?.companion === t.companion
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:bg-white/5"
              }`}
            >
              <span className="font-semibold">{t.persona}</span> ↔ {t.companion}
              <span className="block text-[11px] text-white/30">
                v{t.version} · {t.recentCount} recent · seq {t.seq}
              </span>
            </button>
          ))}
          {threads !== null && threads.length === 0 ? (
            <p className="px-2 py-4 text-sm text-white/40">no threads yet — memory writes as the room talks</p>
          ) : null}
        </aside>

        {thread ? (
          <section className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white">
                {thread.persona} ↔ {thread.companion}{" "}
                <span className="font-normal text-white/40">— {historical ? `viewing version ${version}` : `live, version ${thread.version}`}</span>
              </h2>
              <div className="flex items-center gap-2">
                {historical ? (
                  <button onClick={() => void open(thread.persona, thread.companion)} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/70 hover:bg-white/5">
                    back to live
                  </button>
                ) : null}
                {historical ? (
                  <button onClick={() => void rollback()} className="rounded-lg bg-amber-500/90 px-2.5 py-1 text-xs font-semibold text-black hover:bg-amber-400">
                    Restore v{version}
                  </button>
                ) : null}
              </div>
            </div>

            {historical ? (
              <p className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-200">
                Historical view — this is the snapshot taken before version {thread.version}. Restoring it adds
                a new version on top; nothing is lost.
              </p>
            ) : null}

            {thread.digest ? (
              <div className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3">
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">digest (agent 2)</h3>
                <p className="text-sm leading-relaxed text-white/80">{thread.digest}</p>
              </div>
            ) : null}

            <ul className="max-h-[45dvh] space-y-1.5 overflow-y-auto">
              {thread.recent.map((entry, i) => (
                <li
                  key={`${entry.seq}-${i}`}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    entry.role === "me" ? "bg-sky-500/10 text-sky-100" : "bg-white/5 text-white/80"
                  }`}
                >
                  <span className="mr-2 text-[10px] text-white/30">#{entry.seq} {entry.role === "me" ? thread.persona : thread.companion}</span>
                  {entry.text}
                </li>
              ))}
              {thread.recent.length === 0 ? <li className="text-sm text-white/40">empty buffer</li> : null}
            </ul>
          </section>
        ) : (
          <section className="flex items-center justify-center rounded-2xl border border-white/10 bg-black/30 p-8 text-sm text-white/40">
            pick a thread to read it
          </section>
        )}
      </div>
    </div>
  );
}
