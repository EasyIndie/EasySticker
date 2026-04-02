import { type FastifyInstance } from "fastify";
import { nanoid } from "nanoid";

export type TaskEvent = { id: number; event: string; data: unknown };

export type WechatGenTask = {
  id: string;
  events: TaskEvent[];
  nextEventId: number;
  listeners: Set<(ev: TaskEvent) => void>;
  done: boolean;
  createdAt: number;
  canceled?: boolean;
  finishedAt?: number;
};

const TASKS = new Map<string, WechatGenTask>();

export function createTask(): WechatGenTask {
  const id = nanoid();
  const task: WechatGenTask = {
    id,
    events: [],
    nextEventId: 1,
    listeners: new Set(),
    done: false,
    createdAt: Date.now()
  };
  TASKS.set(id, task);
  return task;
}

export function getTask(taskId: string): WechatGenTask | undefined {
  return TASKS.get(taskId);
}

export function appendEvent(task: WechatGenTask, event: string, data: unknown) {
  const ev: TaskEvent = { id: task.nextEventId++, event, data };
  task.events.push(ev);
  for (const listener of task.listeners) {
    try {
      listener(ev);
    } catch {
      // ignore listener errors
    }
  }
  if (event === "done") {
    task.done = true;
    task.finishedAt = Date.now();
  }
}

export function addListener(task: WechatGenTask, listener: (ev: TaskEvent) => void) {
  task.listeners.add(listener);
}

export function removeListener(task: WechatGenTask, listener: (ev: TaskEvent) => void) {
  task.listeners.delete(listener);
}

export function getEventsSince(task: WechatGenTask, lastEventId: number): TaskEvent[] {
  if (!lastEventId || lastEventId < 0) return task.events.slice();
  return task.events.filter((e) => e.id > lastEventId);
}

export function cancelTask(taskId: string) {
  const task = TASKS.get(taskId);
  if (!task) return false;
  task.canceled = true;
  appendEvent(task, "error", { message: "已取消生成任务" });
  return true;
}

let gcStarted = false;
export function ensureTaskGc(ttlMs: number = 10 * 60 * 1000, intervalMs: number = 60 * 1000) {
  if (gcStarted) return;
  gcStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [id, task] of TASKS.entries()) {
      const age = now - (task.finishedAt ?? task.createdAt);
      const shouldDelete =
        age >= ttlMs ||
        (task.done && age >= ttlMs) ||
        (task.canceled && age >= ttlMs);
      if (shouldDelete) {
        TASKS.delete(id);
      }
    }
  }, intervalMs).unref?.();
}
