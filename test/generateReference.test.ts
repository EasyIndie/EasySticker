import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildApp } from "../src/app";
import { createFileAssetStore } from "../src/lib/assets";

/**
 * POST /api/generate/reference —— AI 生成参考图。
 *
 * 这是「参考图只能靠上传」的补充路径，用 mock provider 验证：
 * - 纯文生图：生成结果会落盘成 asset，且能像上传的参考图一样通过 /api/assets/:id 访问。
 * - 图生图：传入 referenceImageAssetId 时同样生成一张新的参考图。
 */
describe("POST /api/generate/reference", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-genref-"));
  const assetStore = createFileAssetStore(dataDir);
  const app = buildApp(
    { host: "127.0.0.1", port: 0, dataDir, logLevel: "silent", security: { jwtSecret: "test-secret-genref" } },
    { assetStore }
  );

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function solidPng(): Promise<Buffer> {
    return sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 128, b: 0, alpha: 1 } } })
      .png()
      .toBuffer();
  }

  it("由文字生成参考图并落盘为可访问的 asset", async () => {
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/reference",
      payload: { prompt: "一只戴红围巾的柴犬，白色背景", style: "水彩", provider: "mock" }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.uploadId).toBeTruthy();
    expect(body.url).toBe(`/api/assets/${body.uploadId}`);
    expect(assetStore.find(body.uploadId)).toBeTruthy();

    const asset = await app.inject({ method: "GET", url: `/api/assets/${body.uploadId}` });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("image/");
  });

  it("传入参考图 assetId 时按图生图生成新的参考图", async () => {
    await app.ready();
    const refId = "base-ref-image";
    assetStore.save(await solidPng(), refId, "png");

    const res = await app.inject({
      method: "POST",
      url: "/api/generate/reference",
      payload: {
        prompt: "把它换成蓝色背景",
        style: "水彩",
        provider: "mock",
        referenceImageAssetId: refId
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.uploadId).toBeTruthy();
    expect(body.uploadId).not.toBe(refId);
    expect(assetStore.find(body.uploadId)).toBeTruthy();
  });

  it("支持主底图 + 附加参考图（多图生图）", async () => {
    await app.ready();
    const mainId = "multi-main";
    const extraId = "multi-extra";
    assetStore.save(await solidPng(), mainId, "png");
    assetStore.save(await solidPng(), extraId, "jpg");

    const res = await app.inject({
      method: "POST",
      url: "/api/generate/reference",
      payload: {
        prompt: "保持主体不变，换成蓝色背景",
        provider: "mock",
        referenceImageAssetId: mainId,
        additionalReferenceImageAssetIds: [extraId]
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.uploadId).toBeTruthy();
    expect(body.uploadId).not.toBe(mainId);
    expect(assetStore.find(body.uploadId)).toBeTruthy();
  });

  it("参考图不存在时返回 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/reference",
      payload: { prompt: "随便", provider: "mock", referenceImageAssetId: "missing-asset" }
    });
    expect(res.statusCode).toBe(404);
  });

  it("附加参考图不存在时返回 404", async () => {
    await app.ready();
    const mainId = "multi-main-2";
    assetStore.save(await solidPng(), mainId, "png");

    const res = await app.inject({
      method: "POST",
      url: "/api/generate/reference",
      payload: {
        prompt: "随便",
        provider: "mock",
        referenceImageAssetId: mainId,
        additionalReferenceImageAssetIds: ["missing-extra"]
      }
    });
    expect(res.statusCode).toBe(404);
  });

  it("缺少 prompt 返回 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/generate/reference", payload: { style: "水彩" } });
    expect(res.statusCode).toBe(400);
  });
});
