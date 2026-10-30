import { describe, expect, it } from "vitest";
import { loadPromptConfig } from "../src/services/generate/promptConfig";
import {
  buildExtraPrompt,
  buildReferencePrompt,
  buildStickerPrompt,
  resolveStyleName
} from "../src/services/generate/promptBuilder";

const config = loadPromptConfig();

describe("promptBuilder：统一的提示词拼接入口", () => {
  it("贴纸提示词：内容 → 表情与动作 → 画面风格 → 背景 → 构图，顺序固定", () => {
    const prompt = buildStickerPrompt(config, {
      prompt: "主体：以参考图中的主体为准；主题：日常聊天；动作：挥手；元素：星星。",
      emotion: "开心，大笑，挥手打招呼",
      style: "贴纸"
    });

    const lines = prompt.split("\n");
    expect(lines[0]).toContain("主体：");
    expect(lines[1]).toBe("表情与动作：开心，大笑，挥手打招呼");
    expect(lines[2]).toMatch(/^画面风格：/);
    expect(lines[2]).toContain("Die-cut sticker style");
    expect(lines[3]).toMatch(/^背景：/);
    expect(lines[3]).toContain("透明背景");
    expect(lines[4]).toMatch(/^构图：/);
    expect(lines[4]).toContain("辅助元素不超过 2 个");
  });

  it("未选风格时不把「默认」写进提示词，而是回退到第一个可用风格", () => {
    const prompt = buildStickerPrompt(config, { prompt: "主体：…", emotion: "开心", style: "默认" });
    expect(prompt).not.toContain("画面风格：默认");
    expect(prompt).toContain(`画面风格：${config.global.stylePrompts?.[config.global.styles[0]!]}`);

    expect(resolveStyleName(config, "")).toBe(config.global.styles[0]);
    expect(resolveStyleName(config, "默认")).toBe(config.global.styles[0]);
    expect(resolveStyleName(config, "贴纸")).toBe("贴纸");
  });

  it("omitStyle：补齐时明确不选风格，完全不写「画面风格」段", () => {
    const sticker = buildStickerPrompt(config, {
      prompt: "主体：橘猫",
      emotion: "开心",
      omitStyle: true
    });
    const extra = buildExtraPrompt(config, {
      prompt: "主体：橘猫",
      requirement: config.extraPrompts.banner,
      omitStyle: true
    });

    expect(sticker).not.toContain("画面风格");
    expect(sticker).not.toContain("{{style}}");
    expect(extra).not.toContain("画面风格");
    expect(extra).not.toContain("{{style}}");
    expect(extra).toContain("画面类型：详情页横幅");
  });

  it("扩展资源提示词：内容 → 资源要求 → 画面风格，且不含贴纸专用的背景/构图规则", () => {
    const prompt = buildExtraPrompt(config, {
      prompt: "主体：以参考图中的主体为准；主题：日常聊天；动作：挥手；元素：星星。",
      requirement: config.extraPrompts.banner,
      style: "扁平插画"
    });

    expect(prompt).toContain("画面类型：详情页横幅");
    expect(prompt).toContain("宽幅比例");
    expect(prompt).toContain("画面风格：Flat vector illustration");
    expect(prompt).not.toContain("辅助元素不超过 2 个");
    expect(prompt).not.toContain("透明背景");
  });

  it("参考图提示词：有风格时追加「画面风格」，无风格时保持原样", () => {
    expect(buildReferencePrompt(config, { prompt: "一只橘猫", style: "水彩风" })).toContain(
      "画面风格：Watercolor illustration"
    );
    expect(buildReferencePrompt(config, { prompt: "一只橘猫", style: "" })).toBe("一只橘猫");
  });

  it("全局负面提示词不再与「情侣互动」等双主体预设冲突", () => {
    expect(config.global.negativePrompt).not.toContain("多人");
    expect(config.global.negativePrompt).toContain("人群");
  });
});
