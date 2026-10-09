import { afterEach, describe, expect, it, vi } from "vitest";
import * as promptConfigModule from "../src/services/generate/promptConfig";
import { resolveEmotions, resolveStylePrompt } from "../src/services/generate/promptConfig";
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

  it("所有预设提示词结构统一（主体 / 主题 / 动作 / 元素，顺序一致）", () => {
    const presets = baseConfig().promptPresets ?? [];
    const labels = ["主体：", "主题：", "动作：", "元素："];
    for (const preset of presets) {
      for (const label of labels) {
        expect(preset.prompt, `${preset.id} 缺「${label}」`).toContain(label);
      }
      const positions = labels.map((label) => preset.prompt.indexOf(label));
      expect(positions, `${preset.id} 字段顺序不对`).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it("默认提供至少 12 种风格", () => {
    expect(baseConfig().global.styles.length).toBeGreaterThanOrEqual(12);
  });

  it("极简蜡笔预设是参数化系列模板：自带风格 + 24 组结构化情绪参数", () => {
    const config = baseConfig();
    const preset = (config.promptPresets ?? []).find((p) => p.id === "minimal-crayon");
    expect(preset).toBeTruthy();
    // 与其它预设保持同一命名习惯：四字名
    expect(preset!.name).toHaveLength(4);
    expect(preset!.style).toBe("极简蜡笔涂鸦");
    expect(config.global.styles).toContain(preset!.style);
    expect(preset!.emotions).toHaveLength(24);
    // 通用模板：角色来源应指向参考图，而不是写死某一种动物
    expect(preset!.prompt).toContain("参考图");
    expect(preset!.prompt).not.toContain("兔子");
    // 画风只写在 stylePrompts 里，预设不重复描述风格（避免与「风格选择」重叠）
    expect(preset!.prompt).not.toContain("Minimalist Kawaii Sticker");
    expect(config.global.stylePrompts?.["极简蜡笔涂鸦"]).toContain("Minimalist Kawaii Sticker");
    for (const emotion of preset!.emotions!) {
      expect(emotion).toMatch(/眼睛/);
      expect(emotion).toMatch(/嘴巴/);
      expect(emotion).toMatch(/手臂/);
      expect(emotion).toMatch(/姿势/);
    }
  });

  it("透明背景与画面规则统一由 templates.sticker 保证，预设不重复", () => {
    const config = baseConfig();
    expect(config.templates.sticker).toContain("透明背景");
    expect(config.templates.sticker).toContain("辅助元素不超过 2 个");
    // 透明背景是贴纸专用规则，不应进全局负面（否则会污染封面/横幅/参考图）
    expect(config.global.negativePrompt).not.toContain("不透明背景");
    for (const preset of config.promptPresets ?? []) {
      // 预设不重复写背景/构图/风格
      expect(preset.prompt, `${preset.id} 不应重复写背景`).not.toContain("背景透明");
      expect(preset.prompt, `${preset.id} 不应写风格`).not.toMatch(/Q\s*版|大头小身|画风|描边/);
    }
  });

  it("resolveStylePrompt 命中时展开为详细风格描述，否则回退风格名", () => {
    const config = baseConfig();
    expect(resolveStylePrompt(config, "极简蜡笔涂鸦")).toContain("Minimalist Kawaii Sticker");
    expect(resolveStylePrompt(config, "贴纸")).toContain("sticker");
    expect(resolveStylePrompt(config, "不存在的风格")).toBe("不存在的风格");
    // 每个内置风格都应有对应描述，否则「风格选择」形同虚设
    for (const style of config.global.styles) {
      expect(resolveStylePrompt(config, style)).not.toBe(style);
    }
  });

  it("resolveEmotions 优先用预设自带情绪，否则回退全局", () => {
    const config = baseConfig();
    const preset = (config.promptPresets ?? []).find((p) => p.id === "minimal-crayon");
    expect(resolveEmotions(config, "minimal-crayon")).toBe(preset!.emotions);
    expect(resolveEmotions(config, "daily")).toBe(config.emotions);
    expect(resolveEmotions(config, "不存在")).toBe(config.emotions);
    expect(resolveEmotions(config, undefined)).toBe(config.emotions);
  });
});
