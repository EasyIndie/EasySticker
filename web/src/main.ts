import { suggestPrompt, startGeneration, cancelGeneration } from "./api/generate";

/**
 * Frontend migration entry point (P5).
 *
 * The legacy public/app.js is being replaced feature-by-feature with typed
 * modules that consume the shared contracts from src/shared/contracts.ts.
 * This bundle is currently additive; wire it into public/ once features migrate.
 */
export const api = { suggestPrompt, startGeneration, cancelGeneration };
