import { describe, expect, it } from "vitest";
import { resourceSchema } from "../src/shared/contracts";

const base = {
  presetId: "wechat_stickers",
  referenceAssetId: "ref-1",
  target: { kind: "sticker" as const, index: 0 },
  sourceAssetId: "src-1"
};

describe("resourceSchema：编辑可不带基础提示词，重新生成必须带", () => {
  it("mode=edit：缺 prompt / 空 prompt 都通过", () => {
    expect(resourceSchema.safeParse({ ...base, mode: "edit" }).success).toBe(true);
    expect(resourceSchema.safeParse({ ...base, mode: "edit", prompt: "" }).success).toBe(true);
  });

  it("mode=regenerate：必须提供非空 prompt", () => {
    expect(resourceSchema.safeParse({ ...base, mode: "regenerate" }).success).toBe(false);
    expect(resourceSchema.safeParse({ ...base, mode: "regenerate", prompt: "   " }).success).toBe(false);
    expect(resourceSchema.safeParse({ ...base, mode: "regenerate", prompt: "Q版人物" }).success).toBe(true);
  });

  it("未显式传 mode 时默认 regenerate，缺 prompt 被拒", () => {
    expect(resourceSchema.safeParse({ ...base }).success).toBe(false);
  });
});

describe("resourceSchema：没有原包参考图时仍可编辑 / 重生成", () => {
  it("referenceAssetId 可省略：编辑用 sourceAssetId", () => {
    const { referenceAssetId: _referenceAssetId, ...withoutReference } = base;
    expect(resourceSchema.safeParse({ ...withoutReference, mode: "edit" }).success).toBe(true);
  });

  it("referenceAssetId 可省略：重生成用 sourceAssetId 兜底", () => {
    const { referenceAssetId: _referenceAssetId, ...withoutReference } = base;
    expect(
      resourceSchema.safeParse({ ...withoutReference, mode: "regenerate", prompt: "Q版人物" }).success
    ).toBe(true);
  });

  it("编辑模式必须提供 sourceAssetId", () => {
    const { sourceAssetId: _sourceAssetId, ...withoutSource } = base;
    expect(resourceSchema.safeParse({ ...withoutSource, mode: "edit" }).success).toBe(false);
  });
});
