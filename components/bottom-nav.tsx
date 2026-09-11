"use client";

import { useRouter } from "next/navigation";
import { Bot, CircleUser, House, Zap } from "lucide-react";

type Tab = "home" | "trade" | "ai" | "account";

const ITEMS: { key: Tab; icon: React.ComponentType<{ className?: string }>; label: string; href: string }[] = [
  { key: "home", icon: House, label: "Home", href: "/" },
  { key: "trade", icon: Zap, label: "Trade", href: "/trade" },
  { key: "ai", icon: Bot, label: "AxAI", href: "/ai" },
  { key: "account", icon: CircleUser, label: "Account", href: "/account" },
];

/**
 * Mobile bottom navigation. Every tab routes to a real page; `active`
 * pins the highlighted tab on pages that own a fixed identity.
 * The Trade tab is the raised gradient FAB.
 */
export function BottomNav({ active }: { active?: Tab }) {
  const router = useRouter();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden"
      aria-label="Primary"
    >
      <div className="mx-auto grid max-w-md grid-cols-4">
        {ITEMS.map(({ key, icon: Icon, label, href }) => {
          const isActive = active === key;
          if (key === "trade") {
            return (
              <button
                key={key}
                onClick={() => router.push(href)}
                className="relative -mt-5 flex flex-col items-center"
                aria-label={label}
                aria-current={isActive ? "page" : undefined}
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
              onClick={() => router.push(href)}
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
