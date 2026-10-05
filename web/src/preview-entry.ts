import { mountPreview } from "./features/preview";

/**
 * Standalone entry for the preview vertical slice (P5).
 *
 * Exposes `window._preview` to the legacy app.js, which injects its
 * cross-feature dependencies via `window._preview.configure(...)` at startup.
 */
mountPreview();
