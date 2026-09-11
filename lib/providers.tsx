"use client";

import { AiSessionProvider } from "@/lib/ai-session";
import { AccountProvider } from "@/lib/account-store";
import { LivePricesProvider } from "@/components/live-prices";

/**
 * Shared client-side provider stack for all authenticated pages:
 * live market data → demo account → AI trading session.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <LivePricesProvider>
      <AccountProvider>
        <AiSessionProvider>{children}</AiSessionProvider>
      </AccountProvider>
    </LivePricesProvider>
  );
}
