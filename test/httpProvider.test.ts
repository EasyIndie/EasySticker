import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { HttpAiProvider } from "../src/services/ai/providers/http";

describe("http ai provider", () => {
  let server: http.Server;
  let endpoint = "";
  let lastContentType = "";
  let lastBody = Buffer.alloc(0);

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      lastContentType = req.headers["content-type"] ?? "";
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      lastBody = Buffer.concat(chunks);

      const png = await sharp({
        create: { width: 64, height: 64, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } }
      })
        .png()
        .toBuffer();

      res.writeHead(200, { "content-type": "image/png" });
      res.end(png);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    endpoint = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("sends multipart reference image when configured", async () => {
    const provider = new HttpAiProvider(endpoint);
    const result = await provider.generateImage({
      prompt: "multipart",
      width: 64,
      height: 64,
      referenceImageTransport: "multipart",
      referenceImageBase64: Buffer.from("fake-image").toString("base64"),
      referenceImageMime: "image/png",
      providerOptions: { comfy: { qualityPreset: "standard" } }
    });

    expect(result.mime).toContain("image/png");
    const bodyText = lastBody.toString("utf8");
    expect(bodyText).toContain("referenceImage");
  });

  it("passes provider options to json http providers", async () => {
    const provider = new HttpAiProvider(endpoint);
    await provider.generateImage({
      prompt: "json",
      width: 64,
      height: 64,
      providerOptions: {
        comfy: {
          qualityPreset: "quality",
          qualityPresets: {
            quality: { steps: 28, cfg: 6, denoise: 0.5 }
          }
        }
      }
    });

    const payload = JSON.parse(lastBody.toString("utf8"));
    expect(payload.providerOptions.comfy.qualityPreset).toBe("quality");
    expect(payload.providerOptions.comfy.qualityPresets.quality.steps).toBe(28);
  });
});
