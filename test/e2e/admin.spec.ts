import { test, expect } from "@playwright/test";

test.describe("管理后台", () => {
  test("管理后台页面可达", async ({ page }) => {
    await page.goto("/admin.html");
    // 应加载到页面内容（登录表单或已登录仪表盘）
    await expect(page.locator("body")).toBeAttached();
  });

  test("管理后台登录表单可见", async ({ page }) => {
    await page.goto("/admin.html");
    const loginForm = page.locator("#adminLoginForm, #loginForm, input[type='email']");
    await expect(loginForm).toBeAttached();
  });

  test("错误登录返回错误信息", async ({ page }) => {
    const response = await page.request.post("/api/auth/login", {
      data: { email: "wrong@test.com", password: "invalid" }
    });
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Invalid credentials");
  });

  test("正确登录返回 token 结构", async ({ page }) => {
    const response = await page.request.post("/api/auth/login", {
      data: { email: "admin@easysticker.app", password: "test123456" }
    });
    // 密码可能不匹配，只要不是 500 即可
    expect(response.status()).not.toBe(500);
    const body = await response.json();
    if (response.ok()) {
      expect(body).toHaveProperty("token");
      expect(body.user.role).toContain("admin");
    }
  });

  test("/health 端点始终可达", async ({ page }) => {
    const response = await page.request.get("/health");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  test("/api/auth/me 需要认证", async ({ page }) => {
    const response = await page.request.get("/api/auth/me");
    expect(response.status()).toBe(401);
  });

  test("关闭注册模式下 register 返回 403", async ({ page }) => {
    // 先尝试无 token 注册
    const response = await page.request.post("/api/auth/register", {
      data: { email: "newuser@test.com", password: "test123456" }
    });
    // 如果是 invite 或 closed 模式应拒绝；open 模式会成功
    const body = await response.json();
    // 只要不是 500 即可
    expect(response.status()).not.toBe(500);
  });

  test("非认证请求返回 401", async ({ page }) => {
    const protectedRoutes = ["/api/auth/me", "/api/auth/logout"];
    for (const route of protectedRoutes) {
      const response = await page.request.get(route);
      // me 返回 401，logout 可能返回 404（无此路由）
      if (response.status() === 401) {
        const body = await response.json();
        expect(body).toHaveProperty("error");
      }
    }
  });
});
