import { test, expect } from "@playwright/test";
import { waitForApp, selectCreationMode, selectPlatform, clearStorage } from "./helpers";

test.describe("导入模式流程", () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await waitForApp(page);
  });

  test("默认显示导入文件区且包含上传 input", async ({ page }) => {
    await expect(page.locator("#importSourceSection")).toBeVisible();
    // 6个 input[type=file] → 用 first()
    const fileInput = page.locator("#importSourceSection input[type='file']").first();
    await expect(fileInput).toBeAttached();
  });

  test("步骤 2 标签默认为「导入已有表情图」", async ({ page }) => {
    const label = page.locator('.step-nav-item[data-step="1"] .step-nav-label');
    await expect(label).toHaveText("导入已有表情图");
  });

  test("步骤导航第 2 项点击后跳转到导入区", async ({ page }) => {
    await page.locator('.step-nav-item[data-step="1"]').click();
    await expect(page.locator("#importSourceSection")).toBeVisible();
  });

  test("选择平台后导入区仍可见", async ({ page }) => {
    await selectPlatform(page, "wechat_stickers");
    await expect(page.locator("#importSourceSection")).toBeVisible();
  });

  test("导入区有拖拽上传提示", async ({ page }) => {
    const hint = page.locator("#importSourceSection").filter({ hasText: /拖拽|drag|上传/ });
    await expect(hint).toBeVisible();
  });

  test("主文件上传 input 的 accept 属性包含图片类型", async ({ page }) => {
    const input = page.locator("#importFiles");
    await expect(input).toBeAttached();
    const accept = await input.getAttribute("accept");
    expect(accept).toContain("image");
  });
});
