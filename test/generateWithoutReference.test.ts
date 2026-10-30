import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { buildApp } from "../src/app";
import { createFileAssetStore } from "../src/lib/assets";
import * as promptConfigModule from "../src/services/generate/promptConfig";

/**
 * 没有参考图时的生成 / 编辑能力。
 *
 * 典型场景：用户已经导入了几张成品图，想用其中一张继续补齐剩余表情。
 * 此时原包没有「上传的参考图」，但编辑用 sourceAssetId、重生成用包内图片
 * 作为参考仍然应该可用；整包生成也允许纯文生图。
 */
describe("没有参考图时的生成与编辑", { timeout: 30_000 }, () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-noref-"));
  const assetStore = createFileAssetStore(dataDir);
  const app = buildApp(
    { host: "127.0.0.1", port: 0, dataDir, logLevel: "silent", security: { jwtSecret: "test-secret-noref" } },
    { assetStore }
  );

  const originalConfig = promptConfigModule.loadPromptConfig();
  vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
    ...originalConfig,
    ai: {
      ...originalConfig.ai,
      defaultProvider: "mock",
      providers: { ...originalConfig.ai.providers, mock: { type: "mock", name: "本地模拟" } }
    }
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function solidPng(width = 64, height = 64): Promise<Buffer> {
    return sharp({
      create: { width, height, channels: 4, background: { r: 200, g: 120, b: 60, alpha: 1 } }
    })
      .png()
      .toBuffer();
  }

  function parseSseEvents(body: string) {
    const normalized = body.replace(/\r\n/g, "\n");
    return normalized
      .split("\n\n")
      .filter((block) => block.trim())
      .map((block) => {
        let event = "message";
        let dataText = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) dataText += (dataText ? "\n" : "") + line.slice(5).trim();
        }
        return { event, data: dataText ? JSON.parse(dataText) : null };
      });
  }

  it("单张重生成可以只带 prompt + 包内 sourceAssetId，不要求原包参考图", async () => {
    const sourceId = "imported-sticker-1";
    assetStore.save(await solidPng(240, 240), sourceId, "png");

    const res = await app.inject({
      method: "POST",
      url: "/api/generate/resource",
      payload: {
        presetId: "wechat_stickers",
        prompt: "同一只柴犬，补一个开心的表情",
        // 补齐时不选风格：显式传空数组，表示不写入任何风格描述。
        styles: [],
        target: { kind: "sticker", index: 4 },
        mode: "regenerate",
        sourceAssetId: sourceId
      },
      headers: { "content-type": "application/json" }
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.assetId).toBeTypeOf("string");
    expect(json.label).toBe("005");
    // 显式 styles: [] 表示不使用任何风格：不写「画面风格」段，也不记录 style。
    expect(json.style).toBeUndefined();
    expect(json.prompt).not.toContain("画面风格");
    expect(assetStore.find(json.assetId)).toBeTruthy();
  });

  it("空白扩展资源可用包内已有图片作为参考补齐", async () => {
    const sourceId = "imported-sticker-extra-ref";
    assetStore.save(await solidPng(240, 240), sourceId, "png");

    const res = await app.inject({
      method: "POST",
      url: "/api/generate/resource",
      payload: {
        presetId: "wechat_stickers",
        prompt: "为这套表情包生成详情页横幅，横向构图",
        styles: ["贴纸"],
        target: { kind: "extra", key: "bannerAssetId" },
        mode: "regenerate",
        sourceAssetId: sourceId
      },
      headers: { "content-type": "application/json" }
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.assetId).toBeTypeOf("string");
    expect(json.targetSize).toEqual({ width: 750, height: 400 });
    expect(assetStore.find(json.assetId)).toBeTruthy();
  });

  it("编辑图片只需要 sourceAssetId，不需要原包参考图", async () => {
    const sourceId = "imported-sticker-2";
    assetStore.save(await solidPng(240, 240), sourceId, "png");

    const res = await app.inject({
      method: "POST",
      url: "/api/generate/resource",
      payload: {
        presetId: "wechat_stickers",
        target: { kind: "sticker", index: 0 },
        mode: "edit",
        sourceAssetId: sourceId,
        instruction: "把背景换成浅蓝色",
        styles: ["贴纸"]
      },
      headers: { "content-type": "application/json" }
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.assetId).not.toBe(sourceId);
    expect(json.prompt).toContain("编辑要求：把背景换成浅蓝色");
    expect(json.sourceAssetId).toBe(sourceId);
  });

  it("整包生成允许纯文生图（referenceAssetId 可省略）", async () => {
    const startRes = await app.inject({
      method: "POST",
      url: "/api/generate/start",
      payload: {
        presetId: "telegram_static",
        prompt: "一只戴红围巾的柴犬",
        styles: ["贴纸"],
        stickerCount: 1,
        metadata: { title: "No Ref Pack", author: "EasySticker Studio" }
      },
      headers: { "content-type": "application/json" }
    });
    expect(startRes.statusCode).toBe(200);
    const { taskId } = startRes.json();

    const streamRes = await app.inject({
      method: "GET",
      url: `/api/generate/stream?taskId=${encodeURIComponent(taskId)}`
    });
    expect(streamRes.statusCode).toBe(200);
    const done = parseSseEvents(streamRes.body).find((event) => event.event === "done")?.data;
    expect(done).toBeTruthy();
    expect(done.stickers).toHaveLength(1);
    expect(done.meta.referenceAssetId).toBeNull();
    expect(done.meta.referenceMode).toBe("none");
    expect(done.generation.referenceAssetId).toBeNull();
  });
});
