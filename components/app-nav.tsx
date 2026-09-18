"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, ChartLine, CircleUser, House, LogOut, PieChart, Wallet } from "lucide-react";

import { BrandMark, BrandWordmark } from "@/components/brand";
import { useAccount } from "@/lib/account-store";
import { useAiSession } from "@/lib/ai-session";
import { signOut } from "@/lib/demo-auth";
import { useLivePrices } from "@/components/live-prices";
import { INSTRUMENTS, formatPrice } from "@/lib/market-data";

const NAV = [
  { href: "/", label: "Overview", icon: House },
  { href: "/holdings", label: "Holdings", icon: PieChart },
  { href: "/trade", label: "Trade", icon: ChartLine },
  { href: "/account", label: "Account", icon: CircleUser },
] as const;

const fmtUsd = (v: number, frac = 2) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: frac, maximumFractionDigits: frac })}`;

/**
 * Desktop navigation rail. The bottom nav is mobile-only (`lg:hidden`), which
 * previously left desktop with no in-app navigation at all — this is the
 * primary wayfinding surface from `lg` upward.
 */
export function AppNav() {
  const pathname = usePathname();
  const { account } = useAccount();
  const { session } = useAiSession();
  const { quotes } = useLivePrices();

  // portfolio value needs live marks, and must stay stable across SSR/hydration
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  let holdings = 0;
  for (const p of account.positions) {
    const q = quotes.get(p.symbol);
    const inst = INSTRUMENTS.find((i) => i.symbol === p.symbol);
    const price = q?.price ?? inst?.price ?? 0;
    holdings += p.qty * price;
  }
  const aiEquity = session?.equity ?? account.aiPrincipal;
  const total = account.cash + holdings + aiEquity;

  return (
    <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-border bg-surface/40 backdrop-blur lg:flex">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <BrandMark size={26} />
        <BrandWordmark />
      </div>

      <nav className="px-3 py-4" aria-label="Primary">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-brand/12 text-foreground"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <Icon className={`h-4.5 w-4.5 ${active ? "text-brand" : ""}`} />
              {label}
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand" />}
            </Link>
          );
        })}

        <Link
          href="/trade#ai-terminal"
          className="mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <Bot className="h-4.5 w-4.5" />
          AxAI engine
          {session?.phase === "running" && (
            <span className="ml-auto flex h-2 w-2">
              <span className="absolute h-2 w-2 animate-ping rounded-full bg-gain opacity-70" />
              <span className="relative h-2 w-2 rounded-full bg-gain" />
            </span>
          )}
        </Link>
      </nav>

      <div className="mt-auto space-y-3 border-t border-border p-4">
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <p className="inline-flex items-center gap-1.5 text-[11px] text-muted">
            <Wallet className="h-3 w-3" /> Portfolio value
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {mounted ? fmtUsd(total) : "—"}
          </p>
          <div className="mt-2 flex justify-between text-[11px] text-muted">
            <span>Free funds</span>
            <span className="font-mono tabular-nums">{mounted ? fmtUsd(account.cash) : "—"}</span>
          </div>
          {account.aiPrincipal > 0 && (
            <div className="mt-0.5 flex justify-between text-[11px] text-muted">
              <span>With AxAI</span>
              <span className="font-mono tabular-nums">{fmtUsd(aiEquity)}</span>
            </div>
          )}
        </div>

        <button
          onClick={() => {
            signOut();
            window.location.href = "/";
          }}
          className="inline-flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:text-foreground"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}

/** Wraps page content so it sits beside the desktop rail. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full">
      <AppNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Small live ticker used in the desktop top area of the trade page. */
export function MiniTicker({ symbols }: { symbols: string[] }) {
  const { quotes } = useLivePrices();
  return (
    <div className="hidden shrink-0 items-center gap-4 2xl:flex">
      {symbols.map((s) => {
        const q = quotes.get(s);
        const inst = INSTRUMENTS.find((i) => i.symbol === s);
        if (!q || !inst) return null;
        const up = q.changePct >= 0;
        return (
          <span key={s} className="inline-flex items-center gap-1.5 text-[12px]">
            <span className="font-semibold">{s}</span>
            <span className="font-mono tabular-nums text-muted">{formatPrice(q.price, inst.kind)}</span>
            <span className={`font-mono tabular-nums ${up ? "text-gain" : "text-loss"}`}>
              {up ? "+" : ""}
              {q.changePct.toFixed(2)}%
            </span>
          </span>
        );
      })}
    </div>
  );
}
