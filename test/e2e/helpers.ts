import { expect, type Page } from "@playwright/test";

/** 等待服务就绪 */
export async function waitForApp(page: Page) {
  await page.goto("/");
  // 页面没有 #app wrapper — 用主内容区替代
  await expect(page.locator("#mainContent")).toBeAttached({ timeout: 15_000 });
}

/** 选择创建方式（AI 或 导入） */
export async function selectCreationMode(page: Page, mode: "ai" | "import") {
  // radio 被 label 覆盖指针事件，使用 force 或点击关联 label
  const radioId = mode === "ai" ? "creationModeAi" : "creationModeImport";
  const label = page.locator(`label[for="${radioId}"]`);
  if (await label.isVisible().catch(() => false)) {
    await label.click();
  } else {
    await page.locator(`#${radioId}`).click({ force: true });
  }
}

/** 选择平台（使用完整平台值如 wechat_stickers） */
export async function selectPlatform(page: Page, platform: string) {
  const el = page.locator(`[data-platform="${platform}"]`);
  try {
    await el.click({ timeout: 3_000 });
  } catch {
    await el.click({ force: true });
  }
}

/** 点击某一步的导航 */
export async function clickStepNav(page: Page, stepIndex: number) {
  await page.locator(`.step-nav-item[data-step="${stepIndex}"]`).click();
}

/** 断言当前活动的 step card */
export async function expectActiveStep(page: Page, stepIndex: number) {
  const card = page.locator(`.step-card[data-step-index="${stepIndex}"]`);
  await expect(card).toBeVisible();
}

/** 等待生成完成 */
export async function waitForGenerationComplete(page: Page) {
  await expect(page.locator(".sticker-preview-card")).toBeAttached({
    timeout: 60_000,
  });
}

/** 登录 */
export async function login(page: Page, email: string, password: string) {
  await page.goto("/login.html");
  await page.fill("#loginEmail", email);
  await page.fill("#loginPassword", password);
  await page.click("#loginSubmit");
  await expect(page.locator(".toast-success, .toast-info")).toBeAttached({
    timeout: 5_000,
  });
}

/** 获取 toast 消息 */
export async function getToastMessage(page: Page): Promise<string> {
  const toast = page.locator(".toast:visible");
  return (await toast.textContent()) || "";
}

/** 等待 toast 消失 */
export async function waitForToastDisappear(page: Page) {
  await expect(page.locator(".toast")).not.toBeVisible({ timeout: 10_000 });
}

/** 清除 localstorage — 在 page.goto 之后调用 */
export async function clearStorage(page: Page) {
  try {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  } catch {
    // 如果页面还没导航到服务 origin，跳过
  }
}
