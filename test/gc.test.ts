import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildApp } from "../src/app";
import { createFileAssetStore, listAssetFiles } from "../src/lib/assets";
import { createPack, findPackZipPath, readPackManifest } from "../src/services/pack/service";
import { runGc } from "../src/services/maintenance/gc";
import { readZipEntries } from "../src/lib/zip";

describe("数据目录 GC", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-gc-"));
  const store = createFileAssetStore(dataDir);
  const app = buildApp({ host: "127.0.0.1", port: 0, dataDir, logLevel: "silent" });

  const png = (w: number, h: number, r: number) =>
    sharp({ create: { width: w, height: h, channels: 4, background: { r, g: 100, b: 150, alpha: 1 } } })
      .png()
      .toBuffer();

  let seq = 0;
  async function mkAsset(w = 240, h = 240, r = 20) {
    const id = `gc-asset-${Date.now()}-${seq++}`;
    store.save(await png(w, h, r), id, "png");
    return id;
  }

  /** 把文件的 mtime 调到过去，模拟「很久以前落盘」。 */
  function ageFile(filePath: string, hoursAgo: number) {
    const when = new Date(Date.now() - hoursAgo * 3600_000);
    fs.utimesSync(filePath, when, when);
  }

  let manifestPackId = "";
  let referencedSticker = "";
  let legacyPackId = "";
  let oldOrphan = "";
  let recentOrphan = "";

  beforeAll(async () => {
    await app.ready();

    // 1) 正常包：有清单、没有 ZIP
    referencedSticker = await mkAsset(240, 240, 10);
    const created = await createPack(store, dataDir, {
      presetId: "wechat_stickers",
      assets: [{ label: "001", assetId: referencedSticker, role: "sticker", prompt: "保留", style: "贴纸" }],
      metadata: { title: "正常包" },
      generation: { source: "ai-generate", providerId: "mock", prompt: "原始", styles: ["贴纸"] }
    });
    manifestPackId = created.packId;

    // 2) 旧包：只有 ZIP，没有清单（先打出来再把清单删掉）
    const legacySticker = await mkAsset(240, 240, 60);
    const legacy = await createPack(store, dataDir, {
      presetId: "wechat_stickers",
      assets: [{ label: "001", assetId: legacySticker, role: "sticker", prompt: "旧包", style: "贴纸" }],
      metadata: { title: "旧包" },
      generation: { source: "ai-generate", providerId: "mock", prompt: "旧包原始", styles: ["贴纸"] }
    });
    legacyPackId = legacy.packId;
    const download = await app.inject({ method: "GET", url: `/api/packs/${legacyPackId}/download` });
    fs.writeFileSync(path.join(dataDir, "packs", `${legacyPackId}.zip`), download.rawPayload);
    fs.rmSync(path.join(dataDir, "packs", `${legacyPackId}.json`));

    // 3) 孤儿素材：旧的应被回收，新的应被保留（安全期）
    oldOrphan = await mkAsset(300, 300, 200);
    ageFile(store.find(oldOrphan)!.filePath, 48);
    recentOrphan = await mkAsset(300, 300, 210);

    // 4) repair-pack 遗留的 .orig 备份
    fs.writeFileSync(path.join(dataDir, "packs", `${legacyPackId}.zip.orig`), Buffer.from("legacy-original-bytes"));
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("dry-run 只体检，一个文件都不删", async () => {
    const before = listAssetFiles(dataDir).length;
    const report = await runGc({ dataDir, dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.compacted.count).toBe(1);
    expect(report.compacted.bytes).toBeGreaterThan(0);
    expect(report.origBackups.count).toBe(1);
    expect(report.orphanAssets.count).toBe(1);
    expect(report.orphanAssets.keptRecent).toBe(1);

    // 什么都没动
    expect(listAssetFiles(dataDir).length).toBe(before);
    expect(readPackManifest(dataDir, legacyPackId)).toBeNull();
    expect(findPackZipPath(dataDir, legacyPackId)).not.toBeNull();
    expect(fs.existsSync(path.join(dataDir, "packs", `${legacyPackId}.zip.orig`))).toBe(true);
    expect(store.find(oldOrphan)).not.toBeNull();
  });

  it("apply 后：旧包压成清单、孤儿与 .orig 清掉、被引用的素材与近期文件保留", async () => {
    const report = await runGc({ dataDir, dryRun: false });

    // 旧包 → 清单，ZIP 删除，但包本身仍可下载（下载时现打）
    expect(readPackManifest(dataDir, legacyPackId)).not.toBeNull();
    expect(findPackZipPath(dataDir, legacyPackId)).toBeNull();
    const zip = await app.inject({ method: "GET", url: `/api/packs/${legacyPackId}/download` });
    expect(zip.statusCode).toBe(200);
    const entries = readZipEntries(zip.rawPayload).map((e) => e.name);
    expect(entries).toContain("metadata.json");
    expect(entries).toContain("assets/001.png");
    // 清单里保留着逐张提示词
    expect(readPackManifest(dataDir, legacyPackId)!.metadata.files[0]!.prompt).toBe("旧包");

    // .orig 清掉
    expect(fs.existsSync(path.join(dataDir, "packs", `${legacyPackId}.zip.orig`))).toBe(false);

    // 旧孤儿删掉，新孤儿留着（安全期），被引用的保留
    expect(store.find(oldOrphan)).toBeNull();
    expect(store.find(recentOrphan)).not.toBeNull();
    expect(store.find(referencedSticker)).not.toBeNull();

    expect(report.reclaimedBytes).toBeGreaterThan(0);
    expect(report.errors).toEqual([]);
  });

  it("幂等：再跑一次没有东西可回收", async () => {
    const report = await runGc({ dataDir, dryRun: false });
    expect(report.compacted.count).toBe(0);
    expect(report.origBackups.count).toBe(0);
    expect(report.orphanAssets.count).toBe(0);
    // 正常包与压缩后的旧包都还在
    expect(readPackManifest(dataDir, manifestPackId)).not.toBeNull();
    expect(readPackManifest(dataDir, legacyPackId)).not.toBeNull();
  });

  it("保留期到点后删包，并把随之失去引用的素材一并回收", async () => {
    const sticker = await mkAsset(240, 240, 30);
    const created = await createPack(store, dataDir, {
      presetId: "wechat_stickers",
      assets: [{ label: "001", assetId: sticker, role: "sticker", prompt: "过期包" }],
      metadata: { title: "过期包" },
      generation: { source: "ai-generate", providerId: "mock", prompt: "过期", styles: ["贴纸"] }
    });
    // 把包的创建时间改到 40 天前
    const manifestPath = path.join(dataDir, "packs", `${created.packId}.json`);
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    raw.metadata.createdAt = new Date(Date.now() - 40 * 86400_000).toISOString();
    fs.writeFileSync(manifestPath, JSON.stringify(raw, null, 2));

    // 保留期不追溯既往，所以先把「策略生效起点」也倒推到 40 天前
    fs.writeFileSync(
      path.join(dataDir, "maintenance.json"),
      JSON.stringify({ retentionStartedAt: new Date(Date.now() - 40 * 86400_000).toISOString() })
    );
    const dry = await runGc({ dataDir, dryRun: true, packRetentionDays: 30, orphanMinAgeMs: 0 });
    expect(dry.expired.packIds).toContain(created.packId);
    expect(readPackManifest(dataDir, created.packId)).not.toBeNull();

    const applied = await runGc({ dataDir, dryRun: false, packRetentionDays: 30, orphanMinAgeMs: 0 });
    expect(applied.expired.packIds).toContain(created.packId);
    expect(readPackManifest(dataDir, created.packId)).toBeNull();
    expect(store.find(sticker)).toBeNull();
    // 没过期的包不受影响
    expect(readPackManifest(dataDir, manifestPackId)).not.toBeNull();
  }, 60000);

  it("保留期不追溯既往：策略刚启用时老包也有完整窗口", async () => {
    const sticker = await mkAsset(240, 240, 70);
    const created = await createPack(store, dataDir, {
      presetId: "wechat_stickers",
      assets: [{ label: "001", assetId: sticker, role: "sticker" }],
      metadata: { title: "很老的包" },
      generation: { source: "ai-generate", providerId: "mock", prompt: "x", styles: ["贴纸"] }
    });
    // 把包的时间改到 400 天前
    const manifestPath = path.join(dataDir, "packs", `${created.packId}.json`);
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    raw.metadata.createdAt = new Date(Date.now() - 400 * 86400_000).toISOString();
    fs.writeFileSync(manifestPath, JSON.stringify(raw, null, 2));

    // 从未启用过保留期 → 第一次跑把「生效起点」锚定到现在，老包不该被删
    fs.rmSync(path.join(dataDir, "maintenance.json"), { force: true });
    const first = await runGc({ dataDir, dryRun: false, packRetentionDays: 30, orphanMinAgeMs: 0 });
    expect(first.expired.packIds).not.toContain(created.packId);
    expect(first.expired.retentionStartedAt).toBeTruthy();
    expect(readPackManifest(dataDir, created.packId)).not.toBeNull();

    // 把生效起点倒推 400 天 → 这个包就真的过期了
    fs.writeFileSync(
      path.join(dataDir, "maintenance.json"),
      JSON.stringify({ retentionStartedAt: new Date(Date.now() - 400 * 86400_000).toISOString() })
    );
    const second = await runGc({ dataDir, dryRun: false, packRetentionDays: 30, orphanMinAgeMs: 0 });
    expect(second.expired.packIds).toContain(created.packId);
    expect(readPackManifest(dataDir, created.packId)).toBeNull();
    expect(store.find(sticker)).toBeNull();
  }, 60000);

  it("删除包后其素材变成孤儿，下一轮 GC 会回收", async () => {
    const sticker = await mkAsset(240, 240, 50);
    const created = await createPack(store, dataDir, {
      presetId: "wechat_stickers",
      assets: [{ label: "001", assetId: sticker, role: "sticker" }],
      metadata: { title: "待删包" },
      generation: { source: "ai-generate", providerId: "mock", prompt: "x", styles: ["贴纸"] }
    });

    expect((await app.inject({ method: "DELETE", url: `/api/packs/${created.packId}` })).statusCode).toBe(200);
    expect(readPackManifest(dataDir, created.packId)).toBeNull();
    // 再删一次：已经没了
    expect((await app.inject({ method: "DELETE", url: `/api/packs/${created.packId}` })).statusCode).toBe(404);
    // 下载也应 404
    expect((await app.inject({ method: "GET", url: `/api/packs/${created.packId}/download` })).statusCode).toBe(404);

    const report = await runGc({ dataDir, dryRun: false, orphanMinAgeMs: 0 });
    expect(store.find(sticker)).toBeNull();
    expect(report.errors).toEqual([]);
  }, 60000);
});
