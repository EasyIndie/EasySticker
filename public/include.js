document.addEventListener("DOMContentLoaded", function () {
  var currentLang = (function () {
    try {
      var v = window.localStorage.getItem("easysticker:lang");
      if (v === "en" || v === "zh") return v;
    } catch {}
    var navLang = (navigator.language || "zh").toLowerCase();
    return navLang.indexOf("zh") === 0 ? "zh" : "en";
  })();

  function applyLang(root) {
    var blocksZh = root.querySelectorAll(".lang.lang-zh");
    var blocksEn = root.querySelectorAll(".lang.lang-en");
    blocksZh.forEach(function (el) {
      el.hidden = currentLang === "en";
    });
    blocksEn.forEach(function (el) {
      el.hidden = currentLang === "zh";
    });
    var html = document.documentElement;
    if (html) {
      html.setAttribute("lang", currentLang === "zh" ? "zh-CN" : "en");
    }
  }

  function loadIncludes() {
    var hosts = document.querySelectorAll("[data-include]");
    hosts.forEach(function (host) {
      var url = host.getAttribute("data-include");
      if (!url) return;
      fetch(url)
        .then(function (res) {
          return res.text();
        })
        .then(function (html) {
          host.innerHTML = html;
          applyLang(host);
        })
        .catch(function () {});
    });
  }

  function updateLang(next) {
    if (next !== "zh" && next !== "en") return;
    currentLang = next;
    try {
      window.localStorage.setItem("easysticker:lang", currentLang);
    } catch {}
    applyLang(document);
    // Re-apply for included partials
    document.querySelectorAll("[data-include]").forEach(function (host) {
      applyLang(host);
    });
  }

  document.querySelectorAll("[data-lang-switch]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var lang = btn.getAttribute("data-lang-switch");
      updateLang(lang);
    });
  });

  loadIncludes();
  applyLang(document);
});
