import { test, expect } from "@playwright/test";

test.describe("认证流程", () => {
  test("未登录状态下操作按钮显示「登录」", async ({ page }) => {
    await page.goto("/");
    const loginBtn = page.locator("#loginBtn, .login-btn, a[href*='login']").first();
    await expect(loginBtn).toBeVisible();
  });

  test("登录页面可达", async ({ page }) => {
    await page.goto("/login.html");
    await expect(page.locator("#loginForm")).toBeVisible();
  });

  test("登录界面可输入邮箱密码", async ({ page }) => {
    await page.goto("/login.html");
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("button[type='submit']")).toBeVisible();
  });

  test("忘记密码页面可达", async ({ page }) => {
    await page.goto("/forgot-password.html");
    await expect(page.locator("h1, h2").filter({ hasText: /忘记|找回|密码/ })).toBeVisible();
  });

  test("密码重置页面可达（直接 URL）", async ({ page }) => {
    await page.goto("/reset-password.html");
    await expect(page.locator("#resetPasswordForm, #resetForm")).toBeAttached();
  });

  test("错误登录有错误提示", async ({ page }) => {
    await page.goto("/login.html");
    await page.fill("#email", "nonexist@test.com");
    await page.fill("#password", "wrongpass");
    await page.locator("button[type='submit']").click();
    // 应有错误消息
    await expect(page.locator(".toast-error, .toast, [role='alert'], #loginMsg")).toBeAttached({ timeout: 5_000 });
  });
});
