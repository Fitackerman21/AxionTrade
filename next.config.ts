import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` opens sockets and optionally requires `pg-native`; keep it a real
  // server dependency instead of letting the bundler trace it.
  serverExternalPackages: ["pg"],
  // The dev server blocks cross-origin requests to its own assets by default, so
  // loading http://127.0.0.1:3000 (Playwright's default host, and what `next dev`
  // prints as an alternative to localhost) leaves the client bundle un-hydrated
  // and the live room stuck on its replay. Allowing the loopback alias fixes it.
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "financialmodelingprep.com" },
      { protocol: "https", hostname: "cdn.jsdelivr.net" },
      { protocol: "https", hostname: "assets.coincap.io" },
    ],
  },
};

export default nextConfig;
