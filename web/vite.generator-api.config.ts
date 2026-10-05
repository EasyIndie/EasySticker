import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Builds the generation network/SSE client as a classic, non-module bundle.
 *
 * Same pattern as web/vite.auth.config.ts and web/vite.preview.config.ts.
 */
export default defineConfig({
  root: "web",
  build: {
    outDir: resolve(process.cwd(), "public/js"),
    emptyOutDir: false,
    lib: {
      entry: resolve(process.cwd(), "web/src/generator-api-entry.ts"),
      formats: ["iife"],
      name: "EasyStickerGeneratorApi",
      fileName: () => "generator-api.js"
    }
  }
});
