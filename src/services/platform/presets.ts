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
  }
];
