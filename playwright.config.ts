import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 15_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [
    ["list"],
  ],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "off",
    screenshot: process.env.CI ? "only-on-failure" : "off",
    actionTimeout: 5_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: process.env.CI
    ? {
        command: "npm run build && NODE_ENV=production node dist/server.js",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
