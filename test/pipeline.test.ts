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

  it("health ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("upload -> process -> generate -> validate -> pack", async () => {
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

    const processRes = await app.inject({
      method: "POST",
      url: `/api/process/${upload.uploadId}`,
      payload: { threshold: 20, softness: 30 },
      headers: { "content-type": "application/json" }
    });
    expect(processRes.statusCode).toBe(200);
    const processed = processRes.json();
    expect(processed.assetId).toBeTypeOf("string");

    const genRes = await app.inject({
      method: "POST",
      url: "/api/generate/static",
      payload: { assetId: processed.assetId, sizes: [512], format: "png" },
      headers: { "content-type": "application/json" }
    });
    expect(genRes.statusCode).toBe(200);
    const gen = genRes.json();
    expect(gen.results).toHaveLength(1);
    const stickerId = gen.results[0].assetId;

    const valRes = await app.inject({
      method: "POST",
      url: "/api/validate",
      payload: { presetId: "telegram_static", assetId: stickerId },
      headers: { "content-type": "application/json" }
    });
    expect(valRes.statusCode).toBe(200);
    const val = valRes.json();
    expect(val.ok).toBe(true);

    const packRes = await app.inject({
      method: "POST",
      url: "/api/packs",
      payload: { presetId: "telegram_static", assetIds: [stickerId], metadata: { title: "t", author: "a" } },
      headers: { "content-type": "application/json" }
    });
    expect(packRes.statusCode).toBe(200);
    const pack = packRes.json();
    expect(pack.packId).toBeTypeOf("string");

    const zipRes = await app.inject({ method: "GET", url: pack.downloadUrl });
    expect(zipRes.statusCode).toBe(200);
    expect(zipRes.headers["content-type"]).toContain("application/zip");
    const raw = (zipRes as any).rawPayload ? ((zipRes as any).rawPayload as Buffer) : Buffer.from(zipRes.body);
    expect(raw.slice(0, 2).toString("utf8")).toBe("PK");
  });
});
