import { afterEach, describe, expect, it, vi } from "vitest";
import * as promptConfigModule from "../src/services/generate/promptConfig";
import { getPromptTemplate } from "../src/services/generate/flow";

function baseConfig() {
  return promptConfigModule.loadPromptConfig();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/generate/prompt 提示词模板预设", () => {
  it("返回全部预设，不替用户随机选择", async () => {
    const presets = [
      { id: "a", name: "A 套", prompt: "提示词 A" },
      { id: "b", name: "B 套", prompt: "提示词 B" }
    ];
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ...baseConfig(),
      promptPresets: presets
    });

    const res = await getPromptTemplate("ref-1");
    expect(res.referenceAssetId).toBe("ref-1");
    expect(res.promptPresets).toEqual(presets);
    expect(res.negativePrompt).toBeTypeOf("string");
    expect(res.styles.length).toBeGreaterThan(0);
    // 不再返回随机选中的 prompt / suggestedPresetId
    expect((res as any).prompt).toBeUndefined();
    expect((res as any).suggestedPresetId).toBeUndefined();
  });

  it("没有预设时返回空数组", async () => {
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ...baseConfig(),
      promptPresets: []
    });

    const res = await getPromptTemplate("ref-2");
    expect(res.promptPresets).toEqual([]);
  });

  it("默认配置内置至少 12 套预设，字段完整且 id 唯一", () => {
    const presets = baseConfig().promptPresets ?? [];
    expect(presets.length).toBeGreaterThanOrEqual(12);
    const ids = new Set(presets.map((p) => p.id));
    expect(ids.size).toBe(presets.length);
    for (const preset of presets) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.prompt.length).toBeGreaterThan(10);
    }
  });

  it("默认提供至少 12 种风格", () => {
    expect(baseConfig().global.styles.length).toBeGreaterThanOrEqual(12);
  });
});
