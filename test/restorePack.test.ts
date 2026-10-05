import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildApp } from "../src/app";
import { buildZipPack } from "../src/services/pack/service";
import { createFileAssetStore } from "../src/lib/assets";
import { readZipEntries } from "../src/lib/zip";

describe("导入 ZIP 还原生成现场", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-restore-"));
  const app = buildApp({ host: "127.0.0.1", port: 0, dataDir, logLevel: "silent" });

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("下载的 ZIP 重新导入后，提示词 / 风格 / 参考图都还在，且图片字节不变", async () => {
    const store = createFileAssetStore(dataDir);
    const stamp = Date.now();
    const solid = (w: number, h: number, r: number) =>
      sharp({ create: { width: w, height: h, channels: 4, background: { r, g: 120, b: 200, alpha: 1 } } })
        .png()
        .toBuffer();

    const stickerBytes: Buffer[] = [];
    const assets = [] as Array<{
      label: string;
      assetId: string;
      role: "sticker";
      prompt?: string;
      style?: string;
      emotion?: string;
    }>;
    for (let i = 0; i < 3; i++) {
      const bytes = await solid(240, 240, 10 + i * 30);
      stickerBytes.push(bytes);
      const id = `restore-sticker-${stamp}-${i}`;
      store.save(bytes, id, "png");
      assets.push({
        label: String(i + 1).padStart(3, "0"),
        assetId: id,
        role: "sticker",
        prompt: `第 ${i + 1} 张的完整提示词\n风格：贴纸`,
        style: "贴纸",
        emotion: ["开心大笑", "点赞", "比心"][i]
      });
    }

    const referenceBytes = await solid(400, 300, 5);
    const referenceId = `restore-reference-${stamp}`;
    store.save(referenceBytes, referenceId, "png");
    const coverId = `restore-cover-${stamp}`;
    store.save(await solid(240, 240, 90), coverId, "png");

    // 先产出一个「和本站下载按钮导出的一样」的 ZIP
    const { packId: originalPackId } = await buildZipPack(store, dataDir, {
      presetId: "wechat_stickers",
      assets,
      coverAssetId: coverId,
      referenceAssetId: referenceId,
      metadata: { title: "还原测试包", author: "tester" },
      generation: {
        source: "ai-generate",
        providerId: "seedream",
        prompt: "原始提示词：基于参考图生成一套贴纸",
        styles: ["贴纸"],
        stickerCount: 3,
        referenceMode: "base64"
      },
      extraDetails: { cover: { prompt: "封面提示词\n风格：贴纸", style: "贴纸" } }
    });

    const zipBytes = fs.readFileSync(path.join(dataDir, "packs", `${originalPackId}.zip`));

    // 走真实路由导入这个 ZIP
    const boundary = `----easysticker-restore-${stamp}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="presetId"\r\n\r\nwechat_stickers\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pack.zip"\r\n` +
          `Content-Type: application/zip\r\n\r\n`
      ),
      zipBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/import-pack",
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` }
    });
    expect(res.statusCode).toBe(200);
    const restored = res.json();

    // 生成现场：来源、提示词、风格、参考图都还原了
    expect(restored.restored.fromPackId).toBe(originalPackId);
    expect(restored.restored.schema).toBe("easysticker-pack@0.3");
    expect(restored.generation).toMatchObject({
      source: "ai-generate",
      providerId: "seedream",
      prompt: "原始提示词：基于参考图生成一套贴纸",
      styles: ["贴纸"],
      stickerCount: 3,
      restoredFrom: originalPackId
    });
    expect(restored.meta.referenceAssetId).toBeTruthy();
    expect(restored.generation.referenceAssetId).toBe(restored.meta.referenceAssetId);
    expect(restored.meta.referenceAssetId).not.toBe(referenceId);

    // 逐张贴纸的提示词 / 风格 / 情绪
    expect(restored.stickers).toHaveLength(3);
    expect(restored.stickers.map((s: any) => s.label)).toEqual(["001", "002", "003"]);
    expect(restored.stickers[0]).toMatchObject({
      prompt: "第 1 张的完整提示词\n风格：贴纸",
      style: "贴纸",
      emotion: "开心大笑"
    });
    expect(restored.stickers[2].emotion).toBe("比心");

    // 扩展资源的提示词也带回来了
    expect(restored.extraDetails.cover).toMatchObject({ prompt: "封面提示词\n风格：贴纸", style: "贴纸" });
    expect(restored.extras.coverAssetId).toBeTruthy();

    // 重新导出的 ZIP：参考图仍在 source/，且图片字节与导入前逐字节一致
    const newZipBytes = fs.readFileSync(path.join(dataDir, "packs", `${restored.packId}.zip`));
    const entries = new Map(readZipEntries(newZipBytes).map((e) => [e.name, e.content]));
    expect(entries.has("source/reference.png")).toBe(true);
    expect(entries.get("source/reference.png")!.equals(referenceBytes)).toBe(true);
    expect(entries.get("assets/001.png")!.equals(stickerBytes[0]!)).toBe(true);
    expect(entries.get("assets/003.png")!.equals(stickerBytes[2]!)).toBe(true);

    const meta = JSON.parse(entries.get("metadata.json")!.toString("utf8"));
    expect(meta.schema).toBe("easysticker-pack@0.3");
    expect(meta.generation.prompt).toBe("原始提示词：基于参考图生成一套贴纸");
    expect(meta.files.filter((f: any) => f.role === "sticker")).toHaveLength(3);
    expect(meta.files.find((f: any) => f.role === "reference").assetId).toBe(restored.meta.referenceAssetId);

    // 下载链接可用
    const download = await app.inject({ method: "GET", url: `/api/packs/${restored.packId}/download` });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.length).toBeGreaterThan(1000);
  }, 120000);

  it("不是本站导出的 ZIP 会被拒绝", async () => {
    const boundary = `----easysticker-bad-${Date.now()}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bad.zip"\r\n` +
          `Content-Type: application/zip\r\n\r\n`
      ),
      Buffer.from("this is definitely not a zip file"),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/api/generate/import-pack",
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` }
    });
    expect(res.statusCode).toBe(400);
  });
});
