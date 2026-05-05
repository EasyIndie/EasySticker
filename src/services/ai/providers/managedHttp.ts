import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import createHttpError from "http-errors";
import { fetch } from "undici";
import { type AiGenerateInput, type AiGenerateOutput, type AiProvider } from "../provider";
import { HttpAiProvider } from "./http";

export type HttpAutoStartConfig = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  healthUrl?: string;
  cancelUrl?: string;
  startupTimeoutMs?: number;
  idleMs?: number;
};

type Manager = {
  child?: ChildProcessWithoutNullStreams;
  starting?: Promise<void>;
  active: number;
  idleTimer?: NodeJS.Timeout;
};

const managers = new Map<string, Manager>();
let cleanupRegistered = false;

export function stopManagedHttpProviders() {
  for (const manager of managers.values()) {
    stopManager(manager);
  }
}

function registerCleanupHandlers() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const stopAndExit = (signal: NodeJS.Signals) => {
    stopManagedHttpProviders();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  process.once("SIGINT", () => stopAndExit("SIGINT"));
  process.once("SIGTERM", () => stopAndExit("SIGTERM"));
  process.once("exit", stopManagedHttpProviders);
}

function stopManager(manager: Manager) {
  if (manager.idleTimer) {
    clearTimeout(manager.idleTimer);
    manager.idleTimer = undefined;
  }
  if (!manager.child || manager.child.killed) {
    manager.child = undefined;
    return;
  }
  manager.child.kill("SIGTERM");
  manager.child = undefined;
}

export class ManagedHttpAiProvider implements AiProvider {
  private readonly provider: HttpAiProvider;
  private readonly managerKey: string;
  private readonly healthUrl: string;
  private readonly cancelUrl?: string;
  private readonly startupTimeoutMs: number;
  private readonly idleMs: number;

  constructor(
    private readonly endpoint: string,
    apiKey: string | undefined,
    private readonly autoStart: HttpAutoStartConfig
  ) {
    this.provider = new HttpAiProvider(endpoint, apiKey);
    this.managerKey = `${autoStart.command} ${(autoStart.args || []).join(" ")} ${endpoint}`;
    this.healthUrl = autoStart.healthUrl || endpoint.replace(/\/generate\/?$/, "/health");
    this.cancelUrl = autoStart.cancelUrl || endpoint.replace(/\/generate\/?$/, "/cancel");
    this.startupTimeoutMs = autoStart.startupTimeoutMs ?? 20000;
    this.idleMs = autoStart.idleMs ?? 120000;
    registerCleanupHandlers();
  }

  async generateImage(input: AiGenerateInput, signal?: AbortSignal): Promise<AiGenerateOutput> {
    const manager = this.getManager();
    manager.active++;
    if (manager.idleTimer) {
      clearTimeout(manager.idleTimer);
      manager.idleTimer = undefined;
    }

    try {
      const removeAbortListener = this.bindAbortSignal(signal);
      try {
        if (signal?.aborted) throw createHttpError(499, "生成任务已取消");
        await this.ensureRunning(manager);
        if (signal?.aborted) {
          await this.cancelRemote();
          throw createHttpError(499, "生成任务已取消");
        }
        return await this.provider.generateImage(input, signal);
      } finally {
        removeAbortListener?.();
      }
    } finally {
      manager.active = Math.max(0, manager.active - 1);
      this.scheduleStop(manager);
    }
  }

  private getManager() {
    let manager = managers.get(this.managerKey);
    if (!manager) {
      manager = { active: 0 };
      managers.set(this.managerKey, manager);
    }
    return manager;
  }

  private async ensureRunning(manager: Manager) {
    if (await this.isHealthy()) return;
    if (!manager.starting) {
      manager.starting = this.start(manager).finally(() => {
        manager.starting = undefined;
      });
    }
    await manager.starting;
  }

  private async start(manager: Manager) {
    if (manager.child && !manager.child.killed) return;

    const cwd = this.autoStart.cwd ? path.resolve(process.cwd(), this.autoStart.cwd) : process.cwd();
    const child = spawn(this.autoStart.command, this.autoStart.args || [], {
      cwd,
      env: {
        ...process.env,
        ...(this.autoStart.env || {})
      },
      stdio: "pipe"
    });
    manager.child = child;

    child.stdout.on("data", (chunk) => {
      process.stdout.write(`[http-autostart:${this.autoStart.command}] ${chunk}`);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(`[http-autostart:${this.autoStart.command}] ${chunk}`);
    });
    child.on("exit", () => {
      if (manager.child === child) manager.child = undefined;
    });

    await this.waitForHealthy();
  }

  private async isHealthy() {
    try {
      const res = await fetch(this.healthUrl, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async waitForHealthy() {
    const started = Date.now();
    while (Date.now() - started < this.startupTimeoutMs) {
      if (await this.isHealthy()) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw createHttpError(502, `auto-started HTTP provider did not become healthy: ${this.healthUrl}`);
  }

  private bindAbortSignal(signal?: AbortSignal) {
    if (!signal) return undefined;
    const onAbort = () => {
      void this.cancelRemote();
    };
    if (signal.aborted) {
      onAbort();
      return undefined;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    return () => signal.removeEventListener("abort", onAbort);
  }

  private async cancelRemote() {
    if (!this.cancelUrl) return;
    try {
      await fetch(this.cancelUrl, { method: "POST" });
    } catch {
      // The local adapter may already be gone; cancellation is best effort.
    }
  }

  private scheduleStop(manager: Manager) {
    if (!manager.child || manager.child.killed || manager.active > 0 || this.idleMs <= 0) return;
    manager.idleTimer = setTimeout(() => {
      if (manager.active > 0 || !manager.child || manager.child.killed) return;
      stopManager(manager);
    }, this.idleMs);
  }
}
