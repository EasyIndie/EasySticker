import fs from "node:fs";
import path from "node:path";

export interface PromptConfig {
  ai: {
    defaultProvider: string;
    publicBaseUrl?: string;
    referenceMode?: "base64" | "url" | "assetId" | "multipart";
    imageSize?: {
      width: number;
      height: number;
    };
    settings?: {
      timeoutMs?: number;
      retryMax?: number;
      retryBaseMs?: number;
    };
    providers: Record<string, {
      type: "mock" | "openai" | string;
      name?: string;
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      background?: "transparent" | "opaque" | "auto";
      quality?: "low" | "medium" | "high" | "auto";
      outputFormat?: "png" | "jpeg" | "webp";
      moderation?: "low" | "auto";
      inputFidelity?: "low" | "high";
      variant?: "gpt-image" | "generic";
      size?: string;
      [key: string]: any;
    }>;
  };
  server?: {
    host?: string;
    port?: number;
    dataDir?: string;
    logLevel?: string;
    taskTtlMs?: number;
    taskGcIntervalMs?: number;
    /** 数据目录定期清理（`data/uploads` / `data/packs`）。 */
    maintenance?: {
      gcEnabled?: boolean;
      gcIntervalMs?: number;
      packRetentionDays?: number;
      orphanMinAgeHours?: number;
      compactLegacyPacks?: boolean;
      dropOrigBackups?: boolean;
    };
    security?: {
      apiToken?: string;
      enableAuth?: boolean;
      jwtSecret?: string;
      rateLimit?: {
        maxRequests: number;
        windowMs: number;
      };
      dailyQuota?: {
        maxGenerations: number;
        anonymousMaxGenerations?: number;
      };
      corsAllowOrigin?: string;
      trustProxy?: boolean;
      monitorRetentionDays?: number;
      registration?: {
        mode?: "open" | "invite" | "closed";
      };
    };
  };
  global: {
    negativePrompt: string;
    styles: string[];
    /** 风格名 → 详细风格提示词。编译时把模板里的 `{{style}}` 展开成它，避免与预设重复描述风格。 */
    stylePrompts?: Record<string, string>;
  };
  emotions: string[];
  /** 多套提示词模板：用户可一键套用，减少多次生成结果雷同。 */
  promptPresets?: Array<{
    id: string;
    name: string;
    prompt: string;
    /** 预设推荐风格（须存在于 `global.styles`）；选中后前端会自动切到该风格。 */
    style?: string;
    /** 预设专属情绪/动作集；选中该预设时覆盖全局 `emotions`（参数化系列模板）。 */
    emotions?: string[];
  }>;
  templates: {
    sticker: string;
    extra: string;
  };
  extraPrompts: {
    cover: string;
    icon: string;
    banner: string;
    rewardGuide: string;
    rewardThanks: string;
  };
}

let cachedConfig: PromptConfig | null = null;

export function loadPromptConfig(): PromptConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const defaultPath = path.join(process.cwd(), "prompt-config.default.json");
  const customPath = path.join(process.cwd(), "prompt-config.json");

  let config: Partial<PromptConfig> = {};
  
  try {
    const defaultContent = fs.readFileSync(defaultPath, "utf-8");
    config = JSON.parse(defaultContent);
  } catch (error) {
    throw new Error(
      `无法加载默认配置 prompt-config.default.json（路径：${defaultPath}）：` +
        `${error instanceof Error ? error.message : String(error)}。请确认该文件存在且为合法 JSON。`
    );
  }

  if (fs.existsSync(customPath)) {
    try {
      const customContent = fs.readFileSync(customPath, "utf-8");
      const customConfig = JSON.parse(customContent);
      
      // 深度合并用户配置
      if (customConfig.ai) {
        config.ai = {
          defaultProvider: customConfig.ai.defaultProvider ?? config.ai?.defaultProvider ?? "mock",
          publicBaseUrl: customConfig.ai.publicBaseUrl ?? config.ai?.publicBaseUrl,
          referenceMode: customConfig.ai.referenceMode ?? config.ai?.referenceMode ?? "base64",
          imageSize: customConfig.ai.imageSize ?? config.ai?.imageSize ?? { width: 1024, height: 1024 },
          settings: {
            ...config.ai?.settings,
            ...customConfig.ai.settings
          },
          providers: {
            ...(config.ai?.providers || {}),
            ...(customConfig.ai.providers || {})
          }
        };
      }

      if (customConfig.server) {
        config.server = {
          ...config.server,
          ...customConfig.server,
          security: {
            ...(config.server?.security || {}),
            ...(customConfig.server.security || {})
          }
        };
      }

      if (customConfig.global) {
        config.global = {
          ...config.global,
          ...customConfig.global
        };
      }

      if (customConfig.emotions && Array.isArray(customConfig.emotions)) {
        config.emotions = customConfig.emotions;
      }

      if (customConfig.promptPresets && Array.isArray(customConfig.promptPresets)) {
        config.promptPresets = customConfig.promptPresets;
      }
      
      if (customConfig.templates) {
        config.templates = {
          ...config.templates,
          ...customConfig.templates
        };
      }
      
      if (customConfig.extraPrompts) {
        config.extraPrompts = {
          ...config.extraPrompts,
          ...customConfig.extraPrompts
        };
      }
      console.log("Loaded custom prompt config.");
    } catch (error) {
      console.error("Failed to load custom prompt config:", error);
    }
  }

  cachedConfig = config as PromptConfig;
  return cachedConfig;
}

/** 清空缓存并重新加载配置（写入配置后调用即可热生效）。 */
export function reloadPromptConfig(): PromptConfig {
  cachedConfig = null;
  return loadPromptConfig();
}

function readDefaultConfig(): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "prompt-config.default.json"), "utf-8"));
  } catch {
    return {};
  }
}

/**
 * 将用户级覆盖写入 prompt-config.json。为避免漂移，只写入与默认值不同的字段
 * （与默认相同的字段会被移除，交回默认继承）。密钥不在此处理，见 setProviderApiKey。
 */
export function updatePromptConfig(partial: {
  defaultProvider?: string;
  providers?: Record<string, Record<string, unknown>>;
}): PromptConfig {
  const customPath = path.join(process.cwd(), "prompt-config.json");
  const defaults = readDefaultConfig();

  let custom: any = {};
  if (fs.existsSync(customPath)) {
    try {
      custom = JSON.parse(fs.readFileSync(customPath, "utf-8"));
    } catch {
      custom = {};
    }
  }
  custom.ai = custom.ai || {};

  if (partial.defaultProvider !== undefined) {
    if (defaults?.ai?.defaultProvider === partial.defaultProvider) {
      delete custom.ai.defaultProvider;
    } else {
      custom.ai.defaultProvider = partial.defaultProvider;
    }
  }

  if (partial.providers) {
    for (const [id, fields] of Object.entries(partial.providers)) {
      const def = defaults?.ai?.providers?.[id] || {};
      const diff: Record<string, unknown> = { ...(custom.ai.providers?.[id] || {}) };
      for (const [key, value] of Object.entries(fields)) {
        if (JSON.stringify(def[key]) === JSON.stringify(value)) {
          delete diff[key];
        } else {
          diff[key] = value;
        }
      }
      custom.ai.providers = custom.ai.providers || {};
      if (Object.keys(diff).length > 0) {
        custom.ai.providers[id] = diff;
      } else {
        delete custom.ai.providers[id];
      }
    }
    if (custom.ai.providers && Object.keys(custom.ai.providers).length === 0) {
      delete custom.ai.providers;
    }
  }

  if (Object.keys(custom.ai).length === 0) delete custom.ai;

  fs.writeFileSync(customPath, JSON.stringify(custom, null, 2) + "\n", "utf-8");
  return reloadPromptConfig();
}

export function compilePrompt(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), value);
  }
  return result;
}

/**
 * 把风格名解析成实际写进提示词的风格描述：
 * 命中 `global.stylePrompts` 时用详细描述，否则回退到风格名本身。
 * 这样「风格」只在 `stylePrompts` 里描述一次，预设不必重复写画风。
 */
export function resolveStylePrompt(config: PromptConfig, style: string): string {
  const mapped = config.global.stylePrompts?.[style];
  return mapped && mapped.trim() ? mapped.trim() : style;
}

/** 按 id 查找提示词预设（参数化系列模板的入口）。 */
export function findPromptPreset(
  config: PromptConfig,
  presetId?: string | null
): NonNullable<PromptConfig["promptPresets"]>[number] | undefined {
  if (!presetId) return undefined;
  return (config.promptPresets ?? []).find((preset) => preset.id === presetId);
}

/**
 * 解析本次生成实际使用的情绪/动作集：优先用预设自带的一组，否则回退到全局 `emotions`。
 * 这样「一个 IP + 一个模板 + N 组情绪参数」的系列预设可以自我描述，不污染其它预设。
 */
export function resolveEmotions(config: PromptConfig, presetId?: string | null): string[] {
  const preset = findPromptPreset(config, presetId);
  return preset?.emotions?.length ? preset.emotions : config.emotions;
}
