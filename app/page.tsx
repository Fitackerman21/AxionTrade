"use client";

/**
 * Root route = auth gate. Signed-in visitors land on the workspace;
 * everyone else is bounced to the sign-in page at /signin. The sign-in
 * screen itself lives at app/signin/page.tsx.
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
    if (authed === false) router.replace("/signin");
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
