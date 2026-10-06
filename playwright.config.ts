import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end config for the live room.
 *
 * By default it drives a local dev server. Set `PLAYWRIGHT_BASE_URL` to point the
 * same spec at a deployed room — that is the only way to prove the serverless
 * shape end to end, since the point is a real POST answering from a real store:
 *
 *   PLAYWRIGHT_BASE_URL=https://axiontrade.vercel.app npm run test:e2e
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // Generous: a cold room wakes through bounded catch-up before it answers.
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    // Running as root in a container: the browser sandbox is unavailable.
    launchOptions: { args: ["--no-sandbox"] },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(isLocal
    ? {
        webServer: {
          command: "npm run dev",
          url: "http://localhost:3000/community",
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }
    : {}),
});
