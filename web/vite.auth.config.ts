import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Builds the auth feature as a classic, non-module bundle.
 *
 * P5 migrates public/app.js feature-by-feature. This config produces the first
 * vertical slice (auth) into public/js/auth.js so public/index.html can load it
 * before the legacy app.js. It exposes the same `window._auth` interface that
 * the un-migrated app.js still consumes.
 */
export default defineConfig({
  root: "web",
  build: {
    outDir: resolve(process.cwd(), "public/js"),
    emptyOutDir: false,
    lib: {
      entry: resolve(process.cwd(), "web/src/auth-entry.ts"),
      formats: ["iife"],
      name: "EasyStickerAuth",
      fileName: () => "auth.js"
    }
  }
});
