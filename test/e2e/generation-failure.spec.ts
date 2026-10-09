import { test, expect } from "@playwright/test";
import { apiRequest, waitForApp, clearStorage, selectCreationMode } from "./helpers";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * 回归：生成中途失败时，本轮已经成功生成的贴纸不能被清空。
 *
 * 直接 stub 掉 `/api/generate/start` 与 `/api/generate/stream`：先推一张
 * 成功贴纸，再推一个 error 事件，验证预览里那张仍然在。
 */
test.describe("生成失败保留已成功图片", () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await waitForApp(page);
  });

  test("中途失败后已生成的贴纸仍显示在预览里", async ({ page }) => {
    test.setTimeout(90_000);

    // 一张真实存在的贴纸资源，保证 <img> 能加载出来
    const stickerUp = await apiRequest(page.request, "post", "/api/uploads", {
      multipart: { file: { name: "ok.png", mimeType: "image/png", buffer: TINY_PNG } }
    });
    const sticker = await stickerUp.json();
    const assetId = sticker.uploadId as string;

    // 进入 AI 模式并上传参考图（走真实上传接口）
    await selectCreationMode(page, "ai");
    await page.locator("#aiSourceSection #file").setInputFiles({
      name: "ref.png",
      mimeType: "image/png",
      buffer: TINY_PNG
    });
    await expect(page.locator("#originalPreview")).toHaveAttribute("src", /\/api\/assets\//, {
      timeout: 15_000
    });

    await page.fill("#wechatAiPrompt", "一只可爱的角色");
    await page.fill("#wechatAiTitle", "失败保留测试");
    await page.fill("#wechatAiAuthor", "tester");
    await page.selectOption("#wechatAiProvider", "mock").catch(() => {});

    // stub 生成任务：先成功一张，再报错
    await page.route("**/api/generate/start", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ taskId: "e2e-fail-task" })
      })
    );
    const sse = [
      `event: start\ndata: ${JSON.stringify({ count: 1 })}\n\n`,
      `event: sticker\ndata: ${JSON.stringify({
        label: "001",
        assetId,
        url: `/api/assets/${assetId}`,
        prompt: "一只可爱的角色",
        style: "贴纸",
        emotion: "开心",
        current: 1,
        total: 1
      })}\n\n`,
      `event: error\ndata: ${JSON.stringify({ message: "模拟生成失败" })}\n\n`
    ].join("");
    await page.route("**/api/generate/stream**", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
        body: sse
      })
    );

    await page.locator("#generateSubmit").click();

    // 生成失败，但已成功的那张必须还在
    await expect(page.locator("#generateState")).toContainText("生成失败", { timeout: 30_000 });
    const cards = page.locator("#wechatAiPreview .preview-item");
    await expect(cards).toHaveCount(1);
    await expect(cards.first().locator("img")).toHaveAttribute("src", new RegExp(`/api/assets/${assetId}`));
    await expect(page.locator("#wechatAiFeedback")).toContainText("仍可预览");
  });
});
