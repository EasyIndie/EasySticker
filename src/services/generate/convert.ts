import sharp from "sharp";

/** Convert a generated image into the platform's target format and size. */
export async function convertToPlatformFormat(
  input: Buffer,
  presetId: string,
  targetW: number,
  targetH: number
): Promise<Buffer> {
  const pipeline = sharp(input).ensureAlpha().resize(targetW, targetH, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  });

  if (presetId === "whatsapp_webp") {
    // WhatsApp 要求单张 sticker ≤ 100KB。从高到低尝试 quality 直到文件体积达标
    const maxBytes = 100 * 1024;
    for (let quality = 90; quality >= 30; quality -= 5) {
      const buf = await pipeline.clone().webp({ quality }).toBuffer();
      if (buf.length <= maxBytes) return buf;
    }
    // 保底：最低 quality
    return pipeline.webp({ quality: 30 }).toBuffer();
  }

  const png = await pipeline.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const maxBytes = presetId === "telegram_static" ? 512 * 1024 : Infinity;
  if (png.length <= maxBytes) return png;
  // 超大文件改用 palette 量化压缩（适用于 PNG）
  return pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
}

/** Convert into a WeChat detail-page banner (750×400 PNG). */
export async function toBannerPng(input: Buffer) {
  return sharp(input)
    .ensureAlpha()
    .resize(750, 400, { fit: "cover" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
