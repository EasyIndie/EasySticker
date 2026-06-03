import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "node_modules/**",
      "dist/**",
      "test/e2e/**", // Playwright E2E tests — run with `npx playwright test`
    ],
  },
});
