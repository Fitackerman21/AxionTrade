"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AiPanel } from "@/components/ai-panel";
import { BottomNav } from "@/components/bottom-nav";
import { BrandMark } from "@/components/brand";
import { LiveDot } from "@/components/live-price";
import { useLivePrices } from "@/components/live-prices";
import { useRequireAuth } from "@/lib/demo-auth";
import { AppProviders } from "@/lib/providers";

function AiInner() {
  const authed = useRequireAuth();
  const { connected } = useLivePrices();

  if (authed === null) {
    return <div className="flex min-h-dvh items-center justify-center text-sm text-muted">Loading…</div>;
  }

  if (authed === false) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <BrandMark size={40} />
        <h1 className="text-xl font-semibold">Sign in to access the AI engine</h1>
        <p className="max-w-xs text-sm text-muted">AxAI is available to signed-in members of this demo workspace.</p>
        <Link
          href="/"
          className="rounded-xl bg-gradient-to-r from-brand to-gain px-5 py-2.5 text-sm font-semibold text-[#071018]"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md">
        <Link
          href="/"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:text-foreground"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </Link>
        <span className="text-sm font-semibold tracking-tight">AxAI Terminal</span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-gain/25 bg-gain/8 px-2.5 py-1 text-[11px] font-semibold text-gain">
          <LiveDot connected={connected} />
          LIVE DATA
        </span>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-4 pt-4 pb-28 sm:px-6 lg:pb-8">
        <AiPanel />
      </main>

      <BottomNav active="trade" />
    </div>
  );
}

export default function AiPage() {
  return (
    <AppProviders>
      <AiInner />
    </AppProviders>
  );
}
