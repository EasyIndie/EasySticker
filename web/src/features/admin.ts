/**
 * Admin panel (P5) — TS port of the former public/admin.js.
 * Self-contained: talks to /api/admin/* and shares the auth token with the
 * main app via localStorage. Inline onclick handlers were replaced by
 * data-action + event delegation to satisfy the CSP.
 */

const API_BASE = "/api";
let _refreshTimer: ReturnType<typeof setInterval> | null = null;

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
  tone: "success" | "error" | "info",
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
    const res = await fetch(API_BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) {
      logout();
      return null;
    }
    return res.json() as Promise<T>;
  } catch (err) {
    console.error("API call failed:", method, path, err);
    return null;
  }
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
  try { if (_refreshTimer) clearInterval(_refreshTimer); } catch { /* ignore */ }
  _refreshTimer = null;
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
  startAutoRefresh();
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
    case "dashboard": void loadDashboard(); break;
    case "users": void loadUsers(); break;
    case "stats": void loadStats(); break;
    case "settings": void loadSettings(); void loadAlertRules(); void loadAiProviders(); break;
  }
}

function startAutoRefresh(): void {
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => {
    const active = document.querySelector(".tab-btn.active") as HTMLElement | null;
    if (active && active.dataset.tab === "dashboard") void loadDashboard();
  }, 15000);
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
      return (
        '<div class="alert-item' + acked + '">' +
          '<div class="alert-info">' +
            '<div class="alert-name">' + escHtml(alert.message || alert.rule) + '</div>' +
            '<div class="alert-detail">' +
              '当前值: ' + escHtml(String(alert.value)) +
              ' | 开始: ' + formatTime(alert.startedAt) +
              ' | 状态: ' + (alert.acknowledged ? "已确认" : "未确认") +
            '</div>' +
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
    return (
      '<tr class="' + disabled + '">' +
        '<td>' + escHtml(u.email) + '</td>' +
        '<td>' + roleBadge + '</td>' +
        '<td>' + formatTime(u.createdAt) + '</td>' +
        '<td>' + (u.lastLogin ? formatTime(u.lastLogin) : "从未") + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td><button class="btn ' + toggleClass + ' btn-sm" data-action="toggle-user" data-email="' + escHtmlAttr(u.email) + '">' + toggleText + '</button></td>' +
        '<td><button class="btn btn-outline btn-sm" data-action="reset-password" data-email="' + escHtmlAttr(u.email) + '">重置密码</button></td>' +
      '</tr>'
    );
  }).join("");

  container.innerHTML =
    '<table class="data-table">' +
      '<thead><tr><th>邮箱</th><th>角色</th><th>创建时间</th><th>最后登录</th><th>状态</th><th>操作</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>';
}

async function toggleUser(email: string): Promise<void> {
  const result = await apiCall("POST", "/admin/users/" + encodeURIComponent(email) + "/toggle");
  if (result) void loadUsers();
}

// ── Stats ───────────────────────────────────────────────────────────────────
async function loadStats(): Promise<void> {
  const usage = await apiCall<any>("GET", "/admin/usage");
  if (usage && usage.summaries) renderStatsOverview(usage.summaries);
  void loadRequestChart();
  void loadSystemChart();
}

function renderStatsOverview(summaries: any[]): void {
  let totalGenerated = 0;
  let totalSuccess = 0;
  let totalFail = 0;
  for (const s of summaries) {
    totalGenerated += s.todayGenerated || 0;
    totalSuccess += s.totalGenerated ? Math.round(s.totalGenerated * (s.successRate || 0)) : 0;
    totalFail += s.todayGenerated ? s.todayGenerated - Math.round(s.todayGenerated * (s.successRate || 0)) : 0;
  }
  const rate = totalGenerated > 0 ? ((totalSuccess / totalGenerated) * 100).toFixed(1) + "%" : "N/A";
  req("stat-total-generated").textContent = String(totalGenerated);
  req("stat-total-success").textContent = String(totalSuccess);
  req("stat-total-fail").textContent = String(totalFail);
  req("stat-total-rate").textContent = rate;
}

async function loadRequestChart(): Promise<void> {
  const result = await apiCall<any>("GET", "/admin/monitoring/metrics?type=request&limit=100");
  if (!result || !result.records || result.records.length === 0) {
    req("chart-requests-empty").style.display = "block";
    req("chart-requests").innerHTML = "";
    return;
  }
  req("chart-requests-empty").style.display = "none";
  const points = result.records.map((r: any) => ({ ts: new Date(r.timestamp).getTime(), value: r.data.durationMs || 0 }));
  renderLineChart("chart-requests", points, 700, 200, "#4A90D9");
}

async function loadSystemChart(): Promise<void> {
  const result = await apiCall<any>("GET", "/admin/monitoring/metrics?type=system&limit=100");
  if (!result || !result.records || result.records.length === 0) {
    req("chart-system-empty").style.display = "block";
    req("chart-system").innerHTML = "";
    return;
  }
  req("chart-system-empty").style.display = "none";
  const records = result.records;
  const cpuPoints = records.map((r: any) => ({ ts: new Date(r.timestamp).getTime(), value: r.data.cpuPercent || 0 }));
  const memPoints = records.map((r: any) => ({ ts: new Date(r.timestamp).getTime(), value: r.data.memPercent || 0 }));
  renderMultiLineChart("chart-system", [cpuPoints, memPoints], 700, 200, ["#4A90D9", "#52C41A"]);
}

// ── SVG charts ──────────────────────────────────────────────────────────────
type Point = { ts: number; value: number };

function renderLineChart(svgId: string, dataPoints: Point[], width: number, height: number, color: string): void {
  if (!dataPoints || dataPoints.length < 2) { req(svgId).innerHTML = ""; return; }
  const pts = normalizePoints(dataPoints, width, height);
  const pointsStr = pts.map((p) => p.x + "," + p.y).join(" ");
  const areaStr = "0," + height + " " + pointsStr + " " + (pts.length > 0 ? pts[pts.length - 1].x + "," + height : "");
  const svg =
    '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '">' +
      '<defs><linearGradient id="area-' + svgId + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.2"/>' +
        '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/>' +
      '</linearGradient></defs>' +
      '<line x1="0" y1="0" x2="' + width + '" y2="0" stroke="#eee" stroke-width="1"/>' +
      '<line x1="0" y1="' + (height / 2) + '" x2="' + width + '" y2="' + (height / 2) + '" stroke="#eee" stroke-width="1"/>' +
      '<line x1="0" y1="' + height + '" x2="' + width + '" y2="' + height + '" stroke="#eee" stroke-width="1"/>' +
      '<polygon points="' + areaStr + '" fill="url(#area-' + svgId + ')"/>' +
      '<polyline points="' + pointsStr + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>' +
      pts.map((p) => '<circle cx="' + p.x + '" cy="' + p.y + '" r="2.5" fill="' + color + '"/>').join(" ") +
    '</svg>';
  req(svgId).innerHTML = svg;
}

function renderMultiLineChart(svgId: string, series: Point[][], width: number, height: number, colors: string[]): void {
  if (!series || series.length === 0 || series.every((s) => s.length < 2)) { req(svgId).innerHTML = ""; return; }
  const allTimestamps: number[] = [];
  const allValues: number[] = [];
  for (const s of series) for (const p of s) { allTimestamps.push(p.ts); allValues.push(p.value); }
  if (allTimestamps.length === 0) { req(svgId).innerHTML = ""; return; }

  const minTs = Math.min(...allTimestamps);
  const maxTs = Math.max(...allTimestamps);
  const tsRange = maxTs - minTs || 1;
  const maxVal = Math.max(...allValues, 1);

  const lines: string[] = [];
  for (let si = 0; si < series.length; si++) {
    const dataPoints = series[si];
    if (dataPoints.length < 2) continue;
    const pts = dataPoints.map((p) => ({
      x: ((p.ts - minTs) / tsRange) * (width - 40) + 40,
      y: height - (p.value / maxVal) * (height - 20) - 10
    }));
    const pointsStr = pts.map((p) => p.x + "," + p.y).join(" ");
    const color = colors[si] || "#4A90D9";
    const areaStr = "40," + height + " " + pointsStr + " " + (pts.length > 0 ? pts[pts.length - 1].x + "," + height : "");
    lines.push(
      '<defs><linearGradient id="area-' + svgId + '-' + si + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.15"/>' +
        '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/>' +
      '</linearGradient></defs>' +
      '<polygon points="' + areaStr + '" fill="url(#area-' + svgId + '-' + si + ')"/>' +
      '<polyline points="' + pointsStr + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>' +
      pts.map((p) => '<circle cx="' + p.x + '" cy="' + p.y + '" r="2.5" fill="' + color + '"/>').join(" ")
    );
  }

  const svg =
    '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '">' +
      '<line x1="40" y1="10" x2="' + width + '" y2="10" stroke="#eee" stroke-width="1"/>' +
      '<line x1="40" y1="' + (height / 2 + 5) + '" x2="' + width + '" y2="' + (height / 2 + 5) + '" stroke="#eee" stroke-width="1"/>' +
      '<line x1="40" y1="' + (height - 10) + '" x2="' + width + '" y2="' + (height - 10) + '" stroke="#eee" stroke-width="1"/>' +
      lines.join("") +
      '<text x="12" y="' + (height / 2) + '" fill="#999" font-size="11" text-anchor="middle" transform="rotate(-90,12,' + (height / 2) + ')">%</text>' +
    '</svg>';
  req(svgId).innerHTML = svg;
}

function normalizePoints(dataPoints: Point[], width: number, height: number): Array<{ x: number; y: number }> {
  const timestamps = dataPoints.map((p) => p.ts);
  const values = dataPoints.map((p) => p.value);
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const tsRange = maxTs - minTs || 1;
  const maxVal = Math.max(...values, 1);
  return dataPoints.map((p) => ({
    x: ((p.ts - minTs) / tsRange) * (width - 40) + 40,
    y: height - (p.value / maxVal) * (height - 20) - 10
  }));
}

// ── Settings ────────────────────────────────────────────────────────────────
async function loadSettings(): Promise<void> {
  const result = await apiCall<any>("GET", "/admin/settings");
  if (!result) return;
  req<HTMLInputElement>("setting-webhook-url").value = result.webhookUrl || "";
  req<HTMLInputElement>("setting-webhook-enabled").checked = !!result.webhookEnabled;
  req<HTMLInputElement>("setting-retention").value = result.monitorRetentionDays || 7;
}

async function saveSettings(): Promise<void> {
  const body = {
    webhookUrl: req<HTMLInputElement>("setting-webhook-url").value.trim(),
    webhookEnabled: req<HTMLInputElement>("setting-webhook-enabled").checked,
    monitorRetentionDays: parseInt(req<HTMLInputElement>("setting-retention").value, 10) || 7
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
  });
}
