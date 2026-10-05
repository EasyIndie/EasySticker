#!/usr/bin/env node
/**
 * EasySticker 交互式配置向导。
 *
 *   npm run setup
 *
 * - 若无 .env 则从 .env.example 创建；
 * - 引导选择生图方式，把密钥写入 .env（AI_<ID>_API_KEY）；
 * - 把所选 provider 写入 prompt-config.json 的 ai.defaultProvider。
 *
 * 说明：使用 readline 的 async iterator 逐行读取，兼容 TTY 与管道输入。
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

const root = process.cwd();
const envPath = path.join(root, ".env");
const envExamplePath = path.join(root, ".env.example");
const configPath = path.join(root, "prompt-config.json");

function ensureEnvFile() {
  if (fs.existsSync(envPath)) {
    console.log("· .env 已存在，将就地更新");
    return;
  }
  const content = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, "utf-8") : "";
  fs.writeFileSync(envPath, content, "utf-8");
  console.log("✓ 已根据 .env.example 创建 .env");
}

function setEnv(key, value) {
  if (!fs.existsSync(envPath)) fs.writeFileSync(envPath, "", "utf-8");
  let found = false;
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/).map((line) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && m[1] === key) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) lines.push(`${key}=${value}`);
  let content = lines.join("\n");
  if (!content.endsWith("\n")) content += "\n";
  fs.writeFileSync(envPath, content, "utf-8");
}

function setDefaultProvider(id, customProvider) {
  let cfg = {};
  if (fs.existsSync(configPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      cfg = {};
    }
  }
  cfg.ai = cfg.ai || {};
  cfg.ai.defaultProvider = id;
  if (customProvider) {
    cfg.ai.providers = cfg.ai.providers || {};
    cfg.ai.providers[id] = { ...(cfg.ai.providers[id] || {}), ...customProvider };
  }
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

const rl = readline.createInterface({ input, output, terminal: Boolean(input.isTTY) });
const lines = rl[Symbol.asyncIterator]();

async function ask(promptText, fallback = "") {
  output.write(promptText);
  const { value, done } = await lines.next();
  if (done) return fallback;
  const v = String(value).trim();
  return v === "" ? fallback : v;
}

try {
  console.log("\n🧩 EasySticker 配置向导\n");
  ensureEnvFile();

  const choice = await ask(
    "选择生图方式：\n" +
      "  1) Mock 本地模拟（默认，无需 Key）\n" +
      "  2) 豆包 Seedream（火山方舟）\n" +
      "  3) OpenAI gpt-image\n" +
      "  4) 其他 OpenAI 兼容端点\n" +
      "  5) 跳过\n" +
      "> ",
    "1"
  );

  if (choice === "2") {
    const key = await ask("火山方舟 API Key: ");
    if (key) setEnv("AI_SEEDREAM_API_KEY", key);
    setDefaultProvider("seedream");
    console.log("✓ 已把 seedream 设为默认 provider（模型见 prompt-config.default.json）");
  } else if (choice === "3") {
    const key = await ask("OpenAI API Key: ");
    if (key) setEnv("AI_OPENAI_API_KEY", key);
    setDefaultProvider("openai");
    console.log("✓ 已把 openai 设为默认 provider");
  } else if (choice === "4") {
    const id = await ask("Provider 名称（英文 id，如 siliconflow）: ", "custom");
    const baseUrl = await ask("Base URL（如 https://api.siliconflow.cn/v1）: ");
    const model = await ask("模型名: ");
    const key = await ask("API Key: ");
    const envName = `AI_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
    if (key) setEnv(envName, key);
    setDefaultProvider(id, { type: "openai", name: id, baseUrl, model, variant: "generic" });
    console.log(`✓ 已添加 provider "${id}" 并设为默认（密钥变量 ${envName}）`);
  } else {
    console.log("· 保持 Mock 模式，可随时运行 npm run setup 重新配置");
  }

  console.log(
    "\n下一步：\n" +
      "  npm run dev                            # 开发模式\n" +
      "  npm run build && node dist/server.js   # 生产模式\n" +
      "然后打开 http://localhost:3000/\n"
  );
} finally {
  rl.close();
}
