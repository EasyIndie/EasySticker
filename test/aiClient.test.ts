import { describe, expect, it, vi, afterEach } from "vitest";
import { buildMinimalClient } from "../src/services/ai/client";
import * as promptConfigModule from "../src/services/generate/promptConfig";
import type { AiProvider } from "../src/services/ai/provider";

const input = { prompt: "p", width: 64, height: 64 };

function mockConfig(settings: { timeoutMs: number; retryMax: number; retryBaseMs: number }) {
  vi.spyOn(promptConfigModule, "loadPromptConfig").mockReturnValue({
    ai: { settings },
    global: { prompt: "", negativePrompt: "", styles: [] },
    emotions: [],
    templates: { sticker: "", extra: "" },
    extraPrompts: { cover: "", icon: "", banner: "", rewardGuide: "", rewardThanks: "" }
  } as any);
}

/** 一个只在 signal abort 时才 reject 的 provider，用来观察底层请求是否被真正取消。 */
function abortableProvider(onCall: (signal?: AbortSignal) => void): AiProvider {
  return {
    generateImage: (_input, signal) =>
      new Promise((_resolve, reject) => {
        onCall(signal);
        signal?.addEventListener("abort", () =>
          reject(signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" }))
        );
      })
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildMinimalClient 的超时 / 取消", () => {
  it("超时会真正 abort 底层请求，并按 retryMax 重试（不是放后台跑）", async () => {
    mockConfig({ timeoutMs: 20, retryMax: 2, retryBaseMs: 1 });
    const signals: AbortSignal[] = [];
    const client = buildMinimalClient(abortableProvider((s) => s && signals.push(s)));

    await expect(client.generateImage(input)).rejects.toMatchObject({ code: "ETIMEDOUT" });

    // 1 次初始 + 2 次重试 = 3 次；且每次的 signal 都已经 abort（旧实现里它们会继续挂着）
    expect(signals).toHaveLength(3);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it("外部取消：立即 abort 且不重试", async () => {
    mockConfig({ timeoutMs: 10000, retryMax: 3, retryBaseMs: 1 });
    const controller = new AbortController();
    let calls = 0;
    let aborted = false;
    const client = buildMinimalClient(
      abortableProvider((signal) => {
        calls++;
        signal?.addEventListener("abort", () => {
          aborted = true;
        });
      })
    );

    const pending = client.generateImage(input, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
    expect(aborted).toBe(true);
  });

  it("成功时不会 abort，底层 signal 保持未触发", async () => {
    mockConfig({ timeoutMs: 1000, retryMax: 0, retryBaseMs: 1 });
    let seen: AbortSignal | undefined;
    const provider: AiProvider = {
      generateImage: async (_input, signal) => {
        seen = signal;
        return { mime: "image/png", bytes: Buffer.alloc(0) };
      }
    };
    const client = buildMinimalClient(provider);

    await client.generateImage(input);

    expect(seen).toBeDefined();
    expect(seen!.aborted).toBe(false);
  });
});
