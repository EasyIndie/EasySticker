import { fetch } from "undici";
import { type AiGenerateInput, type AiGenerateOutput, type AiProvider } from "../provider";

export class PicsumAiProvider implements AiProvider {
  constructor(private readonly baseUrl = "https://picsum.photos") {}

  async generateImage(input: AiGenerateInput): Promise<AiGenerateOutput> {
    const w = Math.max(1, Math.floor(input.width || 1024));
    const h = Math.max(1, Math.floor(input.height || 1024));
    const rand = Math.floor(Math.random() * 100000);
    // Use jpg for broad compatibility; pipeline will convert to PNG later
    const url = `${this.baseUrl.replace(/\/+$/, "")}/${w}/${h}.jpg?random=${rand}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      throw Object.assign(new Error(`picsum error: ${res.status}`), { statusCode: 502 });
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return { mime: "image/jpeg", bytes };
  }
}
