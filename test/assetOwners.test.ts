import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileAssetStore } from "../src/lib/assets";
import {
  loadAssetOwners,
  pruneAssetOwners,
  recordAssetOwner,
  removeAssetOwners,
  withAssetOwner
} from "../src/lib/assetOwners";

describe("素材归属索引", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "easysticker-owners-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("记录后再读取，后写的归属覆盖先写的", () => {
    recordAssetOwner(dir, "a", "alice@test.com");
    recordAssetOwner(dir, "b", "bob@test.com");
    recordAssetOwner(dir, "a", "carol@test.com");

    const map = loadAssetOwners(dir);
    expect(map.get("a")).toBe("carol@test.com");
    expect(map.get("b")).toBe("bob@test.com");
  });

  it("owner 为空时不记录", () => {
    recordAssetOwner(dir, "x", null);
    recordAssetOwner(dir, "y", "");
    expect(loadAssetOwners(dir).size).toBe(0);
  });

  it("removeAssetOwners 只删指定 id", () => {
    recordAssetOwner(dir, "a", "alice@test.com");
    recordAssetOwner(dir, "b", "bob@test.com");
    removeAssetOwners(dir, ["a"]);

    const map = loadAssetOwners(dir);
    expect(map.has("a")).toBe(false);
    expect(map.get("b")).toBe("bob@test.com");
  });

  it("pruneAssetOwners 只保留仍然存在的 id", () => {
    recordAssetOwner(dir, "a", "alice@test.com");
    recordAssetOwner(dir, "b", "bob@test.com");
    pruneAssetOwners(dir, ["b"]);

    const map = loadAssetOwners(dir);
    expect(map.has("a")).toBe(false);
    expect(map.get("b")).toBe("bob@test.com");
  });

  it("withAssetOwner 在 save 时记录归属，且 find 仍然可用", () => {
    const store = createFileAssetStore(dir);
    const owned = withAssetOwner(store, dir, "alice@test.com");
    owned.save(Buffer.from("x"), "asset-1", "png");

    expect(store.find("asset-1")).not.toBeNull();
    expect(loadAssetOwners(dir).get("asset-1")).toBe("alice@test.com");
  });

  it("withAssetOwner 没有 owner 时原样返回", () => {
    const store = createFileAssetStore(dir);
    expect(withAssetOwner(store, dir, null)).toBe(store);
  });
});
