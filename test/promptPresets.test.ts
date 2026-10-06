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
  it("返回全部预设，并推荐其中一套", async () => {
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
    const picked = res.promptPresets.find((p) => p.id === res.suggestedPresetId);
    expect(picked).toBeTruthy();
    expect(res.prompt).toBe(picked!.prompt);
  });

  it("没有预设时回退到 global.prompt", async () => {
    const config = { ...baseConfig(), promptPresets: [] };
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue(config);

    const res = await getPromptTemplate("ref-2");
    expect(res.promptPresets).toEqual([]);
    expect(res.suggestedPresetId).toBeNull();
    expect(res.prompt).toBe(config.global.prompt);
  });

  it("默认配置内置 6 套预设，字段完整", () => {
    const presets = baseConfig().promptPresets ?? [];
    expect(presets.length).toBeGreaterThanOrEqual(6);
    const ids = new Set(presets.map((p) => p.id));
    expect(ids.size).toBe(presets.length);
    for (const preset of presets) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.prompt.length).toBeGreaterThan(10);
    }
  });
});
