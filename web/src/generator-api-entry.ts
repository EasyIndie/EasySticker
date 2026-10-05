import { startGenerationTask, streamGeneration } from "./api/generate-stream";

declare global {
  interface Window {
    _generatorApi?: {
      startGenerationTask: typeof startGenerationTask;
      streamGeneration: typeof streamGeneration;
    };
  }
}

/**
 * Standalone entry for the generation network/SSE client (P5 generator slice).
 *
 * Exposes the typed start + stream primitives to the legacy app.js, which
 * keeps the UI orchestration and injects its auth-aware fetch + cancel flag.
 */
window._generatorApi = { startGenerationTask, streamGeneration };
