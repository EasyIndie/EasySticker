import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { OpenAiImageProvider } from "../src/services/ai/providers/openai";

describe("openai image provider", () => {
  let server: http.Server;
  let baseUrl = "";
  let nextStatus = 200;
  let nextBody: unknown | null = null;
  const requests: Array<{ url: string; contentType: string; body: Buffer }> = [];

  beforeAll(async () => {
    const png = await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: 120, g: 30, b: 200, alpha: 1 } }
    })
      .png()
      .toBuffer();
    const imageBase64 = png.toString("base64");

    server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      requests.push({
        url: req.url || "",
        contentType: req.headers["content-type"] || "",
        body
      });

      res.writeHead(nextStatus, { "content-type": "application/json" });
      res.end(JSON.stringify(nextBody ?? { data: [{ b64_json: imageBase64 }] }));
      nextStatus = 200;
      nextBody = null;
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("calls image generations when no reference image is provided", async () => {
    requests.length = 0;
    const provider = new OpenAiImageProvider(baseUrl, "test-key", "gpt-image-1.5");

    const out = await provider.generateImage({
      prompt: "make a sticker",
      width: 1024,
      height: 1024
    });

    expect(out.mime).toBe("image/png");
    expect(out.bytes.length).toBeGreaterThan(0);
    expect(requests[0].url).toBe("/v1/images/generations");
    expect(requests[0].contentType).toContain("application/json");
    const body = JSON.parse(requests[0].body.toString("utf8"));
    expect(body.model).toBe("gpt-image-1.5");
    expect(body.prompt).toBe("make a sticker");
    expect(body.size).toBe("1024x1024");
    expect(body.background).toBe("transparent");
  });

  it("calls image edits with multipart form data when a base64 reference image is provided", async () => {
    requests.length = 0;
    const provider = new OpenAiImageProvider(baseUrl, "test-key", "gpt-image-1.5", {
      inputFidelity: "high"
    });

    const out = await provider.generateImage({
      prompt: "make a sticker",
      negativePrompt: "watermark",
      width: 1024,
      height: 1024,
      referenceImageBase64: Buffer.from("fake-image").toString("base64"),
      referenceImageMime: "image/png"
    });

    expect(out.mime).toBe("image/png");
    expect(requests[0].url).toBe("/v1/images/edits");
    expect(requests[0].contentType).toContain("multipart/form-data");
    const bodyText = requests[0].body.toString("utf8");
    expect(bodyText).toContain("reference.png");
    expect(bodyText).toContain("input_fidelity");
    expect(bodyText).toContain("Avoid: watermark");
  });

  it("generic variant sends OpenAI-compatible generations payload", async () => {
    requests.length = 0;
    const provider = new OpenAiImageProvider(baseUrl, "test-key", "doubao-seedream-5-0-260128", {
      variant: "generic",
      size: "2K"
    });

    const out = await provider.generateImage({
      prompt: "make a sticker",
      width: 1024,
      height: 1024
    });

    expect(out.mime).toBe("image/png");
    expect(requests[0].url).toBe("/v1/images/generations");
    const body = JSON.parse(requests[0].body.toString("utf8"));
    expect(body.model).toBe("doubao-seedream-5-0-260128");
    expect(body.size).toBe("2K");
    expect(body.response_format).toBe("b64_json");
    expect(body.watermark).toBe(false);
    expect(body.background).toBeUndefined();
  });

  it("generic variant passes reference image via image field instead of edits", async () => {
    requests.length = 0;
    const provider = new OpenAiImageProvider(baseUrl, "test-key", "doubao-seedream-5-0-260128", {
      variant: "generic"
    });

    const out = await provider.generateImage({
      prompt: "make a sticker",
      width: 1024,
      height: 1024,
      referenceImageBase64: Buffer.from("fake-image").toString("base64"),
      referenceImageMime: "image/png"
    });

    expect(out.mime).toBe("image/png");
    expect(requests[0].url).toBe("/v1/images/generations");
    expect(requests[0].contentType).toContain("application/json");
    const body = JSON.parse(requests[0].body.toString("utf8"));
    expect(body.image).toBe(`data:image/png;base64,${Buffer.from("fake-image").toString("base64")}`);
  });

  it("generic variant 支持多张参考图：image 传数组，主图在前", async () => {
    requests.length = 0;
    const provider = new OpenAiImageProvider(baseUrl, "test-key", "doubao-seedream-5-0-260128", {
      variant: "generic"
    });

    await provider.generateImage({
      prompt: "make a sticker",
      width: 1024,
      height: 1024,
      referenceImageBase64: Buffer.from("source-image").toString("base64"),
      referenceImageMime: "image/png",
      additionalReferenceImages: [
        { base64: Buffer.from("extra-image").toString("base64"), mime: "image/jpeg" }
      ]
    });

    const body = JSON.parse(requests[0].body.toString("utf8"));
    expect(Array.isArray(body.image)).toBe(true);
    expect(body.image).toEqual([
      `data:image/png;base64,${Buffer.from("source-image").toString("base64")}`,
      `data:image/jpeg;base64,${Buffer.from("extra-image").toString("base64")}`
    ]);
  });

  it("多张附加参考图可以给 URL（url 传输模式）", async () => {
    requests.length = 0;
    const provider = new OpenAiImageProvider(baseUrl, "test-key", "doubao-seedream-5-0-260128", {
      variant: "generic"
    });

    await provider.generateImage({
      prompt: "make a sticker",
      width: 1024,
      height: 1024,
      referenceImageUrl: "https://cdn.example.com/source.png",
      additionalReferenceImages: [{ url: "https://cdn.example.com/extra.png" }]
    });

    const body = JSON.parse(requests[0].body.toString("utf8"));
    expect(body.image).toEqual([
      "https://cdn.example.com/source.png",
      "https://cdn.example.com/extra.png"
    ]);
  });

  it("gpt-image 多图走 multipart，附加图用 image[] 字段", async () => {
    requests.length = 0;
    const provider = new OpenAiImageProvider(baseUrl, "test-key", "gpt-image-1.5");

    await provider.generateImage({
      prompt: "make a sticker",
      width: 1024,
      height: 1024,
      referenceImageBase64: Buffer.from("source-image").toString("base64"),
      referenceImageMime: "image/png",
      additionalReferenceImages: [{ base64: Buffer.from("extra-image").toString("base64"), mime: "image/png" }]
    });

    expect(requests[0].url).toBe("/v1/images/edits");
    const bodyText = requests[0].body.toString("utf8");
    expect(bodyText).toContain("reference.png");
    expect(bodyText).toContain("image[]");
    expect(bodyText).toContain("reference-2.png");
  });

  it("preserves non-retryable OpenAI 4xx errors", async () => {
    requests.length = 0;
    nextStatus = 400;
    nextBody = { error: { message: "Billing hard limit has been reached." } };
    const provider = new OpenAiImageProvider(baseUrl, "test-key", "gpt-image-1.5");

    await expect(
      provider.generateImage({
        prompt: "make a sticker",
        width: 1024,
        height: 1024
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Billing hard limit has been reached."
    });
  });
});
