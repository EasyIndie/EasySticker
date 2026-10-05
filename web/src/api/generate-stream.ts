import { SseParser } from "./sse";

export type FetchApi = (url: string, opts?: RequestInit) => Promise<Response>;

export type StreamGenerationOptions = {
  fetchApi: FetchApi;
  /** App-level cancellation flag (e.g. cancel button or `error` event). */
  isCancelled?: () => boolean;
  maxRetries?: number;
  baseBackoff?: number;
};

export type SseEventHandler = (event: string, data: any) => void;

/**
 * POST /api/generate/start and return the task id.
 *
 * Uses the injected fetch so the legacy app can pass its auth-aware wrapper
 * (window._auth.api) while the SPA can pass a typed client.
 */
export async function startGenerationTask(payload: unknown, fetchApi: FetchApi): Promise<string> {
  const res = await fetchApi("/api/generate/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = (await res.json()) as { message?: string; taskId?: string };
  if (!res.ok) {
    throw new Error(json?.message || "生成失败，请稍后重试。");
  }
  if (!json?.taskId) {
    throw new Error("生成失败，请稍后重试。");
  }
  return json.taskId;
}

/**
 * Stream `/api/generate/stream` until the `done` event arrives, the task is
 * cancelled, or an unrecoverable error occurs.
 *
 * `onEvent` receives each parsed SSE event (`start`, `progress`, `sticker`,
 * `extra`, `done`, `error`). If the handler throws an error carrying
 * `isServerError`, it is rethrown immediately (no retry). Other read failures
 * are retried with exponential backoff, mirroring the legacy app.js loop.
 */
export async function streamGeneration(
  taskId: string,
  signal: AbortSignal,
  onEvent: SseEventHandler,
  options: StreamGenerationOptions
): Promise<void> {
  const maxRetries = options.maxRetries ?? 3;
  const baseBackoff = options.baseBackoff ?? 500;
  const isCancelled = options.isCancelled ?? (() => false);

  const decoder = new TextDecoder();
  const parser = new SseParser();
  let lastEventId = 0;
  let completed = false;

  for (let attempt = 0; attempt <= maxRetries && !completed && !isCancelled(); attempt++) {
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (lastEventId > 0) headers["Last-Event-ID"] = String(lastEventId);

    const res = await options.fetchApi(
      `/api/generate/stream?taskId=${encodeURIComponent(taskId)}`,
      { method: "GET", headers, signal }
    );
    if (!res.ok) throw new Error("生成失败，请稍后重试。");
    const reader = res.body?.getReader?.();
    if (!reader) throw new Error("生成失败，请稍后重试。");

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
          if (ev.id) {
            const n = Number(ev.id);
            if (Number.isFinite(n)) lastEventId = n;
          }

          const data = JSON.parse(ev.data);
          onEvent(ev.event, data);
          if (ev.event === "done") completed = true;
          if (isCancelled()) break;
        }

        if (isCancelled()) break;
      }
    } catch (error) {
      if (isCancelled() || signal.aborted) break;
      if ((error as any)?.isServerError) throw error;

      if (!completed && attempt < maxRetries) {
        const backoff = baseBackoff * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      throw error;
    }
  }
}
