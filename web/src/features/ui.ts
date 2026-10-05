/**
 * UI helpers vertical slice (P5).
 *
 * Migrated from public/app.js: toast/notice/status/busy/progress/error-hint.
 * These are leaf helpers with no dependency on the rest of the controller, so
 * they are exposed as `window._ui` and consumed by the remaining legacy code.
 */

declare global {
  interface Window {
    _ui?: {
      setStatus: (node: HTMLElement, text: string, tone?: string) => void;
      setNotice: (text: string, tone?: string) => void;
      showToast: (text: string, tone?: string) => void;
      setBusy: (button: HTMLButtonElement, busy: boolean, text: string) => void;
      setButtonLabel: (button: HTMLButtonElement | null, text: string) => void;
      updateGenerationProgress: (current: number, total: number) => void;
      resetGenerationProgress: () => void;
      getFriendlyErrorHint: (error: unknown) => string;
    };
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

const globalNotice = byId("globalNotice");
const toastNotice = byId("toastNotice");
const generationProgressWrap = byId("generationProgressWrap");
const generationProgressBar = byId("generationProgressBar");
const generationProgressPct = byId("generationProgressPct");

let lastProgressTotal = 0;
let lastProgressCurrent = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(node: HTMLElement, text: string, tone = "idle"): void {
  node.textContent = text;
  node.dataset.tone = tone;
}

function showToast(text: string, tone = "info"): void {
  if (!toastNotice) return;
  toastNotice.textContent = text;
  toastNotice.dataset.tone = tone;
  toastNotice.dataset.visible = "true";
  toastNotice.style.pointerEvents = "auto";
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  const duration = Math.min(2500 + text.length * 50, 8000);
  toastTimer = setTimeout(() => {
    toastNotice.dataset.visible = "false";
    toastNotice.style.pointerEvents = "";
  }, duration);
}

function setNotice(text: string, tone = "info"): void {
  if (globalNotice) {
    globalNotice.textContent = text;
    globalNotice.dataset.tone = tone;
  }
  if (tone === "success" || tone === "error") {
    showToast(text, tone);
  }
}

function setBusy(button: HTMLButtonElement, busy: boolean, text: string): void {
  button.disabled = busy;
  button.dataset.label = button.dataset.label || button.textContent || "";
  button.textContent = busy ? text : button.dataset.label;
}

function setButtonLabel(button: HTMLButtonElement | null, text: string): void {
  if (!button) return;
  button.textContent = text;
  delete button.dataset.label;
}

function updateGenerationProgress(current: number, total: number): void {
  lastProgressCurrent = current;
  lastProgressTotal = total;
  if (!generationProgressWrap || !generationProgressBar || !generationProgressPct) return;
  generationProgressWrap.hidden = false;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  generationProgressBar.style.setProperty("--progress-width", pct + "%");
  generationProgressPct.textContent = pct + "%";
}

function resetGenerationProgress(): void {
  lastProgressCurrent = 0;
  lastProgressTotal = 0;
  if (generationProgressWrap) generationProgressWrap.hidden = true;
  if (generationProgressBar) generationProgressBar.style.setProperty("--progress-width", "0%");
  if (generationProgressPct) generationProgressPct.textContent = "0%";
}

function getFriendlyErrorHint(error: unknown): string {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (msg.includes("timed out") || msg.includes("timeout") || msg.includes("超时")) {
    return "生成超时，建议减少贴纸数量或尝试切换到其他 AI 提供商。";
  }
  if (msg.includes("api key") || msg.includes("unauthorized") || msg.includes("401") || msg.includes("403") || msg.includes("认证") || msg.includes("token")) {
    return "AI 服务认证失败，请检查 prompt-config.json 中的 API Key 配置是否正确。";
  }
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("频率")) {
    return "AI 服务触发频率限制，请稍后再试或降低并发数。";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("网络")) {
    return "网络连接异常，请检查服务器网络和 AI 提供商服务状态。";
  }
  if (msg.includes("validation") || msg.includes("校验") || msg.includes("validate")) {
    return "生成结果未通过平台规格校验，尝试更换风格或参考图。";
  }
  if (msg.includes("cancel") || msg.includes("取消")) {
    return "生成已取消。";
  }
  return "请检查 AI 提供商配置，或尝试使用其他提供商。如果持续失败，检查 prompt-config.json 配置。";
}

export function mountUi(): void {
  toastNotice?.addEventListener("click", function () {
    if (toastTimer) clearTimeout(toastTimer);
    if (toastNotice) {
      toastNotice.dataset.visible = "false";
      toastNotice.style.pointerEvents = "";
    }
  });

  window._ui = {
    setStatus,
    setNotice,
    showToast,
    setBusy,
    setButtonLabel,
    updateGenerationProgress,
    resetGenerationProgress,
    getFriendlyErrorHint
  };
}
