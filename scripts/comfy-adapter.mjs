import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

const port = Number(process.env.COMFY_ADAPTER_PORT || 8787);
const comfyBaseUrl = (process.env.COMFY_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const workflowPath = process.env.COMFY_WORKFLOW || path.join(process.cwd(), "comfy", "workflow_api.json");
const timeoutMs = Number(process.env.COMFY_TIMEOUT_MS || 300000);
const pollMs = Number(process.env.COMFY_POLL_MS || 1500);
const defaultStickerPromptPrefix =
  "wechat sticker, chibi person, single character, big head, expressive face, exaggerated emotion, cute emoji pose, thick clean outline, simple flat color, centered composition, transparent background, high quality";
const defaultStickerNegativePrompt =
  "realistic photo, complex background, multiple people, extra face, extra hands, bad hands, deformed, blurry, low quality, watermark, logo, qr code, long text, unreadable text, cropped head, out of frame";
const defaultQualityPresets = {
  fast: { steps: 16, cfg: 5.5, denoise: 0.4, samplerName: "dpmpp_2m", scheduler: "karras" },
  standard: { steps: 22, cfg: 5.5, denoise: 0.45, samplerName: "dpmpp_2m", scheduler: "karras" },
  quality: { steps: 28, cfg: 6, denoise: 0.5, samplerName: "dpmpp_2m", scheduler: "karras" },
  expressive: { steps: 26, cfg: 6.5, denoise: 0.6, samplerName: "dpmpp_2m", scheduler: "karras" }
};

function abortError() {
  return Object.assign(new Error("ComfyUI generation canceled"), { statusCode: 499 });
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

async function interruptComfy() {
  try {
    await fetch(`${comfyBaseUrl}/interrupt`, { method: "POST" });
  } catch {
    // Best effort: ComfyUI may be closed or the request may already be done.
  }
}

async function uploadReferenceImage(input, signal) {
  throwIfAborted(signal);
  if (!input.referenceImageBase64) {
    throw Object.assign(new Error("referenceImageBase64 is required for local ComfyUI img2img"), { statusCode: 400 });
  }

  const width = Math.max(256, Math.min(768, Number(input.width) || 512));
  const height = Math.max(256, Math.min(768, Number(input.height) || 512));
  const imageBytes = await sharp(Buffer.from(input.referenceImageBase64, "base64"))
    .resize(width, height, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();

  const filename = `easysticker_${Date.now()}_${randomUUID()}.png`;
  const form = new FormData();
  form.set("image", new Blob([imageBytes], { type: "image/png" }), filename);
  form.set("type", "input");
  form.set("overwrite", "true");

  const res = await fetch(`${comfyBaseUrl}/upload/image`, { method: "POST", body: form, signal });
  if (!res.ok) throw new Error(`ComfyUI upload failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.name;
}

async function queuePrompt(workflow, signal) {
  throwIfAborted(signal);
  const res = await fetch(`${comfyBaseUrl}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: "easysticker-comfy-adapter",
      prompt: workflow
    }),
    signal
  });
  if (!res.ok) throw new Error(`ComfyUI prompt failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.prompt_id) throw new Error("ComfyUI prompt response missing prompt_id");
  return json.prompt_id;
}

async function waitForOutput(promptId, signal) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    throwIfAborted(signal);
    const res = await fetch(`${comfyBaseUrl}/history/${promptId}`, { signal });
    if (!res.ok) throw new Error(`ComfyUI history failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    const item = json[promptId];
    if (item) {
      for (const output of Object.values(item.outputs || {})) {
        const image = output?.images?.[0];
        if (image?.filename) return image;
      }
      throw new Error("ComfyUI finished without image output");
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, pollMs);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(abortError());
        },
        { once: true }
      );
    });
  }
  throw new Error(`ComfyUI generation timed out after ${timeoutMs}ms`);
}

async function downloadOutput(image, signal) {
  throwIfAborted(signal);
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder || "",
    type: image.type || "output"
  });
  const res = await fetch(`${comfyBaseUrl}/view?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`ComfyUI view failed: ${res.status} ${await res.text()}`);
  return {
    mime: res.headers.get("content-type") || "image/png",
    bytes: Buffer.from(await res.arrayBuffer())
  };
}

function configureWorkflow(workflow, input, imageName) {
  const next = structuredClone(workflow);
  const options = resolveComfyOptions(input);
  const positivePrompt = [options.promptPrefix, input.prompt, input.style ? `Style: ${input.style}` : "", options.promptSuffix]
    .filter(Boolean)
    .join("\n");
  const negativeBase = options.negativePrompt || [input.negativePrompt, defaultStickerNegativePrompt].filter(Boolean).join(", ");
  const negativePrompt = [negativeBase, options.negativePromptAppend]
    .filter(Boolean)
    .join(", ");

  if (options.checkpoint && next["1"]?.inputs?.ckpt_name !== undefined) {
    next["1"].inputs.ckpt_name = options.checkpoint;
  }
  next["2"].inputs.image = imageName;
  next["3"].inputs.text = positivePrompt;
  next["4"].inputs.text = negativePrompt;
  next["6"].inputs.seed = Math.floor(Math.random() * 2 ** 32);
  next["6"].inputs.steps = numberOption(process.env.COMFY_STEPS, options.steps, next["6"].inputs.steps, 22);
  next["6"].inputs.cfg = numberOption(process.env.COMFY_CFG, options.cfg, next["6"].inputs.cfg, 5.5);
  next["6"].inputs.denoise = numberOption(process.env.COMFY_DENOISE, options.denoise, next["6"].inputs.denoise, 0.45);
  next["6"].inputs.sampler_name = stringOption(process.env.COMFY_SAMPLER, options.samplerName, next["6"].inputs.sampler_name, "dpmpp_2m");
  next["6"].inputs.scheduler = stringOption(process.env.COMFY_SCHEDULER, options.scheduler, next["6"].inputs.scheduler, "karras");
  next["8"].inputs.filename_prefix = `easysticker_${Date.now()}`;
  return next;
}

function resolveComfyOptions(input) {
  const comfy = input.providerOptions?.comfy && typeof input.providerOptions.comfy === "object" ? input.providerOptions.comfy : {};
  const presetName = process.env.COMFY_QUALITY_PRESET || comfy.qualityPreset || "standard";
  const presets = comfy.qualityPresets && typeof comfy.qualityPresets === "object" ? comfy.qualityPresets : {};
  const builtInPreset = defaultQualityPresets[presetName] || defaultQualityPresets.standard;
  const customPreset = presets[presetName] && typeof presets[presetName] === "object" ? presets[presetName] : {};
  return {
    promptPrefix: defaultStickerPromptPrefix,
    ...comfy,
    ...builtInPreset,
    ...customPreset,
    qualityPreset: presetName
  };
}

function numberOption(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function stringOption(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

async function generate(input, signal) {
  const workflow = JSON.parse(await fs.readFile(workflowPath, "utf8"));
  const imageName = await uploadReferenceImage(input, signal);
  const configured = configureWorkflow(workflow, input, imageName);
  const promptId = await queuePrompt(configured, signal);
  const output = await waitForOutput(promptId, signal);
  return downloadOutput(output, signal);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { ok: true, comfyBaseUrl, workflowPath });
  }
  if (req.method === "POST" && req.url === "/cancel") {
    await interruptComfy();
    return sendJson(res, 200, { ok: true });
  }
  if (req.method !== "POST" || req.url !== "/generate") {
    return sendJson(res, 404, { error: "NotFound" });
  }

  const abortController = new AbortController();
  let finished = false;
  const cancelGeneration = () => {
    if (finished || abortController.signal.aborted) return;
    abortController.abort();
    void interruptComfy();
  };
  req.on("aborted", cancelGeneration);
  res.on("close", () => {
    if (!finished) cancelGeneration();
  });

  try {
    const input = await readJson(req);
    const output = await generate(input, abortController.signal);
    if (abortController.signal.aborted || res.destroyed) return;
    finished = true;
    res.writeHead(200, { "content-type": output.mime });
    res.end(output.bytes);
  } catch (error) {
    if (abortController.signal.aborted || res.destroyed) return;
    const statusCode = Number(error?.statusCode) || 502;
    console.error("[comfy-adapter]", error);
    sendJson(res, statusCode, {
      error: "ComfyAdapterError",
      message: error instanceof Error ? error.message : "ComfyUI generation failed"
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[comfy-adapter] listening on http://127.0.0.1:${port}/generate`);
  console.log(`[comfy-adapter] ComfyUI: ${comfyBaseUrl}`);
  console.log(`[comfy-adapter] Workflow: ${workflowPath}`);
});
