import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createFileAssetStore } from "../src/lib/assets";
import { loadPromptConfig } from "../src/services/generate/promptConfig";
import { generateWechatExtras } from "../src/services/generate/extras";

/**
 * 扩展资源（cover/icon/banner/reward）现在按「单张失败不中断整包」处理：
 * 一张失败只记录到 failures 并发出带 error 的 extra 事件，其余继续生成，
 * 让整包仍可产出，前端据此显示失败卡片并支持单资源重生成。
 */
describe("generateWechatExtras — 单资源失败不中断整包", () => {
  it("赞赏感谢图失败时其余资源仍生成，并记录 failures", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-extras-"));
    const assetStore = createFileAssetStore(dataDir);
    const promptConfig = loadPromptConfig();
    const events: Array<{ event: string; data: any }> = [];

    const client = {
      async generateImage(input: { prompt: string }) {
        if (input.prompt.includes("感谢打赏")) {
          throw Object.assign(new Error("模拟失败"), { statusCode: 502 });
        }
        const bytes = await sharp({
          create: { width: 1024, height: 1024, channels: 4, background: { r: 10, g: 200, b: 120, alpha: 1 } }
        })
          .png()
          .toBuffer();
        return { mime: "image/png", bytes };
      }
    };

    try {
      const result = await generateWechatExtras(
        {
          assetStore,
          presetId: "wechat_stickers",
          client,
          promptConfig,
          prompt: "Q版大头",
          styles: ["贴纸"],
          referenceMode: "base64",
          referenceBase64: "",
          emit: (event, data) => events.push({ event, data })
        },
        {
          includeCover: true,
          includeIcon: true,
          includeBanner: true,
          enableReward: true,
          currentGenerated: 0,
          totalImageCount: 5
        }
      );

      expect(result.coverAssetId).toBeTypeOf("string");
      expect(result.iconAssetId).toBeTypeOf("string");
      expect(result.bannerAssetId).toBeTypeOf("string");
      expect(result.rewardGuideAssetId).toBeTypeOf("string");
      expect(result.rewardThanksAssetId).toBeUndefined();
      expect(result.failures.rewardThanksAssetId).toContain("模拟失败");

      const failedEvent = events.find((e) => e.event === "extra" && e.data.key === "rewardThanksAssetId");
      expect(failedEvent).toBeTruthy();
      expect(failedEvent?.data.assetId).toBeNull();
      expect(failedEvent?.data.error).toContain("模拟失败");
      // 其余四张成功
      expect(events.filter((e) => e.event === "extra" && e.data.assetId).length).toBe(4);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
