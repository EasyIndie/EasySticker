import { describe, expect, it, vi, afterEach } from "vitest";
import { getAiProvider } from "../src/services/ai/index";
import * as promptConfigModule from "../src/services/wechat/promptConfig";

describe("getAiProvider validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws error when doubao apiKey is empty string", () => {
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ai: {
        defaultProvider: "test-doubao",
        providers: {
          "test-doubao": {
            type: "doubao",
            apiKey: ""
          }
        }
      },
      global: { prompt: "", negativePrompt: "", styles: [] },
      emotions: [],
      templates: { sticker: "", extra: "" },
      extraPrompts: { cover: "", icon: "", banner: "", rewardGuide: "", rewardThanks: "" }
    } as any);

    expect(() => getAiProvider()).toThrowError("apiKey is required and cannot be empty");
  });

  it("throws error when doubao apiKey is undefined", () => {
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ai: {
        defaultProvider: "test-doubao",
        providers: {
          "test-doubao": {
            type: "doubao",
            apiKey: undefined
          }
        }
      },
      global: { prompt: "", negativePrompt: "", styles: [] },
      emotions: [],
      templates: { sticker: "", extra: "" },
      extraPrompts: { cover: "", icon: "", banner: "", rewardGuide: "", rewardThanks: "" }
    } as any);

    expect(() => getAiProvider()).toThrowError("apiKey is required and cannot be empty");
  });

  it("throws error when hf apiKey is empty string", () => {
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ai: {
        defaultProvider: "test-hf",
        providers: {
          "test-hf": {
            type: "hf",
            endpoint: "https://router.huggingface.co/hf-inference/models/test/test",
            apiKey: ""
          }
        }
      },
      global: { prompt: "", negativePrompt: "", styles: [] },
      emotions: [],
      templates: { sticker: "", extra: "" },
      extraPrompts: { cover: "", icon: "", banner: "", rewardGuide: "", rewardThanks: "" }
    } as any);

    expect(() => getAiProvider()).toThrowError("apiKey is required and cannot be empty");
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

    expect(() => getAiProvider()).toThrowError("apiKey is required and cannot be empty");
  });

  it("throws error when hf apiKey is undefined", () => {
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ai: {
        defaultProvider: "test-hf",
        providers: {
          "test-hf": {
            type: "hf",
            endpoint: "https://router.huggingface.co/hf-inference/models/test/test",
            apiKey: undefined
          }
        }
      },
      global: { prompt: "", negativePrompt: "", styles: [] },
      emotions: [],
      templates: { sticker: "", extra: "" },
      extraPrompts: { cover: "", icon: "", banner: "", rewardGuide: "", rewardThanks: "" }
    } as any);

    expect(() => getAiProvider()).toThrowError("apiKey is required and cannot be empty");
  });

  it("returns doubao provider successfully when apiKey is valid", () => {
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ai: {
        defaultProvider: "test-doubao",
        providers: {
          "test-doubao": {
            type: "doubao",
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
});
