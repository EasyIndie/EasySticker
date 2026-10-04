export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/** Thin typed fetch wrapper. Reads the same auth token as the legacy app. */
export async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  const token = localStorage.getItem("easysticker_token");
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, { ...init, headers });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // non-JSON error body
    }
    return { ok: false, status: res.status, error: message };
  }

  return { ok: true, data: (await res.json()) as T };
}
