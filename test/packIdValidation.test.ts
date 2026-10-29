import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findPackZipPath,
  isValidPackId,
  listPacks,
  readPackManifest
} from "../src/services/pack/service";

const dirs: string[] = [];
function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-packid-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("packId 路径安全", () => {
  it("只接受 URL 安全的 packId", () => {
    expect(isValidPackId("V1StGXR8_Z5jdHi6B-myT")).toBe(true);
    expect(isValidPackId("abc_DEF-123")).toBe(true);
    expect(isValidPackId("../../etc/passwd")).toBe(false);
    expect(isValidPackId("..")).toBe(false);
    expect(isValidPackId("a/b")).toBe(false);
  });

  it("拒绝带路径分隔符的 packId，避免越出 packs 目录", () => {
    const dir = makeDir();
    expect(() => readPackManifest(dir, "../../etc/passwd")).toThrow(/invalid packId/);
    expect(findPackZipPath(dir, "../../etc/passwd")).toBeNull();
  });

  it("扫描 packs 目录时忽略非法文件名", () => {
    const dir = makeDir();
    const packs = path.join(dir, "packs");
    fs.mkdirSync(packs, { recursive: true });
    fs.writeFileSync(path.join(packs, "../evil.json"), "{}");
    fs.writeFileSync(path.join(packs, "ok-pack_1.json"), "{}");
    const ids = listPacks(dir).map((p) => p.packId);
    expect(ids).not.toContain("../evil");
    expect(ids).toContain("ok-pack_1");
  });
});
