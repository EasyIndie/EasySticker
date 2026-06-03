/* ================================================================
   EasySticker 管理后台 — admin.js
   ================================================================ */

const API_BASE = "/api";
let _refreshTimer = null;

// ── API Call Helper ──────────────────────────────────────────

async function apiCall(method, path, body) {
  const token = localStorage.getItem("easysticker_token");
  try {
    const res = await fetch(API_BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      logout();
      return null;
    }
    return res.json();
  } catch (err) {
    console.error("API call failed:", method, path, err);
    return null;
  }
}

// ── Login / Logout ───────────────────────────────────────────

async function login() {
  console.log("[admin] login() called");
  const emailEl = document.getElementById("login-email");
  const passEl = document.getElementById("login-password");
  if (!emailEl || !passEl) {
    console.error("[admin] login-email or login-password element missing");
    return;
  }
  const email = emailEl.value.trim();
  const password = passEl.value;

  if (!email || !password) {
    errorEl.textContent = "请输入邮箱和密码";
    return;
  }

  const btn = document.getElementById("login-btn");
  if (!btn) {
    console.error("[admin] login-btn element missing");
    return;
  }
  btn.disabled = true;
  btn.textContent = "登录中...";
  errorEl.textContent = "";

  try {
    const result = await apiCall("POST", "/auth/login", { email, password });
    btn.disabled = false;
    btn.textContent = "登 录";

    if (!result || result.error) {
      errorEl.textContent = result?.message || "登录失败，请检查邮箱和密码";
      return;
    }

    // 写入统一存储位置 (localStorage)，与首页 app.js 共享
    localStorage.setItem("easysticker_token", result.token);
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

function logout() {
  console.log("[admin] logout() called");
  try { clearInterval(_refreshTimer); } catch(_){}
  _refreshTimer = null;
  try {
    localStorage.removeItem("easysticker_token");
    localStorage.removeItem("easysticker_user");
    // 标记此会话已退出，防止 checkAuth 自动恢复
    sessionStorage.setItem("admin_logged_out", "1");
  } catch(e){
    console.error("[admin] logout storage error:", e);
  }
  // 返回登录界面（不跳转，直接在当前页面切换）
  try {
    document.getElementById("main-section").style.display = "none";
    document.getElementById("login-section").style.display = "flex";
    document.getElementById("login-email").value = "";
    document.getElementById("login-password").value = "";
    document.getElementById("login-error").textContent = "";
  } catch(e) {
    console.error("[admin] logout DOM error:", e);
  }
}

function showMainSection(user) {
  console.log("[admin] showMainSection:", user.email);
  document.getElementById("login-section").style.display = "none";
  document.getElementById("main-section").style.display = "block";

  const userLabel = user.email + (user.role === "admin" ? " (管理员)" : "");
  document.getElementById("topbar-user").textContent = userLabel;

  switchTab("dashboard");
  startAutoRefresh();
}

function checkAuth() {
  // 如果标记为已退出，不再自动登录
  if (sessionStorage.getItem("admin_logged_out")) {
    console.log("[admin] checkAuth: blocked by logged_out flag");
    return;
  }
  // 统一从 localStorage 读取登录状态（与首页 app.js 共享同一 Token）
  const token = localStorage.getItem("easysticker_token");
  const userRaw = localStorage.getItem("easysticker_user");
  if (token && userRaw) {
    try {
      const user = JSON.parse(userRaw);
      if (user.role === "admin") {
        console.log("[admin] checkAuth: auto-logged in as", user.email);
        showMainSection(user);
        return;
      }
    } catch (e) {
      console.error("[admin] checkAuth: failed to parse user", e);
    }
  }
}

// ── Tab Switching ────────────────────────────────────────────

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.style.display = panel.id === tab + "-panel" ? "block" : "none";
  });

  // Load data on first access
  switch (tab) {
    case "dashboard":
      loadDashboard();
      break;
    case "users":
      loadUsers();
      break;
    case "stats":
      loadStats();
      break;
    case "settings":
      loadSettings();
      loadAlertRules();
      break;
  }
}

// ── Auto Refresh ─────────────────────────────────────────────

function startAutoRefresh() {
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => {
    const active = document.querySelector(".tab-btn.active");
    if (active) {
      const tab = active.dataset.tab;
      if (tab === "dashboard") loadDashboard();
    }
  }, 15000);
}

// ── Dashboard: Monitoring Snapshot ───────────────────────────

async function loadDashboard() {
  const data = await apiCall("GET", "/admin/monitoring");
  if (!data) return;
  renderMetrics(data.snapshot);
  loadAlerts();
}

function getMetricColor(percent) {
  if (percent < 50) return "#52C41A";
  if (percent <= 80) return "#FAAD14";
  return "#FF4D4F";
}

function renderMetrics(snapshot) {
  if (!snapshot) return;

  const circumference = 2 * Math.PI * 52; // ~326.73

  // CPU
  const cpuPct = snapshot.cpu?.percent ?? 0;
  renderRing("metric-cpu", cpuPct, "%", circumference);
  const cpuCircle = document.querySelector("#metric-cpu .metric-ring circle:last-child");
  if (cpuCircle) cpuCircle.style.color = getMetricColor(cpuPct);
  document.getElementById("metric-cpu-load").textContent =
    "负载: " + (snapshot.cpu?.loadAvg || []).map((v) => v.toFixed(1)).join(" / ");

  // Memory
  const memPct = snapshot.memory?.percent ?? 0;
  renderRing("metric-mem", memPct, "%", circumference);
  const memCircle = document.querySelector("#metric-mem .metric-ring circle:last-child");
  if (memCircle) memCircle.style.color = getMetricColor(memPct);
  const memUsed = snapshot.memory?.usedMb ?? 0;
  const memTotal = snapshot.memory?.totalMb ?? 0;
  document.getElementById("metric-mem-detail").textContent =
    memUsed + " MB / " + memTotal + " MB";

  // Disk
  const diskPct = snapshot.disk?.percent ?? 0;
  const diskUsed = snapshot.disk?.usedMb ?? 0;
  renderRing("metric-disk", Math.min(diskUsed, 100), "MB", circumference, true);
  const diskEl = document.querySelector("#metric-disk .metric-ring-value");
  if (diskEl) diskEl.textContent = diskUsed;
  document.getElementById("metric-disk-detail").textContent =
    "总计: " + (snapshot.disk?.totalMb ?? 0) + " MB";

  // Requests per minute
  const rpm = snapshot.requestsLastMinute ?? 0;
  document.getElementById("metric-rpm-value").textContent = rpm;
  const errors = snapshot.errorsLastMinute ?? 0;
  const avgLatency = snapshot.avgLatencyLastMinute ?? 0;
  document.getElementById("metric-rpm-detail").textContent =
    "错误: " + errors + " | 平均延迟: " + avgLatency + "ms";
}

function renderRing(cardId, percent, unit, circumference, isDisk) {
  const valueEl = document.querySelector("#" + cardId + " .metric-ring-value");
  if (!valueEl) return;
  const pct = Math.min(Math.max(percent, 0), 100);
  valueEl.textContent = pct;
  const offset = circumference * (1 - pct / 100);
  const circle = document.querySelector("#" + cardId + " .metric-ring circle:last-child");
  if (circle) {
    circle.setAttribute("stroke-dashoffset", offset);
  }
}

// ── Dashboard: Alerts ────────────────────────────────────────

async function loadAlerts() {
  const result = await apiCall("GET", "/admin/alerts/history?resolved=false");
  if (!result) return;
  renderAlerts(result.alerts || []);
}

function renderAlerts(alerts) {
  const container = document.getElementById("alerts-container");
  if (!alerts || alerts.length === 0) {
    container.innerHTML = '<div class="empty-state">✅ 当前无活跃告警</div>';
    return;
  }

  const items = alerts
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
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
            ? '<button class="btn btn-outline btn-sm" onclick="acknowledgeAlert(\'' + alert.id + '\')">确认</button>'
            : '') +
        '</div>'
      );
    })
    .join("");

  container.innerHTML = items;
}

async function acknowledgeAlert(id) {
  const result = await apiCall("POST", "/admin/alerts/" + id + "/ack");
  if (result && result.success) {
    loadAlerts();
  }
}

// ── Users ────────────────────────────────────────────────────

async function loadUsers() {
  const result = await apiCall("GET", "/admin/users");
  if (!result) return;
  renderUsers(result.users || []);
}

function renderUsers(users) {
  const container = document.getElementById("users-container");
  if (!users || users.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无用户</div>';
    return;
  }

  const rows = users
    .map((u) => {
      const disabled = u.disabled ? ' disabled-row' : '';
      const roleBadge = u.role === "admin"
        ? '<span class="badge badge-admin">管理员</span>'
        : '<span class="badge badge-user">用户</span>';
      const statusBadge = u.disabled
        ? '<span class="badge badge-disabled">已禁用</span>'
        : '<span class="badge badge-active">正常</span>';
      const toggleText = u.disabled ? "启用" : "禁用";
      const toggleClass = u.disabled ? "btn-success" : "btn-warning";

      return (
        '<tr class="' + disabled + '">' +
          '<td>' + escHtml(u.email) + '</td>' +
          '<td>' + roleBadge + '</td>' +
          '<td>' + formatTime(u.createdAt) + '</td>' +
          '<td>' + (u.lastLogin ? formatTime(u.lastLogin) : "从未") + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' +
            '<button class="btn ' + toggleClass + ' btn-sm" onclick="toggleUser(\'' + escHtmlAttr(u.email) + '\')">' + toggleText + '</button>' +
          '</td>' +
          '<td>' +
            '<button class="btn btn-outline btn-sm" onclick="showResetPassword(\'' + escHtmlAttr(u.email) + '\')">重置密码</button>' +
          '</td>' +
        '</tr>'
      );
    })
    .join("");

  container.innerHTML =
    '<table class="data-table">' +
      '<thead><tr>' +
        '<th>邮箱</th><th>角色</th><th>创建时间</th><th>最后登录</th><th>状态</th><th>操作</th><th></th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>';
}

async function toggleUser(email) {
  const result = await apiCall("POST", "/admin/users/" + encodeURIComponent(email) + "/toggle");
  if (result) {
    loadUsers();
  }
}

// ── Stats ────────────────────────────────────────────────────

async function loadStats() {
  // Usage overview
  const usage = await apiCall("GET", "/admin/usage");
  if (usage && usage.summaries) {
    renderStatsOverview(usage.summaries);
  }

  // Request trend chart
  loadRequestChart();

  // System trend chart
  loadSystemChart();
}

function renderStatsOverview(summaries) {
  let totalGenerated = 0;
  let totalSuccess = 0;
  let totalFail = 0;

  for (const s of summaries) {
    totalGenerated += s.todayGenerated || 0;
    totalSuccess += s.totalGenerated ? Math.round(s.totalGenerated * (s.successRate || 0)) : 0;
    totalFail += s.todayGenerated ? s.todayGenerated - Math.round(s.todayGenerated * (s.successRate || 0)) : 0;
  }

  const rate = totalGenerated > 0 ? ((totalSuccess / totalGenerated) * 100).toFixed(1) + "%" : "N/A";

  document.getElementById("stat-total-generated").textContent = totalGenerated;
  document.getElementById("stat-total-success").textContent = totalSuccess;
  document.getElementById("stat-total-fail").textContent = totalFail;
  document.getElementById("stat-total-rate").textContent = rate;
}

async function loadRequestChart() {
  const result = await apiCall("GET", "/admin/monitoring/metrics?type=request&limit=100");
  if (!result || !result.records || result.records.length === 0) {
    document.getElementById("chart-requests-empty").style.display = "block";
    document.getElementById("chart-requests").innerHTML = "";
    return;
  }
  document.getElementById("chart-requests-empty").style.display = "none";

  const records = result.records;
  const points = records.map((r) => ({
    ts: new Date(r.timestamp).getTime(),
    value: r.data.durationMs || 0,
  }));

  renderLineChart("chart-requests", points, 700, 200, "#4A90D9", "延迟 (ms)");
}

async function loadSystemChart() {
  const result = await apiCall("GET", "/admin/monitoring/metrics?type=system&limit=100");
  if (!result || !result.records || result.records.length === 0) {
    document.getElementById("chart-system-empty").style.display = "block";
    document.getElementById("chart-system").innerHTML = "";
    return;
  }
  document.getElementById("chart-system-empty").style.display = "none";

  const records = result.records;
  const cpuPoints = records.map((r) => ({
    ts: new Date(r.timestamp).getTime(),
    value: r.data.cpuPercent || 0,
  }));
  const memPoints = records.map((r) => ({
    ts: new Date(r.timestamp).getTime(),
    value: r.data.memPercent || 0,
  }));

  renderMultiLineChart("chart-system", [cpuPoints, memPoints], 700, 200, ["#4A90D9", "#52C41A"], ["CPU %", "内存 %"]);
}

// ── SVG Line Charts ──────────────────────────────────────────

function renderLineChart(svgId, dataPoints, width, height, color, label) {
  if (!dataPoints || dataPoints.length < 2) {
    document.getElementById(svgId).innerHTML = "";
    return;
  }

  const pts = normalizePoints(dataPoints, width, height);
  const pointsStr = pts.map((p) => p.x + "," + p.y).join(" ");
  const areaStr = "0," + height + " " + pointsStr + " " + (pts.length > 0 ? pts[pts.length - 1].x + "," + height : "");

  const svg =
    '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '">' +
      '<defs>' +
        '<linearGradient id="area-' + svgId + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.2"/>' +
          '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<!-- Grid lines -->' +
      '<line x1="0" y1="0" x2="' + width + '" y2="0" stroke="#eee" stroke-width="1"/>' +
      '<line x1="0" y1="' + (height / 2) + '" x2="' + width + '" y2="' + (height / 2) + '" stroke="#eee" stroke-width="1"/>' +
      '<line x1="0" y1="' + height + '" x2="' + width + '" y2="' + height + '" stroke="#eee" stroke-width="1"/>' +
      '<!-- Area fill -->' +
      '<polygon points="' + areaStr + '" fill="url(#area-' + svgId + ')"/>' +
      '<!-- Line -->' +
      '<polyline points="' + pointsStr + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>' +
      '<!-- Dots -->' +
      pts.map((p) => '<circle cx="' + p.x + '" cy="' + p.y + '" r="2.5" fill="' + color + '"/>').join(" ") +
    '</svg>';

  document.getElementById(svgId).innerHTML = svg;
}

function renderMultiLineChart(svgId, series, width, height, colors, labels) {
  if (!series || series.length === 0 || series.every((s) => s.length < 2)) {
    document.getElementById(svgId).innerHTML = "";
    return;
  }

  // Collect all x values for consistent scaling
  const allTimestamps = [];
  for (const s of series) {
    for (const p of s) {
      allTimestamps.push(p.ts);
    }
  }
  if (allTimestamps.length === 0) {
    document.getElementById(svgId).innerHTML = "";
    return;
  }

  const minTs = Math.min(...allTimestamps);
  const maxTs = Math.max(...allTimestamps);
  const tsRange = maxTs - minTs || 1;

  let allValues = [];
  for (const s of series) {
    for (const p of s) {
      allValues.push(p.value);
    }
  }
  const maxVal = Math.max(...allValues, 1);
  const minVal = 0;

  const lines = [];

  for (let si = 0; si < series.length; si++) {
    const dataPoints = series[si];
    if (dataPoints.length < 2) continue;

    const pts = dataPoints.map((p) => ({
      x: ((p.ts - minTs) / tsRange) * (width - 40) + 40,
      y: height - ((p.value - minVal) / (maxVal - minVal)) * (height - 20) - 10,
    }));

    const pointsStr = pts.map((p) => p.x + "," + p.y).join(" ");
    const color = colors[si] || "#4A90D9";

    const areaStr = "40," + height + " " + pointsStr + " " + (pts.length > 0 ? pts[pts.length - 1].x + "," + height : "");

    lines.push(
      '<defs>' +
        '<linearGradient id="area-' + svgId + '-' + si + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.15"/>' +
          '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<polygon points="' + areaStr + '" fill="url(#area-' + svgId + '-' + si + ')"/>' +
      '<polyline points="' + pointsStr + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>' +
      pts.map((p) => '<circle cx="' + p.x + '" cy="' + p.y + '" r="2.5" fill="' + color + '"/>').join(" ")
    );
  }

  const svgLines = lines.join("");

  const legend = labels
    .map(
      (l, i) =>
        '<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;margin-right:12px">' +
          '<span style="width:10px;height:10px;border-radius:50%;background:' + (colors[i] || "#4A90D9") + '"></span>' +
          l +
        "</span>"
    )
    .join("");

  const svg =
    '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '">' +
      '<!-- Grid lines -->' +
      '<line x1="40" y1="10" x2="' + width + '" y2="10" stroke="#eee" stroke-width="1"/>' +
      '<line x1="40" y1="' + (height / 2 + 5) + '" x2="' + width + '" y2="' + (height / 2 + 5) + '" stroke="#eee" stroke-width="1"/>' +
      '<line x1="40" y1="' + (height - 10) + '" x2="' + width + '" y2="' + (height - 10) + '" stroke="#eee" stroke-width="1"/>' +
      svgLines +
      '<!-- Y-axis label -->' +
      '<text x="12" y="' + (height / 2) + '" fill="#999" font-size="11" text-anchor="middle" transform="rotate(-90,12,' + (height / 2) + ')">%</text>' +
    '</svg>';

  document.getElementById(svgId).innerHTML = svg;
}

function normalizePoints(dataPoints, width, height) {
  const timestamps = dataPoints.map((p) => p.ts);
  const values = dataPoints.map((p) => p.value);

  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const tsRange = maxTs - minTs || 1;

  const maxVal = Math.max(...values, 1);
  const minVal = 0;

  return dataPoints.map((p) => ({
    x: ((p.ts - minTs) / tsRange) * (width - 40) + 40,
    y: height - ((p.value - minVal) / (maxVal - minVal)) * (height - 20) - 10,
  }));
}

// ── Settings ─────────────────────────────────────────────────

async function loadSettings() {
  const result = await apiCall("GET", "/admin/settings");
  if (!result) return;

  document.getElementById("setting-webhook-url").value = result.webhookUrl || "";
  document.getElementById("setting-webhook-enabled").checked = !!result.webhookEnabled;
  document.getElementById("setting-retention").value = result.monitorRetentionDays || 7;
}

async function saveSettings() {
  const body = {
    webhookUrl: document.getElementById("setting-webhook-url").value.trim(),
    webhookEnabled: document.getElementById("setting-webhook-enabled").checked,
    monitorRetentionDays: parseInt(document.getElementById("setting-retention").value, 10) || 7,
  };

  const result = await apiCall("PUT", "/admin/settings", body);
  const msg = document.getElementById("settings-msg");
  if (result && !result.error) {
    msg.textContent = "✅ 设置已保存";
    msg.className = "status-msg success";
  } else {
    msg.textContent = "❌ 保存失败";
    msg.className = "status-msg error";
  }
  setTimeout(() => { msg.textContent = ""; }, 3000);
}

// ── Alert Rules ──────────────────────────────────────────────

async function loadAlertRules() {
  const result = await apiCall("GET", "/admin/alerts/rules");
  if (!result) return;
  renderAlertRules(result.rules || []);
}

function renderAlertRules(rules) {
  const container = document.getElementById("alert-rules-container");
  if (!rules || rules.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无告警规则</div>';
    return;
  }

  const items = rules
    .map((rule, idx) => {
      const metricLabel = getMetricLabel(rule.metric);
      return (
        '<div class="rule-card">' +
          '<div class="rule-info">' +
            '<div class="rule-name">' + escHtml(rule.name) + '</div>' +
            '<div class="rule-meta">指标: ' + metricLabel + '</div>' +
          '</div>' +
          '<div class="rule-controls">' +
            '<div>' +
              '<label>阈值</label>' +
              '<input type="number" class="rule-threshold" data-idx="' + idx + '" value="' + rule.threshold + '" step="any">' +
            '</div>' +
            '<div>' +
              '<label>持续(s)</label>' +
              '<input type="number" class="rule-duration" data-idx="' + idx + '" value="' + rule.duration + '" step="1" min="1">' +
            '</div>' +
            '<div>' +
              '<label>静默(ms)</label>' +
              '<input type="number" class="rule-silence" data-idx="' + idx + '" value="' + rule.silenceMs + '" step="1000" min="0">' +
            '</div>' +
            '<label class="checkbox-wrap">' +
              '<input type="checkbox" class="rule-enabled" data-idx="' + idx + '"' + (rule.enabled ? " checked" : "") + '>' +
              '启用' +
            '</label>' +
          '</div>' +
        '</div>'
      );
    })
    .join("");

  container.innerHTML = items;
}

function getMetricLabel(metric) {
  const labels = {
    "cpu.percent": "CPU 使用率",
    "errorRate": "错误率",
    "disk.usedMb": "磁盘用量 (MB)",
    "avgLatencyMs": "平均延迟 (ms)",
    "requestsPerMinute": "每分钟请求数",
  };
  return labels[metric] || metric;
}

async function saveAlertRules() {
  const result = await apiCall("GET", "/admin/alerts/rules");
  if (!result || !result.rules) return;

  const rules = result.rules.map((rule, idx) => {
    const thresholdInput = document.querySelector(".rule-threshold[data-idx='" + idx + "']");
    const durationInput = document.querySelector(".rule-duration[data-idx='" + idx + "']");
    const silenceInput = document.querySelector(".rule-silence[data-idx='" + idx + "']");
    const enabledInput = document.querySelector(".rule-enabled[data-idx='" + idx + "']");

    return {
      ...rule,
      threshold: thresholdInput ? parseFloat(thresholdInput.value) : rule.threshold,
      duration: durationInput ? parseInt(durationInput.value, 10) || rule.duration : rule.duration,
      silenceMs: silenceInput ? parseInt(silenceInput.value, 10) || rule.silenceMs : rule.silenceMs,
      enabled: enabledInput ? enabledInput.checked : rule.enabled,
    };
  });

  const saveResult = await apiCall("PUT", "/admin/alerts/rules", { rules });
  const msg = document.getElementById("rules-msg");
  if (saveResult && !saveResult.error) {
    msg.textContent = "✅ 规则已保存";
    msg.className = "status-msg success";
    // Reload rules to reflect server state
    loadAlertRules();
  } else {
    msg.textContent = "❌ 保存失败";
    msg.className = "status-msg error";
  }
  setTimeout(() => { msg.textContent = ""; }, 3000);
}

// ── Password Reset ──────────────────────────────────────────

function showResetPassword(email) {
  const newPassword = prompt('为 "' + email + '" 设置新密码（至少6个字符）：');
  if (!newPassword || newPassword.length < 6) {
    if (newPassword) alert('密码至少6个字符');
    return;
  }
  resetPassword(email, newPassword);
}

async function resetPassword(email, newPassword) {
  const result = await apiCall("POST", "/auth/reset-password", { email, newPassword });
  if (result && result.success) {
    alert('✅ 密码已重置');
  } else {
    alert('❌ 重置失败: ' + (result?.message || '请重试'));
  }
}

// ── Utility ──────────────────────────────────────────────────

function escHtml(str) {
  if (typeof str !== "string") return String(str);
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escHtmlAttr(str) {
  if (typeof str !== "string") return String(str);
  return str.replace(/'/g, "&apos;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatTime(isoStr) {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoStr;
  }
}

// ── Keyboard shortcut: Enter to login ────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  checkAuth();

  document.getElementById("login-password").addEventListener("keydown", function (e) {
    if (e.key === "Enter") login();
  });
  document.getElementById("login-email").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      document.getElementById("login-password").focus();
    }
  });
});
