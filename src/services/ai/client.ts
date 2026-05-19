import { type AiProvider, type AiGenerateInput, type AiGenerateOutput } from "./provider";
import { loadPromptConfig } from "../generate/promptConfig";

type Options = {
  timeoutMs: number;
  retryMax: number;
  retryBaseMs: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout<T>(timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("ai timeout"), { code: "ETIMEDOUT" })), timeoutMs);
    fn()
      .then((v) => resolve(v))
      .catch((e) => reject(e))
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
  });
}

function isRetryable(err: any) {
  if (err?.name === "AbortError" || err?.statusCode === 499) return false;
  const status = typeof err?.statusCode === "number" ? err.statusCode : 0;
  return err?.code === "ETIMEDOUT" || status === 429 || (status >= 500 && status <= 599);
}

export function buildMinimalClient(provider: AiProvider, opts?: Partial<Options>) {
  const config = loadPromptConfig();
  const settings = config.ai?.settings || {};
  const options: Options = {
    timeoutMs: settings.timeoutMs ?? 60000,
    retryMax: settings.retryMax ?? 3,
    retryBaseMs: settings.retryBaseMs ?? 1000,
    ...(opts ?? {})
  };

  return {
    async generateImage(input: AiGenerateInput, signal?: AbortSignal): Promise<AiGenerateOutput> {
      let attempt = 0;
      while (true) {
        if (signal?.aborted) throw Object.assign(new Error("生成任务已取消"), { statusCode: 499 });
        try {
          const out = await withTimeout(options.timeoutMs, () => provider.generateImage(input, signal));
          return out;
        } catch (err: any) {
          if (attempt >= options.retryMax || !isRetryable(err)) throw err;
          // 如果是 429，增加更多的退避时间
          const status = typeof err?.statusCode === "number" ? err.statusCode : 0;
          const multiplier = status === 429 ? 3 : 1;
          const backoff = Math.floor(options.retryBaseMs * Math.pow(2, attempt)) * multiplier;
          await sleep(backoff);
          attempt++;
        }
      }
    }
  };
}
