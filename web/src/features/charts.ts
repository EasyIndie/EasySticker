/**
 * 轻量级 SVG 图表（零依赖）。
 *
 * 为什么重写：旧版本把 viewBox 固定成 700×200 再配 preserveAspectRatio="none"，
 * 于是宽屏下整张图被横向拉扁、文字变形；y 轴按 min~max 缩放而非从 0 起，
 * 波动被放大得失真；也没有坐标轴/刻度/图例/悬浮读数，基本没法当数据分析用。
 *
 * 现在的目标：
 * - 响应式：按容器真实宽度绘制，容器尺寸变化时重绘（不再拉伸）。
 * - 可读数：左 y 轴刻度 + 底部时间刻度 + 网格 + 图例 + 悬浮十字线与提示框。
 * - 不误导：基线默认从 0 起；曲线用单调三次插值，避免过冲造成的虚假峰谷。
 * - 跟随主题：颜色一律走 CSS 变量，亮/暗模式自动适配。
 */

export type ChartPoint = { ts: number; value: number };

export type ChartSeries = {
  name: string;
  color: string;
  points: ChartPoint[];
  /** 是否填充面积（默认 false）。 */
  area?: boolean;
  /** 虚线，用于对比序列（如错误数）。 */
  dashed?: boolean;
};

export type ChartOptions = {
  height?: number;
  /** 固定下界；缺省时取 0（更诚实的基线）。 */
  yMin?: number;
  /** 固定上界；缺省时按数据取「好看」的整数上限。 */
  yMax?: number;
  yTicks?: number;
  /** y 轴刻度格式化。 */
  yFormat?: (v: number) => string;
  /** x 轴时间刻度格式化。 */
  xFormat?: (ts: number) => string;
  /** 是否平滑（默认 true）。 */
  smooth?: boolean;
};

const MARGIN = { top: 16, right: 18, bottom: 28, left: 52 };

const chartStates = new WeakMap<HTMLElement, () => void>();

/** 渲染/更新一条或多条时间序列。可重复调用（窗口变化时会自动重绘）。 */
export function renderTimeSeries(container: HTMLElement, series: ChartSeries[], opts: ChartOptions = {}): void {
  const draw = () => drawTimeSeries(container, series, opts);
  chartStates.set(container, draw);
  draw();

  if (container.dataset.chartObserved !== "1" && typeof ResizeObserver !== "undefined") {
    container.dataset.chartObserved = "1";
    const ro = new ResizeObserver(() => chartStates.get(container)?.());
    ro.observe(container);
  }
}

function drawTimeSeries(container: HTMLElement, series: ChartSeries[], opts: ChartOptions): void {
  const width = Math.max(container.clientWidth || 640, 260);
  const height = opts.height ?? 220;
  const plotW = Math.max(width - MARGIN.left - MARGIN.right, 10);
  const plotH = Math.max(height - MARGIN.top - MARGIN.bottom, 10);

  const visible = series.filter((s) => s.points && s.points.length > 0);
  if (visible.length === 0) {
    container.innerHTML = '<p class="empty-text">暂无数据</p>';
    return;
  }

  const allTs = visible.flatMap((s) => s.points.map((p) => p.ts));
  const allValues = visible.flatMap((s) => s.points.map((p) => p.value));
  const minTs = Math.min(...allTs);
  const maxTs = Math.max(...allTs);
  const tsSpan = Math.max(maxTs - minTs, 60_000);

  const dataMax = Math.max(...allValues, 0);
  const dataMin = Math.min(...allValues, 0);
  const yMin = opts.yMin ?? (dataMin < 0 ? dataMin : 0);
  let yMax = opts.yMax ?? niceCeil(dataMax);
  if (yMax <= yMin) yMax = yMin + 1;

  const x = (ts: number) => MARGIN.left + ((ts - minTs) / tsSpan) * plotW;
  const y = (v: number) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const yFormat = opts.yFormat ?? ((v: number) => formatNumber(v));
  const xFormat = opts.xFormat ?? defaultTimeFormat(tsSpan);
  const smooth = opts.smooth !== false;

  const ticks = niceTicks(yMin, yMax, opts.yTicks ?? 4);
  const xTicks = evenlySpaced(minTs, maxTs, Math.min(6, Math.max(2, Math.floor(plotW / 110))));

  // ── 网格 + 坐标轴刻度 ──────────────────────────────────────
  const grid = ticks
    .map((t) => {
      const gy = round(y(t));
      return `<line x1="${MARGIN.left}" y1="${gy}" x2="${MARGIN.left + plotW}" y2="${gy}" class="chart-grid${t === yMin ? " chart-axis" : ""}"/>` +
        `<text x="${MARGIN.left - 8}" y="${gy + 3.5}" class="chart-axis-label" text-anchor="end">${escapeText(yFormat(t))}</text>`;
    })
    .join("");

  const xAxis = xTicks
    .map((t) => {
      const gx = round(x(t));
      return `<text x="${gx}" y="${height - 8}" class="chart-axis-label" text-anchor="middle">${escapeText(xFormat(t))}</text>`;
    })
    .join("");

  // ── 序列 ───────────────────────────────────────────────────
  let defs = "";
  let bodies = "";
  visible.forEach((s, i) => {
    const sorted = [...s.points].sort((a, b) => a.ts - b.ts);
    const pts = sorted.map((p) => ({ x: x(p.ts), y: y(p.value) }));
    const line = smooth ? monotonePath(pts) : linearPath(pts);
    const gradId = `chart-grad-${i}-${Math.random().toString(36).slice(2, 7)}`;
    if (s.area) {
      const base = y(Math.max(yMin, 0));
      const areaPath = `${line} L${round(pts[pts.length - 1].x)},${round(base)} L${round(pts[0].x)},${round(base)} Z`;
      defs +=
        `<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0%" style="stop-color:${s.color}" stop-opacity="0.28"/>` +
        `<stop offset="100%" style="stop-color:${s.color}" stop-opacity="0.02"/>` +
        `</linearGradient>`;
      bodies += `<path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>`;
    }
    const dash = s.dashed ? ` stroke-dasharray="5 4"` : "";
    bodies += `<path d="${line}" fill="none" style="stroke:${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${dash}/>`;
  });

  const lastValues = visible.map((s, i) => {
    const sorted = [...s.points].sort((a, b) => a.ts - b.ts);
    const last = sorted[sorted.length - 1];
    return { series: s, value: last ? last.value : 0, index: i };
  });

  const legend =
    `<div class="chart-legend">` +
    lastValues
      .map(
        (v) =>
          `<span class="chart-legend-item"><i style="background:${v.series.color}"></i>${escapeText(v.series.name)}` +
          `<b>${escapeText(yFormat(v.value))}</b></span>`
      )
      .join("") +
    `</div>`;

  const aria = visible.map((s) => s.name).join("、");

  container.innerHTML =
    legend +
    `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="${escapeText(aria)} 趋势图">` +
    `<defs>${defs}</defs>` +
    grid +
    `<line x1="${MARGIN.left}" y1="${MARGIN.top + plotH}" x2="${MARGIN.left + plotW}" y2="${MARGIN.top + plotH}" class="chart-grid chart-axis"/>` +
    bodies +
    xAxis +
    `<g class="chart-hover" style="display:none"><line class="chart-crosshair" y1="${MARGIN.top}" y2="${MARGIN.top + plotH}"/></g>` +
    `</svg>` +
    `<div class="chart-tooltip" hidden></div>`;

  wireHover(container, visible, { width, height, plotW, plotH, minTs, tsSpan, x, y, yFormat, xFormat });
}

type HoverCtx = {
  width: number;
  height: number;
  plotW: number;
  plotH: number;
  minTs: number;
  tsSpan: number;
  x: (ts: number) => number;
  y: (v: number) => number;
  yFormat: (v: number) => string;
  xFormat: (ts: number) => string;
};

function wireHover(container: HTMLElement, series: ChartSeries[], ctx: HoverCtx): void {
  const svg = container.querySelector("svg");
  const tooltip = container.querySelector<HTMLElement>(".chart-tooltip");
  const hoverGroup = container.querySelector<SVGGElement>(".chart-hover");
  if (!svg || !tooltip || !hoverGroup) return;

  const crosshair = hoverGroup.querySelector(".chart-crosshair");
  const dots: SVGCircleElement[] = series.map((s) => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("r", "3.5");
    c.setAttribute("stroke-width", "2");
    c.style.fill = "var(--c-card)";
    c.style.stroke = s.color;
    c.style.display = "none";
    hoverGroup.appendChild(c);
    return c;
  });

  const hide = () => {
    hoverGroup.style.display = "none";
    tooltip.hidden = true;
  };

  const move = (ev: MouseEvent) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const scale = ctx.width / rect.width;
    const mx = (ev.clientX - rect.left) * scale;
    if (mx < MARGIN.left - 6 || mx > MARGIN.left + ctx.plotW + 6) {
      hide();
      return;
    }
    const frac = Math.min(Math.max((mx - MARGIN.left) / ctx.plotW, 0), 1);
    const ts = ctx.minTs + frac * ctx.tsSpan;
    const gx = round(ctx.x(ts));

    hoverGroup.style.display = "";
    crosshair?.setAttribute("x1", String(gx));
    crosshair?.setAttribute("x2", String(gx));

    const rows: Array<{ name: string; color: string; value: number }> = [];
    series.forEach((s, i) => {
      if (!s.points.length) {
        dots[i].style.display = "none";
        return;
      }
      const nearest = nearestPoint(s.points, ts);
      dots[i].style.display = "";
      dots[i].setAttribute("cx", String(round(ctx.x(nearest.ts))));
      dots[i].setAttribute("cy", String(round(ctx.y(nearest.value))));
      rows.push({ name: s.name, color: s.color, value: nearest.value });
    });

    tooltip.hidden = false;
    tooltip.innerHTML =
      `<div class="chart-tooltip-time">${escapeText(fullTime(ts))}</div>` +
      rows
        .map(
          (r) =>
            `<div class="chart-tooltip-row"><i style="background:${r.color}"></i>` +
            `<span>${escapeText(r.name)}</span><b>${escapeText(ctx.yFormat(r.value))}</b></div>`
        )
        .join("");

    const crect = container.getBoundingClientRect();
    let left = ev.clientX - crect.left + 14;
    let top = ev.clientY - crect.top + 12;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    if (left + tw > crect.width - 4) left = ev.clientX - crect.left - tw - 14;
    if (top + th > crect.height - 4) top = Math.max(4, ev.clientY - crect.top - th - 12);
    tooltip.style.left = `${Math.max(4, left)}px`;
    tooltip.style.top = `${top}px`;
  };

  svg.addEventListener("mousemove", move);
  svg.addEventListener("mouseleave", hide);
}

// ── 路径构造 ─────────────────────────────────────────────────

function linearPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return "";
  return "M" + pts.map((p) => `${round(p.x)},${round(p.y)}`).join("L");
}

/** 单调三次 Hermite（Fritsch–Carlson），保证曲线不过冲。 */
function monotonePath(pts: Array<{ x: number; y: number }>): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n < 3) return linearPath(pts);

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1].x - pts[i].x;
    dx.push(h);
    slope.push(h === 0 ? 0 : (pts[i + 1].y - pts[i].y) / h);
  }

  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }

  let d = `M${round(pts[0].x)},${round(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    const c1x = pts[i].x + h / 3;
    const c1y = pts[i].y + (m[i] * h) / 3;
    const c2x = pts[i + 1].x - h / 3;
    const c2y = pts[i + 1].y - (m[i + 1] * h) / 3;
    d += `C${round(c1x)},${round(c1y)} ${round(c2x)},${round(c2y)} ${round(pts[i + 1].x)},${round(pts[i + 1].y)}`;
  }
  return d;
}

// ── 比例尺工具 ───────────────────────────────────────────────

/** 把上限抬到 1/2/5×10ⁿ 的「好看」刻度，并留一点顶部空间。 */
function niceCeil(max: number): number {
  if (!(max > 0)) return 1;
  const raw = max * 1.05;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min || 1;
  const rawStep = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = min; v <= max + step * 1e-6; v += step) ticks.push(round(v));
  return ticks;
}

function evenlySpaced(min: number, max: number, count: number): number[] {
  if (count <= 1 || max === min) return [min];
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(min + ((max - min) * i) / (count - 1));
  return out;
}

function nearestPoint(points: ChartPoint[], ts: number): ChartPoint {
  let best = points[0];
  let bestDist = Math.abs(best.ts - ts);
  for (let i = 1; i < points.length; i++) {
    const dist = Math.abs(points[i].ts - ts);
    if (dist < bestDist) {
      bestDist = dist;
      best = points[i];
    }
  }
  return best;
}

function defaultTimeFormat(spanMs: number): (ts: number) => string {
  return (ts: number) => {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    if (spanMs <= 6 * 3600_000) return `${p(d.getHours())}:${p(d.getMinutes())}`;
    if (spanMs <= 4 * 86400_000) return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:00`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
}

function fullTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatNumber(v: number): string {
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString("en-US");
  if (Number.isInteger(v)) return String(v);
  return (Math.round(v * 100) / 100).toString();
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
