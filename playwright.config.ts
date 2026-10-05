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

  // 没有显式指定 BASE_URL 时，由 Playwright 起一个专用服务端。
  // e2e 会在几十秒内集中打上百个 API，默认的 30 req/min 限流（另有单测覆盖）
  // 会把测试打成 flaky，所以这里放宽；已有的服务端会被复用。
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: process.env.CI
          ? "npm run build && NODE_ENV=production node dist/server.js"
          : "npm run build && node dist/server.js",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
        // 每日生成配额也放宽：e2e 反复跑会把匿名配额（默认 10/天）用光
        env: { RATE_LIMIT_MAX: "600", DAILY_QUOTA_ANONYMOUS_MAX: "500" },
      },
});
