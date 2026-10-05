import { writeEnvValues } from "../../lib/envFile";

/**
 * 解析 AI provider 的 API Key，优先级：
 *   1. 真实环境变量 / .env 文件中的 `AI_<PROVIDER_ID>_API_KEY`
 *   2. prompt-config.json 中的 `ai.providers.<id>.apiKey`
 *
 * 推荐把密钥放进 .env（已被 .gitignore 忽略），避免写入 prompt-config.json，
 * 从而不会随配置文件分享/备份/Docker 镜像而泄露。
 */

/** 由 provider id 推导环境变量名，例如 "seedream" -> "AI_SEEDREAM_API_KEY"。 */
export function providerApiKeyEnvName(providerId: string): string {
  return `AI_${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

/** 返回解析后的 API Key；环境变量优先，其次配置文件。未配置时返回 undefined。 */
export function resolveProviderApiKey(
  providerId: string,
  config?: { apiKey?: unknown } | null
): string | undefined {
  const fromEnv = process.env[providerApiKeyEnvName(providerId)];
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv;
  }
  const fromConfig = config?.apiKey;
  if (typeof fromConfig === "string" && fromConfig.length > 0) {
    return fromConfig;
  }
  return undefined;
}

/** 把 API Key 写入 `.env`（`AI_<PROVIDER_ID>_API_KEY`）并同步到 process.env，登录即可生效。 */
export function setProviderApiKey(providerId: string, apiKey: string): void {
  writeEnvValues({ [providerApiKeyEnvName(providerId)]: apiKey });
}
