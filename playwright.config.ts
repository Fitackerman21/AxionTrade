import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end config for the live room.
 *
 * The `/community` page is driven against a real Next dev server, because the
 * point of these tests is the real path: `GET/POST /api/forum/messages`, the
 * lazy catch-up that wakes the room, and a reply from an actual persona.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    // Running as root in a container: the browser sandbox is unavailable.
    launchOptions: { args: ["--no-sandbox"] },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/community",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
