import { suggestPrompt, startGeneration, cancelGeneration } from "./api/generate";
import { login, register, getQuota } from "./api/auth";

/**
 * Frontend migration entry point (P5).
 *
 * The legacy public/app.js is being replaced feature-by-feature with typed
 * modules that consume the shared contracts from src/shared/contracts.ts.
 * This SPA entry is currently additive; the first vertical slice (auth) is
 * wired into public/ via the standalone auth-entry.ts bundle.
 */
export const api = {
  suggestPrompt,
  startGeneration,
  cancelGeneration,
  login,
  register,
  getQuota
};
