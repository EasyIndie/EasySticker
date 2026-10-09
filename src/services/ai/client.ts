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

function timeoutError() {
  return Object.assign(new Error("ai timeout"), { code: "ETIMEDOUT" });
}

type LinkedAbort = { signal: AbortSignal; dispose: () => void };

/**
 * 把多个 AbortSignal 联动到一个新 signal。手写实现（不依赖 Node 20.3+ 才有的
 * `AbortSignal.any`），任一源 abort 都会带动合并 signal。
 */
function linkAbortSignals(signals: Array<AbortSignal | undefined>): LinkedAbort {
  const controller = new AbortController();
  const active = signals.filter((s): s is AbortSignal => Boolean(s));
  const disposers: Array<() => void> = [];

  for (const source of active) {
    if (source.aborted) {
      controller.abort(source.reason);
      break;
    }
  }

  if (!controller.signal.aborted) {
    for (const source of active) {
      const onAbort = () => controller.abort(source.reason);
      source.addEventListener("abort", onAbort, { once: true });
      disposers.push(() => source.removeEventListener("abort", onAbort));
    }
  }

  return { signal: controller.signal, dispose: () => disposers.forEach((off) => off()) };
}

/**
 * 用「外部取消 signal + 超时 signal」联动后的 signal 调用 fn。
 *
 * 与旧实现的关键区别：超时不再只是 reject Promise，而是真正 abort 底层请求，
 * 避免请求在后台变成 zombie、并在重试时叠加出多份可能仍在计费的请求。
 */
async function withTimeout<T>(
  timeoutMs: number,
  outerSignal: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(timeoutError()), timeoutMs);
  const linked = linkAbortSignals([outerSignal, timeoutController.signal]);
  try {
    return await fn(linked.signal);
  } catch (err) {
    // 超时触发的 abort：归一化为可重试的 ETIMEDOUT；
    // 用户取消触发的 abort：保持原样（isRetryable 会判为不可重试）。
    if (timeoutController.signal.aborted && !outerSignal?.aborted) {
      throw timeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
    linked.dispose();
  }
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
          const out = await withTimeout(options.timeoutMs, signal, (combined) =>
            provider.generateImage(input, combined)
          );
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
