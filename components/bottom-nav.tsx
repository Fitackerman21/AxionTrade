"use client";

import Link from "next/link";
import { Bot } from "lucide-react";

import { NAV_ITEMS, type NavKey } from "@/components/nav-items";
import { useAiSession } from "@/lib/ai-session";

/**
 * Mobile bottom navigation. Five distinct destinations, rendered from the same
 * list as the drawer and the desktop rail — Trade sits third so the raised
 * button lands dead centre. The raised button carries an AI badge because
 * trading on AxionTrade is autonomous.
 */
export function BottomNav({ active }: { active?: NavKey }) {
  const { session } = useAiSession();
  const running = session?.phase === "running";

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden"
      aria-label="Primary"
    >
      <div className="mx-auto grid max-w-md grid-cols-5">
        {NAV_ITEMS.map(({ key, icon: Icon, label, href }) => {
          const isActive = active === key;

          if (key === "trade") {
            return (
              <Link
                key={key}
                href={href}
                className="relative -mt-5 flex flex-col items-center"
                aria-label={label}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-gain text-[#071018] shadow-[0_10px_28px_-6px_rgba(46,144,250,0.6)] ring-4 ring-background transition-transform active:scale-95">
                  <Icon className="h-5.5 w-5.5" />
                  <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background bg-[#0b0e11]">
                    <Bot className={`h-3 w-3 ${running ? "text-gain" : "text-muted"}`} />
                    {running && <span className="absolute inset-0 animate-ping rounded-full bg-gain/30" />}
                  </span>
                </span>
                <span className={`mt-1 text-[10px] font-medium ${isActive ? "text-foreground" : "text-muted"}`}>
                  {label}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={key}
              href={href}
              className="flex flex-col items-center gap-1 py-2.5"
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className={`h-5 w-5 transition-colors ${isActive ? "text-brand" : "text-muted"}`} />
              <span
                className={`text-[10px] font-medium transition-colors ${
                  isActive ? "text-foreground" : "text-muted"
                }`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
