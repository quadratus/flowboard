import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against the running stack. Default target: the compose web service on :8080.
 * In Docker (make e2e-web) the target is http://web, set through E2E_BASE_URL.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: false, // the tests change shared seed data, so they run one at a time
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
