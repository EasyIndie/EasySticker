import fs from "node:fs";
import path from "node:path";

/**
 * 更新（或创建）`.env` 文件中的键值，并同步写入 `process.env`，
 * 使改动无需重启即可生效。
 *
 * - 保留文件中的其他行与注释；
 * - 已存在的同名键就地更新，缺失的键追加到末尾；
 * - 值包含空格/引号/# 时自动加双引号。
 */
export function writeEnvValues(
  updates: Record<string, string>,
  filePath: string = path.join(process.cwd(), ".env")
): void {
  const lines = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf-8").split(/\r?\n/)
    : [];
  const pending = new Map(Object.entries(updates));

  const out = lines.map((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) return line;
    const key = match[1]!;
    if (!pending.has(key)) return line;
    const value = pending.get(key)!;
    pending.delete(key);
    return `${key}=${formatEnvValue(value)}`;
  });

  for (const [key, value] of pending) {
    out.push(`${key}=${formatEnvValue(value)}`);
  }

  let content = out.join("\n");
  if (!content.endsWith("\n")) content += "\n";
  fs.writeFileSync(filePath, content, "utf-8");

  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }
}

function formatEnvValue(value: string): string {
  if (/[\s#"']/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}
