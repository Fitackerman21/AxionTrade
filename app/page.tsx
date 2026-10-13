"use client";

/**
 * Root route = auth gate. Signed-in visitors land on the workspace; everyone else is
 * bounced to the marketing home page at /home, which is the intended front door for
 * axiontrade.vercel.app. The sign-in screen itself lives at app/signin/page.tsx, and
 * /home links into the community room, which carries a Start Trading CTA to /signin.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { BrandMark } from "@/components/brand";
import { DashboardShell } from "@/components/dashboard-shell";
import { useRequireAuth } from "@/lib/demo-auth";
import { AppProviders } from "@/lib/providers";

export default function GatePage() {
  const router = useRouter();
  // null = still checking (SSR-safe), false = bounce, true = workspace.
  const authed = useRequireAuth();

  useEffect(() => {
    if (authed === false) router.replace("/home");
  }, [authed, router]);

  if (authed !== true) {
    return (
      <div className="flex min-h-dvh items-center justify-center gap-3 text-sm text-muted">
        <BrandMark size={28} />
        <span>Entering Axion…</span>
      </div>
    );
  }

  return (
    <AppProviders>
      <DashboardShell />
    </AppProviders>
  );
}
