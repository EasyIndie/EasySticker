import type { FastifyRequest } from "fastify";

/** 客户端 id 由前端生成并持久化；未登录用户靠它做「尽力而为」的归属。 */
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

export type Requester = {
  /** 已登录是邮箱，未登录是 `client:<id>`，null 表示无法归属。 */
  owner: string | null;
  isAdmin: boolean;
};

/**
 * 解析这次请求的归属者。
 *
 * - 已登录：用邮箱 —— 跨浏览器稳定，所以「清了浏览器缓存也不丢历史」；
 * - 未登录：用前端持久化的 `x-client-id` —— 清缓存会丢，属于尽力而为；
 * - 都没有：null。**不归属任何人的包不会出现在任何人的列表里**（避免把别人的包列出来）。
 *
 * 注意：这里只用于「列表 / 删除」的归属判断，不做鉴权。
 * 真正能读到包内容的凭证始终是 packId（不可猜的 nanoid），与 download / restore 一致。
 */
export async function resolveRequester(req: FastifyRequest): Promise<Requester> {
  // 即使全局鉴权关闭（未配置 API_TOKEN）也要尝试解析 JWT，否则拿不到 email
  await req.jwtVerify().catch(() => {});
  const user = req.user as { email?: string; role?: string } | undefined;
  const isAdmin = user?.role === "admin";
  if (user?.email) return { owner: user.email, isAdmin };

  const header = req.headers["x-client-id"];
  const clientId = typeof header === "string" && CLIENT_ID_PATTERN.test(header) ? `client:${header}` : null;
  return { owner: clientId, isAdmin };
}

/** 该请求是否有权操作这个包（管理员或归属者本人；无归属的旧包放行以保持兼容）。 */
export function canManagePack(requester: Requester, packOwner: string | null | undefined): boolean {
  if (requester.isAdmin) return true;
  if (!packOwner) return true;
  return requester.owner === packOwner;
}
