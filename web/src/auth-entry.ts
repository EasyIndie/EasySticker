import { mountAuth } from "./features/auth";

/**
 * Standalone entry for the auth vertical slice.
 *
 * Built as an IIFE (see web/vite.auth.config.ts) and loaded by public/index.html
 * before the legacy app.js so `window._auth` is available to the un-migrated
 * features. Remove this bridge once app.js has been fully replaced.
 */
mountAuth();
