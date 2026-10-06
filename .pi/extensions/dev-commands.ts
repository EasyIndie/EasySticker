/**
 * EasySticker 本地开发指令
 *
 * 注册两个用户指令：
 *   /dev [start|stop|restart|status|logs]   后端开发服务（npm run dev）
 *   /web [start|stop|restart|status|logs]   前端开发服务（npm run web:dev）
 *
 * 服务以脱离 pi 进程的方式在后台运行，PID 与日志存放在项目内的 .pi/run/。
 * 不带参数时默认执行 start；已在运行时重复 start 只提示，不会重复拉起。
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

type Action = "start" | "stop" | "restart" | "status" | "logs";

interface ServerSpec {
  /** package.json 中的 npm script 名 */
  script: string;
  /** 展示名称 */
  title: string;
  /** 访问地址 */
  url: string;
}

const SERVERS: Record<string, ServerSpec> = {
  dev: {
    script: "dev",
    title: "后端开发服务",
    url: "http://localhost:3000/",
  },
  web: {
    script: "web:dev",
    title: "前端开发服务",
    url: "http://localhost:5173/",
  },
};

const ACTIONS: Action[] = ["start", "stop", "restart", "status", "logs"];

const runDir = (cwd: string): string => path.join(cwd, ".pi", "run");
const pidPath = (cwd: string, key: string): string => path.join(runDir(cwd), `${key}.pid`);
const logPath = (cwd: string, key: string): string => path.join(runDir(cwd), `${key}.log`);

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

function startServer(cwd: string, key: string, spec: ServerSpec, ctx: ExtensionCommandContext): void {
  const existing = readPid(cwd, key);
  if (isAlive(existing)) {
    ctx.ui.notify(`${spec.title} 已在运行（PID ${existing}）\n${spec.url}`, "info");
    return;
  }

  fs.mkdirSync(runDir(cwd), { recursive: true });
  const out = fs.openSync(logPath(cwd, key), "a");
  const child = spawn("npm", ["run", spec.script], {
    cwd,
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, FORCE_COLOR: "0" },
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
    `${spec.title} 启动中（PID ${child.pid}）\n访问：${spec.url}\n日志：${path.relative(cwd, logPath(cwd, key))}`,
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

  // detached 进程是进程组组长，杀整组才能一并清掉 npm/concurrently/tsup/node 子进程
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
  ctx.ui.notify(`${spec.title} 已停止（PID ${pid}）`, "info");
}

function statusServer(cwd: string, key: string, spec: ServerSpec, ctx: ExtensionCommandContext): void {
  const pid = readPid(cwd, key);
  if (isAlive(pid)) {
    ctx.ui.notify(`${spec.title} 运行中（PID ${pid}）\n访问：${spec.url}`, "info");
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
      startServer(cwd, key, spec, ctx);
      break;
    case "stop":
      stopServer(cwd, key, spec, ctx);
      break;
    case "restart":
      stopServer(cwd, key, spec, ctx);
      await sleep(800);
      startServer(cwd, key, spec, ctx);
      break;
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
      description: `${spec.title}：npm run ${spec.script}（后台运行，支持 start/stop/restart/status/logs）`,
      getArgumentCompletions: (prefix) =>
        ACTIONS.filter((a) => a.startsWith(prefix.trim())).map((a) => ({ value: a, label: a })),
      handler: (args, ctx) => handleCommand(key, spec, args, ctx),
    });
  }
}
