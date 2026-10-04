import { defineConfig } from "vite";
import path from "node:path";

// Frontend toolchain for the incremental migration of public/app.js to
// TypeScript modules. The existing public/ app is untouched; this builds into
// dist-web/ until the migration is complete.
export default defineConfig({
  root: "web",
  build: {
    outDir: path.resolve(process.cwd(), "dist-web"),
    emptyOutDir: true
  }
});
