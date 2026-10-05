import { test, expect } from "@playwright/test";
import { apiRequest, waitForApp, clearStorage, selectCreationMode } from "./helpers";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

test.describe("单图编辑", () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page);
    await waitForApp(page);
  });

  /** 造一个「已有生成结果」的现场，避免为了测试真去打一次生图 API。 */
  async function seedGeneratedPack(page: import("@playwright/test").Page, count = 1) {
    const upload = await apiRequest(page.request, "post", "/api/uploads", {
      multipart: { file: { name: "ref.png", mimeType: "image/png", buffer: TINY_PNG } }
    });
    const ref = await upload.json();

    const stickerAssets: Array<{ uploadId: string }> = [];
    for (let i = 0; i < count; i++) {
      const up = await apiRequest(page.request, "post", "/api/uploads", {
        multipart: { file: { name: `s${i}.png`, mimeType: "image/png", buffer: TINY_PNG } }
      });
      stickerAssets.push(await up.json());
    }

    const packRes = await apiRequest(page.request, "post", "/api/packs", {
      headers: { "content-type": "application/json" },
      data: {
        presetId: "wechat_stickers",
        assets: stickerAssets.map((a, i) => ({
          label: String(i + 1).padStart(3, "0"),
          assetId: a.uploadId,
          role: "sticker",
          prompt: `第 ${i + 1} 张`,
          style: "贴纸"
        })),
        metadata: { title: "图片编辑测试" },
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
        title: "图片编辑测试",
        author: "tester",
        versionText: "",
        copyrightText: "",
        rewardEnabled: false,
        rewardMessage: "",
        stickerCount: count,
        styles: ["贴纸"],
        hasGenerationAttempted: true,
        result: {
          packId: pack.packId,
          downloadUrl: pack.downloadUrl,
          downloadFilename: pack.downloadFilename,
          stickers: stickerAssets.map((a, i) => ({
            label: String(i + 1).padStart(3, "0"),
            url: `/api/assets/${a.uploadId}`,
            assetId: a.uploadId,
            prompt: `第 ${i + 1} 张`
          })),
          meta: { count, styles: ["贴纸"], title: "图片编辑测试", presetId: "wechat_stickers" },
          extras: {}
        }
      }
    );
    await page.reload();
    await waitForApp(page);
    // 预览来自 AI 生成结果，切到 AI 模式才能看到提示词 / 提供商这些配置
    await selectCreationMode(page, "ai");
    return { packId: pack.packId as string, uploadId: ref.uploadId as string };
  }

  test("卡片上有编辑图片入口，弹窗能打开并带出当前图与常用修改", async ({ page }) => {
    test.setTimeout(90000);
    const { packId } = await seedGeneratedPack(page);

    const card = page.locator("#wechatAiPreview .preview-item").first();
    await expect(card).toBeAttached();
    const editBtn = card.locator('[data-action="edit-resource"]');
    await expect(editBtn).toBeVisible();
    await expect(editBtn).toContainText("编辑图片");

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
    const { packId } = await seedGeneratedPack(page);

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

  test("勾选「同时参考原始参考图」会把本包参考图作为附加参考图发出去", async ({ page }) => {
    test.setTimeout(120000);
    const { packId, uploadId } = await seedGeneratedPack(page);
    await page.selectOption("#wechatAiProvider", "mock");

    const card = page.locator("#wechatAiPreview .preview-item").first();
    await card.locator('[data-action="edit-resource"]').click();
    await expect(page.locator("#editDialog")).toBeVisible();
    await page.fill("#editInstruction", "让角色更贴近原始参考图");
    await page.check("#editUseOriginalRef");

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/api/generate/resource") && r.method() === "POST"),
      page.locator("#editDialogSubmit").click()
    ]);
    const body = JSON.parse(request.postData() || "{}");
    expect(body.editReferenceAssetId).toBe(uploadId);

    await expect(page.locator("#editDialog")).toBeHidden({ timeout: 60_000 });
    await apiRequest(page.request, "delete", `/api/packs/${packId}`);
  });

  test("上传一张附加参考图会先入库再作为 editReferenceAssetId 发出", async ({ page }) => {
    test.setTimeout(120000);
    const { packId } = await seedGeneratedPack(page);
    await page.selectOption("#wechatAiProvider", "mock");

    const card = page.locator("#wechatAiPreview .preview-item").first();
    await card.locator('[data-action="edit-resource"]').click();
    await expect(page.locator("#editDialog")).toBeVisible();
    await page.fill("#editInstruction", "换成这张图里的角色");
    await page.locator("#editReference").setInputFiles({
      name: "another-character.png",
      mimeType: "image/png",
      buffer: TINY_PNG
    });

    // 选了图之后，「用原始参考图」会被禁用（两者是同一个参数，避免歧义）
    await expect(page.locator("#editUseOriginalRef")).toBeDisabled();

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/api/generate/resource") && r.method() === "POST"),
      page.locator("#editDialogSubmit").click()
    ]);
    const body = JSON.parse(request.postData() || "{}");
    expect(typeof body.editReferenceAssetId).toBe("string");
    expect(body.editReferenceAssetId).not.toBe("");

    await expect(page.locator("#editDialog")).toBeHidden({ timeout: 60_000 });
    await apiRequest(page.request, "delete", `/api/packs/${packId}`);
  });

  test("编辑其中一张后，其它未编辑的图仍然正常显示", async ({ page }) => {
    test.setTimeout(120000);
    const { packId } = await seedGeneratedPack(page, 3);
    await page.selectOption("#wechatAiProvider", "mock");

    const cards = page.locator("#wechatAiPreview .preview-item");
    await expect(cards).toHaveCount(3);
    await expect(cards.locator("img")).toHaveCount(3);

    // 编辑第 3 张
    await cards.nth(2).locator('[data-action="edit-resource"]').click();
    await expect(page.locator("#editDialog")).toBeVisible();
    await page.fill("#editInstruction", "把背景换成浅蓝色");
    await page.locator("#editDialogSubmit").click();
    await expect(page.locator("#editDialog")).toBeHidden({ timeout: 60_000 });

    // 回归：三张都必须在，而且每张都还有 <img>（曾经这里是「只剩被编辑的那张」）
    await expect(cards).toHaveCount(3);
    await expect(cards.locator("img")).toHaveCount(3);
    await expect(page.locator("#wechatAiPreview .preview-edited-tag")).toHaveCount(1);
    // 根 tsconfig 没有 DOM lib，这里用 any 避免引入 DOM 类型
    const broken = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const imgs: Array<{ complete: boolean; naturalWidth: number }> = Array.from(
        doc.querySelectorAll("#wechatAiPreview .preview-item img")
      );
      return imgs.filter((img) => img.complete && img.naturalWidth === 0).length;
    });
    expect(broken).toBe(0);

    // 刷新后这些逐张信息（含「已编辑」标记）不能丢：持久化时曾经只存
    // label/url/assetId/prompt，导致刷新后标记消失、再次编辑不再记录来源。
    await page.reload();
    await waitForApp(page);
    await expect(page.locator("#wechatAiPreview .preview-item")).toHaveCount(3);
    await expect(page.locator("#wechatAiPreview .preview-item img")).toHaveCount(3);
    await expect(page.locator("#wechatAiPreview .preview-edited-tag")).toHaveCount(1);

    await apiRequest(page.request, "delete", `/api/packs/${packId}`);
  });

  test("刷新后再次编辑，以编辑后的版本为源（不会退回原图）", async ({ page }) => {
    test.setTimeout(120000);
    const { packId } = await seedGeneratedPack(page, 1);
    await page.selectOption("#wechatAiProvider", "mock");

    const card = page.locator("#wechatAiPreview .preview-item").first();
    await card.locator('[data-action="edit-resource"]').click();
    await page.fill("#editInstruction", "第一次修改");
    const [req1] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/api/generate/resource") && r.method() === "POST"),
      page.locator("#editDialogSubmit").click()
    ]);
    const firstBody = JSON.parse(req1.postData() || "{}");
    await expect(page.locator("#editDialog")).toBeHidden({ timeout: 60_000 });
    const editedSrc = await card.locator("img").getAttribute("src");
    expect(editedSrc).toBeTruthy();

    // 刷新：预览必须还是编辑后的图，标记也还在
    await page.reload();
    await waitForApp(page);
    // 刷新后创建方式默认回到「导入」，AI 配置区（含提供商选择）是隐藏的
    await page.locator("#creationModeAi").click({ force: true });
    await page.selectOption("#wechatAiProvider", "mock");
    const card2 = page.locator("#wechatAiPreview .preview-item").first();
    await expect(card2.locator(".preview-edited-tag")).toHaveCount(1);
    expect(await card2.locator("img").getAttribute("src")).toBe(editedSrc);

    // 再编辑一次：源必须是第一次编辑的结果，而不是最初那张
    await card2.locator('[data-action="edit-resource"]').click();
    await page.fill("#editInstruction", "第二次修改");
    const [req2] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/api/generate/resource") && r.method() === "POST"),
      page.locator("#editDialogSubmit").click()
    ]);
    const secondBody = JSON.parse(req2.postData() || "{}");
    expect(secondBody.sourceAssetId).not.toBe(firstBody.sourceAssetId);
    expect(editedSrc).toContain(secondBody.sourceAssetId);

    await expect(page.locator("#editDialog")).toBeHidden({ timeout: 60_000 });
    await apiRequest(page.request, "delete", `/api/packs/${packId}`);
  });
});
