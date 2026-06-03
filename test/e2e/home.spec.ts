import { test, expect } from "@playwright/test";
import { waitForApp, selectCreationMode, selectPlatform, clickStepNav, expectActiveStep, clearStorage } from "./helpers";

test.describe("首页和导航", () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await waitForApp(page);
  });

  test("页面加载正常，标题和操作区可见", async ({ page }) => {
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("#stepNav")).toBeVisible();
    // stickyActionBar 初始 hidden（未开始生成）
    await expect(page.locator("#stickyActionBar")).toHaveAttribute("hidden");
  });

  test("默认打开导入模式", async ({ page }) => {
    await expect(page.locator("#creationModeImport")).toBeChecked();
    await expect(page.locator("#creationModeAi")).not.toBeChecked();
    await expect(page.locator("#importSourceSection")).toBeVisible();
  });

  test("切换到 AI 模式时显示 AI 区并隐藏导入区", async ({ page }) => {
    await selectCreationMode(page, "ai");
    await expect(page.locator("#aiSourceSection")).toBeVisible();
    await expect(page.locator("#importSourceSection")).not.toBeVisible();
  });

  test("步骤导航栏包含 5 项，顺序正确", async ({ page }) => {
    const items = page.locator(".step-nav-item");
    await expect(items).toHaveCount(5);
    const label0 = items.nth(0).locator(".step-nav-label");
    await expect(label0).toHaveText("选择创建方式与平台");
  });

  test("点击步骤导航跳转到对应版块", async ({ page }) => {
    await clickStepNav(page, 2);
    await expectActiveStep(page, 2);
  });

  test("平台选择可见并包含主流平台", async ({ page }) => {
    await expect(page.locator("#platformSelector")).toBeVisible();
    await expect(page.locator('[data-platform="wechat_stickers"]')).toBeVisible();
  });

  test("导入模式下步骤 2 标签显示「导入已有表情图」", async ({ page }) => {
    const step2Label = page.locator('.step-nav-item[data-step="1"] .step-nav-label');
    await expect(step2Label).toHaveText("导入已有表情图");
  });

  test("切换到 AI 模式后步骤 2 标签变更为「上传参考图」", async ({ page }) => {
    await selectCreationMode(page, "ai");
    const step2Label = page.locator('.step-nav-item[data-step="1"] .step-nav-label');
    await expect(step2Label).toHaveText("上传参考图");
  });

  test("暗黑模式切换按钮存在且可点击", async ({ page }) => {
    const toggle = page.locator("#darkModeToggle");
    await expect(toggle).toBeVisible();
    // 可点击即可，不校验具体切换行为
    await expect(toggle).toBeEnabled();
  });
});
