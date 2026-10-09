import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createFileAssetStore } from "../src/lib/assets";
import { createPack, listPacks, readPackManifest } from "../src/services/pack/service";

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } })
    .png()
    .toBuffer();
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-pack-"));
  return { dir, store: createFileAssetStore(dir) };
}

describe("createPack —— 覆盖同一 packId（编辑一张图不新增历史）", () => {
  it("带 packId 且归属一致：原地更新、保留 createdAt、历史仍只有一条", async () => {
    const { dir, store } = setup();
    store.save(await png(), "a1", "png");
    const first = await createPack(
      store,
      dir,
      { presetId: "wechat_stickers", assets: [{ label: "001", assetId: "a1", prompt: "v1" }], metadata: { title: "t" } },
      "client:me"
    );
    const manifest1 = readPackManifest(dir, first.packId)!;
    expect(manifest1.metadata.createdAt).toBeTruthy();

    store.save(await png(), "a2", "png");
    const second = await createPack(
      store,
      dir,
      {
        packId: first.packId,
        presetId: "wechat_stickers",
        assets: [{ label: "001", assetId: "a2", prompt: "v2" }],
        metadata: { title: "t" }
      },
      "client:me"
    );

    expect(second.packId).toBe(first.packId);
    const manifest2 = readPackManifest(dir, first.packId)!;
    // createdAt 保留，历史/保留期不因编辑而变
    expect(manifest2.metadata.createdAt).toBe(manifest1.metadata.createdAt);
    // 内容确实更新为新图
    expect(manifest2.metadata.files[0].assetId).toBe("a2");
    expect(manifest2.metadata.files[0].prompt).toBe("v2");
    // 服务端只有一个包
    expect(listPacks(dir).map((p) => p.packId)).toEqual([first.packId]);
  });

  it("归属不一致：不覆盖，另建新包（避免覆盖他人）", async () => {
    const { dir, store } = setup();
    store.save(await png(), "a1", "png");
    const first = await createPack(
      store,
      dir,
      { presetId: "wechat_stickers", assets: [{ label: "001", assetId: "a1" }] },
      "client:owner-a"
    );

    store.save(await png(), "a2", "png");
    const second = await createPack(
      store,
      dir,
      { packId: first.packId, presetId: "wechat_stickers", assets: [{ label: "001", assetId: "a2" }] },
      "client:owner-b"
    );

    expect(second.packId).not.toBe(first.packId);
    expect(listPacks(dir)).toHaveLength(2);
  });

  it("packId 不存在：不采用客户端指定的 ID，另建新包", async () => {
    const { dir, store } = setup();
    store.save(await png(), "a1", "png");
    const res = await createPack(
      store,
      dir,
      { packId: "not-exist", presetId: "wechat_stickers", assets: [{ label: "001", assetId: "a1" }] },
      "client:me"
    );

    expect(res.packId).not.toBe("not-exist");
    expect(readPackManifest(dir, "not-exist")).toBeNull();
  });
});
