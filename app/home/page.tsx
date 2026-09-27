import type { Metadata } from "next";

import HomeClient from "./home-client";

export const metadata: Metadata = {
  title: "AxionTrade — Every market. One terminal. One AI engine.",
  description:
    "Stocks, ETFs, crypto, FX and commodities in a single professional terminal, with the AxAI engine trading alongside you — simulated fills, live pricing, millisecond refresh.",
};

export default function HomePage() {
  return <HomeClient />;
}
