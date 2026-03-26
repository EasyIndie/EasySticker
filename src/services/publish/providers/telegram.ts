import fs from "node:fs";
import createHttpError from "http-errors";
import { fetch, FormData } from "undici";
import type { FastifyInstance } from "fastify";
import { findAssetFile } from "../../../lib/assets";
import { validateAsset } from "../../platform/validate";
import type { TelegramPublishRequest } from "../types";

type TgOk<T> = { ok: true; result: T };
type TgErr = { ok: false; error_code: number; description: string };

async function tgCall<T>(token: string, method: string, form: FormData): Promise<TgOk<T>> {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, { method: "POST", body: form });
  const json = (await res.json()) as TgOk<T> | TgErr;
  if (!json.ok) {
    throw createHttpError(502, `telegram api error: ${json.error_code} ${json.description}`);
  }
  return json;
}

export async function publishToTelegram(app: FastifyInstance, req: TelegramPublishRequest) {
  if (!req.assetIds.length) throw createHttpError(400, "assetIds is required");

  const emojis = (req.emojis ?? "😀").slice(0, 50);

  const firstId = req.assetIds[0]!;
  const firstAsset = findAssetFile(app, firstId);
  if (!firstAsset) throw createHttpError(404, `asset not found: ${firstId}`);

  const check = await validateAsset(app, "telegram_static", firstId);
  if (!check.ok) throw createHttpError(400, `asset not compatible: ${JSON.stringify(check.issues)}`);

  const firstBuf = fs.readFileSync(firstAsset.filePath);
  const createForm = new FormData();
  createForm.set("user_id", String(req.userId));
  createForm.set("name", req.setName);
  createForm.set("title", req.setTitle);
  createForm.set("emojis", emojis);
  createForm.set("png_sticker", new Blob([firstBuf], { type: "image/png" }), "sticker.png");

  const created = await tgCall(req.token, "createNewStickerSet", createForm);
  const results: Array<{ assetId: string; method: string; ok: boolean }> = [{ assetId: firstId, method: "createNewStickerSet", ok: true }];

  for (let i = 1; i < req.assetIds.length; i++) {
    const id = req.assetIds[i]!;
    const asset = findAssetFile(app, id);
    if (!asset) throw createHttpError(404, `asset not found: ${id}`);

    const v = await validateAsset(app, "telegram_static", id);
    if (!v.ok) throw createHttpError(400, `asset not compatible: ${id}`);

    const buf = fs.readFileSync(asset.filePath);
    const form = new FormData();
    form.set("user_id", String(req.userId));
    form.set("name", req.setName);
    form.set("emojis", emojis);
    form.set("png_sticker", new Blob([buf], { type: "image/png" }), `sticker-${i + 1}.png`);

    await tgCall(req.token, "addStickerToSet", form);
    results.push({ assetId: id, method: "addStickerToSet", ok: true });
  }

  return { created: created.result, items: results };
}
