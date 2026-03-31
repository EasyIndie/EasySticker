import createHttpError from "http-errors";
import { fetch } from "undici";
import { type AiGenerateInput, type AiGenerateOutput, type AiProvider } from "../provider";

export class HttpAiProvider implements AiProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey?: string
  ) {}

  async generateImage(input: AiGenerateInput): Promise<AiGenerateOutput> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: JSON.stringify(input)
    });

    if (!res.ok) throw createHttpError(502, `ai provider error: ${res.status}`);

    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const json = (await res.json()) as any;
      const b64 = json?.imageBase64;
      const mime = json?.mime ?? "image/png";
      if (typeof b64 !== "string") throw createHttpError(502, "ai provider invalid response");
      return { mime, bytes: Buffer.from(b64, "base64") };
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    return { mime: ct || "application/octet-stream", bytes };
  }
}

