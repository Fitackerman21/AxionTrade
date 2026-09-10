"use client";

import { useState } from "react";
import { ChartCandlestick, CircleUser, House, ListOrdered, Search, Zap } from "lucide-react";

type Tab = "home" | "search" | "trade" | "orders" | "account";

const ITEMS: { key: Tab; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { key: "home", icon: House, label: "Home" },
  { key: "search", icon: Search, label: "Search" },
  { key: "trade", icon: Zap, label: "Trade" },
  { key: "orders", icon: ListOrdered, label: "Orders" },
  { key: "account", icon: CircleUser, label: "Account" },
];

export function BottomNav({ onTrade }: { onTrade?: () => void }) {
  const [active, setActive] = useState<Tab>("home");

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden"
      aria-label="Primary"
    >
      <div className="mx-auto grid max-w-md grid-cols-5">
        {ITEMS.map(({ key, icon: Icon, label }) => {
          const isActive = active === key;
          if (key === "trade") {
            return (
              <button
                key={key}
                onClick={() => {
                  setActive(key);
                  onTrade?.();
                }}
                className="relative -mt-5 flex flex-col items-center"
                aria-label="Trade"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-gain text-[#071018] shadow-[0_10px_28px_-6px_rgba(46,144,250,0.6)] ring-4 ring-background transition-transform active:scale-95">
                  <Icon className="h-5.5 w-5.5" />
                </span>
                <span className={`mt-1 text-[10px] font-medium ${isActive ? "text-foreground" : "text-muted"}`}>
                  {label}
                </span>
              </button>
            );
          }
          return (
            <button
              key={key}
              onClick={() => setActive(key)}
              className="flex flex-col items-center gap-1 py-2.5"
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className={`h-5 w-5 transition-colors ${isActive ? "text-brand" : "text-muted"}`} />
              <span className={`text-[10px] font-medium transition-colors ${isActive ? "text-foreground" : "text-muted"}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Desktop keeps the candle icon in the sidebar; imported here so the icon set stays consistent. */
export const NAV_ICONS = { ChartCandlestick };
