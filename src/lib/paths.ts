import path from "node:path";

export function uploadsDir(dataDir: string) {
  return path.join(dataDir, "uploads");
}
