import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { uploadsDir } from "./paths";

export function findAssetFile(app: FastifyInstance, id: string): { filePath: string; filename: string } | null {
  const dir = uploadsDir(app);
  if (!fs.existsSync(dir)) return null;
  const filename = fs.readdirSync(dir).find((f) => f.startsWith(`${id}.`));
  if (!filename) return null;
  return { filename, filePath: path.join(dir, filename) };
}

