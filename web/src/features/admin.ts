/**
 * Admin panel (P5) — TS port of the former public/admin.js.
 * Self-contained: talks to /api/admin/* and shares the auth token with the
 * main app via localStorage. Inline onclick handlers were replaced by
 * data-action + event delegation to satisfy the CSP.
 */

const API_BASE = "/api";
import { openMonitoringStream, type MonitoringStream } from "../api/admin-stream";
import { buildRequestInit } from "../api/request";
import { renderTimeSeries } from "./charts";

/** 仪表盘实时数据流；只在仪表盘标签页可见时保持连接。 */
let _dashboardStream: MonitoringStream | null = null;

// ── 统一 SVG 图标（stroke=currentColor，自动适配亮/暗模式）─────────────────
const ICON_CHECK =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_CROSS =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const ICON_WARN =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const ICON_CLOCK =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
const ICON_CHECK_CIRCLE =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
const ICON_SUN =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const ICON_MOON =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

/** 与主站共用 easysticker-theme，保证跳转时主题一致。 */
function initTheme(): void {
  const toggle = byId<HTMLButtonElement>("theme-toggle");
  const meta = byId<HTMLMetaElement>("themeMeta");
  const apply = (theme: string) => {
    document.documentElement.setAttribute("data-theme", theme);
    if (meta) meta.content = theme === "dark" ? "#0f172a" : "#F0F2F5";
    if (toggle) {
      toggle.innerHTML = theme === "dark" ? ICON_SUN : ICON_MOON;
      const label = theme === "dark" ? "切换浅色模式" : "切换深色模式";
      toggle.setAttribute("aria-label", label);
      toggle.setAttribute("title", label);
    }
  };
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  apply(current);
  toggle?.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem("easysticker-theme", next);
    apply(next);
  });
}

function setStatusMsg(
  el: HTMLElement | null,
  tone: "success" | "error" | "info" | "warning",
  text: string,
  icon: string
): void {
  if (!el) return;
  el.className = `status-msg ${tone}`;
  el.innerHTML = `${icon}<span>${escHtml(text)}</span>`;
}

function clearStatusMsg(el: HTMLElement | null): void {
  if (!el) return;
  el.className = "status-msg";
  el.innerHTML = "";
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
function req<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Missing required element #${id}`);
  return el;
}

async function apiCall<T = any>(method: string, path: string, body?: unknown): Promise<T | null> {
  const token = localStorage.getItem("easysticker_token");
  try {
    const res = await fetch(API_BASE + path, buildRequestInit({ method, token, body }));
    if (res.status === 401) {
      logout();
      return null;
    }
    const data = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      // 以前这里把错误响应也当成成功往下传，于是「确认告警」这类操作
      // 失败时界面毫无反应。至少要让人看见，而不是静默。
      console.error("API call failed:", method, path, res.status, data);
      setGlobalAdminNotice(data?.message || data?.error || `操作失败（${res.status}）`);
      return null;
    }
    return data as T;
  } catch (err) {
    console.error("API call failed:", method, path, err);
    setGlobalAdminNotice("网络异常，操作未生效");
    return null;
  }
}

/** 后台没有 toast 组件，用顶部提示条显示一次性错误。 */
let _noticeTimer: ReturnType<typeof setTimeout> | null = null;
function setGlobalAdminNotice(text: string): void {
  const el = byId("admin-notice");
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  if (_noticeTimer) clearTimeout(_noticeTimer);
  _noticeTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

async function login(): Promise<void> {
  const emailEl = byId<HTMLInputElement>("login-email");
  const passEl = byId<HTMLInputElement>("login-password");
  const errorEl = byId("login-error");
  const btn = byId<HTMLButtonElement>("login-btn");
  if (!emailEl || !passEl || !errorEl || !btn) return;

  const email = emailEl.value.trim();
  const password = passEl.value;
  if (!email || !password) {
    errorEl.textContent = "请输入邮箱和密码";
    return;
  }

  btn.disabled = true;
  btn.textContent = "登录中...";
  errorEl.textContent = "";

  try {
    const result = await apiCall<{ error?: string; message?: string; token?: string; user?: any }>("POST", "/auth/login", { email, password });
    btn.disabled = false;
    btn.textContent = "登 录";

    if (!result || result.error) {
      errorEl.textContent = result?.message || "登录失败，请检查邮箱和密码";
      return;
    }

    localStorage.setItem("easysticker_token", result.token || "");
    localStorage.setItem("easysticker_user", JSON.stringify(result.user));
    sessionStorage.removeItem("admin_logged_out");
    showMainSection(result.user);
  } catch (e) {
    console.error("[admin] login error:", e);
    btn.disabled = false;
    btn.textContent = "登 录";
    errorEl.textContent = "登录出错，请重试";
  }
}

function logout(): void {
  stopLiveUpdates();
  try {
    localStorage.removeItem("easysticker_token");
    localStorage.removeItem("easysticker_user");
    sessionStorage.setItem("admin_logged_out", "1");
  } catch (e) { console.error("[admin] logout storage error:", e); }

  try {
    const main = byId("main-section");
    const loginSection = byId("login-section");
    if (main) main.style.display = "none";
    if (loginSection) loginSection.style.display = "flex";
    const emailEl = byId<HTMLInputElement>("login-email");
    const passEl = byId<HTMLInputElement>("login-password");
    const errorEl = byId("login-error");
    if (emailEl) emailEl.value = "";
    if (passEl) passEl.value = "";
    if (errorEl) errorEl.textContent = "";
  } catch (e) { console.error("[admin] logout DOM error:", e); }
}

function showMainSection(user: any): void {
  const loginSection = byId("login-section");
  const mainSection = byId("main-section");
  if (loginSection) loginSection.style.display = "none";
  if (mainSection) mainSection.style.display = "block";

  const userLabel = req("topbar-user");
  userLabel.textContent = user.email + (user.role === "admin" ? " (管理员)" : "");

  switchTab("dashboard");
}

function checkAuth(): void {
  if (sessionStorage.getItem("admin_logged_out")) return;
  const token = localStorage.getItem("easysticker_token");
  const userRaw = localStorage.getItem("easysticker_user");
  if (token && userRaw) {
    try {
      const user = JSON.parse(userRaw);
      if (user.role === "admin") showMainSection(user);
    } catch (e) { console.error("[admin] checkAuth: failed to parse user", e); }
  }
}

function switchTab(tab: string): void {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", (btn as HTMLElement).dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    (panel as HTMLElement).style.display = panel.id === tab + "-panel" ? "block" : "none";
  });

  switch (tab) {
    case "dashboard": startLiveUpdates(); break;
    case "users": stopLiveUpdates(); void loadUsers(); break;
    case "stats": stopLiveUpdates(); void loadStats(); break;
    case "storage": stopLiveUpdates(); void loadStorage(); break;
    case "settings":
      stopLiveUpdates();
      void loadSettings();
      void loadAlertRules();
      void loadAiProviders();
      break;
  }
}

// ── 仪表盘实时更新（SSE，替代原先的 15 秒轮询）─────────────────────────────
//
// 原先 setInterval(loadDashboard, 15000) 有两个毛病：数据永远滞后，
// 且只要后台页面开着就一直发请求。改成服务端推送后，切到别的标签页
// 或浏览器标签页被隐藏时会主动断开，不再有空转连接。
function startLiveUpdates(): void {
  if (_dashboardStream) return;
  setLiveStatus("connecting");
  _dashboardStream = openMonitoringStream({
    onSnapshot: (payload) => renderMetrics(payload?.snapshot),
    onAlerts: (payload) => renderAlerts(payload?.alerts || []),
    onStatus: (status) => {
      setLiveStatus(status);
      // 推送被中间层挡住时（部分代理会缓冲 SSE）退回到拉一次，
      // 至少保证页面上有数据可看；连接本身会退避重试。
      if (status === "offline") void loadDashboard();
    }
  });
}

function stopLiveUpdates(): void {
  _dashboardStream?.close();
  _dashboardStream = null;
  setLiveStatus("offline");
}

function setLiveStatus(status: "connecting" | "live" | "offline"): void {
  const el = byId("dashboard-live");
  if (!el) return;
  const map = {
    live: { text: "实时更新中", tone: "live" },
    connecting: { text: "连接中…", tone: "connecting" },
    offline: { text: "已断开，正在重连", tone: "offline" }
  } as const;
  const { text, tone } = map[status];
  el.dataset.tone = tone;
  el.textContent = text;
}

// ── Dashboard ───────────────────────────────────────────────────────────────
async function loadDashboard(): Promise<void> {
  const data = await apiCall<any>("GET", "/admin/monitoring");
  if (!data) return;
  renderMetrics(data.snapshot);
  void loadAlerts();
}

function getMetricColor(percent: number): string {
  if (percent < 50) return "#52C41A";
  if (percent <= 80) return "#FAAD14";
  return "#FF4D4F";
}

function renderMetrics(snapshot: any): void {
  if (!snapshot) return;
  const circumference = 2 * Math.PI * 52;

  const cpuPct = snapshot.cpu?.percent ?? 0;
  renderRing("metric-cpu", cpuPct, "%", circumference);
  const cpuCircle = document.querySelector("#metric-cpu .metric-ring circle:last-child");
  if (cpuCircle) (cpuCircle as SVGElement).style.color = getMetricColor(cpuPct);
  const cpuLoad = req("metric-cpu-load");
  cpuLoad.textContent = "负载: " + (snapshot.cpu?.loadAvg || []).map((v: number) => v.toFixed(1)).join(" / ");

  const memPct = snapshot.memory?.percent ?? 0;
  renderRing("metric-mem", memPct, "%", circumference);
  const memCircle = document.querySelector("#metric-mem .metric-ring circle:last-child");
  if (memCircle) (memCircle as SVGElement).style.color = getMetricColor(memPct);
  const memUsed = snapshot.memory?.usedMb ?? 0;
  const memTotal = snapshot.memory?.totalMb ?? 0;
  req("metric-mem-detail").textContent = memUsed + " MB / " + memTotal + " MB";

  const diskPct = snapshot.disk?.percent ?? 0;
  const diskUsed = snapshot.disk?.usedMb ?? 0;
  renderRing("metric-disk", Math.min(diskUsed, 100), "MB", circumference);
  const diskEl = document.querySelector("#metric-disk .metric-ring-value");
  if (diskEl) diskEl.textContent = diskUsed;
  req("metric-disk-detail").textContent = "总计: " + (snapshot.disk?.totalMb ?? 0) + " MB";

  const rpm = snapshot.requestsLastMinute ?? 0;
  req("metric-rpm-value").textContent = rpm;
  const errors = snapshot.errorsLastMinute ?? 0;
  const avgLatency = snapshot.avgLatencyLastMinute ?? 0;
  req("metric-rpm-detail").textContent = "错误: " + errors + " | 平均延迟: " + avgLatency + "ms";
}

function renderRing(cardId: string, percent: number, unit: string, circumference: number): void {
  const valueEl = document.querySelector("#" + cardId + " .metric-ring-value");
  if (!valueEl) return;
  const pct = Math.min(Math.max(percent, 0), 100);
  valueEl.textContent = String(pct);
  const offset = circumference * (1 - pct / 100);
  const circle = document.querySelector("#" + cardId + " .metric-ring circle:last-child");
  if (circle) circle.setAttribute("stroke-dashoffset", String(offset));
}

// ── Alerts ──────────────────────────────────────────────────────────────────
async function loadAlerts(): Promise<void> {
  const result = await apiCall<any>("GET", "/admin/alerts/history?resolved=false");
  if (!result) return;
  renderAlerts(result.alerts || []);
}

function renderAlerts(alerts: any[]): void {
  const container = req("alerts-container");
  if (!alerts || alerts.length === 0) {
    container.innerHTML = `<div class="empty-state">${ICON_CHECK_CIRCLE} 当前无活跃告警</div>`;
    return;
  }

  container.innerHTML = alerts
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .map((alert) => {
      const acked = alert.acknowledged ? " acknowledged" : "";
      const details: string[] = Array.isArray(alert.details) ? alert.details : [];
      const detailsHtml = details.length
        ? '<div class="alert-details">' + details.map((d) => '<div class="alert-detail-line">' + escHtml(String(d)) + '</div>').join("") + '</div>'
        : "";
      return (
        '<div class="alert-item' + acked + '">' +
          '<div class="alert-info">' +
            '<div class="alert-name">' + escHtml(alert.message || alert.rule) + '</div>' +
            '<div class="alert-detail">' +
              '开始: ' + formatTime(alert.startedAt) +
              ' | 状态: ' + (alert.acknowledged ? "已确认" : "未确认") +
              (alert.notifyCount ? ' | 已通知 ' + alert.notifyCount + ' 次' : '') +
            '</div>' +
            detailsHtml +
          '</div>' +
          (!alert.acknowledged
            ? '<button class="btn btn-outline btn-sm" data-action="ack-alert" data-id="' + escHtmlAttr(alert.id) + '">确认</button>'
            : '') +
        '</div>'
      );
    })
    .join("");
}

async function acknowledgeAlert(id: string): Promise<void> {
  const result = await apiCall<any>("POST", "/admin/alerts/" + id + "/ack");
  if (result && result.success) void loadAlerts();
}

// ── Users ───────────────────────────────────────────────────────────────────
async function loadUsers(): Promise<void> {
  const result = await apiCall<any>("GET", "/admin/users");
  if (!result) return;
  renderUsers(result.users || []);
}

function renderUsers(users: any[]): void {
  const container = req("users-container");
  if (!users || users.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无用户</div>';
    return;
  }

  const rows = users.map((u) => {
    const disabled = u.disabled ? ' disabled-row' : '';
    const roleBadge = u.role === "admin" ? '<span class="badge badge-admin">管理员</span>' : '<span class="badge badge-user">用户</span>';
    const statusBadge = u.disabled ? '<span class="badge badge-disabled">已禁用</span>' : '<span class="badge badge-active">正常</span>';
    const toggleText = u.disabled ? "启用" : "禁用";
    const toggleClass = u.disabled ? "btn-success" : "btn-warning";
    const isSelf = u.email === getCurrentUser()?.email;
    // 管理员账号（含当前登录的自己）受后端保护，点禁用/删除只会拿到 400，
    // 所以这里直接置灰并用 tooltip 说明原因 —— 不隐藏，是为了让人知道这里本可以操作。
    const lockedReason = isSelf
      ? "不能操作当前登录的账号"
      : u.role === "admin"
        ? "管理员账号受保护，不能被停用或删除"
        : "";
    const toggleBtn = lockedReason
      ? '<button class="btn btn-outline btn-sm" disabled title="' + lockedReason + '">' + toggleText + '</button>'
      : '<button class="btn ' + toggleClass + ' btn-sm" data-action="toggle-user" data-email="' + escHtmlAttr(u.email) + '">' + toggleText + '</button>';
    const deleteBtn = lockedReason
      ? '<button class="btn btn-outline btn-sm" disabled title="' + lockedReason + '">删除</button>'
      : '<button class="btn btn-danger btn-sm" data-action="delete-user" data-email="' + escHtmlAttr(u.email) + '">删除</button>';
    return (
      '<tr class="' + disabled + '">' +
        '<td>' + escHtml(u.email) + (isSelf ? ' <span class="badge badge-user">当前账号</span>' : '') + (u.role === "admin" && !isSelf ? ' <span class="badge badge-admin" title="管理员账号受保护">受保护</span>' : '') + '</td>' +
        '<td>' + roleBadge + '</td>' +
        '<td>' + formatTime(u.createdAt) + '</td>' +
        '<td>' + (u.lastLogin ? formatTime(u.lastLogin) : "从未") + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td class="row-actions">' + toggleBtn +
          '<button class="btn btn-outline btn-sm" data-action="reset-password" data-email="' + escHtmlAttr(u.email) + '">重置密码</button>' +
          deleteBtn +
        '</td>' +
      '</tr>'
    );
  }).join("");

  container.innerHTML =
    '<table class="data-table">' +
      '<thead><tr><th>邮箱</th><th>角色</th><th>创建时间</th><th>最后登录</th><th>状态</th><th>操作</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>';
}

async function deleteUser(email: string): Promise<void> {
  if (email === getCurrentUser()?.email) {
    setGlobalAdminNotice("不能删除当前登录的账号。");
    return;
  }
  // 一个输入框同时表达两种强度，避免误触不可恢复的清理。
  const typed = window.prompt(
    `删除账号：${email}\n\n` +
      `· 输入 DELETE      —— 只删除账号，保留其表情包与记录\n` +
      `· 输入 DELETE ALL  —— 删除账号，并清理全部数据（名下包/素材、用量与监控记录）\n\n` +
      `此操作不可恢复，请谨慎操作。`
  );
  if (typed === null) return;
  const choice = typed.trim().toUpperCase();
  const purge = choice === "DELETE ALL";
  if (choice !== "DELETE" && !purge) return;

  const status = byId("users-status");
  setStatusMsg(status, "info", "正在删除账号…", ICON_CLOCK);
  const result = await apiCall<any>(
    "DELETE",
    `/admin/users/${encodeURIComponent(email)}?purge=${purge ? "true" : "false"}`
  );
  if (!result) {
    setStatusMsg(status, "error", `删除 ${email} 失败`, ICON_CROSS);
    return;
  }
  const s = result.summary || {};
  const detail = purge
    ? `，清理 ${s.packs || 0} 个包、${s.orphanAssets || 0} 张散图` +
      `${s.reclaimedBytes ? `（回收 ${mbText(s.reclaimedBytes)}）` : ""}` +
      `、用量 ${s.usageRecords || 0} 条、监控 ${s.monitorRecords || 0} 条`
    : "（仅删除账号）";
  setStatusMsg(status, "success", `已删除 ${email}${detail}`, ICON_CHECK);
  void loadUsers();
}

async function toggleUser(email: string): Promise<void> {
  // 双保险：按钮已禁用，这里再挡一次（键盘/程序化触发也拦得住）
  if (email === getCurrentUser()?.email) {
    setGlobalAdminNotice("不能禁用当前登录的账号，否则会立刻失去后台访问权限。");
    return;
  }
  const result = await apiCall("POST", "/admin/users/" + encodeURIComponent(email) + "/toggle");
  if (result) void loadUsers();
}

/** 读取当前登录用户（localStorage 里的 easysticker_user）。 */
function getCurrentUser(): any | null {
  try {
    const raw = localStorage.getItem("easysticker_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ── Stats ───────────────────────────────────────────────────────────────────
//
// 数据来源：/admin/usage（按用户的用量汇总）+ /admin/monitoring/metrics（原始采样）。
// 与旧版的区别：不再画「最近 100 条原始记录」那种随请求节奏跳动的噪声线，
// 而是按分钟聚合成吞吐/分位延迟/资源占用，并补齐坐标轴、图例与悬浮读数。

async function loadStats(): Promise<void> {
  const from = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
  const [usage, requests, system] = await Promise.all([
    apiCall<any>("GET", "/admin/usage"),
    apiCall<any>("GET", `/admin/monitoring/metrics?type=request&from=${from}&limit=2000`),
    apiCall<any>("GET", `/admin/monitoring/metrics?type=system&from=${from}&limit=2000`)
  ]);
  const summaries: any[] = usage?.summaries || [];
  renderStatsOverview(summaries);
  renderUserUsage(summaries);
  renderRequestStats(requests?.records || []);
  renderSystemStats(system?.records || []);
}

/**
 * KPI 概览。
 * 旧实现把「所有用户的今日生成数」当分母、「所有用户的累计成功数」当分子算成功率，
 * 两个口径完全不同，得出来的百分比没有意义。这里今日/累计各算各的。
 */
function renderStatsOverview(summaries: any[]): void {
  let todayGen = 0;
  let todayOk = 0;
  let todayFail = 0;
  let totalGen = 0;
  let totalOk = 0;
  let totalFail = 0;

  for (const s of summaries) {
    const tg = s.todayGenerated || 0;
    const tok = s.todaySuccess ?? roundNum(tg * (s.todaySuccessRate ?? s.successRate ?? 0));
    const tot = s.totalGenerated || 0;
    const took = s.totalSuccess ?? roundNum(tot * (s.successRate || 0));
    todayGen += tg;
    todayOk += Math.min(tok, tg);
    todayFail += Math.max(tg - tok, 0);
    totalGen += tot;
    totalOk += Math.min(took, tot);
    totalFail += Math.max(tot - took, 0);
  }

  const todayRate = todayGen > 0 ? (todayOk / todayGen) * 100 : null;
  const totalRate = totalGen > 0 ? (totalOk / totalGen) * 100 : null;

  setText("stat-today-generated", fmtInt(todayGen));
  setText("stat-today-sub", `成功 ${fmtInt(todayOk)} · 失败 ${fmtInt(todayFail)}`);
  setText("stat-total-generated", fmtInt(totalGen));
  setText("stat-total-sub", `成功 ${fmtInt(totalOk)} · 失败 ${fmtInt(totalFail)}`);
  setText("stat-today-rate", todayRate === null ? "—" : todayRate.toFixed(1) + "%");
  setRateBar("stat-today-rate-bar", todayRate);
  setText("stat-total-rate", totalRate === null ? "—" : totalRate.toFixed(1) + "%");
  setRateBar("stat-total-rate-bar", totalRate);
}

/** 按用户的用量明细：累计用量、成功数、成功率条。 */
function renderUserUsage(summaries: any[]): void {
  const el = byId("stats-users");
  if (!el) return;
  if (!summaries.length) {
    el.innerHTML = '<p class="empty-text">暂无用量数据</p>';
    return;
  }
  const rows = [...summaries]
    .sort((a, b) => (b.totalGenerated || 0) - (a.totalGenerated || 0))
    .map((s) => {
      const total = s.totalGenerated || 0;
      const ok = s.totalSuccess ?? roundNum(total * (s.successRate || 0));
      const rate = total > 0 ? (ok / total) * 100 : null;
      return (
        "<tr>" +
        `<td>${escHtml(s.email)}</td>` +
        `<td class="num">${fmtInt(s.todayGenerated || 0)}</td>` +
        `<td class="num">${fmtInt(total)}</td>` +
        `<td class="num">${fmtInt(ok)}</td>` +
        `<td>${rateBarCell(rate)}</td>` +
        "</tr>"
      );
    })
    .join("");
  el.innerHTML =
    '<table class="data-table"><thead><tr><th>用户</th><th class="num">今日</th><th class="num">累计</th><th class="num">成功</th><th>成功率</th></tr></thead>' +
    `<tbody>${rows}</tbody></table>`;
}

function renderRequestStats(records: any[]): void {
  const reqEl = byId<HTMLElement>("chart-requests");
  const latEl = byId<HTMLElement>("chart-latency");
  if (!reqEl || !latEl) return;

  if (!records.length) {
    reqEl.innerHTML = '<p class="empty-text">近 24 小时暂无请求数据</p>';
    latEl.innerHTML = '<p class="empty-text">近 24 小时暂无请求数据</p>';
    renderRouteStats([]);
    setText("chart-requests-meta", "");
    setText("chart-latency-meta", "");
    return;
  }

  const buckets = new Map<number, { count: number; errors: number; durations: number[] }>();
  for (const r of records) {
    const t = new Date(r.timestamp).getTime();
    if (!Number.isFinite(t)) continue;
    const key = Math.floor(t / 60_000) * 60_000;
    let b = buckets.get(key);
    if (!b) {
      b = { count: 0, errors: 0, durations: [] };
      buckets.set(key, b);
    }
    b.count += 1;
    b.durations.push(Number(r.data?.durationMs) || 0);
    if ((Number(r.data?.status) || 0) >= 400) b.errors += 1;
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const reqPoints = keys.map((k) => ({ ts: k, value: buckets.get(k)!.count }));
  const errPoints = keys.map((k) => ({ ts: k, value: buckets.get(k)!.errors }));
  const p50 = keys.map((k) => ({ ts: k, value: percentile(buckets.get(k)!.durations, 0.5) }));
  const p95 = keys.map((k) => ({ ts: k, value: percentile(buckets.get(k)!.durations, 0.95) }));

  renderTimeSeries(
    reqEl,
    [
      { name: "请求数", color: "var(--c-chart-1)", points: reqPoints, area: true },
      { name: "错误数", color: "var(--c-chart-5)", points: errPoints, dashed: true }
    ],
    { height: 220, yFormat: (v) => fmtInt(v) }
  );
  renderTimeSeries(
    latEl,
    [
      { name: "P50", color: "var(--c-chart-2)", points: p50 },
      { name: "P95", color: "var(--c-chart-3)", points: p95, area: true }
    ],
    { height: 220, yFormat: (v) => `${Math.round(v)} ms` }
  );

  const peak = reqPoints.reduce((m, p) => Math.max(m, p.value), 0);
  setText("chart-requests-meta", `${keys.length} 分钟 · 峰值 ${fmtInt(peak)} 请求/分`);
  const avgP95 = p95.length ? p95.reduce((a, b) => a + b.value, 0) / p95.length : 0;
  const maxP95 = p95.reduce((m, p) => Math.max(m, p.value), 0);
  setText("chart-latency-meta", `P95 均值 ${Math.round(avgP95)} ms · 峰值 ${Math.round(maxP95)} ms`);

  renderRouteStats(records);
}

/** 接口热点表：请求数、占比、平均/P95 延迟、错误数。 */
function renderRouteStats(records: any[]): void {
  const el = byId("stats-routes");
  if (!el) return;
  if (!records.length) {
    el.innerHTML = '<p class="empty-text">暂无接口数据</p>';
    return;
  }
  const map = new Map<string, { count: number; errors: number; durations: number[] }>();
  for (const r of records) {
    const route = `${r.data?.method || ""} ${r.data?.route || ""}`.trim() || "unknown";
    let m = map.get(route);
    if (!m) {
      m = { count: 0, errors: 0, durations: [] };
      map.set(route, m);
    }
    m.count += 1;
    m.durations.push(Number(r.data?.durationMs) || 0);
    if ((Number(r.data?.status) || 0) >= 400) m.errors += 1;
  }
  const total = records.length || 1;
  const rows = [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([route, m]) => {
      const share = (m.count / total) * 100;
      const avg = m.durations.reduce((a, b) => a + b, 0) / m.count;
      const p95 = percentile(m.durations, 0.95);
      return (
        "<tr>" +
        `<td class="mono">${escHtml(route)}</td>` +
        `<td class="num">${fmtInt(m.count)}</td>` +
        `<td>${shareBarCell(share)}</td>` +
        `<td class="num">${Math.round(avg)} ms</td>` +
        `<td class="num${p95 > 1000 ? " warn" : ""}">${Math.round(p95)} ms</td>` +
        `<td class="num${m.errors > 0 ? " danger" : ""}">${fmtInt(m.errors)}</td>` +
        "</tr>"
      );
    })
    .join("");
  el.innerHTML =
    '<table class="data-table"><thead><tr><th>接口</th><th class="num">请求数</th><th>占比</th><th class="num">平均</th><th class="num">P95</th><th class="num">错误</th></tr></thead>' +
    `<tbody>${rows}</tbody></table>`;
}

function renderSystemStats(records: any[]): void {
  const el = byId<HTMLElement>("chart-system");
  if (!el) return;
  if (!records.length) {
    el.innerHTML = '<p class="empty-text">近 24 小时暂无系统采样</p>';
    setText("chart-system-meta", "");
    return;
  }
  const buckets = new Map<number, { cpu: number[]; mem: number[] }>();
  for (const r of records) {
    const t = new Date(r.timestamp).getTime();
    if (!Number.isFinite(t)) continue;
    const key = Math.floor(t / 60_000) * 60_000;
    let b = buckets.get(key);
    if (!b) {
      b = { cpu: [], mem: [] };
      buckets.set(key, b);
    }
    b.cpu.push(Number(r.data?.cpuPercent) || 0);
    b.mem.push(Number(r.data?.memPercent) || 0);
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const cpu = keys.map((k) => ({ ts: k, value: avgNum(buckets.get(k)!.cpu) }));
  const mem = keys.map((k) => ({ ts: k, value: avgNum(buckets.get(k)!.mem) }));

  renderTimeSeries(
    el,
    [
      { name: "CPU", color: "var(--c-chart-1)", points: cpu, area: true },
      { name: "内存", color: "var(--c-chart-4)", points: mem, area: true }
    ],
    { height: 220, yMin: 0, yMax: 100, yFormat: (v) => `${Math.round(v)}%` }
  );

  const lastCpu = cpu.length ? cpu[cpu.length - 1].value : 0;
  const lastMem = mem.length ? mem[mem.length - 1].value : 0;
  const maxCpu = cpu.reduce((m, p) => Math.max(m, p.value), 0);
  setText(
    "chart-system-meta",
    `当前 CPU ${Math.round(lastCpu)}% · 内存 ${Math.round(lastMem)}% · CPU 峰值 ${Math.round(maxCpu)}%`
  );
}

// ── 统计页小工具 ─────────────────────────────────────────────
function setText(id: string, text: string): void {
  const el = byId(id);
  if (el) el.textContent = text;
}

function setRateBar(id: string, rate: number | null): void {
  const el = byId<HTMLElement>(id);
  if (!el) return;
  if (rate === null) {
    el.style.width = "0%";
    return;
  }
  el.style.width = `${Math.min(Math.max(rate, 0), 100)}%`;
  el.style.background = rateColor(rate);
}

function rateColor(rate: number): string {
  if (rate >= 95) return "var(--c-success)";
  if (rate >= 85) return "var(--c-warning)";
  return "var(--c-danger)";
}

function rateBarCell(rate: number | null): string {
  if (rate === null) return '<span class="muted">—</span>';
  const clamped = Math.min(Math.max(rate, 0), 100);
  return (
    '<div class="rate-cell">' +
    `<span class="stat-bar sm"><i style="width:${clamped}%;background:${rateColor(rate)}"></i></span>` +
    `<span class="rate-num">${rate.toFixed(1)}%</span>` +
    "</div>"
  );
}

function shareBarCell(share: number): string {
  const clamped = Math.min(Math.max(share, 0), 100);
  return (
    '<div class="rate-cell">' +
    `<span class="stat-bar sm"><i style="width:${clamped}%;background:var(--c-chart-1)"></i></span>` +
    `<span class="rate-num">${share.toFixed(1)}%</span>` +
    "</div>"
  );
}

/** 分位数（线性插值），用于 P50 / P95。 */
function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function avgNum(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function fmtInt(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}

function roundNum(v: number): number {
  return Math.round(v);
}

// ── Settings ────────────────────────────────────────────────────────────────
async function loadSettings(): Promise<void> {
  const result = await apiCall<any>("GET", "/admin/settings");
  if (!result) return;
  req<HTMLInputElement>("setting-webhook-url").value = result.webhookUrl || "";
  req<HTMLInputElement>("setting-webhook-enabled").checked = !!result.webhookEnabled;
  req<HTMLInputElement>("setting-retention").value = result.monitorRetentionDays || 7;
  req<HTMLInputElement>("setting-notification-interval").value = String(result.notificationInterval ?? 60_000);
}

async function saveSettings(): Promise<void> {
  const body = {
    webhookUrl: req<HTMLInputElement>("setting-webhook-url").value.trim(),
    webhookEnabled: req<HTMLInputElement>("setting-webhook-enabled").checked,
    monitorRetentionDays: parseInt(req<HTMLInputElement>("setting-retention").value, 10) || 7,
    notificationInterval: parseInt(req<HTMLInputElement>("setting-notification-interval").value, 10) || 60_000
  };
  const result = await apiCall("PUT", "/admin/settings", body);
  const msg = req("settings-msg");
  if (result && !(result as any).error) setStatusMsg(msg, "success", "设置已保存", ICON_CHECK);
  else setStatusMsg(msg, "error", "保存失败", ICON_CROSS);
  setTimeout(() => clearStatusMsg(msg), 3000);
}

// ── AI providers ────────────────────────────────────────────────────────────
let aiProvidersState: any[] = [];
let aiDefaultProvider = "mock";

async function loadAiProviders(): Promise<void> {
  const result = await apiCall<any>("GET", "/admin/ai/providers");
  if (!result) return;
  aiProvidersState = result.providers || [];
  aiDefaultProvider = result.defaultProvider || "mock";
  renderAiProviders();
}

function renderAiProviders(): void {
  const container = byId("ai-providers-container");
  if (!container) return;
  if (!aiProvidersState.length) {
    container.innerHTML = '<div class="empty-state">暂无 provider</div>';
    return;
  }
  container.innerHTML = aiProvidersState.map((p) => {
    const isDefault = p.id === aiDefaultProvider;
    const isMock = p.type === "mock";
    const status = isMock
      ? '<span class="badge badge-muted">本地模拟</span>'
      : (p.ready
        ? `<span class="badge badge-ok">${ICON_CHECK} 可用</span>`
        : `<span class="badge badge-warn">${ICON_WARN} 缺少 Key</span>`);
    const fields = isMock ? "" : (
      '<div class="ai-provider-fields">' +
        '<div class="input-group"><label>模型</label><input type="text" data-field="model" value="' + escHtmlAttr(p.model || "") + '" placeholder="如 doubao-seedream-5-0-flash-260915"></div>' +
        '<div class="input-group"><label>Base URL</label><input type="text" data-field="baseUrl" value="' + escHtmlAttr(p.baseUrl || "") + '" placeholder="https://..."></div>' +
        (p.type === "openai"
          ? '<div class="input-group"><label>Variant</label><input type="text" data-field="variant" value="' + escHtmlAttr(p.variant || "") + '" placeholder="gpt-image / generic"></div>' +
            '<div class="input-group"><label>尺寸</label><input type="text" data-field="size" value="' + escHtmlAttr(p.size || "") + '" placeholder="留空 = 用默认尺寸"></div>'
          : "") +
        '<div class="input-group"><label>API Key</label><input type="password" data-field="apiKey" autocomplete="off" placeholder="' + (p.hasKey ? "已配置（留空则不修改）" : "未配置，粘贴你的 Key") + '"></div>' +
      '</div>'
    );
    return (
      '<div class="ai-provider-card' + (isDefault ? " is-default" : "") + '" data-id="' + escHtmlAttr(p.id) + '">' +
        '<div class="ai-provider-head">' +
          '<div class="ai-provider-title"><strong>' + escHtml(p.name) + '</strong> <code>' + escHtml(p.id) + '</code> ' + status +
            (isDefault ? ' <span class="badge badge-default">默认</span>' : "") + '</div>' +
          '<div class="ai-provider-actions">' +
            (isMock || isDefault ? "" : '<button type="button" class="btn btn-ghost btn-sm" data-action="set-default" data-id="' + escHtmlAttr(p.id) + '">设为默认</button>') +
            (isMock ? "" : '<button type="button" class="btn btn-ghost btn-sm" data-action="test-provider" data-id="' + escHtmlAttr(p.id) + '">测试</button>') +
          '</div>' +
        '</div>' +
        fields +
      '</div>'
    );
  }).join("");
}

async function saveAiProviders(): Promise<void> {
  const providers: Record<string, any> = {};
  document.querySelectorAll<HTMLElement>(".ai-provider-card").forEach((card) => {
    const id = card.dataset.id || "";
    const p: Record<string, any> = {};
    card.querySelectorAll<HTMLInputElement>("[data-field]").forEach((input) => {
      const field = input.dataset.field!;
      const value = input.value.trim();
      if (field === "apiKey") {
        if (value) p.apiKey = value;
      } else if (value !== "") {
        p[field] = value;
      }
    });
    if (Object.keys(p).length) providers[id] = p;
  });

  const result = await apiCall<any>("PUT", "/admin/ai/providers", { defaultProvider: aiDefaultProvider, providers });
  const msg = req("ai-msg");
  if (result && !(result as any).error) {
    aiProvidersState = result.providers || [];
    aiDefaultProvider = result.defaultProvider || "mock";
    renderAiProviders();
    setStatusMsg(msg, "success", "AI 配置已保存", ICON_CHECK);
  } else {
    setStatusMsg(msg, "error", "保存失败", ICON_CROSS);
  }
  setTimeout(() => clearStatusMsg(msg), 4000);
}

async function testAiProvider(id: string): Promise<void> {
  const msg = req("ai-msg");
  setStatusMsg(msg, "info", "测试中（真实调用一次，请稍候）…", ICON_CLOCK);
  const result = await apiCall<any>("POST", "/admin/ai/test", { providerId: id });
  if (result && result.ok) {
    setStatusMsg(msg, "success", `${id} 连通正常（${result.ms}ms，${result.bytes} bytes）`, ICON_CHECK);
  } else {
    setStatusMsg(msg, "error", `${id} 测试失败：${result?.error || "未知错误"}`, ICON_CROSS);
  }
  setTimeout(() => clearStatusMsg(msg), 8000);
}

// ── Alert rules ─────────────────────────────────────────────────────────────
async function loadAlertRules(): Promise<void> {
  const result = await apiCall<any>("GET", "/admin/alerts/rules");
  if (!result) return;
  renderAlertRules(result.rules || []);
}

function renderAlertRules(rules: any[]): void {
  const container = req("alert-rules-container");
  if (!rules || rules.length === 0) { container.innerHTML = '<div class="empty-state">暂无告警规则</div>'; return; }
  container.innerHTML = rules.map((rule, idx) => {
    const metricLabel = getMetricLabel(rule.metric);
    return (
      '<div class="rule-card">' +
        '<div class="rule-info"><div class="rule-name">' + escHtml(rule.name) + '</div><div class="rule-meta">指标: ' + metricLabel + '</div></div>' +
        '<div class="rule-controls">' +
          '<div><label>阈值</label><input type="number" class="rule-threshold" data-idx="' + idx + '" value="' + rule.threshold + '" step="any"></div>' +
          '<div><label>持续(s)</label><input type="number" class="rule-duration" data-idx="' + idx + '" value="' + rule.duration + '" step="1" min="1"></div>' +
          '<div><label>静默(ms)</label><input type="number" class="rule-silence" data-idx="' + idx + '" value="' + rule.silenceMs + '" step="1000" min="0"></div>' +
          '<label class="checkbox-wrap"><input type="checkbox" class="rule-enabled" data-idx="' + idx + '"' + (rule.enabled ? " checked" : "") + '>启用</label>' +
        '</div>' +
      '</div>'
    );
  }).join("");
}

function getMetricLabel(metric: string): string {
  const labels: Record<string, string> = {
    "cpu.percent": "CPU 使用率",
    "errorRate": "错误率",
    "disk.usedMb": "磁盘用量 (MB)",
    "avgLatencyMs": "平均延迟 (ms)",
    "requestsPerMinute": "每分钟请求数"
  };
  return labels[metric] || metric;
}

async function saveAlertRules(): Promise<void> {
  const result = await apiCall<any>("GET", "/admin/alerts/rules");
  if (!result || !result.rules) return;
  const rules = result.rules.map((rule: any, idx: number) => {
    const thresholdInput = document.querySelector<HTMLInputElement>(".rule-threshold[data-idx='" + idx + "']");
    const durationInput = document.querySelector<HTMLInputElement>(".rule-duration[data-idx='" + idx + "']");
    const silenceInput = document.querySelector<HTMLInputElement>(".rule-silence[data-idx='" + idx + "']");
    const enabledInput = document.querySelector<HTMLInputElement>(".rule-enabled[data-idx='" + idx + "']");
    return {
      ...rule,
      threshold: thresholdInput ? parseFloat(thresholdInput.value) : rule.threshold,
      duration: durationInput ? parseInt(durationInput.value, 10) || rule.duration : rule.duration,
      silenceMs: silenceInput ? parseInt(silenceInput.value, 10) || rule.silenceMs : rule.silenceMs,
      enabled: enabledInput ? enabledInput.checked : rule.enabled
    };
  });
  const saveResult = await apiCall("PUT", "/admin/alerts/rules", { rules });
  const msg = req("rules-msg");
  if (saveResult && !(saveResult as any).error) { setStatusMsg(msg, "success", "规则已保存", ICON_CHECK); void loadAlertRules(); }
  else setStatusMsg(msg, "error", "保存失败", ICON_CROSS);
  setTimeout(() => clearStatusMsg(msg), 3000);
}

// ── Password reset ──────────────────────────────────────────────────────────
function showResetPassword(email: string): void {
  const newPassword = prompt('为 "' + email + '" 设置新密码（至少6个字符）：');
  if (!newPassword || newPassword.length < 6) {
    if (newPassword) alert("密码至少6个字符");
    return;
  }
  void resetPassword(email, newPassword);
}

async function resetPassword(email: string, newPassword: string): Promise<void> {
  const result = await apiCall<any>("POST", "/auth/reset-password", { email, newPassword });
  if (result && result.success) alert("密码已重置");
  else alert("重置失败: " + (result?.message || "请重试"));
}

// ── Utils ───────────────────────────────────────────────────────────────────
function escHtml(str: unknown): string {
  const s = typeof str === "string" ? str : String(str);
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
function escHtmlAttr(str: unknown): string {
  const s = typeof str === "string" ? str : String(str);
  return s.replace(/'/g, "&apos;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function formatTime(isoStr: string): string {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return isoStr; }
}

// ── 存储 ────────────────────────────────────────────────────────────────────
const MB = 1024 * 1024;
const mbText = (bytes: number) => `${(Number(bytes || 0) / MB).toFixed(2)} MB`;

async function loadStorage(withFeedback = false): Promise<void> {
  const status = byId("storage-status");
  const btn = byId<HTMLButtonElement>("storage-refresh-btn");
  if (withFeedback) {
    setStatusMsg(status, "info", "正在体检…", ICON_CLOCK);
    if (btn) btn.disabled = true;
  }
  try {
    const data = await apiCall<any>("GET", "/admin/storage");
    if (!data?.report) {
      // 以前这里直接 return，体检失败时界面毫无反应，这也是「点了没效果」的来源之一。
      if (withFeedback) setStatusMsg(status, "error", "体检失败，请查看顶部提示后重试", ICON_CROSS);
      return;
    }
    renderStorage(data.report, data.packs || [], data.retentionDays || 0, data.retentionStartedAt || null);
    if (withFeedback) {
      setStatusMsg(status, "success", `体检完成 · ${new Date().toLocaleTimeString()}`, ICON_CHECK);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function selectedPackIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>("#storage-packs .pack-check:checked"))
    .map((el) => el.dataset.packId || "")
    .filter(Boolean);
}

/** 同步「全选」勾选态、批量按钮与已选计数。表格每次重建后都要调一次。 */
function updateSelectionUi(): void {
  const boxes = Array.from(document.querySelectorAll<HTMLInputElement>("#storage-packs .pack-check"));
  const checked = boxes.filter((box) => box.checked);
  const selectAll = byId<HTMLInputElement>("storage-select-all");
  if (selectAll) {
    selectAll.checked = boxes.length > 0 && checked.length === boxes.length;
    selectAll.indeterminate = checked.length > 0 && checked.length < boxes.length;
  }
  const btn = byId<HTMLButtonElement>("storage-delete-selected-btn");
  if (btn) {
    btn.disabled = checked.length === 0;
    btn.textContent = checked.length ? `删除选中（${checked.length}）` : "删除选中";
  }
  const info = byId("storage-selection-info");
  if (info) info.textContent = checked.length ? `已选 ${checked.length} / ${boxes.length} 个` : "";
}

function renderStorage(report: any, packs: any[], retentionDays = 0, retentionStartedAt: string | null = null): void {
  const grid = byId("storage-metrics");
  if (grid) {
    const cards: Array<[string, string, string]> = [
      ["包数量", String(report.packs?.total ?? 0), `${report.packs?.legacyZips ?? 0} 个仍是整包 ZIP`],
      ["包占用", mbText(report.packs?.bytes), "清单 + 残留的旧 ZIP"],
      ["素材数量", String(report.uploads?.total ?? 0), "data/uploads"],
      ["素材占用", mbText(report.uploads?.bytes), "所有生成/上传的图片"],
      ["待压缩旧包", `${report.compacted?.count ?? 0} 个`, mbText(report.compacted?.bytes)],
      ["可回收孤儿素材", `${report.orphanAssets?.count ?? 0} 个`, mbText(report.orphanAssets?.bytes)],
      ["可回收备份", `${report.origBackups?.count ?? 0} 个`, mbText(report.origBackups?.bytes)],
      [
        "包保留期",
        retentionDays > 0 ? `${retentionDays} 天` : "不清理",
        retentionDays > 0
          ? `自 ${retentionStartedAt ? formatTime(retentionStartedAt) : "未知"} 起算（不追溯既往数据）`
          : "只做压缩旧包 / 清孤儿素材"
      ],
      ["合计可回收", mbText(report.reclaimedBytes), "下次自动巡检会清理"]
    ];
    grid.innerHTML = cards
      .map(
        ([label, value, hint]) => `
      <div class="storage-card">
        <div class="storage-card-label">${escHtml(label)}</div>
        <div class="storage-card-value">${escHtml(value)}</div>
        <div class="storage-card-hint">${escHtml(hint)}</div>
      </div>`
      )
      .join("");
  }

  const countEl = byId("storage-pack-count");
  if (countEl) countEl.textContent = packs.length ? `共 ${packs.length} 个` : "";

  const list = byId("storage-packs");
  if (!list) return;
  if (!packs.length) {
    list.innerHTML = '<p class="empty-text">还没有任何包</p>';
    updateSelectionUi();
    return;
  }
  list.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th class="col-check"><input type="checkbox" id="storage-select-all" aria-label="全选" /></th>
        <th>标题</th><th>贴纸</th><th>占用</th><th>创建时间</th><th>保存方式</th><th>操作</th>
      </tr></thead>
      <tbody>
        ${packs
          .map(
            (p) => `<tr>
          <td class="col-check"><input type="checkbox" class="pack-check" data-pack-id="${escHtml(p.packId)}" aria-label="选择 ${escHtml(p.title || p.packId)}" /></td>
          <td>${escHtml(p.title || p.packId)}</td>
          <td>${p.stickerCount || "-"}</td>
          <td>${mbText(p.bytes)}</td>
          <td>${escHtml(formatTime(p.createdAt))}${p.expiresAt ? `<br><span class="section-desc">${escHtml(formatTime(p.expiresAt))} 清理</span>` : ""}</td>
          <td>${p.hasZip ? "旧 ZIP" : "清单"}${p.owner ? `<br><span class="section-desc">${escHtml(p.owner)}</span>` : ""}</td>
          <td><button class="btn btn-outline btn-sm" data-action="delete-pack" data-pack-id="${escHtml(p.packId)}">删除</button></td>
        </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
  updateSelectionUi();
}

async function runStorageGc(): Promise<void> {
  const status = byId("storage-status");
  const btn = byId<HTMLButtonElement>("storage-gc-btn");
  setStatusMsg(status, "info", "正在清理…", ICON_CLOCK);
  if (btn) btn.disabled = true;
  try {
    const res = await apiCall<any>("POST", "/admin/storage/gc", { dryRun: false });
    if (!res?.report) {
      setStatusMsg(status, "error", "清理失败，请查看顶部提示后重试", ICON_CROSS);
      return;
    }
    const r = res.report;
    const reclaimed = (r.compacted?.count ?? 0) + (r.orphanAssets?.count ?? 0) + (r.origBackups?.count ?? 0);
    if (reclaimed === 0) {
      // 没有可回收内容时给出明确结论，避免被误认为「点了没反应」。
      setStatusMsg(status, "info", "没有可回收的内容（无需清理）", ICON_CHECK_CIRCLE);
    } else {
      setStatusMsg(
        status,
        "success",
        `已清理：压缩旧包 ${r.compacted.count} 个、孤儿素材 ${r.orphanAssets.count} 个、备份 ${r.origBackups.count} 个，回收 ${mbText(r.reclaimedBytes)}`,
        ICON_CHECK
      );
    }
    await loadStorage();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deletePack(packId: string): Promise<void> {
  const confirmed = window.confirm(
    `确定删除包 ${packId}？\n\n会删除它的清单（及残留 ZIP），并回收不再被引用的素材。此操作不可恢复。`
  );
  if (!confirmed) return;

  const status = byId("storage-status");
  setStatusMsg(status, "info", "正在删除…", ICON_CLOCK);
  const res = await apiCall<any>("DELETE", `/admin/packs/${encodeURIComponent(packId)}`);
  if (!res) {
    setStatusMsg(status, "error", `删除 ${packId} 失败`, ICON_CROSS);
    return;
  }
  const reclaimed = Number(res.reclaimedBytes) || 0;
  setStatusMsg(
    status,
    "success",
    `已删除 ${packId}${reclaimed > 0 ? `，回收 ${mbText(reclaimed)}` : ""}`,
    ICON_CHECK
  );
  await loadStorage();
}

async function deleteSelectedPacks(): Promise<void> {
  const ids = selectedPackIds();
  if (!ids.length) return;

  const total = document.querySelectorAll("#storage-packs .pack-check").length;
  const deletingAll = total > 0 && ids.length === total;

  // 选满即等于「删除全部」，要求手动输入关键字，避免误点。
  if (deletingAll) {
    const typed = window.prompt(
      `你正在删除全部 ${ids.length} 个包，此操作不可恢复。\n请输入 DELETE 确认：`
    );
    if (typed?.trim().toUpperCase() !== "DELETE") return;
  } else if (
    !window.confirm(
      `确定删除选中的 ${ids.length} 个包？\n\n会删除它们的清单（及残留 ZIP），并回收不再被引用的素材。此操作不可恢复。`
    )
  ) {
    return;
  }

  const status = byId("storage-status");
  const btn = byId<HTMLButtonElement>("storage-delete-selected-btn");
  setStatusMsg(status, "info", `正在删除 ${ids.length} 个包…`, ICON_CLOCK);
  if (btn) btn.disabled = true;
  try {
    const res = await apiCall<any>("POST", "/admin/packs/bulk-delete", { packIds: ids });
    if (!res?.deleted) {
      setStatusMsg(status, "error", "批量删除失败，请查看顶部提示后重试", ICON_CROSS);
      return;
    }
    const failed = (res.missing?.length ?? 0) + (res.errors?.length ?? 0);
    const reclaimed = Number(res.reclaimedBytes) || 0;
    setStatusMsg(
      status,
      failed ? "warning" : "success",
      `已删除 ${res.deleted.length} 个包${reclaimed > 0 ? `，回收 ${mbText(reclaimed)}` : ""}${failed ? `，${failed} 个未删除` : ""}`,
      failed ? ICON_WARN : ICON_CHECK
    );
    await loadStorage();
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Mount / event binding ───────────────────────────────────────────────────
export function mountAdmin(): void {
  initTheme();
  checkAuth();

  req("login-btn").addEventListener("click", () => void login());
  req("logout-btn").addEventListener("click", logout);
  req("load-alerts-btn").addEventListener("click", () => void loadAlerts());
  req("load-users-btn").addEventListener("click", () => void loadUsers());
  req("save-settings-btn").addEventListener("click", () => void saveSettings());
  req("save-rules-btn").addEventListener("click", () => void saveAlertRules());
  req("save-ai-btn").addEventListener("click", () => void saveAiProviders());
  byId("storage-refresh-btn")?.addEventListener("click", () => void loadStorage(true));
  byId("storage-gc-btn")?.addEventListener("click", () => void runStorageGc());
  byId("storage-packs")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest?.("[data-action='delete-pack']") as HTMLElement | null;
    if (btn?.dataset.packId) void deletePack(btn.dataset.packId);
  });
  // 全选框与行内复选框都用 change 事件冒泡到容器上委派：
  // 表格每次 renderStorage 都会重建，直接绑在元素上的监听会丢。
  byId("storage-packs")?.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement | null;
    if (!target) return;
    if (target.id === "storage-select-all") {
      document
        .querySelectorAll<HTMLInputElement>("#storage-packs .pack-check")
        .forEach((box) => { box.checked = target.checked; });
    }
    if (target.id === "storage-select-all" || target.classList.contains("pack-check")) {
      updateSelectionUi();
    }
  });
  byId("storage-delete-selected-btn")?.addEventListener("click", () => void deleteSelectedPacks());
  req("ai-providers-container").addEventListener("click", (e) => {
    const target = (e.target as HTMLElement | null)?.closest?.("[data-action]") as HTMLElement | null;
    if (!target) return;
    const id = target.dataset.id || "";
    if (target.dataset.action === "set-default") { aiDefaultProvider = id; renderAiProviders(); }
    else if (target.dataset.action === "test-provider") void testAiProvider(id);
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab((btn as HTMLElement).dataset.tab || "dashboard"));
  });

  // 页面/浏览器标签页被隐藏时断掉长连接：没人看仪表盘就不该继续推数据，
  // 也避免后台标签页被浏览器限制后留下一堆半死的连接。
  document.addEventListener("visibilitychange", () => {
    const active = document.querySelector(".tab-btn.active") as HTMLElement | null;
    if (document.hidden) {
      stopLiveUpdates();
    } else if (active?.dataset.tab === "dashboard") {
      startLiveUpdates();
    }
  });
  window.addEventListener("pagehide", stopLiveUpdates);

  req("login-password").addEventListener("keydown", (e) => { if (e.key === "Enter") void login(); });
  req("login-email").addEventListener("keydown", (e) => {
    if (e.key === "Enter") req("login-password").focus();
  });

  // Delegated handlers (replaces the CSP-blocked inline onclick).
  req("alerts-container").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest?.("[data-action='ack-alert']") as HTMLElement | null;
    if (btn) void acknowledgeAlert(btn.dataset.id || "");
  });
  req("users-container").addEventListener("click", (e) => {
    const target = (e.target as HTMLElement | null)?.closest?.("[data-action]") as HTMLElement | null;
    if (!target) return;
    const email = target.dataset.email || "";
    if (target.dataset.action === "toggle-user") void toggleUser(email);
    else if (target.dataset.action === "reset-password") showResetPassword(email);
    else if (target.dataset.action === "delete-user") void deleteUser(email);
  });
}
