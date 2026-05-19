export type PlatformPreset = {
  id: string;
  title: string;
  description?: string;
  allowedExts: string[];
  maxBytes: number;
  requiredSquare?: boolean;
  exactWidth?: number;
  exactHeight?: number;
  maxWidth: number;
  maxHeight: number;
  minCount?: number;
  maxCount?: number;
  outputFormat?: "png" | "webp";
};

export function getPlatformPreset(id: string): PlatformPreset | undefined {
  return PLATFORM_PRESETS.find((p) => p.id === id);
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    id: "telegram_static",
    title: "Telegram (Static PNG)",
    description: "Telegram 静态贴纸包，512×512 PNG 格式，支持 1–50 张。",
    allowedExts: [".png"],
    maxBytes: 512 * 1024,
    requiredSquare: true,
    maxWidth: 512,
    maxHeight: 512,
    minCount: 1,
    maxCount: 50,
    outputFormat: "png"
  },
  {
    id: "whatsapp_webp",
    title: "WhatsApp (Sticker WebP)",
    description: "WhatsApp 贴纸包，512×512 WebP 格式，支持 1–50 张。",
    allowedExts: [".webp"],
    maxBytes: 100 * 1024,
    requiredSquare: true,
    exactWidth: 512,
    exactHeight: 512,
    maxWidth: 512,
    maxHeight: 512,
    minCount: 1,
    maxCount: 50,
    outputFormat: "webp"
  },
  {
    id: "wechat_stickers",
    title: "微信表情包",
    description: "微信表情包，240×240 PNG 格式，支持 8–24 张。",
    allowedExts: [".png", ".jpg", ".jpeg", ".gif"],
    maxBytes: 500 * 1024,
    requiredSquare: true,
    exactWidth: 240,
    exactHeight: 240,
    maxWidth: 240,
    maxHeight: 240,
    minCount: 8,
    maxCount: 24,
    outputFormat: "png"
  },
  {
    id: "wechat_banner",
    title: "WeChat (Banner 750x400)",
    description: "微信表情横幅图",
    allowedExts: [".png", ".jpg", ".jpeg"],
    maxBytes: 500 * 1024,
    exactWidth: 750,
    exactHeight: 400,
    maxWidth: 750,
    maxHeight: 400,
    outputFormat: "png"
  },
  {
    id: "wechat_reward_guide",
    title: "WeChat (Reward Guide 750x400)",
    description: "微信赞赏引导图",
    allowedExts: [".png", ".jpg", ".jpeg"],
    maxBytes: 500 * 1024,
    exactWidth: 750,
    exactHeight: 400,
    maxWidth: 750,
    maxHeight: 400,
    outputFormat: "png"
  },
  {
    id: "wechat_reward_thanks",
    title: "WeChat (Reward Thanks 750x400)",
    description: "微信赞赏感谢图",
    allowedExts: [".png", ".jpg", ".jpeg"],
    maxBytes: 500 * 1024,
    exactWidth: 750,
    exactHeight: 400,
    maxWidth: 750,
    maxHeight: 400,
    outputFormat: "png"
  },
  {
    id: "wechat_cover",
    title: "WeChat (Cover 240x240 PNG)",
    description: "微信表情封面图",
    allowedExts: [".png"],
    maxBytes: 500 * 1024,
    requiredSquare: true,
    exactWidth: 240,
    exactHeight: 240,
    maxWidth: 240,
    maxHeight: 240,
    outputFormat: "png"
  },
  {
    id: "wechat_icon",
    title: "WeChat (Icon 50x50 PNG)",
    description: "微信聊天面板图标",
    allowedExts: [".png"],
    maxBytes: 100 * 1024,
    requiredSquare: true,
    exactWidth: 50,
    exactHeight: 50,
    maxWidth: 50,
    maxHeight: 50,
    outputFormat: "png"
  }
];
