import { type AiProvider, type AiGenerateInput, type AiGenerateOutput } from "./provider";

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
  const status = typeof err?.statusCode === "number" ? err.statusCode : 0;
  return err?.code === "ETIMEDOUT" || status === 429 || (status >= 500 && status <= 599);
}

export function buildMinimalClient(provider: AiProvider, opts?: Partial<Options>) {
  const options: Options = {
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 15000),
    retryMax: Number(process.env.AI_RETRY_MAX ?? 2),
    retryBaseMs: Number(process.env.AI_RETRY_BASE_MS ?? 400),
    ...(opts ?? {})
  };

  return {
    async generateImage(input: AiGenerateInput): Promise<AiGenerateOutput> {
      let attempt = 0;
      while (true) {
        try {
          const out = await withTimeout(options.timeoutMs, () => provider.generateImage(input));
          return out;
        } catch (err) {
          if (attempt >= options.retryMax || !isRetryable(err)) throw err;
          const backoff = Math.floor(options.retryBaseMs * Math.pow(2, attempt));
          await sleep(backoff);
          attempt++;
        }
      }
    }
  };
}
