import { test, expect } from "@playwright/test";
import { apiRequest, waitForApp, clearStorage, selectCreationMode } from "./helpers";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

test.describe("单图二次编辑", () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await waitForApp(page);
  });

  /** 造一个「已有生成结果」的现场，避免为了测试真去打一次生图 API。 */
  async function seedGeneratedPack(page: import("@playwright/test").Page) {
    const upload = await apiRequest(page.request, "post", "/api/uploads", {
      multipart: { file: { name: "ref.png", mimeType: "image/png", buffer: TINY_PNG } }
    });
    const ref = await upload.json();

    const stickerUpload = await apiRequest(page.request, "post", "/api/uploads", {
      multipart: { file: { name: "s.png", mimeType: "image/png", buffer: TINY_PNG } }
    });
    const stickerAsset = await stickerUpload.json();

    const packRes = await apiRequest(page.request, "post", "/api/packs", {
      headers: { "content-type": "application/json" },
      data: {
        presetId: "wechat_stickers",
        assets: [{ label: "001", assetId: stickerAsset.uploadId, role: "sticker", prompt: "第一张", style: "贴纸" }],
        metadata: { title: "二次编辑测试" },
        generation: { source: "ai-generate", providerId: "mock", prompt: "Q版人物", styles: ["贴纸"] }
      }
    });
    const pack = await packRes.json();

    await page.evaluate(
      (payload) => localStorage.setItem("easysticker:last-wechat-pack", JSON.stringify(payload)),
      {
        platform: "wechat_stickers",
        savedAt: new Date().toISOString(),
        uploadId: ref.uploadId,
        prompt: "Q版人物",
        provider: "mock",
        title: "二次编辑测试",
        author: "tester",
        versionText: "",
        copyrightText: "",
        rewardEnabled: false,
        rewardMessage: "",
        stickerCount: 1,
        styles: ["贴纸"],
        hasGenerationAttempted: true,
        result: {
          packId: pack.packId,
          downloadUrl: pack.downloadUrl,
          downloadFilename: pack.downloadFilename,
          stickers: [
            {
              label: "001",
              url: `/api/assets/${stickerAsset.uploadId}`,
              assetId: stickerAsset.uploadId,
              prompt: "Q版人物"
            }
          ],
          meta: { count: 1, styles: ["贴纸"], title: "二次编辑测试", presetId: "wechat_stickers" },
          extras: {}
        }
      }
    );
    await page.reload();
    await waitForApp(page);
    // 预览来自 AI 生成结果，切到 AI 模式才能看到提示词 / 提供商这些配置
    await selectCreationMode(page, "ai");
    return pack.packId as string;
  }

  test("卡片上有二次编辑入口，弹窗能打开并带出当前图与常用修改", async ({ page }) => {
    test.setTimeout(90000);
    const packId = await seedGeneratedPack(page);

    const card = page.locator("#wechatAiPreview .preview-item").first();
    await expect(card).toBeAttached();
    const editBtn = card.locator('[data-action="edit-resource"]');
    await expect(editBtn).toBeVisible();
    await expect(editBtn).toContainText("二次编辑");

    await editBtn.click();
    await expect(page.locator("#editDialog")).toBeVisible();
    await expect(page.locator("#editDialogTarget")).toContainText("第 1 张表情");
    await expect(page.locator("#editDialogImage")).toHaveAttribute("src", /\/api\/assets\//);
    // 常用修改：点一下追加进输入框
    await expect(page.locator("#editChips .edit-chip").first()).toBeVisible();
    await page.locator("#editChips .edit-chip").first().click();
    await expect(page.locator("#editInstruction")).not.toHaveValue("");

    // Esc 关闭
    await page.keyboard.press("Escape");
    await expect(page.locator("#editDialog")).toBeHidden();

    await apiRequest(page.request, "delete", `/api/packs/${packId}`);
  });

  test("提交修改要求只会重做这一张，并标记为「已编辑」", async ({ page }) => {
    test.setTimeout(120000);
    const packId = await seedGeneratedPack(page);

    // 用 mock 提供商，测的是链路而不是真去调生图 API
    await page.selectOption("#wechatAiProvider", "mock");

    const card = page.locator("#wechatAiPreview .preview-item").first();
    const beforeSrc = await card.locator("img").getAttribute("src");

    await card.locator('[data-action="edit-resource"]').click();
    await expect(page.locator("#editDialog")).toBeVisible();
    await page.fill("#editInstruction", "把背景换成浅蓝色");

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/api/generate/resource") && r.method() === "POST"),
      page.locator("#editDialogSubmit").click()
    ]);

    const body = JSON.parse(request.postData() || "{}");
    expect(body.mode).toBe("edit");
    expect(body.instruction).toBe("把背景换成浅蓝色");
    expect(typeof body.sourceAssetId).toBe("string");
    expect(body.target).toEqual({ kind: "sticker", index: 0 });

    await expect(page.locator("#editDialog")).toBeHidden({ timeout: 60_000 });
    await expect(page.locator("#globalNotice")).toContainText("已更新为编辑后的新版本", { timeout: 60_000 });

    // 换成了新资源，并打上「已编辑」标记
    await expect(card.locator("img")).not.toHaveAttribute("src", beforeSrc ?? "");
    await expect(card.locator(".preview-edited-tag")).toHaveText("已编辑");

    await apiRequest(page.request, "delete", `/api/packs/${packId}`);
  });
});
