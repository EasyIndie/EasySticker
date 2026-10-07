/**
 * EasySticker 本地开发指令
 *
 * 注册一个用户指令：
 *   /dev [start|lan|stop|restart|status|logs]   后端开发服务（npm run dev）
 *
 * 服务以脱离 pi 进程的方式在后台运行，PID / 日志 / 访问模式写入项目内的 .pi/run/。
 *
 * 访问模式（默认仅本机可访问）：
 *   local   仅监听本机：后端 HOST=127.0.0.1（http://localhost:3000/）
 *   lan     允许局域网访问：后端 HOST=0.0.0.0（用本机 IP:3000 访问）
 *
 *   /dev lan    以局域网模式启动（若已在运行会切换模式并重启）
 *   restart     沿用上次 start/lan 选择的模式
 *   不带参数     默认 start（local）
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type Action = "start" | "lan" | "stop" | "restart" | "status" | "logs";
type Mode = "local" | "lan";

interface ServerSpec {
  /** package.json 中的 npm script 名 */
  script: string;
  /** 展示名称 */
  title: string;
  /** 端口（用于拼接访问地址） */
  port: number;
}

const SERVERS: Record<string, ServerSpec> = {
  dev: { script: "dev", title: "后端开发服务", port: 3000 },
};

const ACTIONS: Action[] = ["start", "lan", "stop", "restart", "status", "logs"];

const runDir = (cwd: string): string => path.join(cwd, ".pi", "run");
const pidPath = (cwd: string, key: string): string => path.join(runDir(cwd), `${key}.pid`);
const logPath = (cwd: string, key: string): string => path.join(runDir(cwd), `${key}.log`);
const modePath = (cwd: string, key: string): string => path.join(runDir(cwd), `${key}.mode`);

function readPid(cwd: string, key: string): number | undefined {
  try {
    const pid = Number(fs.readFileSync(pidPath(cwd, key), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isAlive(pid: number | undefined): pid is number {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearPid(cwd: string, key: string): void {
  try {
    fs.rmSync(pidPath(cwd, key), { force: true });
  } catch {
    /* ignore */
  }
}

function readMode(cwd: string, key: string): Mode {
  try {
    const m = fs.readFileSync(modePath(cwd, key), "utf8").trim();
    return m === "lan" ? "lan" : "local";
  } catch {
    return "local";
  }
}

function writeMode(cwd: string, key: string, mode: Mode): void {
  try {
    fs.mkdirSync(runDir(cwd), { recursive: true });
    fs.writeFileSync(modePath(cwd, key), mode);
  } catch {
    /* ignore */
  }
}

function lanUrl(port: number): string | undefined {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const info of ifaces ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        return `http://${info.address}:${port}/`;
      }
    }
  }
  return undefined;
}

function modeLabel(mode: Mode): string {
  return mode === "lan" ? "局域网可访问" : "仅本机";
}

function describeUrl(spec: ServerSpec, mode: Mode): string {
  if (mode === "lan") {
    const lan = lanUrl(spec.port);
    return lan ? `${lan}（局域网）` : `已监听 0.0.0.0，请用本机 IP 的 ${spec.port} 端口访问`;
  }
  return `http://localhost:${spec.port}/`;
}

/** 杀掉 detached 进程组（npm/concurrently/tsup/node 一起清掉），返回是否真的杀到了进程。 */
function killServer(cwd: string, key: string): boolean {
  const pid = readPid(cwd, key);
  if (!isAlive(pid)) {
    clearPid(cwd, key);
    return false;
  }
  // detached 进程是进程组组长，杀整组才能一并清掉子进程
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* ignore */
    }
  }
  clearPid(cwd, key);
  return true;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function startServer(
  cwd: string,
  key: string,
  spec: ServerSpec,
  mode: Mode,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const existing = readPid(cwd, key);
  if (isAlive(existing) && readMode(cwd, key) === mode) {
    ctx.ui.notify(
      `${spec.title} 已在运行（PID ${existing}，${modeLabel(mode)}）\n${describeUrl(spec, mode)}`,
      "info",
    );
    return;
  }
  if (isAlive(existing)) {
    // 切换访问模式：先停旧进程，等端口释放再拉起
    killServer(cwd, key);
    ctx.ui.notify(`${spec.title} 正在切换访问模式，重启中…`, "info");
    await sleep(800);
  }

  writeMode(cwd, key, mode);

  const args = ["run", spec.script];
  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: "0" };
  env.HOST = mode === "lan" ? "0.0.0.0" : "127.0.0.1";

  fs.mkdirSync(runDir(cwd), { recursive: true });
  const out = fs.openSync(logPath(cwd, key), "a");
  const child = spawn("npm", args, {
    cwd,
    detached: true,
    stdio: ["ignore", out, out],
    env,
  });
  fs.closeSync(out);

  child.on("error", (err) => {
    ctx.ui.notify(`启动 ${spec.title} 失败：${err.message}`, "error");
  });

  if (!child.pid) {
    ctx.ui.notify(`启动 ${spec.title} 失败：未能创建进程（检查 npm 是否在 PATH 中）`, "error");
    return;
  }

  child.unref();
  fs.writeFileSync(pidPath(cwd, key), String(child.pid));
  ctx.ui.notify(
    `${spec.title} 启动中（PID ${child.pid}，${modeLabel(mode)}）\n访问：${describeUrl(spec, mode)}\n日志：${path.relative(cwd, logPath(cwd, key))}`,
    "info",
  );
}

function stopServer(cwd: string, key: string, spec: ServerSpec, ctx: ExtensionCommandContext): void {
  const pid = readPid(cwd, key);
  if (!isAlive(pid)) {
    clearPid(cwd, key);
    ctx.ui.notify(`${spec.title} 未在运行`, "info");
    return;
  }
  killServer(cwd, key);
  ctx.ui.notify(`${spec.title} 已停止（PID ${pid}）`, "info");
}

function statusServer(cwd: string, key: string, spec: ServerSpec, ctx: ExtensionCommandContext): void {
  const pid = readPid(cwd, key);
  if (isAlive(pid)) {
    const mode = readMode(cwd, key);
    ctx.ui.notify(
      `${spec.title} 运行中（PID ${pid}，${modeLabel(mode)}）\n访问：${describeUrl(spec, mode)}`,
      "info",
    );
  } else {
    ctx.ui.notify(`${spec.title} 未在运行`, "info");
  }
}

function showLogs(cwd: string, key: string, spec: ServerSpec, ctx: ExtensionCommandContext, lines = 20): void {
  const file = logPath(cwd, key);
  if (!fs.existsSync(file)) {
    ctx.ui.notify(`${spec.title} 暂无日志（${path.relative(cwd, file)}）`, "info");
    return;
  }
  const all = fs.readFileSync(file, "utf8").split("\n");
  const tail = all.slice(-lines).join("\n").trim();
  ctx.ui.notify(tail || `${spec.title} 日志为空`, "info");
}

async function handleCommand(
  key: string,
  spec: ServerSpec,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const cwd = ctx.cwd;
  const action = (args.trim().split(/\s+/)[0] || "start") as Action;

  switch (action) {
    case "start":
      await startServer(cwd, key, spec, "local", ctx);
      break;
    case "lan":
      await startServer(cwd, key, spec, "lan", ctx);
      break;
    case "stop":
      stopServer(cwd, key, spec, ctx);
      break;
    case "restart": {
      const mode = readMode(cwd, key);
      stopServer(cwd, key, spec, ctx);
      await sleep(800);
      await startServer(cwd, key, spec, mode, ctx);
      break;
    }
    case "status":
      statusServer(cwd, key, spec, ctx);
      break;
    case "logs":
      showLogs(cwd, key, spec, ctx);
      break;
    default:
      ctx.ui.notify(`未知操作 "${action}"，可用：${ACTIONS.join(" / ")}`, "warning");
  }
}

export default function devCommandsExtension(pi: ExtensionAPI): void {
  for (const [key, spec] of Object.entries(SERVERS)) {
    pi.registerCommand(key, {
      description: `${spec.title}：npm run ${spec.script}（后台运行，支持 start/lan/stop/restart/status/logs，默认仅本机）`,
      getArgumentCompletions: (prefix) =>
        ACTIONS.filter((a) => a.startsWith(prefix.trim())).map((a) => ({ value: a, label: a })),
      handler: (args, ctx) => handleCommand(key, spec, args, ctx),
    });
  }
}
