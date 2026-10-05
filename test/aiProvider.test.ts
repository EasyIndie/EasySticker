import { describe, expect, it, vi, afterEach } from "vitest";
import { getAiProvider } from "../src/services/ai/index";
import { providerApiKeyEnvName, resolveProviderApiKey } from "../src/services/ai/apiKey";
import * as promptConfigModule from "../src/services/generate/promptConfig";

describe("getAiProvider validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws error when openai apiKey is empty string", () => {
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ai: {
        defaultProvider: "test-openai",
        providers: {
          "test-openai": {
            type: "openai",
            apiKey: ""
          }
        }
      },
      global: { prompt: "", negativePrompt: "", styles: [] },
      emotions: [],
      templates: { sticker: "", extra: "" },
      extraPrompts: { cover: "", icon: "", banner: "", rewardGuide: "", rewardThanks: "" }
    } as any);

    expect(() => getAiProvider()).toThrowError("apiKey is required");
  });

  it("throws error when openai apiKey is undefined", () => {
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ai: {
        defaultProvider: "test-openai",
        providers: {
          "test-openai": {
            type: "openai",
            apiKey: undefined
          }
        }
      },
      global: { prompt: "", negativePrompt: "", styles: [] },
      emotions: [],
      templates: { sticker: "", extra: "" },
      extraPrompts: { cover: "", icon: "", banner: "", rewardGuide: "", rewardThanks: "" }
    } as any);

    expect(() => getAiProvider()).toThrowError("apiKey is required");
  });

  it("returns openai provider successfully when apiKey is valid", () => {
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ai: {
        defaultProvider: "test-openai",
        providers: {
          "test-openai": {
            type: "openai",
            apiKey: "valid-key"
          }
        }
      },
      global: { prompt: "", negativePrompt: "", styles: [] },
      emotions: [],
      templates: { sticker: "", extra: "" },
      extraPrompts: { cover: "", icon: "", banner: "", rewardGuide: "", rewardThanks: "" }
    } as any);

    const provider = getAiProvider();
    expect(provider).toBeDefined();
  });

  it("returns mock provider when defaultProvider is mock without config entry", () => {
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ai: {
        defaultProvider: "mock",
        providers: {}
      },
      global: { prompt: "", negativePrompt: "", styles: [] },
      emotions: [],
      templates: { sticker: "", extra: "" },
      extraPrompts: { cover: "", icon: "", banner: "", rewardGuide: "", rewardThanks: "" }
    } as any);

    const provider = getAiProvider();
    expect(provider).toBeDefined();
  });

  it("resolves apiKey from environment variable when config apiKey is empty", () => {
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ai: {
        defaultProvider: "test-openai",
        providers: {
          "test-openai": { type: "openai", apiKey: "" }
        }
      },
      global: { prompt: "", negativePrompt: "", styles: [] },
      emotions: [],
      templates: { sticker: "", extra: "" },
      extraPrompts: { cover: "", icon: "", banner: "", rewardGuide: "", rewardThanks: "" }
    } as any);

    const envName = providerApiKeyEnvName("test-openai");
    expect(envName).toBe("AI_TEST_OPENAI_API_KEY");
    process.env[envName] = "env-key";
    try {
      const provider = getAiProvider();
      expect(provider).toBeDefined();
    } finally {
      delete process.env[envName];
    }
  });

  it("resolveProviderApiKey prefers env over config, then falls back to config", () => {
    const envName = providerApiKeyEnvName("test-openai");
    delete process.env[envName];
    expect(resolveProviderApiKey("test-openai", { apiKey: "config-key" })).toBe("config-key");
    expect(resolveProviderApiKey("test-openai", { apiKey: "" })).toBeUndefined();
    expect(resolveProviderApiKey("test-openai", undefined)).toBeUndefined();

    process.env[envName] = "env-key";
    try {
      expect(resolveProviderApiKey("test-openai", { apiKey: "config-key" })).toBe("env-key");
    } finally {
      delete process.env[envName];
    }
  });
});
