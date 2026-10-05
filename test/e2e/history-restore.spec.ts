import { test, expect } from "@playwright/test";
import { waitForApp, clearStorage } from "./helpers";

// 1×1 透明 PNG：上传接口不校验尺寸，只要字节是合法 PNG 即可
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

async function seedHistory(page: import("@playwright/test").Page, entry: Record<string, unknown>) {
  await page.goto("/");
  await clearStorage(page);
  await page.evaluate((e) => {
    localStorage.setItem("easysticker:pack-history", JSON.stringify([e]));
  }, entry);
  await page.reload();
  await waitForApp(page);
}

test.describe("历史记录一键还原", () => {
  test("点「还原现场」能按 packId 还原服务端已存的包", async ({ page }) => {
    // 用 API 造一个真实存在于服务端的包
    const upload = await page.request.post("/api/uploads", {
      multipart: { file: { name: "sticker.png", mimeType: "image/png", buffer: TINY_PNG } }
    });
    expect(upload.ok()).toBe(true);
    const { uploadId } = await upload.json();

    const packRes = await page.request.post("/api/packs", {
      data: {
        presetId: "wechat_stickers",
        assets: [
          {
            label: "001",
            assetId: uploadId,
            role: "sticker",
            prompt: "历史还原提示词\n风格：贴纸",
            style: "贴纸",
            emotion: "开心"
          }
        ],
        metadata: { title: "历史还原测试包", author: "tester" },
        generation: {
          source: "ai-generate",
          providerId: "mock",
          prompt: "历史还原原始提示词",
          styles: ["贴纸"],
          stickerCount: 1
        }
      }
    });
    expect(packRes.ok()).toBe(true);
    const { packId } = await packRes.json();

    await seedHistory(page, {
      packId,
      title: "历史还原测试包",
      author: "tester",
      stickerCount: 1,
      styles: "贴纸",
      rewardEnabled: false,
      platformLabel: "微信表情",
      platform: "wechat_stickers",
      createdAt: Date.now(),
      downloadUrl: `/api/packs/${packId}/download`,
      downloadFilename: `${packId}.zip`
    });

    await page.locator("#historyToggle").click();
    const item = page.locator(`.history-item[data-pack-id="${packId}"]`);
    await expect(item).toBeVisible();
    await expect(item.locator(".history-restore-btn")).toContainText("还原现场");

    await item.locator(".history-restore-btn").click();

    // 预览重建 + 下载链接接上 + 提示还原成功
    await expect(page.locator("#wechatAiPreview .preview-item")).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator("#wechatAiZipLink .download-button")).toBeAttached({ timeout: 10_000 });
    await expect(page.locator("#globalNotice")).toContainText("已还原", { timeout: 10_000 });
    // 包里的标题写回了表单
    await expect(page.locator("#wechatAiTitle")).toHaveValue("历史还原测试包");
  });

  test("包已被清理时退回「只恢复配置」并给出提示", async ({ page }) => {
    await seedHistory(page, {
      packId: "zzzzzzzzzzzzzzzzzzzzz",
      title: "已删除的包",
      author: "tester",
      stickerCount: 12,
      styles: "贴纸",
      rewardEnabled: false,
      platformLabel: "微信表情",
      platform: "wechat_stickers",
      createdAt: Date.now(),
      downloadUrl: "/api/packs/zzzzzzzzzzzzzzzzzzzzz/download",
      downloadFilename: "gone.zip"
    });

    await page.locator("#historyToggle").click();
    await page.locator(".history-item[data-pack-id='zzzzzzzzzzzzzzzzzzzzz'] .history-restore-btn").click();

    await expect(page.locator("#globalNotice")).toContainText("已只恢复配置", { timeout: 10_000 });
    // 标题等配置仍然恢复
    await expect(page.locator("#wechatAiTitle")).toHaveValue("已删除的包");
  });
});
