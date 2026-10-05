import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Builds the preview/export-confirm feature as a classic, non-module bundle.
 *
 * Same pattern as web/vite.auth.config.ts: outputs into public/js/ so
 * public/index.html can load it before the legacy app.js.
 */
export default defineConfig({
  root: "web",
  build: {
    outDir: resolve(process.cwd(), "public/js"),
    emptyOutDir: false,
    lib: {
      entry: resolve(process.cwd(), "web/src/preview-entry.ts"),
      formats: ["iife"],
      name: "EasyStickerPreview",
      fileName: () => "preview.js"
    }
  }
});
