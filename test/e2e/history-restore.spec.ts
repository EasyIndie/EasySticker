import { test, expect } from "@playwright/test";
import { apiRequest, waitForApp, clearStorage } from "./helpers";

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
    test.setTimeout(90000);
    // 用 API 造一个真实存在于服务端的包
    const upload = await apiRequest(page.request, "post", "/api/uploads", {
      multipart: { file: { name: "sticker.png", mimeType: "image/png", buffer: TINY_PNG } }
    });
    expect(upload.ok()).toBe(true);
    const { uploadId } = await upload.json();

    const packRes = await apiRequest(page.request, "post", "/api/packs", {
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

    // 不留测试垃圾：把这次造出来的包删掉
    await apiRequest(page.request, "delete", `/api/packs/${packId}`);
  });

  test("还原 AI 生成的历史包会还原创建方式 / 预设 / 自定义 / 风格 / 数量", async ({ page }) => {
    test.setTimeout(90000);
    const upload = await apiRequest(page.request, "post", "/api/uploads", {
      multipart: { file: { name: "sticker.png", mimeType: "image/png", buffer: TINY_PNG } }
    });
    const { uploadId } = await upload.json();

    const packRes = await apiRequest(page.request, "post", "/api/packs", {
      data: {
        presetId: "wechat_stickers",
        assets: [
          { label: "001", assetId: uploadId, role: "sticker", prompt: "预设+自定义", style: "贴纸", emotion: "开心" }
        ],
        metadata: { title: "AI 还原测试" },
        generation: {
          source: "ai-generate",
          providerId: "mock",
          prompt: "预设内容\n自定义补充",
          promptPreset: "daily",
          promptCustom: "自定义补充",
          promptMode: "append",
          styles: ["贴纸"],
          stickerCount: 1
        }
      }
    });
    expect(packRes.ok()).toBe(true);
    const { packId } = await packRes.json();

    await seedHistory(page, {
      packId,
      title: "AI 还原测试",
      author: "",
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
    await page.locator(`.history-item[data-pack-id="${packId}"] .history-restore-btn`).click();
    await expect(page.locator("#wechatAiPreview .preview-item")).toHaveCount(1, { timeout: 20_000 });

    // 创建方式：AI 生图（以前会被硬编码成导入）
    await expect(page.locator("#creationModeAi")).toBeChecked();
    // 预设 + 自定义文本（自定义框不能塞进合并后的整段）
    await expect(page.locator("#wechatAiPromptPreset")).toHaveValue("daily");
    await expect(page.locator("#wechatAiPrompt")).toHaveValue("自定义补充");
    // 风格 chip
    await expect(page.locator('#wechatAiStyleOptions .style-chip[data-selected="true"]')).toHaveText("贴纸");
    // 数量
    await expect(page.locator("#wechatAiCount")).toHaveValue("1");

    await apiRequest(page.request, "delete", `/api/packs/${packId}`);
  });

  test("服务端已不存在的包会被标为已过期并置灰", async ({ page }) => {
    const goneId = "zzzzzzzzzzzzzzzzzzzzz";
    await seedHistory(page, {
      packId: goneId,
      title: "已删除的包",
      author: "tester",
      stickerCount: 12,
      styles: "贴纸",
      rewardEnabled: false,
      platformLabel: "微信表情",
      platform: "wechat_stickers",
      createdAt: Date.now(),
      downloadUrl: `/api/packs/${goneId}/download`,
      downloadFilename: "gone.zip"
    });

    await page.locator("#historyToggle").click();
    const item = page.locator(`.history-item[data-pack-id="${goneId}"]`);
    await expect(item).toBeVisible();
    // 会先探测一次服务端，确认真的没了才标记
    await expect(item.locator(".history-tag")).toHaveText("已过期", { timeout: 15_000 });
    await expect(item).toHaveClass(/history-item-missing/);
    await expect(item.locator(".history-restore-btn")).toBeDisabled();
    await expect(item.locator(".history-dl-btn")).toBeDisabled();
  });

  test("删除记录会同时删掉服务端的包", async ({ page }) => {
    const upload = await apiRequest(page.request, "post", "/api/uploads", {
      multipart: { file: { name: "s.png", mimeType: "image/png", buffer: TINY_PNG } }
    });
    const { uploadId } = await upload.json();
    const packRes = await apiRequest(page.request, "post", "/api/packs", {
      data: {
        presetId: "wechat_stickers",
        assets: [{ label: "001", assetId: uploadId, role: "sticker" }],
        metadata: { title: "待删除的包" }
      }
    });
    const { packId } = await packRes.json();
    expect((await page.request.get(`/api/packs/${packId}`)).status()).toBe(200);

    await seedHistory(page, {
      packId,
      title: "待删除的包",
      stickerCount: 1,
      styles: "贴纸",
      platform: "wechat_stickers",
      createdAt: Date.now(),
      downloadUrl: `/api/packs/${packId}/download`,
      downloadFilename: `${packId}.zip`
    });

    await page.locator("#historyToggle").click();
    await expect(page.locator(`.history-item[data-pack-id="${packId}"]`)).toBeVisible();
    await page.locator(`.history-item[data-pack-id="${packId}"] .history-delete-btn`).click();

    await expect(page.locator(`.history-item[data-pack-id="${packId}"]`)).toHaveCount(0, { timeout: 10_000 });
    // 服务端的包也一起没了
    expect((await page.request.get(`/api/packs/${packId}`)).status()).toBe(404);
  });

  test("本地记录被清掉后，服务端列表会把历史补回来", async ({ page }) => {
    test.setTimeout(90000);
    const clientId = "e2eclient000001";
    const upload = await apiRequest(page.request, "post", "/api/uploads", {
      multipart: { file: { name: "s.png", mimeType: "image/png", buffer: TINY_PNG } }
    });
    const { uploadId } = await upload.json();
    const packRes = await apiRequest(page.request, "post", "/api/packs", {
      headers: { "x-client-id": clientId, "content-type": "application/json" },
      data: {
        presetId: "wechat_stickers",
        assets: [{ label: "001", assetId: uploadId, role: "sticker" }],
        metadata: { title: "服务端补回来的包" }
      }
    });
    const { packId } = await packRes.json();

    // 模拟「本地记录丢了，但设备标识还在」：只留 client id，history 清空
    await page.goto("/");
    await clearStorage(page);
    await page.evaluate((id) => localStorage.setItem("easysticker:client-id", id), clientId);
    await page.reload();
    await waitForApp(page);

    // 不用做任何事，服务端列表会把记录补回来
    await expect(page.locator(`.history-item[data-pack-id="${packId}"]`)).toBeAttached({ timeout: 15_000 });

    await apiRequest(page.request, "delete", `/api/packs/${packId}`, { headers: { "x-client-id": clientId } });
  });

  test("清空历史会同时删掉服务端的包，刷新后不再回来", async ({ page }) => {
    test.setTimeout(90000);
    const clientId = "e2eclient000002";
    const upload = await apiRequest(page.request, "post", "/api/uploads", {
      multipart: { file: { name: "s.png", mimeType: "image/png", buffer: TINY_PNG } }
    });
    const { uploadId } = await upload.json();
    const packRes = await apiRequest(page.request, "post", "/api/packs", {
      headers: { "x-client-id": clientId, "content-type": "application/json" },
      data: {
        presetId: "wechat_stickers",
        assets: [{ label: "001", assetId: uploadId, role: "sticker" }],
        metadata: { title: "要被清空的包" }
      }
    });
    const { packId } = await packRes.json();

    await page.goto("/");
    await clearStorage(page);
    await page.evaluate((id) => localStorage.setItem("easysticker:client-id", id), clientId);
    await page.reload();
    await waitForApp(page);
    await expect(page.locator(`.history-item[data-pack-id="${packId}"]`)).toBeAttached({ timeout: 15_000 });

    page.on("dialog", (dialog) => void dialog.accept());
    await page.locator("#historyToggle").click();
    await page.locator("#clearHistory").click();

    await expect(page.locator(".history-item")).toHaveCount(0, { timeout: 10_000 });
    // 服务端也删了，所以刷新不会「复活」
    await page.reload();
    await waitForApp(page);
    await page.waitForTimeout(1200);
    await expect(page.locator(".history-item")).toHaveCount(0);
    expect((await page.request.get(`/api/packs/${packId}`)).status()).toBe(404);
  });
});
