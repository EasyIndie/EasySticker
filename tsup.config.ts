import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/workers/imageWorker.ts"],
  outDir: "dist",
  format: ["cjs"],
  sourcemap: true,
  clean: true,
  dts: false,
  splitting: false,
  minify: false,
  target: "node20"
});
