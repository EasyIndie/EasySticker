/**
 * 主题初始化 — 全站共用（主站 / 管理后台 / 文档页）。
 *
 * 必须在样式表之前同步执行：先把 data-theme 写到 <html> 上，避免首屏先按
 * 浅色渲染再切换造成的闪烁；各页面共用 easysticker-theme，跳转时主题保持一致。
 * 放在独立文件里而不是内联，是为了兼容 `script-src 'self'` 的 CSP（内联脚本
 * 需要一个内容哈希，改一处就要重算）。
 *
 * 主站/后台的主题按钮由各自 bundle 处理（#darkModeToggle / #theme-toggle）；
 * 静态文档页没有 bundle，用 `[data-theme-toggle]` 由这里统一接管。
 */
(function () {
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);

    var meta = document.getElementById("themeMeta");
    if (meta) {
      if (!meta.dataset.light) meta.dataset.light = meta.getAttribute("content") || "";
      meta.setAttribute(
        "content",
        theme === "dark" ? meta.dataset.dark || "#0f172a" : meta.dataset.light || "#07c160"
      );
    }

    var toggles = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < toggles.length; i++) {
      var label = theme === "dark" ? "切换浅色模式" : "切换深色模式";
      toggles[i].setAttribute("aria-label", label);
      toggles[i].setAttribute("title", label);
    }
  }

  var saved = localStorage.getItem("easysticker-theme");
  var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));

  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-theme-toggle]") : null;
    if (!btn) return;
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem("easysticker-theme", next);
    applyTheme(next);
  });
})();
