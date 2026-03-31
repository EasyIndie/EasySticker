export type PlatformPreset = {
  id: string;
  title: string;
  allowedExts: string[];
  maxBytes: number;
  requiredSquare?: boolean;
  exactWidth?: number;
  exactHeight?: number;
  maxWidth: number;
  maxHeight: number;
  minCount?: number;
  maxCount?: number;
};

export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    id: "telegram_static",
    title: "Telegram (Static PNG)",
    allowedExts: [".png"],
    maxBytes: 512 * 1024,
    requiredSquare: true,
    maxWidth: 512,
    maxHeight: 512
  },
  {
    id: "whatsapp_webp",
    title: "WhatsApp (Sticker WebP)",
    allowedExts: [".webp"],
    maxBytes: 100 * 1024,
    requiredSquare: true,
    exactWidth: 512,
    exactHeight: 512,
    maxWidth: 512,
    maxHeight: 512
  },
  {
    id: "wechat_stickers",
    title: "WeChat (Stickers 240x240)",
    allowedExts: [".png", ".jpg", ".jpeg", ".gif"],
    maxBytes: 500 * 1024,
    requiredSquare: true,
    exactWidth: 240,
    exactHeight: 240,
    maxWidth: 240,
    maxHeight: 240,
    minCount: 8,
    maxCount: 24
  },
  {
    id: "wechat_banner",
    title: "WeChat (Banner 750x400)",
    allowedExts: [".png", ".jpg", ".jpeg"],
    maxBytes: 500 * 1024,
    exactWidth: 750,
    exactHeight: 400,
    maxWidth: 750,
    maxHeight: 400
  },
  {
    id: "wechat_cover",
    title: "WeChat (Cover 240x240 PNG)",
    allowedExts: [".png"],
    maxBytes: 500 * 1024,
    requiredSquare: true,
    exactWidth: 240,
    exactHeight: 240,
    maxWidth: 240,
    maxHeight: 240
  },
  {
    id: "wechat_icon",
    title: "WeChat (Icon 50x50 PNG)",
    allowedExts: [".png"],
    maxBytes: 100 * 1024,
    requiredSquare: true,
    exactWidth: 50,
    exactHeight: 50,
    maxWidth: 50,
    maxHeight: 50
  }
];
