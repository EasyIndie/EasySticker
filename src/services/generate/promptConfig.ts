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
      type: "mock" | "picsum" | "doubao" | "hf" | "http" | "openai" | string;
      name?: string;
      baseUrl?: string;
      endpoint?: string;
      apiKey?: string;
      model?: string;
      background?: "transparent" | "opaque" | "auto";
      quality?: "low" | "medium" | "high" | "auto";
      outputFormat?: "png" | "jpeg" | "webp";
      moderation?: "low" | "auto";
      inputFidelity?: "low" | "high";
      comfy?: {
        qualityPreset?: string;
        checkpoint?: string;
        promptPrefix?: string;
        promptSuffix?: string;
        negativePrompt?: string;
        negativePromptAppend?: string;
        qualityPresets?: Record<string, {
          steps?: number;
          cfg?: number;
          denoise?: number;
          samplerName?: string;
          scheduler?: string;
          checkpoint?: string;
          promptPrefix?: string;
          promptSuffix?: string;
          negativePrompt?: string;
          negativePromptAppend?: string;
        }>;
      };
      autoStart?: {
        command: string;
        args?: string[];
        cwd?: string;
        env?: Record<string, string>;
        healthUrl?: string;
        cancelUrl?: string;
        startupTimeoutMs?: number;
        idleMs?: number;
      };
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
      };
      corsAllowOrigin?: string;
      jwtSecret?: string;
      monitorRetentionDays?: number;
    };
  };
  global: {
    prompt: string;
    negativePrompt: string;
    styles: string[];
  };
  emotions: string[];
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
    console.error("Failed to load default prompt config:", error);
    // 降级为硬编码的默认值
    config = {
      ai: {
        defaultProvider: "mock",
        referenceMode: "base64",
        imageSize: { width: 256, height: 256 },
        settings: {
          timeoutMs: 60000,
          retryMax: 3,
          retryBaseMs: 1000
        },
        providers: {}
      },
      server: {
        host: "0.0.0.0",
        port: 3000,
        dataDir: "data",
        logLevel: "info",
        taskTtlMs: 3600000,
        taskGcIntervalMs: 600000
      },
      global: {
        prompt: "基于参考图的主体形象，生成微信聊天场景可用的表情贴纸。要求：可爱有趣，主体居中，背景透明，避免水印，可适当添加文字，字数不超过4个，使用简体中文",
        negativePrompt: "文字、水印、二维码、品牌logo、复杂背景、低清晰度、锯齿、模糊",
        styles: ["扁平插画", "3D 卡通", "日系 Q 版", "像素风", "国潮风"]
      },
      emotions: [
        "开心，大笑，挥手打招呼", "点赞，竖起大拇指", "比心，双手比心", "害羞，捂脸",
        "感谢，双手合十", "哭泣，流泪", "生气，双手抱胸", "疑问，头上带有问号",
        "睡觉，打呼噜", "奋斗，头绑发带加油", "震惊，下巴掉下来", "无奈，摊手",
        "期待，星星眼", "庆祝，撒花", "拒绝，双手打叉", "吃瓜，拿爆米花",
        "叹气，扶额", "庆祝，举起酒杯", "思考，手托下巴", "疲惫，瘫倒",
        "偷笑，捂嘴", "抱抱，张开双臂", "冷汗，流汗", "期待，搓手"
      ],
      templates: {
        sticker: "{{prompt}}\\n当前表情主题与动作：{{emotion}}\\n风格：{{style}}",
        extra: "{{prompt}}\\n{{customPrompt}}\\n风格：{{style}}"
      },
      extraPrompts: {
        cover: "当前要求：生成一张能代表整套表情包的高质量主封面，构图饱满，主体居中。",
        icon: "当前要求：生成一个极简的头像图标，主要突出角色面部特征，大头贴特写。",
        banner: "当前要求：这是一张宽屏横幅插画，适合作为详情页背景，角色处于画面右侧，左侧留白。",
        rewardGuide: "当前要求：这是一张赞赏引导图横幅，角色做出期待、可怜或感谢的动作，右侧留出空白区域。",
        rewardThanks: "当前要求：这是一张感谢打赏的横幅插画，角色非常开心、欢呼撒花，横幅比例。"
      }
    };
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
          imageSize: customConfig.ai.imageSize ?? config.ai?.imageSize ?? { width: 256, height: 256 },
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
          ...customConfig.server
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

export function compilePrompt(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), value);
  }
  return result;
}
