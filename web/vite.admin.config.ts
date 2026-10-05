import { defineConfig } from "vite";
import { resolve } from "node:path";

/** Builds the admin panel as a classic IIFE bundle (replaces public/admin.js). */
export default defineConfig({
  root: "web",
  build: {
    outDir: resolve(process.cwd(), "public/js"),
    emptyOutDir: false,
    lib: {
      entry: resolve(process.cwd(), "web/src/admin-entry.ts"),
      formats: ["iife"],
      name: "EasyStickerAdmin",
      fileName: () => "admin.js"
    }
  }
});
