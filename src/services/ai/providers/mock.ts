import sharp from "sharp";
import { type AiGenerateInput, type AiGenerateOutput, type AiProvider } from "../provider";

function escapeXml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function colorFromSeed(seed: number) {
  const r = (seed * 37) % 255;
  const g = (seed * 67) % 255;
  const b = (seed * 97) % 255;
  return { r, g, b, alpha: 1 };
}

export class MockAiProvider implements AiProvider {
  async generateImage(input: AiGenerateInput): Promise<AiGenerateOutput> {
    const seed = hashCode(`${input.prompt}|${input.style ?? ""}|${input.width}x${input.height}`);
    const bg = colorFromSeed(seed);
    const bg2 = colorFromSeed(seed ^ 0x9e3779b9);

    const title = escapeXml((input.style ?? "style").slice(0, 28));
    const prompt = escapeXml(input.prompt.slice(0, 80));

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="rgb(${bg.r},${bg.g},${bg.b})"/>
      <stop offset="100%" stop-color="rgb(${bg2.r},${bg2.g},${bg2.b})"/>
    </linearGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="rgba(0,0,0,0.45)"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="${input.width}" height="${input.height}" fill="url(#g)"/>
  <circle cx="${Math.floor(input.width * 0.35)}" cy="${Math.floor(input.height * 0.42)}" r="${Math.floor(
    Math.min(input.width, input.height) * 0.22
  )}" fill="rgba(255,255,255,0.35)" filter="url(#s)"/>
  <circle cx="${Math.floor(input.width * 0.62)}" cy="${Math.floor(input.height * 0.55)}" r="${Math.floor(
    Math.min(input.width, input.height) * 0.16
  )}" fill="rgba(0,0,0,0.20)"/>
  <text x="50%" y="${Math.floor(input.height * 0.12)}" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="${Math.floor(
    input.height * 0.06
  )}" fill="rgba(255,255,255,0.95)" filter="url(#s)">${title}</text>
  <text x="50%" y="${Math.floor(input.height * 0.88)}" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" font-size="${Math.floor(
    input.height * 0.04
  )}" fill="rgba(255,255,255,0.85)">${prompt}</text>
</svg>`;

    const bytes = await sharp(Buffer.from(svg))
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();

    return { mime: "image/png", bytes };
  }
}

