import { defineConfig } from "vite";
import { resolve } from "node:path";

/** Builds the UI helpers as a classic IIFE bundle loaded before app.js. */
export default defineConfig({
  root: "web",
  build: {
    outDir: resolve(process.cwd(), "public/js"),
    emptyOutDir: false,
    lib: {
      entry: resolve(process.cwd(), "web/src/ui-entry.ts"),
      formats: ["iife"],
      name: "EasyStickerUi",
      fileName: () => "ui.js"
    }
  }
});
