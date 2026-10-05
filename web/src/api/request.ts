/**
 * 后台请求构造。
 *
 * 关键点（这是个踩过的坑）：**只有真的带 body 时才声明
 * `content-type: application/json`**。
 *
 * Fastify 的 JSON 解析器对「content-type 是 application/json 但 body 为空」
 * 会直接回 400 `FST_ERR_CTP_EMPTY_JSON_BODY`，根本不会进到路由处理函数。
 * 后台的「确认告警 / 启用禁用用户 / 删除包」这三个请求本来就不需要 body，
 * 却因为无条件带上 content-type 而被静默打断 —— 表现就是
 * 「点确认按钮没反应」（请求其实发出去了，只是回 400，前端又没提示）。
 *
 * 抽成独立模块是为了能单测这条约束：这个 bug 不报错、不崩，只是没反应，
 * 靠人工很容易漏。
 */
export type RequestInitParts = {
  method: string;
  /** JWT；缺省表示未登录。 */
  token?: string | null;
  /** 缺省（undefined）表示「没有 body」，而不是「body 是 undefined」。 */
  body?: unknown;
};

export function buildRequestInit({ method, token, body }: RequestInitParts): RequestInit {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  if (body === undefined) {
    return { method, headers };
  }

  headers["Content-Type"] = "application/json";
  return { method, headers, body: JSON.stringify(body) };
}
