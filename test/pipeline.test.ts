import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

describe("pipeline", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-"));
  const app = buildApp({ host: "127.0.0.1", port: 0, dataDir, logLevel: "silent" });

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("upload -> wechat prompt -> wechat ai generate -> validate -> download", async () => {
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
      url: "/api/wechat/prompt",
      payload: { referenceAssetId: upload.uploadId },
      headers: { "content-type": "application/json" }
    });
    expect(promptRes.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: "/api/wechat/generate",
      payload: { referenceAssetId: upload.uploadId, prompt: "test", stickerCount: 8, styles: ["flat"] },
      headers: { "content-type": "application/json" }
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.packId).toBeTypeOf("string");
    expect(json.downloadUrl).toBeTypeOf("string");
    expect(json.stickers).toHaveLength(8);

    const assetId0 = json.stickers[0].assetId;
    const assetRes = await app.inject({ method: "GET", url: `/api/assets/${assetId0}` });
    expect(assetRes.statusCode).toBe(200);

    const zipRes = await app.inject({ method: "GET", url: json.downloadUrl });
    expect(zipRes.statusCode).toBe(200);
    expect(zipRes.headers["content-type"]).toContain("application/zip");
  });
});
