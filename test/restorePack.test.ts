import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildApp } from "../src/app";
import { createPack } from "../src/services/pack/service";
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


  /** 走真实下载接口拿 ZIP 字节（ZIP 现在不再常驻磁盘，是现场打的）。 */
  async function downloadZip(packId: string): Promise<Buffer> {
    const res = await app.inject({ method: "GET", url: `/api/packs/${packId}/download` });
    expect(res.statusCode).toBe(200);
    return res.rawPayload;
  }

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
    const { packId: originalPackId } = await createPack(store, dataDir, {
      presetId: "wechat_stickers",
      assets,
      coverAssetId: coverId,
      referenceAssetId: referenceId,
      metadata: { title: "还原测试包", author: "tester" },
      generation: {
        source: "ai-generate",
        providerId: "seedream",
        prompt: "原始提示词：基于参考图生成一套贴纸",
        promptPreset: "daily",
        promptCustom: "自定义补充：主角戴一顶帽子",
        styles: ["贴纸"],
        stickerCount: 3,
        referenceMode: "base64"
      },
      extraDetails: { cover: { prompt: "封面提示词\n风格：贴纸", style: "贴纸" } }
    });

    const zipBytes = await downloadZip(originalPackId);

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
      promptPreset: "daily",
      promptCustom: "自定义补充：主角戴一顶帽子",
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
    const newZipBytes = await downloadZip(restored.packId);
    const entries = new Map(readZipEntries(newZipBytes).map((e) => [e.name, e.content]));
    expect(entries.has("source/reference.png")).toBe(true);
    expect(entries.get("source/reference.png")!.equals(referenceBytes)).toBe(true);
    expect(entries.get("assets/001.png")!.equals(stickerBytes[0]!)).toBe(true);
    expect(entries.get("assets/003.png")!.equals(stickerBytes[2]!)).toBe(true);

    const meta = JSON.parse(entries.get("metadata.json")!.toString("utf8"));
    expect(meta.schema).toBe("easysticker-pack@0.3");
    expect(meta.generation.prompt).toBe("原始提示词：基于参考图生成一套贴纸");
    // 预设 id + 自定义文本随包往返，ZIP 二次导出后仍可完整还原
    expect(meta.generation.promptPreset).toBe("daily");
    expect(meta.generation.promptCustom).toBe("自定义补充：主角戴一顶帽子");
    expect(meta.files.filter((f: any) => f.role === "sticker")).toHaveLength(3);
    expect(meta.files.find((f: any) => f.role === "reference").assetId).toBe(restored.meta.referenceAssetId);

    // 下载链接可用
    const download = await app.inject({ method: "GET", url: `/api/packs/${restored.packId}/download` });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.length).toBeGreaterThan(1000);
  }, 120000);

  it("按 packId 还原（历史记录一键还原）复用服务端已有的包", async () => {
    const store = createFileAssetStore(dataDir);
    const stamp = Date.now();
    const stickerId = `byid-sticker-${stamp}`;
    store.save(
      await sharp({ create: { width: 240, height: 240, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } })
        .png()
        .toBuffer(),
      stickerId,
      "png"
    );
    const refId = `byid-reference-${stamp}`;
    store.save(
      await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } } })
        .png()
        .toBuffer(),
      refId,
      "png"
    );

    const { packId, downloadFilename } = await createPack(store, dataDir, {
      presetId: "wechat_stickers",
      assets: [
        { label: "001", assetId: stickerId, role: "sticker", prompt: "按 packId 还原的提示词", style: "贴纸", emotion: "开心" }
      ],
      referenceAssetId: refId,
      metadata: { title: "按 id 还原" },
      generation: { source: "ai-generate", providerId: "mock", prompt: "原始提示词", styles: ["贴纸"] }
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/packs/${packId}/restore`,
      payload: { presetId: "wechat_stickers" }
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();

    // 包已存在且下载链接有效 → 直接复用，不再复制一份
    expect(json.packId).toBe(packId);
    expect(json.downloadUrl).toBe(`/api/packs/${packId}/download`);
    expect(json.downloadFilename).toBe(downloadFilename);
    expect(json.restored.fromPackId).toBe(packId);

    // 生成现场同样完整
    expect(json.stickers[0]).toMatchObject({
      prompt: "按 packId 还原的提示词",
      style: "贴纸",
      emotion: "开心"
    });
    expect(json.generation.prompt).toBe("原始提示词");
    // 走清单快路径：素材零拷贝，参考图仍是库里原来那个 assetId
    expect(json.meta.referenceAssetId).toBe(refId);

    // 不存在的 packId → 404；非法 packId → 400（防路径穿越）
    const missing = await app.inject({ method: "POST", url: "/api/packs/doesnotexist0000000000/restore", payload: {} });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({ method: "POST", url: "/api/packs/abc/restore", payload: {} });
    expect(bad.statusCode).toBe(400);
  }, 60000);

  it("旧包（只有 ZIP、没有清单）也能按 packId 还原", async () => {
    const store = createFileAssetStore(dataDir);
    const stamp = Date.now();
    const stickerId = `legacy-sticker-${stamp}`;
    store.save(
      await sharp({ create: { width: 240, height: 240, channels: 4, background: { r: 7, g: 7, b: 7, alpha: 1 } } })
        .png()
        .toBuffer(),
      stickerId,
      "png"
    );

    const { packId } = await createPack(store, dataDir, {
      presetId: "wechat_stickers",
      assets: [
        { label: "001", assetId: stickerId, role: "sticker", prompt: "旧包提示词", style: "贴纸", emotion: "开心" }
      ],
      metadata: { title: "旧包" },
      generation: { source: "ai-generate", providerId: "mock", prompt: "旧包原始提示词", styles: ["贴纸"] }
    });

    // 先把 ZIP 打出来，然后删掉清单 —— 模拟迁移前那批「只有 zip」的历史包
    const zipBytes = await downloadZip(packId);
    const zipPath = path.join(dataDir, "packs", `${packId}.zip`);
    fs.writeFileSync(zipPath, zipBytes);
    fs.rmSync(path.join(dataDir, "packs", `${packId}.json`));

    const res = await app.inject({
      method: "POST",
      url: `/api/packs/${packId}/restore`,
      payload: { presetId: "wechat_stickers" }
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.packId).toBe(packId);
    expect(json.stickers[0]).toMatchObject({ prompt: "旧包提示词", style: "贴纸", emotion: "开心" });
    expect(json.restored.fromPackId).toBe(packId);
    // 旧包仍从 ZIP 里直接发，不做二次打包
    expect((await app.inject({ method: "GET", url: `/api/packs/${packId}/download` })).statusCode).toBe(200);
  }, 60000);

  it("编辑历史版本会打进 ZIP，重新导入后仍可查看（assetId 重映射）", async () => {
    const store = createFileAssetStore(dataDir);
    const stamp = Date.now();
    const solid = (r: number) =>
      sharp({ create: { width: 240, height: 240, channels: 4, background: { r, g: 100, b: 100, alpha: 1 } } })
        .png()
        .toBuffer();

    const oldId = `ver-old-${stamp}`;
    const curId = `ver-cur-${stamp}`;
    const oldBytes = await solid(30);
    const curBytes = await solid(200);
    store.save(oldBytes, oldId, "png");
    store.save(curBytes, curId, "png");

    const { packId } = await createPack(store, dataDir, {
      presetId: "wechat_stickers",
      assets: [
        {
          label: "001",
          assetId: curId,
          role: "sticker",
          prompt: "v2 提示词",
          style: "贴纸",
          emotion: "开心",
          sourceAssetId: oldId,
          versions: [
            { assetId: oldId, createdAt: "2024-01-01T00:00:00.000Z", kind: "generate", prompt: "v1 提示词" },
            { assetId: curId, createdAt: "2024-01-02T00:00:00.000Z", kind: "edit", instruction: "加一顶帽子", prompt: "v2 提示词" }
          ]
        }
      ],
      metadata: { title: "版本历史包" },
      generation: { source: "ai-generate", providerId: "mock", prompt: "原始提示词", styles: ["贴纸"] }
    });

    // ZIP 里应包含当前图（assets/）与历史版本图（history/）
    const zipBytes = await downloadZip(packId);
    const entries = new Map(readZipEntries(zipBytes).map((e) => [e.name, e.content]));
    expect(entries.has("assets/001.png")).toBe(true);
    expect(entries.has("history/001/v1.png")).toBe(true);
    expect(entries.get("history/001/v1.png")!.equals(oldBytes)).toBe(true);

    // 重新导入：版本保留，且 assetId 全部重映射到新库里的 id
    const boundary = `----easysticker-ver-${stamp}`;
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
    const versions = restored.stickers[0].versions as any[];
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ kind: "generate", prompt: "v1 提示词", createdAt: "2024-01-01T00:00:00.000Z" });
    expect(versions[1]).toMatchObject({ kind: "edit", instruction: "加一顶帽子", createdAt: "2024-01-02T00:00:00.000Z" });
    // 当前版本指向重导入后的新图；初版指向历史图（不同的新 assetId）
    expect(versions[1].assetId).toBe(restored.stickers[0].assetId);
    expect(versions[0].assetId).not.toBe(versions[1].assetId);
    // 历史图字节一致（原样带回）
    const historyAsset = await app.inject({ method: "GET", url: `/api/assets/${versions[0].assetId}` });
    expect(historyAsset.statusCode).toBe(200);
    expect(historyAsset.rawPayload.equals(oldBytes)).toBe(true);

    // 再次导出仍带历史版本
    const newZip = await downloadZip(restored.packId);
    expect([...new Set(readZipEntries(newZip).map((e) => e.name))].some((n) => n.startsWith("history/"))).toBe(true);
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
