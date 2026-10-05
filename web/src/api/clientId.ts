const STORAGE_KEY = "easysticker:client-id";
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
let cached: string | null = null;

function randomId(): string {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
  } catch {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * 未登录用户在本站的稳定标识，随每个请求发到服务端（`x-client-id`）。
 *
 * 已登录用户服务端会用邮箱归属，用不到它；未登录时用它把「自己的包」列出来。
 * 清掉浏览器缓存会换一个新 id，所以这只是尽力而为 —— 想跨设备保留历史请登录。
 */
export function getClientId(): string {
  if (cached) return cached;
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && CLIENT_ID_PATTERN.test(existing)) {
      cached = existing;
      return cached;
    }
    const id = randomId();
    localStorage.setItem(STORAGE_KEY, id);
    cached = id;
    return cached;
  } catch {
    return "";
  }
}

/** 把客户端标识附到请求头上（不覆盖调用方自己设置的值）。 */
export function withClientId(headers: Headers): Headers {
  if (headers.has("x-client-id")) return headers;
  const id = getClientId();
  if (id) headers.set("x-client-id", id);
  return headers;
}
