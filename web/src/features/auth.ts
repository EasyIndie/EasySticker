import type { AuthUser, LoginRequest, RegisterRequest } from "../../../src/shared/contracts";
import { login as apiLogin, register as apiRegister, getQuota } from "../api/auth";
import { authStore } from "../store/auth";

/**
 * Auth overlay controller.
 *
 * P5 migration of the legacy "Auth Module" from public/app.js. It owns the
 * login/register overlay DOM, the header login button and the `window._auth`
 * bridge consumed by the rest of the legacy app.js. State lives in
 * store/auth.ts.
 */

declare global {
  interface Window {
    _auth?: {
      api: (url: string, opts?: RequestInit) => Promise<Response>;
      login: (token: string, user: AuthUser) => void;
      logout: () => void;
      isLoggedIn: () => boolean;
      getUser: () => AuthUser | null;
      getToken: () => string | null;
      loadQuota: () => Promise<void>;
    };
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

const overlay = byId("authOverlay");
const authTitle = byId("authTitle");
const authSubtitle = byId("authSubtitle");
const authForm = byId<HTMLFormElement>("authForm");
const authSubmit = byId<HTMLButtonElement>("authSubmit");
const loginEmail = byId<HTMLInputElement>("loginEmail");
const loginPassword = byId<HTMLInputElement>("loginPassword");
const authError = byId("authError");
const authToggle = byId("authToggle");
const authQuotaBar = byId("authQuotaBar");
const quotaDisplay = byId("quotaDisplay");
const loginBtn = byId<HTMLButtonElement>("loginBtn");
const authClose = byId("authClose");

const ICON_LOGIN = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
const ICON_LOGOUT = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';

let isRegisterMode = false;

function showAuth(): void {
  overlay?.removeAttribute("hidden");
}

function hideAuth(): void {
  overlay?.setAttribute("hidden", "");
  void loadQuota();
}

function updateUI(): void {
  const adminEntry = byId("adminEntry");
  const adminFooterLink = byId("adminFooterLink");

  if (authStore.isLoggedIn) {
    if (loginBtn) {
      loginBtn.innerHTML = ICON_LOGOUT;
      loginBtn.title = "注销";
    }
    if (authStore.user?.role === "admin") {
      adminEntry?.removeAttribute("hidden");
      adminFooterLink?.removeAttribute("hidden");
    } else {
      adminEntry?.setAttribute("hidden", "");
      adminFooterLink?.setAttribute("hidden", "");
    }
    hideAuth();
  } else {
    adminEntry?.setAttribute("hidden", "");
    adminFooterLink?.setAttribute("hidden", "");
    if (loginBtn) {
      loginBtn.innerHTML = ICON_LOGIN;
      loginBtn.title = "登录";
    }
  }
}

function toggleMode(): void {
  isRegisterMode = !isRegisterMode;
  const inviteField = byId("inviteField");

  if (isRegisterMode) {
    if (authTitle) authTitle.textContent = "注册 EasySticker";
    if (authSubtitle) authSubtitle.textContent = "创建一个账户以使用生成服务";
    if (authSubmit) authSubmit.textContent = "注册";
    if (authToggle) authToggle.textContent = "已有账户？登录";
    inviteField?.removeAttribute("hidden");
  } else {
    if (authTitle) authTitle.textContent = "登录 EasySticker";
    if (authSubtitle) authSubtitle.textContent = "输入邮箱和密码进入工作台";
    if (authSubmit) authSubmit.textContent = "登录";
    if (authToggle) authToggle.textContent = "没有账户？注册";
    inviteField?.setAttribute("hidden", "");
  }
}

function showError(message: string): void {
  if (!authError) return;
  authError.textContent = message;
  authError.removeAttribute("hidden");
}

async function loadQuota(): Promise<void> {
  if (!authStore.isLoggedIn || !quotaDisplay || !authQuotaBar) return;

  const result = await getQuota();
  if (result.ok) {
    quotaDisplay.textContent = `${result.data.used} / ${result.data.remaining + result.data.used}`;
    authQuotaBar.removeAttribute("hidden");
  }
}

async function handleSubmit(event: Event): Promise<void> {
  event.preventDefault();
  if (!loginEmail || !loginPassword || !authSubmit) return;

  authError?.setAttribute("hidden", "");
  authSubmit.disabled = true;
  authSubmit.textContent = isRegisterMode ? "注册中..." : "登录中...";

  try {
    const email = loginEmail.value.trim();
    const password = loginPassword.value;

    if (isRegisterMode) {
      const inviteTokenInput = byId<HTMLInputElement>("inviteToken");
      const adminToken = inviteTokenInput?.value.trim() ?? "";
      const input: RegisterRequest = { email, password };
      if (adminToken) input.adminToken = adminToken;

      const result = await apiRegister(input);
      if (!result.ok) {
        showError(result.error);
        return;
      }
      authStore.login(result.data.token, result.data.user);
    } else {
      const input: LoginRequest = { email, password };
      const result = await apiLogin(input);
      if (!result.ok) {
        showError(result.error);
        return;
      }
      authStore.login(result.data.token, result.data.user);
    }
  } catch {
    showError("Network error. Please try again.");
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = isRegisterMode ? "注册" : "登录";
  }
}

/**
 * Raw fetch bridge for the legacy app.js. Returns a Response (not the typed
 * ApiResult) and preserves the old 401 → logout/showAuth behaviour.
 */
async function legacyApi(url: string, opts: RequestInit = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (authStore.token) {
    headers.set("Authorization", `Bearer ${authStore.token}`);
  }
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401 && !url.includes("/auth/")) {
    authStore.logout();
    showAuth();
    throw new Error("Session expired. Please log in again.");
  }
  return res;
}

export function mountAuth(): void {
  overlay?.addEventListener("click", (event) => {
    if (event.target === overlay) hideAuth();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay && !overlay.hasAttribute("hidden")) {
      hideAuth();
    }
  });

  authForm?.addEventListener("submit", (event) => void handleSubmit(event));
  authToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    toggleMode();
  });

  loginBtn?.addEventListener("click", () => {
    if (authStore.isLoggedIn) {
      authStore.logout();
    } else {
      showAuth();
    }
  });

  authClose?.addEventListener("click", hideAuth);

  authStore.subscribe(updateUI);

  window._auth = {
    api: legacyApi,
    login: (token, user) => authStore.login(token, user),
    logout: () => authStore.logout(),
    isLoggedIn: () => authStore.isLoggedIn,
    getUser: () => authStore.user,
    getToken: () => authStore.token,
    loadQuota
  };

  // Apply initial UI state without blocking the rest of the app.
  updateUI();
  if (authStore.isLoggedIn) {
    void loadQuota();
  }
}
