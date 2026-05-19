import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as promptConfigModule from "../src/services/generate/promptConfig";
import sharp from "sharp";
import { buildApp } from "../src/app";

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

    const zipRes = await app.inject({ method: "GET", url: json.downloadUrl });
    expect(zipRes.statusCode).toBe(200);
    expect(zipRes.headers["content-type"]).toContain("application/zip");
  });

  it("wechat ai generate via http provider with base64 reference", async () => {
    const hits: any[] = [];
    const server = http.createServer(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(404);
        res.end();
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      hits.push(body);

      const png = await sharp({
        create: { width: 1024, height: 1024, channels: 4, background: { r: 40, g: 120, b: 220, alpha: 1 } }
      })
        .png()
        .toBuffer();

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ mime: "image/png", imageBase64: png.toString("base64") }));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const originalConfig = promptConfigModule.loadPromptConfig();
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ...originalConfig,
      ai: {
        ...originalConfig.ai,
        defaultProvider: "http",
        referenceMode: "base64",
        providers: {
          ...originalConfig.ai.providers,
          http: {
            type: "http",
            endpoint: `http://127.0.0.1:${port}`
          }
        }
      }
    });

    try {
      const png = await sharp({
        create: { width: 256, height: 256, channels: 4, background: { r: 255, g: 180, b: 80, alpha: 1 } }
      })
        .png()
        .toBuffer();

      const mp = multipartPayload("file", "ref.png", "image/png", png);
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
        payload: { referenceAssetId: upload.uploadId, prompt: "http-test", provider: "http", stickerCount: 8, styles: ["flat"] },
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
      expect(typeof hits[0].referenceImageBase64).toBe("string");
      expect(hits[0].referenceImageBase64.length).toBeGreaterThan(10);
      expect(hits[0].referenceImageUrl).toBeUndefined();
    } finally {
      vi.restoreAllMocks();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }, 120000);
});
