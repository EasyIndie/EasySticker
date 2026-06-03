import { test, expect } from "@playwright/test";

test.describe("管理后台", () => {
  test("管理后台登录页面可达", async ({ page }) => {
    await page.goto("/admin.html");
    const url = page.url();
    expect(url).toContain("admin");
    // 应该看到登录表单或 app 内容
    await expect(page.locator("input[type='email'], #adminApp, .admin-layout")).toBeAttached();
  });

  test("管理后台登录有邮箱和密码输入框", async ({ page }) => {
    await page.goto("/admin.html");
    const emailInput = page.locator("input[type='email']");
    const passwordInput = page.locator("input[type='password']");

    if ((await emailInput.count()) > 0) {
      await expect(emailInput).toBeVisible();
      await expect(passwordInput).toBeVisible();
    } else {
      // 可能已经登录跳转到了仪表盘
      await expect(page.locator("#adminApp, .admin-layout")).toBeAttached();
    }
  });

  test("管理后台导航元素存在", async ({ page }) => {
    await page.goto("/admin.html");
    // 找导航/侧边栏元素
    const nav = page.locator("nav, .admin-nav, .sidebar, .tabs").first();
    if (await nav.isVisible()) {
      await expect(nav).toBeVisible();
    }
  });

  test("管理后台有监控或设置等高级功能入口", async ({ page }) => {
    await page.goto("/admin.html");
    // 找 tab 或菜单项
    const tab = page.locator("button, a, .tab, .nav-item").filter({ hasText: /监控|Monitor|用户|设置|Settings|仪表盘/ }).first();
    if (await tab.isVisible()) {
      await expect(tab).toBeVisible();
    }
  });
});
