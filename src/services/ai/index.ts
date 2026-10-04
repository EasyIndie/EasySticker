import createHttpError from "http-errors";
import { loadPromptConfig } from "../generate/promptConfig";
import { getProviderFactory } from "./registry";

// Side-effect imports: each provider file self-registers its factory into the
// registry on module load. Keep this list in sync with the providers/ directory.
import "./providers/mock";
import "./providers/picsum";
import "./providers/http";
import "./providers/doubao";
import "./providers/openai";
import "./providers/hf";

/**
 * Resolve a provider instance for the given provider id (or the configured
 * default when omitted). Configuration lookup and validation now live inside
 * each provider's factory, keeping this entry point decoupled from provider
 * implementation details.
 */
export function getAiProvider(overrideKind?: string) {
  const config = loadPromptConfig();
  const providerId = overrideKind ?? config.ai?.defaultProvider ?? "mock";
  const providerConfig = config.ai?.providers?.[providerId];

  if (!providerConfig) {
    // "mock" is special-cased so it works without any config entry.
    if (providerId === "mock") {
      return getProviderFactory("mock")({}, providerId);
    }
    throw createHttpError(500, `Provider config not found for ID: ${providerId}`);
  }

  const factory = getProviderFactory(providerConfig.type);
  return factory(providerConfig, providerId);
}
