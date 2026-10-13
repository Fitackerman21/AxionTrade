"use client";

/**
 * Community: the name and description the overview modal shows when the header is
 * tapped on /community. Saved to the admin settings table, so it is live on the
 * room's next community read — no redeploy.
 */

import { useCallback, useEffect, useState } from "react";

import { adminFetch } from "@/lib/admin/client";

interface CommunityProfile {
  name: string;
  description: string;
}

export default function AdminCommunityPage() {
  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = (await adminFetch("/api/admin/community")) as { community: CommunityProfile };
      setProfile(data.community);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load the community profile");
    }
  }, []);

  // Deferred a task so the first read cannot set state during the render commit
  // (the same shape the community chat uses for its first transcript fetch).
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  const save = async () => {
    if (!profile) return;
    setBusy(true);
    setStatus(null);
    try {
      await adminFetch("/api/admin/community", {
        method: "POST",
        body: JSON.stringify(profile),
        mutation: true,
      });
      setStatus("saved — the community page picks it up on its next read");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  };

  if (!profile) return <p className="p-6 text-sm text-white/40">loading the community profile…</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-white">Community</h1>
        <p className="text-sm text-white/40">
          What the room shows on the overview when someone taps its header.
        </p>
      </header>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      {status ? <p className="text-sm text-emerald-300">{status}</p> : null}

      <section className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
        <label className="block text-xs font-semibold uppercase tracking-wider text-white/40">
          Name
          <input
            value={profile.name}
            maxLength={60}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm font-normal text-white outline-none focus:border-emerald-400/60"
          />
        </label>
        <label className="block text-xs font-semibold uppercase tracking-wider text-white/40">
          Description
          <textarea
            value={profile.description}
            maxLength={600}
            rows={5}
            onChange={(e) => setProfile({ ...profile, description: e.target.value })}
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm font-normal text-white outline-none focus:border-emerald-400/60"
          />
        </label>
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/30">{profile.description.length}/600</span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || profile.name.trim() === "" || profile.description.trim() === ""}
            className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
          >
            {busy ? "saving…" : "Save community"}
          </button>
        </div>
      </section>
    </div>
  );
}
