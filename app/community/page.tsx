import type { Metadata } from "next";

import { AuroraBackground } from "@/components/aurora-background";
import { CommunityChat } from "@/components/community-chat";

export const metadata: Metadata = {
  title: "Axion — Community",
  description: "The Axion trading community — traders and the AxAI engine in one room.",
};

export default function CommunityPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <AuroraBackground />
      <div className="relative z-10 h-dvh py-3">
        <CommunityChat />
      </div>
    </main>
  );
}
