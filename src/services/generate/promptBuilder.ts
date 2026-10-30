import { compilePrompt, resolveStylePrompt, type PromptConfig } from "./promptConfig";

/**
 * 提示词拼接的唯一入口。
 *
 * 所有生成路径（贴纸 / 扩展资源 / 参考图）都必须经过这里，保证最终发往 AI 服务的
 * 提示词结构一致、不随调用点漂移。统一结构为：
 *
 *   {内容：主体 / 主题 / 动作 / 元素}
 *   {画面约束：表情与动作 / 画面风格 / 背景 / 构图}
 *   {负面约束：由 provider 追加，见 ai/providers/openai.ts 的 buildPrompt}
 *
 * 模板本身存放在 `prompt-config.default.json` 的 `templates` / `extraPrompts`，
 * 这里只负责「选风格、填占位符、拼段落」。
 */

/** 前端在「未选择风格」时的占位值；不应原样写进提示词。 */
export const PLACEHOLDER_STYLE = "默认";

/**
 * 解析本次生成实际使用的风格名：留空或占位时回退到配置里的第一个风格。
 * 避免出现「画面风格：默认」这种对模型无意义的提示词。
 */
export function resolveStyleName(config: PromptConfig, style?: string | null): string {
  const cleaned = (style ?? "").trim();
  if (cleaned && cleaned !== PLACEHOLDER_STYLE) return cleaned;
  return config.global.styles?.find((s) => s && s.trim()) ?? "扁平插画";
}

/**
 * 用户明确不选择风格时不写任何风格段：清掉模板里空的「画面风格：」行，
 * 避免 compilePrompt 把空占位符留成一行无意义文本。
 */
function withoutStyleSection(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*画面风格\s*[:：]\s*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 一组针对「完整角色贴纸」的提示词：单主体、透明背景、1:1、缩略图可读。 */
export function buildStickerPrompt(
  config: PromptConfig,
  params: { prompt: string; emotion: string; style?: string | null; omitStyle?: boolean }
): string {
  if (params.omitStyle) {
    return withoutStyleSection(
      compilePrompt(config.templates.sticker, {
        prompt: params.prompt.trim(),
        emotion: params.emotion.trim(),
        style: "",
        styleName: ""
      })
    );
  }
  const styleName = resolveStyleName(config, params.style);
  return compilePrompt(config.templates.sticker, {
    prompt: params.prompt.trim(),
    emotion: params.emotion.trim(),
    style: resolveStylePrompt(config, styleName),
    styleName
  }).trim();
}

/** 一组针对「扩展资源（封面 / 图标 / 横幅 / 赞赏图）」的提示词。 */
export function buildExtraPrompt(
  config: PromptConfig,
  params: { prompt: string; requirement: string; style?: string | null; omitStyle?: boolean }
): string {
  if (params.omitStyle) {
    return withoutStyleSection(
      compilePrompt(config.templates.extra, {
        prompt: params.prompt.trim(),
        customPrompt: params.requirement.trim(),
        style: "",
        styleName: ""
      })
    );
  }
  const styleName = resolveStyleName(config, params.style);
  return compilePrompt(config.templates.extra, {
    prompt: params.prompt.trim(),
    customPrompt: params.requirement.trim(),
    style: resolveStylePrompt(config, styleName),
    styleName
  }).trim();
}

/** 一张「参考图」的提示词：用户描述 + 统一的画面风格段。 */
export function buildReferencePrompt(
  config: PromptConfig,
  params: { prompt: string; style?: string | null }
): string {
  const style = (params.style ?? "").trim();
  const base = params.prompt.trim();
  if (!style || style === PLACEHOLDER_STYLE) return base;
  return `${base}\n画面风格：${resolveStylePrompt(config, style)}`;
}
