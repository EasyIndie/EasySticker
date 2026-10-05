import { describe, expect, it, vi, afterEach } from "vitest";
import { buildApp } from "../src/app";
import * as promptConfigModule from "../src/services/generate/promptConfig";

describe("/api/config route validation", () => {
  const app = buildApp({ host: "127.0.0.1", port: 0, dataDir: "data", logLevel: "silent" });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters out openai providers with empty or undefined apiKeys", async () => {
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ai: {
        defaultProvider: "mock",
        providers: {
          "mock": {
            type: "mock"
          },
          "openai-empty": {
            type: "openai",
            apiKey: ""
          },
          "openai-undef": {
            type: "openai"
            // apiKey undefined
          },
          "openai-valid": {
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

    const res = await app.inject({
      method: "GET",
      url: "/api/config"
    });

    const data = res.json();
    const providers = data.wechat.availableProviders.map((p: any) => p.id);

    // mock is added by default in non-prod
    expect(providers).toContain("mock");
    expect(providers).toContain("openai-valid");

    expect(providers).not.toContain("openai-empty");
    expect(providers).not.toContain("openai-undef");
  });

  it("includes providers whose apiKey comes from an environment variable", async () => {
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ai: {
        defaultProvider: "mock",
        providers: {
          "mock": { type: "mock" },
          "openai-env": { type: "openai", apiKey: "" }
        }
      },
      global: { prompt: "", negativePrompt: "", styles: [] },
      emotions: [],
      templates: { sticker: "", extra: "" },
      extraPrompts: { cover: "", icon: "", banner: "", rewardGuide: "", rewardThanks: "" }
    } as any);

    const envName = "AI_OPENAI_ENV_API_KEY";
    process.env[envName] = "env-key";
    try {
      const res = await app.inject({ method: "GET", url: "/api/config" });
      const data = res.json();
      const providers = data.wechat.availableProviders.map((p: any) => p.id);
      expect(providers).toContain("openai-env");
    } finally {
      delete process.env[envName];
    }
  });

  it("adds a fallback mock provider when production config yields empty list", async () => {
    // 模拟生产环境
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ai: {
        defaultProvider: "mock",
        providers: {
          "openai-invalid": {
            type: "openai",
            apiKey: ""
          },
          "mock-should-be-filtered": {
            type: "mock"
          }
        }
      },
      global: { prompt: "", negativePrompt: "", styles: [] },
      emotions: [],
      templates: { sticker: "", extra: "" },
      extraPrompts: { cover: "", icon: "", banner: "", rewardGuide: "", rewardThanks: "" }
    } as any);

    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/config"
      });

      const data = res.json();
      const providers = data.wechat.availableProviders;

      expect(providers.length).toBe(1);
      expect(providers[0].id).toBe("mock");
      expect(providers[0].name).toContain("生产环境未配置真实模型");
      expect(data.wechat.defaultProvider).toBe("mock");
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
