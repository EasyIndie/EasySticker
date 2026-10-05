import { defineConfig } from "vite";
import { resolve } from "node:path";

/** Builds the migrated controller as a classic IIFE bundle (replaces public/app.js). */
export default defineConfig({
  root: "web",
  build: {
    outDir: resolve(process.cwd(), "public/js"),
    emptyOutDir: false,
    lib: {
      entry: resolve(process.cwd(), "web/src/app-entry.ts"),
      formats: ["iife"],
      name: "EasyStickerApp",
      fileName: () => "app.js"
    }
  }
});
