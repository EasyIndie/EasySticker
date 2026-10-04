import createHttpError from "http-errors";
import type { AiProvider } from "./provider";

/**
 * A provider factory receives its prompt-config entry and returns a ready-to-use
 * AiProvider instance. Factories are responsible for validating their own config
 * (missing apiKey, invalid endpoint, etc.) and throwing a descriptive error.
 */
export type ProviderFactory = (config: Record<string, any>, providerId: string) => AiProvider;

const registry = new Map<string, ProviderFactory>();

/**
 * Register a provider implementation under its `type` string (e.g. "doubao", "http").
 * Called at module load time from each provider file, so adding a new provider
 * only requires a new file — no central switch needs to change.
 */
export function registerProvider(type: string, factory: ProviderFactory): void {
  if (registry.has(type)) {
    throw new Error(`AI provider type already registered: ${type}`);
  }
  registry.set(type, factory);
}

/** Look up a factory by provider type. Throws when the type is unknown. */
export function getProviderFactory(type: string): ProviderFactory {
  const factory = registry.get(type);
  if (!factory) {
    throw createHttpError(500, `unknown AI provider type: ${type}`);
  }
  return factory;
}
