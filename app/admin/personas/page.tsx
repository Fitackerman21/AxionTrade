"use client";

/**
 * Personas & members: edit what the room shows for each character — name, role,
 * bio, age, picture, avatar colours, online flag — and import new chat members
 * from a CSV. Edits become live in the community chat via /api/admin/roster.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";

import { adminFetch } from "@/lib/admin/client";

interface PersonaRow {
  id: string;
  name: string;
  role: string;
  g1: string;
  g2: string;
  color: string;
  online: boolean;
  overridden?: boolean;
  display?: never;
}
interface Editable {
  name: string;
  role: string;
  bio: string;
  age: string;
  picture: string;
  g1: string;
  g2: string;
  color: string;
  online: boolean;
}

interface MemberRow {
  email: string;
  name: string;
  bio: string | null;
  age: number | null;
  picture: string | null;
  batch: string | null;
}

export default function AdminPersonasPage() {
  const [personas, setPersonas] = useState<PersonaRow[] | null>(null);
  const [edits, setEdits] = useState<Record<string, Editable>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // members
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [csvResult, setCsvResult] = useState<{ inserted: number; skipped: number; errors: Array<{ line: number; reason: string }> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [newMember, setNewMember] = useState({ name: "", email: "", bio: "", age: "", picture: "" });
  const [memberMsg, setMemberMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = (await adminFetch("/api/admin/personas")) as { personas: PersonaRow[] };
      setPersonas(data.personas);
      setEdits(
        Object.fromEntries(
          data.personas.map((p) => [
            p.id,
            {
              name: p.name ?? "",
              role: p.role ?? "",
              bio: (p as unknown as { bio?: string }).bio ?? "",
              age: String((p as unknown as { age?: number }).age ?? ""),
              picture: (p as unknown as { picture?: string }).picture ?? "",
              g1: p.g1,
              g2: p.g2,
              color: p.color,
              online: p.online,
            },
          ]),
        ),
      );
      const roster = (await adminFetch("/api/admin/members")) as { members: MemberRow[] };
      setMembers(roster.members);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load personas");
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

  const save = async (id: string) => {
    const edit = edits[id];
    if (!edit) return;
    setStatus(`saving ${id}…`);
    try {
      await adminFetch("/api/admin/personas", {
        method: "POST",
        body: JSON.stringify({
          persona: id,
          display: {
            name: edit.name,
            role: edit.role,
            bio: edit.bio || null,
            age: edit.age === "" ? null : Number(edit.age),
            picture: edit.picture || null,
            g1: edit.g1,
            g2: edit.g2,
            color: edit.color,
            online: edit.online,
          },
        }),
        mutation: true,
      });
      setStatus(`${id} saved — the community page picks it up on its next roster read`);
      await load();
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : "save failed");
    }
  };

  const uploadCsv = async (file: File) => {
    setError(null);
    setCsvResult(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const result = (await adminFetch("/api/admin/members", {
        method: "POST",
        body: form,
        mutation: true,
      })) as { inserted: number; skipped: number; errors: Array<{ line: number; reason: string }> };
      setCsvResult(result);
      const roster = (await adminFetch("/api/admin/members")) as { members: MemberRow[] };
      setMembers(roster.members);
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    }
  };

  const createMember = async () => {
    setMemberMsg(null);
    try {
      await adminFetch("/api/admin/members", {
        method: "POST",
        body: JSON.stringify({
          name: newMember.name,
          email: newMember.email,
          bio: newMember.bio || undefined,
          age: newMember.age ? Number(newMember.age) : undefined,
          picture: newMember.picture || undefined,
        }),
        mutation: true,
      });
      setMemberMsg(`${newMember.name} added to the member roster`);
      setNewMember({ name: "", email: "", bio: "", age: "", picture: "" });
      const roster = (await adminFetch("/api/admin/members")) as { members: MemberRow[] };
      setMembers(roster.members);
    } catch (e) {
      setMemberMsg(null);
      setError(e instanceof Error ? e.message : "could not add the member");
    }
  };

  const setEdit = (id: string, patch: Partial<Editable>) =>
    setEdits((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id]!, ...patch } } : prev));

  if (!personas || !edits) return <p className="p-6 text-sm text-white/40">loading the roster…</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-white">Personas</h1>
        <p className="text-sm text-white/40">
          What the community page shows for each character. Saves apply live — no redeploy.
        </p>
      </header>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      {status ? <p className="text-sm text-emerald-300">{status}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {personas.map((p) => {
          const e = edits[p.id];
          if (!e) return null;
          return (
            <section key={p.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="mb-3 flex items-center gap-3">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-black"
                  style={{ background: `linear-gradient(135deg, ${e.g1}, ${e.g2})` }}
                >
                  {e.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <input
                    value={e.name}
                    onChange={(ev) => setEdit(p.id, { name: ev.target.value })}
                    className="w-full bg-transparent text-sm font-semibold text-white outline-none"
                  />
                  <input
                    value={e.role}
                    onChange={(ev) => setEdit(p.id, { role: ev.target.value })}
                    className="w-full bg-transparent text-xs text-white/50 outline-none"
                  />
                </div>
                <code className="text-[10px] text-white/30">{p.id}{p.overridden ? " *" : ""}</code>
              </div>

              <textarea
                value={e.bio}
                onChange={(ev) => setEdit(p.id, { bio: ev.target.value })}
                placeholder="bio — what the roster page says about them"
                rows={2}
                className="mb-2 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
              />
              <div className="mb-2 grid grid-cols-3 gap-2">
                <label className="text-[11px] text-white/40">
                  age
                  <input
                    value={e.age}
                    onChange={(ev) => setEdit(p.id, { age: ev.target.value.replace(/[^0-9]/g, "") })}
                    className="mt-0.5 w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
                  />
                </label>
                <label className="col-span-2 text-[11px] text-white/40">
                  picture URL
                  <input
                    value={e.picture}
                    onChange={(ev) => setEdit(p.id, { picture: ev.target.value })}
                    placeholder="https://…"
                    className="mt-0.5 w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
                  />
                </label>
              </div>
              <div className="mb-3 flex items-center gap-3">
                {(["g1", "g2", "color"] as const).map((field) => (
                  <label key={field} className="flex items-center gap-1.5 text-[11px] text-white/40">
                    {field}
                    <input
                      type="color"
                      value={e[field]}
                      onChange={(ev) => setEdit(p.id, { [field]: ev.target.value })}
                      className="h-7 w-9 cursor-pointer rounded border border-white/15 bg-transparent"
                    />
                  </label>
                ))}
                <label className="ml-auto flex items-center gap-1.5 text-[11px] text-white/60">
                  <input
                    type="checkbox"
                    checked={e.online}
                    onChange={(ev) => setEdit(p.id, { online: ev.target.checked })}
                  />
                  online
                </label>
              </div>
              <button
                onClick={() => void save(p.id)}
                className="w-full rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-semibold text-black hover:bg-emerald-400"
              >
                Save {p.id}
              </button>
            </section>
          );
        })}
      </div>

      <section className="rounded-2xl border border-white/10 bg-black/30 p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
          <Upload className="h-4 w-4" /> Chat room members — CSV upload
        </h2>
        <p className="mb-3 text-xs text-white/40">
          Columns: <code className="text-white/70">name, email, bio, age, picture</code> (only{" "}
          <code className="text-white/70">name</code> and <code className="text-white/70">email</code> are
          required; existing emails are updated in place).
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadCsv(file);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 hover:bg-white/5"
        >
          Choose a CSV file…
        </button>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">Add one member by hand</h3>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <input
              value={newMember.name}
              onChange={(e) => setNewMember((m) => ({ ...m, name: e.target.value }))}
              placeholder="name *"
              className="rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
            />
            <input
              value={newMember.email}
              onChange={(e) => setNewMember((m) => ({ ...m, email: e.target.value }))}
              placeholder="email *"
              className="rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
            />
            <input
              value={newMember.age}
              onChange={(e) => setNewMember((m) => ({ ...m, age: e.target.value.replace(/[^0-9]/g, "") }))}
              placeholder="age"
              className="rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
            />
            <input
              value={newMember.picture}
              onChange={(e) => setNewMember((m) => ({ ...m, picture: e.target.value }))}
              placeholder="picture URL"
              className="rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
            />
            <button
              onClick={() => void createMember()}
              disabled={!newMember.name.trim() || !newMember.email.trim()}
              className="rounded-lg bg-emerald-500/90 px-3 py-1.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
            >
              Add member
            </button>
          </div>
          <input
            value={newMember.bio}
            onChange={(e) => setNewMember((m) => ({ ...m, bio: e.target.value }))}
            placeholder="bio — what the room knows them by"
            className="mt-2 w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-sm text-white"
          />
          {memberMsg ? <p className="mt-2 text-xs text-emerald-300">{memberMsg}</p> : null}
        </div>
        {csvResult ? (
          <p className="mt-2 text-sm text-emerald-300">
            {csvResult.inserted} imported, {csvResult.skipped} skipped
            {csvResult.errors.length > 0 ? ` — ${csvResult.errors.length} rejected` : ""}
          </p>
        ) : null}
        {csvResult && csvResult.errors.length > 0 ? (
          <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-xs text-rose-300">
            {csvResult.errors.map((err) => (
              <li key={err.line}>
                line {err.line}: {err.reason}
              </li>
            ))}
          </ul>
        ) : null}
        {members.length > 0 ? (
          <div className="mt-3 max-h-52 overflow-y-auto rounded-xl border border-white/10">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-black/80 text-white/40">
                <tr>
                  <th className="px-3 py-1.5">name</th>
                  <th className="px-3 py-1.5">email</th>
                  <th className="px-3 py-1.5">age</th>
                  <th className="px-3 py-1.5">batch</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.email} className="border-t border-white/5 text-white/70">
                    <td className="px-3 py-1.5">{m.name}</td>
                    <td className="px-3 py-1.5 text-white/50">{m.email}</td>
                    <td className="px-3 py-1.5">{m.age ?? "—"}</td>
                    <td className="px-3 py-1.5 text-white/30">{m.batch ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
