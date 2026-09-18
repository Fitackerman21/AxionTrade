"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, ChevronRight, LogOut, Menu, X } from "lucide-react";

import { BrandMark, BrandWordmark } from "@/components/brand";
import { LiveDot } from "@/components/live-price";
import { useLivePrices } from "@/components/live-prices";
import { NAV_ITEMS, isActive } from "@/components/nav-items";
import { useAccount } from "@/lib/account-store";
import { useAiSession } from "@/lib/ai-session";
import { signOut } from "@/lib/demo-auth";
import { INSTRUMENTS } from "@/lib/market-data";

const usd = (v: number, frac = 2) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: frac, maximumFractionDigits: frac })}`;

/**
 * Live portfolio value, derived from positions marked at live quotes. Returns
 * `null` until mounted so server and first client render agree.
 */
export function usePortfolioValue() {
  const { account } = useAccount();
  const { session } = useAiSession();
  const { quotes } = useLivePrices();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return useMemo(() => {
    if (!mounted) return null;
    let holdings = 0;
    for (const p of account.positions) {
      const q = quotes.get(p.symbol);
      const inst = INSTRUMENTS.find((i) => i.symbol === p.symbol);
      holdings += p.qty * (q?.price ?? inst?.price ?? 0);
    }
    const aiEquity = session?.equity ?? account.aiPrincipal;
    return {
      holdings,
      aiEquity,
      cash: account.cash,
      total: account.cash + holdings + aiEquity,
    };
  }, [mounted, account.positions, account.cash, account.aiPrincipal, quotes, session]);
}

/* ------------------------------ drawer -------------------------------- */

function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { session } = useAiSession();
  const totals = usePortfolioValue();

  // escape to close + lock the page behind the sheet
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Navigation">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="relative flex h-full w-[19rem] max-w-[86vw] flex-col border-r border-border bg-surface"
          >
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
              <BrandMark size={26} />
              <BrandWordmark />
              <button
                onClick={onClose}
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:text-foreground"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-4">
              {/* account snapshot */}
              <div className="mb-4 rounded-xl border border-border bg-background/40 p-3">
                <p className="text-[11px] text-muted">Portfolio value</p>
                <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
                  {totals ? usd(totals.total) : "—"}
                </p>
                <div className="mt-2 space-y-0.5 text-[11px] text-muted">
                  <div className="flex justify-between">
                    <span>Free funds</span>
                    <span className="font-mono tabular-nums">{totals ? usd(totals.cash) : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Invested</span>
                    <span className="font-mono tabular-nums">{totals ? usd(totals.holdings) : "—"}</span>
                  </div>
                  {totals && totals.aiEquity > 0 && (
                    <div className="flex justify-between">
                      <span className="text-brand">With AxAI</span>
                      <span className="font-mono tabular-nums text-brand">{usd(totals.aiEquity)}</span>
                    </div>
                  )}
                </div>
              </div>

              {session?.phase === "running" && (
                <Link
                  href="/trade"
                  onClick={onClose}
                  className="mb-4 flex items-center gap-2.5 rounded-xl border border-gain/30 bg-gain/8 px-3 py-2.5"
                >
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute h-full w-full animate-ping rounded-full bg-gain opacity-70" />
                    <span className="relative h-2 w-2 rounded-full bg-gain" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold text-gain">
                      AxAI is trading
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted tabular-nums">
                      {usd(session.equity, 0)} · {session.trades.length} fills
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                </Link>
              )}

              <nav aria-label="Primary">
                {NAV_ITEMS.map(({ key, href, label, blurb, icon: Icon }) => {
                  const active = isActive(pathname, href);
                  return (
                    <Link
                      key={key}
                      href={href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                        active ? "bg-brand/12" : "hover:bg-surface-2"
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                          active ? "border-brand/40 bg-brand/12" : "border-border bg-background/40"
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${active ? "text-brand" : "text-muted"}`} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13.5px] font-semibold ${active ? "text-foreground" : "text-foreground/90"}`}>
                          {label}
                        </span>
                        <span className="block truncate text-[11px] text-muted">{blurb}</span>
                      </span>
                      {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />}
                    </Link>
                  );
                })}
              </nav>

              <div className="mt-4 border-t border-border pt-4">
                <Link
                  href="/trade"
                  onClick={onClose}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <Bot className="h-4 w-4" />
                  AxAI engine
                  <ChevronRight className="ml-auto h-4 w-4" />
                </Link>
              </div>
            </div>

            <div className="shrink-0 border-t border-border p-3">
              <button
                onClick={() => {
                  signOut();
                  window.location.href = "/";
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------- header ------------------------------- */

export interface AppHeaderProps {
  /** Page-specific left content, rendered beside the menu button. */
  leading?: React.ReactNode;
  /** Page-specific controls, rendered on the right. */
  actions?: React.ReactNode;
  /** Show the live-feed pill (default true). */
  live?: boolean;
  className?: string;
}

/**
 * The one top bar for every authenticated route. Always carries a hamburger
 * that opens the app-wide drawer, so navigation is reachable from anywhere —
 * previously the only real nav surfaces were the desktop rail and a
 * mobile-only bottom bar.
 */
export function AppHeader({ leading, actions, live = true, className = "" }: AppHeaderProps) {
  const { connected } = useLivePrices();
  const [open, setOpen] = useState(false);

  return (
    <>
      <header
        className={`sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-2.5 backdrop-blur-md sm:px-4 ${className}`}
      >
        <button
          onClick={() => setOpen(true)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:border-muted/40 hover:text-foreground"
          aria-label="Open navigation menu"
          aria-haspopup="dialog"
        >
          <Menu className="h-4.5 w-4.5" />
        </button>

        {leading ?? <div className="flex-1" />}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {live && (
            <span className="hidden items-center gap-1.5 rounded-full border border-gain/25 bg-gain/8 px-2.5 py-1 text-[11px] font-semibold text-gain sm:inline-flex">
              <LiveDot connected={connected} />
              LIVE
            </span>
          )}
          {actions}
        </div>
      </header>

      <NavDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
