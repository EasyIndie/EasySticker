import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildApp } from "../src/app";

/**
 * 覆盖非微信平台（Telegram / WhatsApp）的生成与导入。
 * 之前这两个平台没有任何测试，且 /generate/import 因 presetId 只读 req.body
 * （multipart 下为空）而总是回落到微信，导入被「至少 8 张」挡下。
 */

function multipartPayload(
  files: Array<{ field: string; filename: string; contentType: string; buf: Buffer }>,
  fields: Record<string, string> = {}
) {
  const boundary = `----easysticker-platforms-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
    );
  }
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`
      ),
      file.buf,
      Buffer.from("\r\n")
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

function parseSseEvents(body: string) {
  const normalized = body.replace(/\r\n/g, "\n");
  return normalized
    .split("\n\n")
    .filter((b) => b.trim())
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

async function solidPng(width: number, height: number, r: number) {
  return sharp({ create: { width, height, channels: 4, background: { r, g: 90, b: 200, alpha: 1 } } })
    .png()
    .toBuffer();
}

describe("多平台生成与导入", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-platforms-"));
  const app = buildApp({ host: "127.0.0.1", port: 0, dataDir, logLevel: "silent" });

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function uploadRef(): Promise<string> {
    const mp = multipartPayload([{ field: "file", filename: "ref.png", contentType: "image/png", buf: await solidPng(256, 256, 40) }]);
    const res = await app.inject({
      method: "POST",
      url: "/api/uploads",
      payload: mp.body,
      headers: { "content-type": `multipart/form-data; boundary=${mp.boundary}` }
    });
    expect(res.statusCode).toBe(200);
    return res.json().uploadId;
  }

  async function generate(presetId: string, count: number) {
    const referenceAssetId = await uploadRef();
    const start = await app.inject({
      method: "POST",
      url: "/api/generate/start",
      payload: { presetId, referenceAssetId, provider: "mock", prompt: "多平台测试", stickerCount: count, styles: ["扁平插画"] },
      headers: { "content-type": "application/json" }
    });
    expect(start.statusCode).toBe(200);
    const taskId = start.json().taskId;
    const stream = await app.inject({ method: "GET", url: `/api/generate/stream?taskId=${encodeURIComponent(taskId)}` });
    expect(stream.statusCode).toBe(200);
    const done = parseSseEvents(stream.body).find((e) => e.event === "done");
    expect(done, "生成应产出 done 事件").toBeTruthy();
    return done!.data as any;
  }

  it("telegram_static 生成 512×512 PNG", async () => {
    const json = await generate("telegram_static", 3);
    expect(json.meta.presetId).toBe("telegram_static");
    const meta = JSON.parse(json.metadataJson);
    const stickers = meta.files.filter((f: any) => f.role === "sticker");
    expect(stickers).toHaveLength(3);
    for (const s of stickers) {
      expect(s.format).toBe("png");
      expect(s.width).toBe(512);
      expect(s.height).toBe(512);
    }
  }, 60000);

  it("whatsapp_webp 生成 512×512 WebP", async () => {
    const json = await generate("whatsapp_webp", 3);
    expect(json.meta.presetId).toBe("whatsapp_webp");
    const meta = JSON.parse(json.metadataJson);
    const stickers = meta.files.filter((f: any) => f.role === "sticker");
    expect(stickers).toHaveLength(3);
    for (const s of stickers) {
      expect(s.format).toBe("webp");
      expect(s.width).toBe(512);
      expect(s.height).toBe(512);
    }
  }, 60000);

  it("telegram_static 导入 PNG 输入 → 512×512 PNG（presetId 走 query）", async () => {
    const mp = multipartPayload(
      [
        { field: "stickers", filename: "a.png", contentType: "image/png", buf: await solidPng(800, 800, 10) },
        { field: "stickers", filename: "b.png", contentType: "image/png", buf: await solidPng(800, 800, 60) }
      ],
      { presetId: "telegram_static" }
    );
    const res = await app.inject({
      method: "POST",
      // 关键：presetId 必须出现在 URL 上，multipart 的 body 字段服务端读不到
      url: "/api/generate/import?presetId=telegram_static",
      payload: mp.body,
      headers: { "content-type": `multipart/form-data; boundary=${mp.boundary}` }
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.meta.presetId).toBe("telegram_static");
    const meta = JSON.parse(json.metadataJson);
    const stickers = meta.files.filter((f: any) => f.role === "sticker");
    expect(stickers).toHaveLength(2);
    for (const s of stickers) {
      expect(s.format).toBe("png");
      expect(s.width).toBe(512);
      expect(s.height).toBe(512);
    }
  }, 60000);

  it("whatsapp_webp 导入 PNG 输入 → 512×512 WebP（会重新编码为 WebP）", async () => {
    const mp = multipartPayload(
      [{ field: "stickers", filename: "a.png", contentType: "image/png", buf: await solidPng(600, 600, 120) }],
      { presetId: "whatsapp_webp" }
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/import?presetId=whatsapp_webp",
      payload: mp.body,
      headers: { "content-type": `multipart/form-data; boundary=${mp.boundary}` }
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.meta.presetId).toBe("whatsapp_webp");
    const meta = JSON.parse(json.metadataJson);
    const stickers = meta.files.filter((f: any) => f.role === "sticker");
    expect(stickers).toHaveLength(1);
    expect(stickers[0].format).toBe("webp");
    expect(stickers[0].width).toBe(512);
    expect(stickers[0].height).toBe(512);
  }, 60000);
});
