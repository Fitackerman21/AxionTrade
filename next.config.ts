import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` opens sockets and optionally requires `pg-native`; keep it a real
  // server dependency instead of letting the bundler trace it.
  serverExternalPackages: ["pg"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "financialmodelingprep.com" },
      { protocol: "https", hostname: "cdn.jsdelivr.net" },
      { protocol: "https", hostname: "assets.coincap.io" },
    ],
  },
};

export default nextConfig;
