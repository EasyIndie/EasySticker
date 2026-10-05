/**
 * 主题初始化 — 主站与管理后台共用。
 *
 * 必须在样式表之前同步执行：先把 data-theme 写到 <html> 上，避免首屏先按
 * 浅色渲染再切换造成的闪烁；主站与管理后台跳转时主题也因此保持一致。
 * 放在独立文件里而不是内联，是为了兼容 `script-src 'self'` 的 CSP（内联脚本
 * 需要一个内容哈希，改一处就要重算）。
 */
(function () {
  var saved = localStorage.getItem("easysticker-theme");
  var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  var theme = saved || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);

  var meta = document.getElementById("themeMeta");
  if (meta) {
    if (!meta.dataset.light) meta.dataset.light = meta.getAttribute("content") || "";
    meta.setAttribute(
      "content",
      theme === "dark" ? meta.dataset.dark || "#0f172a" : meta.dataset.light || "#07c160"
    );
  }
})();
