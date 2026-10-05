import { describe, expect, it } from "vitest";
import { buildRequestInit } from "../web/src/api/request";

/**
 * 后台请求构造的回归测试。
 *
 * 背景：`apiCall` 曾经无条件带上 `content-type: application/json`，
 * 于是「确认告警 / 启用禁用用户 / 删除包」这三个不需要 body 的 POST/DELETE
 * 被 Fastify 直接回 400 `FST_ERR_CTP_EMPTY_JSON_BODY`。
 * 症状极具误导性：按钮点下去什么都没发生。
 *
 * 这几条断言就是防止再退回那个状态。
 */
describe("buildRequestInit", () => {
  it("没有 body 时不能带 content-type（否则 Fastify 回 400）", () => {
    const init = buildRequestInit({ method: "POST", token: "t" });
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(Object.keys(headers).some((k) => k.toLowerCase() === "content-type")).toBe(false);
    expect(init.body).toBeUndefined();
  });

  it("DELETE 与 POST 在无 body 时表现一致", () => {
    for (const method of ["POST", "DELETE", "PUT"]) {
      const init = buildRequestInit({ method, token: "t" });
      expect(Object.keys(init.headers as object)).not.toContain("Content-Type");
    }
  });

  it("带 body 时才声明 content-type 并序列化", () => {
    const init = buildRequestInit({ method: "PUT", token: "t", body: { rules: [] } });
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"rules":[]}');
  });

  it("body 为 null / false / 0 时仍算「有 body」（不能被当成缺省丢掉）", () => {
    for (const body of [null, false, 0, ""]) {
      const init = buildRequestInit({ method: "POST", token: "t", body });
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect(init.body).toBe(JSON.stringify(body));
    }
  });

  it("始终带上 Authorization（除非未登录）", () => {
    expect((buildRequestInit({ method: "GET", token: "abc" }).headers as Record<string, string>).Authorization).toBe(
      "Bearer abc"
    );
    expect(
      (buildRequestInit({ method: "GET", token: null }).headers as Record<string, string>).Authorization
    ).toBeUndefined();
    expect(
      (buildRequestInit({ method: "GET", token: "" }).headers as Record<string, string>).Authorization
    ).toBeUndefined();
  });
});
