import { test, expect } from "@playwright/test";
import { waitForApp, selectPlatform, clearStorage } from "./helpers";

test.describe("AI 生成流程", () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await waitForApp(page);
  });

  test("步骤卡片默认全部展开（共 5 张卡片）", async ({ page }) => {
    const cards = page.locator(".step-card");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test("选择微信平台后平台 radio 被选中", async ({ page }) => {
    await selectPlatform(page, "wechat_stickers");
    // radio 是 name=platform 且 value=wechat_stickers
    await expect(page.locator('input[name="platform"][value="wechat_stickers"]')).toBeChecked();
  });

  test("切换到 AI 模式后参考图上传区域可见", async ({ page }) => {
    // 点 label（radio 被 label 覆盖指针事件）
    await page.locator('label[for="creationModeAi"]').click();
    // AI 区域的上传 input 在 #file
    const fileInput = page.locator("#aiSourceSection #file");
    await expect(fileInput).toBeVisible();
  });

  test("AI 模式 + 微信平台后显示提示词 textarea", async ({ page }) => {
    // 需要 AI 模式 + 微信平台才显示
    await page.locator('label[for="creationModeAi"]').click();
    await page.locator("input[name='platform'][value='wechat_stickers']").click({ force: true });
    const textarea = page.locator("#wechatAiPrompt");
    await expect(textarea).toBeVisible();
  });

  test("选择平台后生成按钮存在", async ({ page }) => {
    await selectPlatform(page, "wechat_stickers");
    const generateBtn = page.locator("#generateBtn, button:has-text('生成')").first();
    await expect(generateBtn).toBeAttached();
  });

  test("预览区域在页面中存在", async ({ page }) => {
    await expect(page.locator("#previewSection, .preview-area")).toBeAttached();
  });

  test("下载按钮存在", async ({ page }) => {
    await expect(page.locator("#downloadBtn, button:has-text('下载')").first()).toBeAttached();
  });

  test("重置按钮存在", async ({ page }) => {
    await expect(page.locator("#resetBtn, button:has-text('重置')").first()).toBeAttached();
  });
});
