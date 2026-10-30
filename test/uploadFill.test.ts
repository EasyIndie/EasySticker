import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { findAssetFile } from "../src/lib/assets";
import { packSchema } from "../src/shared/contracts";

function multipartPayload(filename: string, contentType: string, buf: Buffer) {
  const boundary = `----easysticker-${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { boundary, body: Buffer.concat([head, buf, tail]) };
}

async function solidPng(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 20, g: 120, b: 200, alpha: 1 } }
  })
    .png()
    .toBuffer();
}

describe("补齐上传：按平台规格规范化", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-upload-fill-"));
  const app = buildApp({ host: "127.0.0.1", port: 0, dataDir, logLevel: "silent" });

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function upload(buffer: Buffer, mime: string, query: string) {
    const mp = multipartPayload("source.png", mime, buffer);
    return app.inject({
      method: "POST",
      url: `/api/uploads?${query}`,
      payload: mp.body,
      headers: { "content-type": `multipart/form-data; boundary=${mp.boundary}` }
    });
  }

  it("主图会转成当前平台尺寸与格式", async () => {
    const res = await upload(await solidPng(100, 160), "image/png", "presetId=wechat_stickers&role=sticker");
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.role).toBe("sticker");
    expect(json.format).toBe("png");

    const file = findAssetFile(dataDir, json.uploadId);
    expect(file).not.toBeNull();
    const meta = await sharp(file!.filePath).metadata();
    expect(meta.width).toBe(240);
    expect(meta.height).toBe(240);
    expect(meta.format).toBe("png");
  });

  it("WhatsApp 主图会转成 512×512 WebP", async () => {
    const res = await upload(await solidPng(300, 200), "image/png", "presetId=whatsapp_webp&role=sticker");
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.format).toBe("webp");

    const file = findAssetFile(dataDir, json.uploadId);
    const meta = await sharp(file!.filePath).metadata();
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
    expect(meta.format).toBe("webp");
  });

  it("扩展资源按固定尺寸裁切 / 补边", async () => {
    const res = await upload(await solidPng(100, 200), "image/png", "presetId=wechat_stickers&role=banner");
    expect(res.statusCode).toBe(200);
    const json = res.json();
    const file = findAssetFile(dataDir, json.uploadId);
    const meta = await sharp(file!.filePath).metadata();
    expect(meta.width).toBe(750);
    expect(meta.height).toBe(400);
  });

  it("作为 AI 参考图时只规范化大小，不要求平台尺寸", async () => {
    const res = await upload(await solidPng(1200, 800), "image/png", "presetId=wechat_stickers&role=reference");
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.role).toBe("reference");
    const file = findAssetFile(dataDir, json.uploadId);
    const meta = await sharp(file!.filePath).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBeLessThanOrEqual(1024);
  });

  it("拒绝未知 role", async () => {
    const res = await upload(await solidPng(20, 20), "image/png", "presetId=wechat_stickers&role=unknown");
    expect(res.statusCode).toBe(400);
  });

  it("包 schema 接受上传补齐的历史版本类型", () => {
    const parsed = packSchema.safeParse({
      presetId: "wechat_stickers",
      assets: [
        {
          label: "001",
          assetId: "asset-1",
          role: "sticker",
          versions: [
            { assetId: "asset-0", createdAt: new Date().toISOString(), kind: "generate" },
            { assetId: "asset-1", createdAt: new Date().toISOString(), kind: "upload" }
          ]
        }
      ]
    });
    expect(parsed.success).toBe(true);
  });
});
