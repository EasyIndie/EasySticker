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
  reporter: "list",
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

  // 未指定 BASE_URL 时自动起测试服务端：
  // 开发模式（保留 mock）、关闭鉴权、放宽限流与匿名配额。
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npm run build && node dist/server.js",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        // e2e 反复运行会耗尽默认匿名配额，且空 data 首次启动会开启鉴权。
        env: { RATE_LIMIT_MAX: "600", DAILY_QUOTA_ANONYMOUS_MAX: "500", DISABLE_AUTH: "1" },
      },
});
