import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFileAssetStore, findAssetFile, listAssetFiles } from "../src/lib/assets";

describe("AssetStore 资源查找", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-assets-"));
  const store = createFileAssetStore(dataDir);

  beforeAll(() => {
    store.save(Buffer.from("png-bytes"), "abc123", "png");
    store.save(Buffer.from("webp-bytes"), "def456", "webp");
    store.save(Buffer.from("jpg-bytes"), "ghi789", "jpg");
  });

  afterAll(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("按扩展名探测即可命中，不需要扫描目录", () => {
    expect(findAssetFile(dataDir, "abc123")).toMatchObject({ filename: "abc123.png" });
    expect(findAssetFile(dataDir, "def456")).toMatchObject({ filename: "def456.webp" });
    expect(findAssetFile(dataDir, "ghi789")).toMatchObject({ filename: "ghi789.jpg" });
    expect(findAssetFile(dataDir, "missing0")).toBeNull();
  });

  it("拒绝路径穿越与非法 assetId", () => {
    const evil = [
      "../../etc/passwd",
      "..%2F..%2Fetc",
      "a/b",
      "a\\b",
      "a b",
      ".hidden",
      "",
      "x".repeat(65)
    ];
    for (const id of evil) {
      expect(findAssetFile(dataDir, id), `id=${JSON.stringify(id)}`).toBeNull();
    }
  });

  it("目录不存在时安全返回 null", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-empty-"));
    expect(findAssetFile(empty, "abc123")).toBeNull();
    expect(listAssetFiles(empty)).toEqual([]);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it("listAssetFiles 枚举全部资源与体积", () => {
    const files = listAssetFiles(dataDir);
    expect(files.map((f) => f.filename).sort()).toEqual(["abc123.png", "def456.webp", "ghi789.jpg"]);
    for (const f of files) {
      expect(f.bytes).toBeGreaterThan(0);
      expect(f.mtimeMs).toBeGreaterThan(0);
      expect(f.assetId).toBe(f.filename.slice(0, f.filename.lastIndexOf(".")));
    }
  });

  it("find 的性能不随目录规模退化（探测，而非扫描）", () => {
    // 往目录里灌入大量无关文件，单次查找耗时应基本不变
    const noiseDir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-noise-"));
    fs.mkdirSync(path.join(noiseDir, "uploads"), { recursive: true });
    const noise = path.join(noiseDir, "uploads");
    for (let i = 0; i < 2000; i++) fs.writeFileSync(path.join(noise, `noise${i}.png`), "x");
    fs.writeFileSync(path.join(noise, "target1.png"), "x");

    const time = (fn: () => void) => {
      const t = process.hrtime.bigint();
      for (let i = 0; i < 50; i++) fn();
      return Number(process.hrtime.bigint() - t) / 1e6 / 50;
    };
    const probing = time(() => findAssetFile(noiseDir, "target1"));
    const scanning = time(() => fs.readdirSync(noise).find((f) => f.startsWith("target1.")));

    expect(findAssetFile(noiseDir, "target1")).not.toBeNull();
    expect(probing).toBeLessThan(scanning);
    fs.rmSync(noiseDir, { recursive: true, force: true });
  });
});
