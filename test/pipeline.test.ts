import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as promptConfigModule from "../src/services/generate/promptConfig";
import sharp from "sharp";
import { buildApp } from "../src/app";
import { createPack } from "../src/services/pack/service";
import { createFileAssetStore } from "../src/lib/assets";
import { readZipEntries } from "../src/lib/zip";

function multipartPayload(field: string, filename: string, contentType: string, buf: Buffer) {
  const boundary = `----easysticker-${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    boundary,
    body: Buffer.concat([head, buf, tail])
  };
}

function multipartMixedPayload(
  files: Array<{ field: string; filename: string; contentType: string; buf: Buffer }>,
  fields: Record<string, string> = {}
) {
  const boundary = `----easysticker-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
          `${value}\r\n`
      )
    );
  }
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`
      ),
      file.buf,
      Buffer.from("\r\n")
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

async function solidPng(width: number, height: number, color: { r: number; g: number; b: number; alpha?: number }) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { ...color, alpha: color.alpha ?? 1 }
    }
  })
    .png()
    .toBuffer();
}

describe("pipeline", () => {
  function parseSseEvents(body: string) {
    const normalized = body.replace(/\r\n/g, "\n");
    const blocks = normalized.split("\n\n").filter((b) => b.trim());
    return blocks.map((block) => {
      let event = "message";
      let dataText = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataText += (dataText ? "\n" : "") + line.slice(5).trim();
      }
      const data = dataText ? JSON.parse(dataText) : null;
      return { event, data };
    });
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-"));
  const app = buildApp({ host: "127.0.0.1", port: 0, dataDir, logLevel: "silent" });

  beforeAll(async () => {
    // 使用 mock 提供商的配置已在下方 spyOn 中完成，不需要设置环境变量
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("upload -> wechat prompt -> wechat ai generate -> validate -> download", async () => {
    const originalConfig = promptConfigModule.loadPromptConfig();
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ...originalConfig,
      ai: {
        ...originalConfig.ai,
        defaultProvider: "mock",
        providers: {
          ...originalConfig.ai.providers,
          mock: { type: "mock", name: "本地模拟" }
        }
      }
    });

    const png = await sharp({
      create: { width: 256, height: 256, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
    })
      .composite([
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect x="78" y="78" width="100" height="100" rx="12" fill="#111"/></svg>`
          )
        }
      ])
      .png()
      .toBuffer();

    const mp = multipartPayload("file", "test.png", "image/png", png);
    const uploadRes = await app.inject({
      method: "POST",
      url: "/api/uploads",
      payload: mp.body,
      headers: { "content-type": `multipart/form-data; boundary=${mp.boundary}` }
    });
    expect(uploadRes.statusCode).toBe(200);
    const upload = uploadRes.json();
    expect(upload.uploadId).toBeTypeOf("string");

    const promptRes = await app.inject({
      method: "POST",
      url: "/api/generate/prompt",
      payload: { referenceAssetId: upload.uploadId },
      headers: { "content-type": "application/json" }
    });
    expect(promptRes.statusCode).toBe(200);

    const startRes = await app.inject({
      method: "POST",
      url: "/api/generate/start",
      payload: {
        referenceAssetId: upload.uploadId,
        prompt: "test",
        stickerCount: 24,
        styles: ["flat"],
        metadata: {
          title: "Cute Cat Pack",
          author: "EasySticker Studio",
          version: "v1.0",
          copyright: "© 2026 EasySticker Studio",
          rewardMessage: "喜欢这套表情的话，欢迎赞赏支持"
        },
        enableReward: true,
        includeCover: true,
        includeIcon: true,
        includeBanner: true
      },
      headers: { "content-type": "application/json" }
    });
    expect(startRes.statusCode).toBe(200);
    const startJson = startRes.json();
    expect(typeof startJson.taskId).toBe("string");
    const streamRes = await app.inject({
      method: "GET",
      url: `/api/generate/stream?taskId=${encodeURIComponent(startJson.taskId)}`
    });
    expect(streamRes.statusCode).toBe(200);
    const events = parseSseEvents(streamRes.body);
    let done: any = null;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]?.event === "done") {
        done = events[i]?.data;
        break;
      }
    }
    expect(done).toBeTruthy();
    const json = done;
    expect(json.packId).toBeTypeOf("string");
    expect(json.downloadUrl).toBeTypeOf("string");
    expect(json.downloadFilename).toBe(`cute-cat-pack-${json.packId}.zip`);
    expect(json.stickers).toHaveLength(24);
    expect(json.metadataJson).toBeTypeOf("string");
    expect(json.metadataJson).toContain(`"packId": "${json.packId}"`);
    expect(json.metadataJson).toContain('"presetId": "wechat_stickers"');
    expect(json.metadataJson).toContain('"title": "Cute Cat Pack"');
    expect(json.metadataJson).toContain('"rewardMessage": "喜欢这套表情的话，欢迎赞赏支持"');

    // metadata.json 需记录每个文件的名称/尺寸，以及生成时的提示词/风格/情绪，
    // 以便导出后重新导入再做二次编辑。
    const packMeta = JSON.parse(json.metadataJson);
    expect(packMeta.schema).toBe("easysticker-pack@0.3");
    expect(packMeta.generation.source).toBe("ai-generate");
    expect(packMeta.generation.prompt).toBe("test");
    expect(packMeta.generation.styles).toEqual(["flat"]);
    expect(packMeta.generation.stickerCount).toBe(24);
    expect(packMeta.generation.imageSize).toEqual({ width: 1024, height: 1024 });
    expect(packMeta.generation.targetSize).toEqual({ width: 240, height: 240 });
    expect(packMeta.generation.referenceAssetId).toBe(upload.uploadId);
    expect(packMeta.generation.include).toEqual({ cover: true, icon: true, banner: true, reward: true });
    expect(packMeta.generation.negativePrompt).toBeTypeOf("string");

    const stickerFiles = packMeta.files.filter((f: any) => f.role === "sticker");
    expect(stickerFiles).toHaveLength(24);
    for (const f of stickerFiles) {
      expect(f.width).toBe(240);
      expect(f.height).toBe(240);
      expect(f.format).toBe("png");
      expect(f.mimeType).toBe("image/png");
      expect(f.bytes).toBeGreaterThan(0);
      expect(f.filename).toMatch(/^\d{3}\.png$/);
      expect(f.zipPath).toBe(`assets/${f.filename}`);
      expect(f.prompt).toContain("test");
      expect(f.style).toBe("flat");
      expect(typeof f.emotion).toBe("string");
    }

    const byRole = Object.fromEntries(
      packMeta.files.filter((f: any) => f.role !== "sticker").map((f: any) => [f.role, f])
    );
    expect(Object.keys(byRole).sort()).toEqual([
      "banner",
      "cover",
      "icon",
      "reference",
      "reward-guide",
      "reward-thanks"
    ]);
    // 参考图一并收入 source/，让 ZIP 能完整还原这次生成
    expect(byRole.reference).toMatchObject({
      assetId: upload.uploadId,
      filename: "reference.png",
      zipPath: "source/reference.png",
      format: "png"
    });
    expect(byRole.reference.width).toBeGreaterThan(0);
    expect(byRole.reference.bytes).toBeGreaterThan(0);
    expect(byRole.cover).toMatchObject({ width: 240, height: 240, zipPath: "meta/cover.png" });
    expect(byRole.icon).toMatchObject({ width: 50, height: 50, zipPath: "meta/icon.png" });
    expect(byRole.banner).toMatchObject({ width: 750, height: 400, zipPath: "meta/banner.png" });
    expect(byRole["reward-guide"]).toMatchObject({ width: 750, height: 560 });
    expect(byRole["reward-thanks"]).toMatchObject({ width: 750, height: 560 });
    // 扩展资源也记录各自使用的提示词/风格
    for (const role of ["cover", "icon", "banner", "reward-guide", "reward-thanks"]) {
      expect(byRole[role].prompt).toBeTypeOf("string");
      expect(byRole[role].style).toBeTypeOf("string");
    }
    // 兼容旧格式：assets 仍是最简贴纸清单
    expect(packMeta.assets).toHaveLength(24);

    expect(json.meta.title).toBe("Cute Cat Pack");
    expect(json.meta.author).toBe("EasySticker Studio");
    expect(json.meta.version).toBe("v1.0");
    expect(json.meta.copyright).toBe("© 2026 EasySticker Studio");
    expect(json.meta.rewardMessage).toBe("喜欢这套表情的话，欢迎赞赏支持");
    expect(json.meta.rewardEnabled).toBe(true);
    expect(json.meta.count).toBe(24);
    expect(json.meta.referenceAssetId).toBe(upload.uploadId);
    expect(json.extras.coverAssetId).toBeTypeOf("string");
    expect(json.extras.iconAssetId).toBeTypeOf("string");
    expect(json.extras.bannerAssetId).toBeTypeOf("string");
    expect(json.extras.rewardGuideAssetId).toBeTypeOf("string");
    expect(json.extras.rewardThanksAssetId).toBeTypeOf("string");

    const assetId0 = json.stickers[0].assetId;
    const assetRes = await app.inject({ method: "GET", url: `/api/assets/${assetId0}` });
    expect(assetRes.statusCode).toBe(200);

    const coverRes = await app.inject({ method: "GET", url: `/api/assets/${json.extras.coverAssetId}` });
    expect(coverRes.statusCode).toBe(200);
    const iconRes = await app.inject({ method: "GET", url: `/api/assets/${json.extras.iconAssetId}` });
    expect(iconRes.statusCode).toBe(200);
    const bannerRes = await app.inject({ method: "GET", url: `/api/assets/${json.extras.bannerAssetId}` });
    expect(bannerRes.statusCode).toBe(200);
    const rewardGuideRes = await app.inject({ method: "GET", url: `/api/assets/${json.extras.rewardGuideAssetId}` });
    expect(rewardGuideRes.statusCode).toBe(200);
    const rewardThanksRes = await app.inject({ method: "GET", url: `/api/assets/${json.extras.rewardThanksAssetId}` });
    expect(rewardThanksRes.statusCode).toBe(200);

    // 微信赞赏图规范：750×560（与横幅 750×400 不同）
    const guideMeta = await sharp(rewardGuideRes.rawPayload).metadata();
    expect(guideMeta.width).toBe(750);
    expect(guideMeta.height).toBe(560);
    const thanksMeta = await sharp(rewardThanksRes.rawPayload).metadata();
    expect(thanksMeta.width).toBe(750);
    expect(thanksMeta.height).toBe(560);

    const zipRes = await app.inject({ method: "GET", url: json.downloadUrl });
    expect(zipRes.statusCode).toBe(200);
    expect(zipRes.headers["content-type"]).toContain("application/zip");
    expect(zipRes.headers["content-disposition"]).toContain('filename="');
    expect(zipRes.headers["content-disposition"]).toContain("filename*=");

    vi.restoreAllMocks();
  }, 120000);

  it("imports existing images -> normalize -> validate -> download", async () => {
    const files = await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const width = index % 2 === 0 ? 360 : 180;
        const height = index % 2 === 0 ? 180 : 360;
        const buf = await solidPng(width, height, { r: 20 + index * 20, g: 90, b: 180 });
        return { field: "stickers", filename: `sticker-${index + 1}.png`, contentType: "image/png", buf };
      })
    );
    const extraFiles = [
      { field: "banner", filename: "banner.png", contentType: "image/png", buf: await solidPng(900, 300, { r: 230, g: 120, b: 40 }) },
      {
        field: "rewardGuide",
        filename: "reward-guide.png",
        contentType: "image/png",
        buf: await solidPng(750, 500, { r: 120, g: 40, b: 200 })
      },
      {
        field: "rewardThanks",
        filename: "reward-thanks.png",
        contentType: "image/png",
        buf: await solidPng(750, 500, { r: 40, g: 180, b: 110 })
      }
    ];
    const mp = multipartMixedPayload([...files, ...extraFiles], {
      title: "Imported Pack",
      author: "EasySticker Studio",
      includeReward: "true",
      rewardMessage: "谢谢支持"
    });

    const importRes = await app.inject({
      method: "POST",
      url: "/api/generate/import",
      payload: mp.body,
      headers: { "content-type": `multipart/form-data; boundary=${mp.boundary}` }
    });

    expect(importRes.statusCode).toBe(200);
    const json = importRes.json();
    expect(json.packId).toBeTypeOf("string");
    expect(json.downloadFilename).toBe(`imported-pack-${json.packId}.zip`);
    expect(json.stickers).toHaveLength(8);
    expect(json.meta.referenceMode).toBe("import");
    expect(json.meta.title).toBe("Imported Pack");
    expect(json.meta.rewardEnabled).toBe(true);
    expect(json.extras.coverAssetId).toBeTypeOf("string");
    expect(json.extras.iconAssetId).toBeTypeOf("string");
    expect(json.extras.bannerAssetId).toBeTypeOf("string");
    expect(json.extras.rewardGuideAssetId).toBeTypeOf("string");
    expect(json.extras.rewardThanksAssetId).toBeTypeOf("string");
    expect(json.metadataJson).toContain('"title": "Imported Pack"');
    expect(json.metadataJson).toContain('"rewardMessage": "谢谢支持"');

    // 导入模式同样写入生成上下文（来源、目标尺寸）与文件尺寸
    const importMeta = JSON.parse(json.metadataJson);
    expect(importMeta.schema).toBe("easysticker-pack@0.3");
    // 导入模式没有参考图
    expect(importMeta.files.some((f: any) => f.role === "reference")).toBe(false);
    expect(importMeta.generation.source).toBe("import");
    expect(importMeta.generation.targetSize).toEqual({ width: 240, height: 240 });
    const importedStickers = importMeta.files.filter((f: any) => f.role === "sticker");
    expect(importedStickers).toHaveLength(8);
    expect(importedStickers[0]).toMatchObject({ width: 240, height: 240, format: "png" });

    const assetRes = await app.inject({ method: "GET", url: `/api/assets/${json.stickers[0].assetId}` });
    expect(assetRes.statusCode).toBe(200);
    expect(assetRes.headers["content-type"]).toContain("image/png");
    const info = await sharp(assetRes.rawPayload).metadata();
    expect(info.width).toBe(240);
    expect(info.height).toBe(240);

    const coverRes = await app.inject({ method: "GET", url: `/api/assets/${json.extras.coverAssetId}` });
    expect((await sharp(coverRes.rawPayload).metadata()).width).toBe(240);
    const iconRes = await app.inject({ method: "GET", url: `/api/assets/${json.extras.iconAssetId}` });
    expect((await sharp(iconRes.rawPayload).metadata()).width).toBe(50);
    const bannerRes = await app.inject({ method: "GET", url: `/api/assets/${json.extras.bannerAssetId}` });
    const bannerInfo = await sharp(bannerRes.rawPayload).metadata();
    expect(bannerInfo.width).toBe(750);
    expect(bannerInfo.height).toBe(400);

    // 赞赏图需符合微信规范 750×560（不同于横幅 750×400）
    const guideRes = await app.inject({ method: "GET", url: `/api/assets/${json.extras.rewardGuideAssetId}` });
    const guideInfo = await sharp(guideRes.rawPayload).metadata();
    expect(guideInfo.width).toBe(750);
    expect(guideInfo.height).toBe(560);
    const thanksRes = await app.inject({ method: "GET", url: `/api/assets/${json.extras.rewardThanksAssetId}` });
    const thanksInfo = await sharp(thanksRes.rawPayload).metadata();
    expect(thanksInfo.width).toBe(750);
    expect(thanksInfo.height).toBe(560);

    const zipRes = await app.inject({ method: "GET", url: json.downloadUrl });
    expect(zipRes.statusCode).toBe(200);
    expect(zipRes.headers["content-type"]).toContain("application/zip");
  });

  it("wechat ai generate via openai-compatible provider with base64 reference", async () => {
    const hits: { url: string; contentType: string; body: Buffer }[] = [];
    const server = http.createServer(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(404);
        res.end();
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      hits.push({
        url: req.url || "",
        contentType: req.headers["content-type"] || "",
        body: Buffer.concat(chunks)
      });

      const png = await sharp({
        create: { width: 1024, height: 1024, channels: 4, background: { r: 40, g: 120, b: 220, alpha: 1 } }
      })
        .png()
        .toBuffer();

      // OpenAI Images API 兼容响应
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const originalConfig = promptConfigModule.loadPromptConfig();
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ...originalConfig,
      ai: {
        ...originalConfig.ai,
        defaultProvider: "openai-test",
        referenceMode: "base64",
        providers: {
          ...originalConfig.ai.providers,
          "openai-test": {
            type: "openai",
            baseUrl: `http://127.0.0.1:${port}/v1`,
            apiKey: "test-key",
            model: "test-model"
          }
        }
      }
    });

    try {
      const refPng = await sharp({
        create: { width: 256, height: 256, channels: 4, background: { r: 255, g: 180, b: 80, alpha: 1 } }
      })
        .png()
        .toBuffer();

      const mp = multipartPayload("file", "ref.png", "image/png", refPng);
      const uploadRes = await app.inject({
        method: "POST",
        url: "/api/uploads",
        payload: mp.body,
        headers: { "content-type": `multipart/form-data; boundary=${mp.boundary}` }
      });
      expect(uploadRes.statusCode).toBe(200);
      const upload = uploadRes.json();

      const startRes = await app.inject({
        method: "POST",
        url: "/api/generate/start",
        payload: { referenceAssetId: upload.uploadId, prompt: "openai-test", provider: "openai-test", stickerCount: 8, styles: ["flat"] },
        headers: { "content-type": "application/json" }
      });
      expect(startRes.statusCode).toBe(200);
      const startJson = startRes.json();
      const streamRes = await app.inject({
        method: "GET",
        url: `/api/generate/stream?taskId=${encodeURIComponent(startJson.taskId)}`
      });
      expect(streamRes.statusCode).toBe(200);
      const events = parseSseEvents(streamRes.body);
      let done: any = null;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i]?.event === "done") {
          done = events[i]?.data;
          break;
        }
      }
      expect(done).toBeTruthy();
      const json = done;
      expect(json.meta.referenceMode).toBe("base64");
      expect(hits.length).toBeGreaterThan(0);
      // 参考图走 multipart 上传到 OpenAI 兼容的 /images/edits 端点
      expect(hits[0].url).toContain("/images/edits");
      expect(hits[0].contentType).toContain("multipart/form-data");
      // 参考图原始 PNG 字节原样出现在 multipart 文件部分
      expect(hits[0].body.includes(refPng)).toBe(true);
    } finally {
      vi.restoreAllMocks();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }, 120000);

  it("POST /api/generate/resource 只重生成单张资源（扩展图 / 贴纸 / 编辑）", async () => {
    const originalConfig = promptConfigModule.loadPromptConfig();
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ...originalConfig,
      ai: {
        ...originalConfig.ai,
        defaultProvider: "mock",
        providers: { ...originalConfig.ai.providers, mock: { type: "mock", name: "本地模拟" } }
      }
    });

    try {
      const refPng = await solidPng(256, 256, { r: 200, g: 120, b: 60 });
      const mp = multipartPayload("file", "ref.png", "image/png", refPng);
      const uploadRes = await app.inject({
        method: "POST",
        url: "/api/uploads",
        payload: mp.body,
        headers: { "content-type": `multipart/form-data; boundary=${mp.boundary}` }
      });
      expect(uploadRes.statusCode).toBe(200);
      const upload = uploadRes.json();

      // 1) 扩展图：赞赏感谢图 → 750×560
      const thanksRes = await app.inject({
        method: "POST",
        url: "/api/generate/resource",
        payload: {
          presetId: "wechat_stickers",
          referenceAssetId: upload.uploadId,
          prompt: "Q版大头",
          styles: ["贴纸"],
          target: { kind: "extra", key: "rewardThanksAssetId" }
        },
        headers: { "content-type": "application/json" }
      });
      expect(thanksRes.statusCode).toBe(200);
      const thanks = thanksRes.json();
      expect(thanks.assetId).toBeTypeOf("string");
      expect(thanks.url).toBe(`/api/assets/${thanks.assetId}`);
      expect(thanks.prompt).toContain("感谢打赏");
      // 返回落盘尺寸与所用风格，供前端写回 pack 的 metadata.json
      expect(thanks.style).toBe("贴纸");
      expect(thanks.targetSize).toEqual({ width: 750, height: 560 });
      const thanksAsset = await app.inject({ method: "GET", url: `/api/assets/${thanks.assetId}` });
      expect(thanksAsset.statusCode).toBe(200);
      const thanksMeta = await sharp(thanksAsset.rawPayload).metadata();
      expect(thanksMeta.width).toBe(750);
      expect(thanksMeta.height).toBe(560);

      // 2) 贴纸第 3 张 → 240×240，label 003
      const stickerRes = await app.inject({
        method: "POST",
        url: "/api/generate/resource",
        payload: {
          presetId: "wechat_stickers",
          referenceAssetId: upload.uploadId,
          prompt: "Q版大头",
          styles: ["贴纸"],
          target: { kind: "sticker", index: 2 }
        },
        headers: { "content-type": "application/json" }
      });
      expect(stickerRes.statusCode).toBe(200);
      const sticker = stickerRes.json();
      expect(sticker.label).toBe("003");
      expect(sticker.style).toBe("贴纸");
      expect(typeof sticker.emotion).toBe("string");
      expect(sticker.targetSize).toEqual({ width: 240, height: 240 });
      const stickerAsset = await app.inject({ method: "GET", url: `/api/assets/${sticker.assetId}` });
      const stickerMeta = await sharp(stickerAsset.rawPayload).metadata();
      expect(stickerMeta.width).toBe(240);
      expect(stickerMeta.height).toBe(240);

      // 3) 编辑模式：以已生成资源为源图，instruction 进入提示词
      const editRes = await app.inject({
        method: "POST",
        url: "/api/generate/resource",
        payload: {
          presetId: "wechat_stickers",
          referenceAssetId: upload.uploadId,
          prompt: "Q版大头",
          styles: ["贴纸"],
          target: { kind: "sticker", index: 2 },
          mode: "edit",
          sourceAssetId: sticker.assetId,
          instruction: "把背景改成浅蓝色"
        },
        headers: { "content-type": "application/json" }
      });
      expect(editRes.statusCode).toBe(200);
      const edited = editRes.json();
      expect(edited.assetId).not.toBe(sticker.assetId);
      expect(edited.prompt).toContain("把背景改成浅蓝色");

      // 4) 非法 target → 400
      const badRes = await app.inject({
        method: "POST",
        url: "/api/generate/resource",
        payload: { referenceAssetId: upload.uploadId, prompt: "x", target: { kind: "extra", key: "nope" } },
        headers: { "content-type": "application/json" }
      });
      expect(badRes.statusCode).toBe(400);
    } finally {
      vi.restoreAllMocks();
    }
  }, 120000);

  it("重新打包保留 generation / extraDetails 与逐张尺寸、提示词、风格", async () => {
    const store = createFileAssetStore(dataDir);
    let seq = 0;
    const mkAsset = async (w: number, h: number, color: { r: number; g: number; b: number }) => {
      const id = `repack-${Date.now()}-${seq++}`;
      store.save(await solidPng(w, h, color), id, "png");
      return id;
    };
    const sticker1 = await mkAsset(240, 240, { r: 200, g: 10, b: 10 });
    const sticker2 = await mkAsset(240, 240, { r: 10, g: 10, b: 200 });
    const coverAsset = await mkAsset(240, 240, { r: 20, g: 20, b: 20 });
    const referenceAsset = await mkAsset(512, 512, { r: 240, g: 240, b: 240 });

    const payload = {
      presetId: "wechat_stickers",
      assets: [
        { label: "001", assetId: sticker1, role: "sticker" as const, prompt: "第一张提示词", style: "贴纸", emotion: "开心" },
        { label: "002", assetId: sticker2, role: "sticker" as const, prompt: "第二张提示词", style: "贴纸", emotion: "哭泣" }
      ],
      coverAssetId: coverAsset,
      referenceAssetId: referenceAsset,
      metadata: { title: "重新打包" },
      generation: {
        source: "ai-generate" as const,
        providerId: "mock",
        prompt: "原始提示词",
        styles: ["贴纸"],
        targetSize: { width: 240, height: 240 }
      },
      extraDetails: { cover: { prompt: "封面提示词", style: "贴纸" } }
    };

    // 路由层：schema 需接受 generation / extraDetails（前端重建 ZIP 时发送）
    const routeRes = await app.inject({
      method: "POST",
      url: "/api/packs",
      payload,
      headers: { "content-type": "application/json" }
    });
    expect(routeRes.statusCode).toBe(200);

    // 内容层：metadata.json 写入生成上下文与每个文件的尺寸/提示词/风格
    const { metadataJson } = await createPack(store, dataDir, payload);
    const meta = JSON.parse(metadataJson);
    expect(meta.schema).toBe("easysticker-pack@0.3");
    expect(meta.generation).toMatchObject({
      source: "ai-generate",
      providerId: "mock",
      prompt: "原始提示词",
      targetSize: { width: 240, height: 240 }
    });
    expect(meta.generation.createdAt).toBeTypeOf("string");

    const stickerFiles = meta.files.filter((f: any) => f.role === "sticker");
    expect(stickerFiles).toHaveLength(2);
    expect(stickerFiles[0]).toMatchObject({
      label: "001",
      filename: "001.png",
      zipPath: "assets/001.png",
      width: 240,
      height: 240,
      format: "png",
      mimeType: "image/png",
      prompt: "第一张提示词",
      style: "贴纸",
      emotion: "开心"
    });
    expect(stickerFiles[0].bytes).toBeGreaterThan(0);

    const coverFile = meta.files.find((f: any) => f.role === "cover");
    expect(coverFile).toMatchObject({
      filename: "cover.png",
      zipPath: "meta/cover.png",
      width: 240,
      height: 240,
      prompt: "封面提示词",
      style: "贴纸"
    });
    // 参考图也会被打进 source/（重建 ZIP 时由前端传入 referenceAssetId）
    const referenceFile = meta.files.find((f: any) => f.role === "reference");
    expect(referenceFile).toMatchObject({
      assetId: referenceAsset,
      filename: "reference.png",
      zipPath: "source/reference.png",
      width: 512,
      height: 512,
      format: "png"
    });

    // 兼容旧格式
    expect(meta.assets).toHaveLength(2);

    // 不再落地 ZIP：只写清单（几 KB），下载时按需现打
    const packDir = path.join(dataDir, "packs");
    expect(fs.existsSync(path.join(packDir, `${meta.packId}.json`))).toBe(true);
    expect(fs.existsSync(path.join(packDir, `${meta.packId}.zip`))).toBe(false);
    const manifest = JSON.parse(fs.readFileSync(path.join(packDir, `${meta.packId}.json`), "utf8"));
    expect(manifest.packId).toBe(meta.packId);
    expect(manifest.metadata.files).toHaveLength(meta.files.length);
  });
});
