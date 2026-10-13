"use client";

/**
 * Users: every account created through /signin.
 *
 * The password code is shown here by design — it is the only credential a user
 * holds, and this is where support recovers it when someone loses the screenshot.
 * It is masked by default so the list can be read in company, and revealed per row.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Eye, EyeOff, RefreshCw, Search, UserRound } from "lucide-react";

import { adminFetch } from "@/lib/admin/client";

interface DirectoryUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  dateOfBirth: string;
  city: string;
  password: string;
  createdAt: number;
}

function when(t: number): string {
  if (!t) return "—";
  return new Date(t).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CodeCell({ code }: { code: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be blocked in an insecure context; the code is still selectable
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <code className="font-mono text-xs text-white/80">
        {shown ? code : "AXN-••••-••••"}
      </code>
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Hide password code" : "Reveal password code"}
        className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
      >
        {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy password code"
        className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<DirectoryUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const data = (await adminFetch("/api/admin/users")) as { users: DirectoryUser[] };
      setUsers(data.users ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load the user directory");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  const filtered = useMemo(() => {
    if (!users) return [];
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.fullName, u.username, u.email, u.city].some((f) => f.toLowerCase().includes(q)),
    );
  }, [users, query]);

  if (error && !users) return <p className="p-6 text-sm text-rose-300">{error}</p>;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Users</h1>
          <p className="text-sm text-white/40">
            {users ? `${users.length} registered account${users.length === 1 ? "" : "s"}` : "loading…"}
            {" · "}password codes are kept here for recovery.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users…"
              className="h-9 w-52 rounded-lg border border-white/15 bg-black/40 pl-9 pr-3 text-sm text-white outline-none focus:border-emerald-400/60"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </header>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      {!users ? (
        <p className="text-sm text-white/40">loading the directory…</p>
      ) : users.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/30 p-8 text-center">
          <UserRound className="mx-auto h-8 w-8 text-white/25" />
          <p className="mt-3 text-sm text-white/60">No accounts yet.</p>
          <p className="mt-1 text-xs text-white/35">
            Accounts appear here as soon as someone creates one on /signin.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/30">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-white/40">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Username</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Date of birth</th>
                <th className="px-4 py-3 font-semibold">City</th>
                <th className="px-4 py-3 font-semibold">Password code</th>
                <th className="px-4 py-3 font-semibold">Joined</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                  <td className="px-4 py-3 text-white">{u.fullName}</td>
                  <td className="px-4 py-3 text-white/70">@{u.username}</td>
                  <td className="px-4 py-3 text-white/70">{u.email}</td>
                  <td className="px-4 py-3 text-white/70">{u.dateOfBirth}</td>
                  <td className="px-4 py-3 text-white/70">{u.city}</td>
                  <td className="px-4 py-3">
                    <CodeCell code={u.password} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-white/40">{when(u.createdAt)}</td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-white/40">
                    No users match “{query}”.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
