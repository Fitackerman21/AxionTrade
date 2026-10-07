"use client";

/**
 * The admin shell: a token gate, a sidebar, and the pages in between.
 *
 * The token lives in `sessionStorage` under a key distinct from the site's demo
 * auth, and every fetch the dashboard makes attaches it as `x-admin-token`. GETs
 * may also pass `?token=` in the URL — that is what the token prompt's first read
 * does — but mutations only ever send the header, because a URL gets logged.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import {
  Activity,
  Brain,
  Gauge,
  MessageSquare,
  ScrollText,
  Users,
  Unlock,
} from "lucide-react";

import { AuroraBackground } from "@/components/aurora-background";
import { readAdminToken, saveAdminToken } from "@/lib/admin/client";

const TokenContext = createContext<string>("");

/** Pages read the token through this so a save in the shell re-renders them. */
export function useAdminToken(): string {
  return useContext(TokenContext);
}

const NAV = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/log", label: "Log & moderation", icon: ScrollText },
  { href: "/admin/personas", label: "Personas", icon: Users },
  { href: "/admin/memory", label: "Memory", icon: Brain },
  { href: "/admin/controls", label: "Room controls", icon: Activity },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [token, setTokenState] = useState("");
  const [checked, setChecked] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // sessionStorage is sync but only exists client-side; reading it inside a
    // microtask keeps the effect body free of synchronous setState.
    Promise.resolve().then(() => {
      if (cancelled) return;
      setTokenState(readAdminToken());
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const verify = async (candidate: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/admin/stats?token=${encodeURIComponent(candidate)}`, {
        cache: "no-store",
      });
      if (response.status === 401) throw new Error("that token was rejected");
      if (response.status === 503) throw new Error("ADMIN_TOKEN is not configured on the server");
      if (!response.ok) throw new Error(`the server answered ${response.status}`);
      saveAdminToken(candidate);
      setTokenState(candidate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "verification failed");
    }
  };

  if (!checked) {
    return (
      <main className="relative flex min-h-dvh items-center justify-center">
        <AuroraBackground />
      </main>
    );
  }

  if (!token) {
    return (
      <main className="relative flex min-h-dvh items-center justify-center px-4">
        <AuroraBackground />
        <form
          className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-black/40 p-6 backdrop-blur"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(input);
          }}
        >
          <div className="mb-1 flex items-center gap-2 text-lg font-semibold text-white">
            <Unlock className="h-5 w-5 text-emerald-300" /> Axion admin
          </div>
          <p className="mb-4 text-sm text-white/50">
            Enter the admin token (<code className="text-white/70">ADMIN_TOKEN</code>). It stays in
            this browser session only.
          </p>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="admin token"
            className="mb-3 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/60"
            autoFocus
          />
          {error ? <p className="mb-3 text-sm text-rose-300">{error}</p> : null}
          <button
            type="submit"
            className="w-full rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-semibold text-black hover:bg-emerald-400"
          >
            Unlock dashboard
          </button>
        </form>
      </main>
    );
  }

  return (
    <TokenContext.Provider value={token}>
      <main className="relative min-h-dvh">
        <AuroraBackground />
        <div className="relative z-10 mx-auto flex max-w-7xl gap-6 px-4 py-6">
          <aside className="hidden w-52 shrink-0 md:block">
            <div className="sticky top-6 space-y-1">
              <Link href="/" className="mb-4 block px-3 text-sm font-semibold tracking-wide text-white/70 hover:text-white">
                ← AxionTrade
              </Link>
              {NAV.map((item) => {
                const active = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                      active ? "bg-white/10 font-semibold text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <Icon className="h-4 w-4" /> {item.label}
                  </Link>
                );
              })}
              <Link
                href="/community"
                className="mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white"
              >
                <MessageSquare className="h-4 w-4" /> Open community
              </Link>
            </div>
          </aside>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>
    </TokenContext.Provider>
  );
}
