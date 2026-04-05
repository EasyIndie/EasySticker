import { describe, expect, it, vi, afterEach } from "vitest";
import { buildApp } from "../src/app";
import * as promptConfigModule from "../src/services/wechat/promptConfig";

describe("/api/config route validation", () => {
  const app = buildApp({ host: "127.0.0.1", port: 0, dataDir: "data", logLevel: "silent" });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters out providers with empty or undefined apiKeys", async () => {
    vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
      ai: {
        defaultProvider: "mock",
        providers: {
          "mock": {
            type: "mock"
          },
          "doubao-empty": {
            type: "doubao",
            apiKey: ""
          },
          "doubao-undef": {
            type: "doubao"
            // apiKey undefined
          },
          "hf-empty": {
            type: "hf",
            endpoint: "http://example.com",
            apiKey: ""
          },
          "hf-undef": {
            type: "hf",
            endpoint: "http://example.com"
          },
          "http-valid": {
            type: "http",
            endpoint: "http://example.com"
            // apiKey optional for http
          },
          "doubao-valid": {
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

    const res = await app.inject({
      method: "GET",
      url: "/api/config"
    });

    const data = res.json();
    const providers = data.wechat.availableProviders.map((p: any) => p.id);

    // mock is added by default in non-prod
    expect(providers).toContain("mock");
    expect(providers).toContain("http-valid");
    expect(providers).toContain("doubao-valid");
    
    expect(providers).not.toContain("doubao-empty");
    expect(providers).not.toContain("doubao-undef");
    expect(providers).not.toContain("hf-empty");
    expect(providers).not.toContain("hf-undef");
  });
});