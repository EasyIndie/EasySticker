import { test, expect } from "@playwright/test";
import { waitForApp, selectCreationMode, selectPlatform, clearStorage } from "./helpers";

// 1×1 透明 PNG，足够走通「导入 → 标准化」。
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * 非微信平台的导入回归：/generate/import 的 presetId 走 URL query，
 * 否则服务端读不到 multipart body 字段、回落到微信，2 张会被「至少 8 张」拒绝。
 */
test.describe("非微信平台导入", () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await waitForApp(page);
  });

  for (const platform of ["telegram_static", "whatsapp_webp"]) {
    test(`${platform} 导入 2 张 PNG 成功且被标准化`, async ({ page }) => {
      await selectPlatform(page, platform);
      await selectCreationMode(page, "import");

      // 导入接受多种输入格式（服务端会统一转成平台格式）
      const accept = await page.locator("#importFiles").getAttribute("accept");
      expect(accept).toContain("image/png");
      expect(accept).toContain("image/webp");

      await page.locator("#importFiles").setInputFiles([
        { name: "a.png", mimeType: "image/png", buffer: PNG_1x1 },
        { name: "b.png", mimeType: "image/png", buffer: PNG_1x1 }
      ]);
      await page.locator("#generateSubmit").click();

      await expect(page.locator("#importState")).toHaveText(/导入完成|已完成/, { timeout: 30_000 });
      await expect(page.locator("#wechatAiPreview .preview-item")).toHaveCount(2);
    });
  }
});
