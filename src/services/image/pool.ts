import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import Piscina from "piscina";

let pool: Piscina | null = null;

export function getImagePool() {
  if (pool) return pool;

  const maxThreads = Math.max(1, Math.min(4, os.cpus().length));
  const candidates = [
    path.join(process.cwd(), "dist", "workers", "imageWorker.js"),
    path.join(__dirname, "workers", "imageWorker.js")
  ];
  const workerPath = candidates.find((p) => fs.existsSync(p));
  if (!workerPath) {
    throw new Error("image worker not found; run `npm run build` before using image processing");
  }

  pool = new Piscina({
    filename: workerPath,
    minThreads: 1,
    maxThreads
  });

  return pool;
}
