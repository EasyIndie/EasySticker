document.addEventListener("DOMContentLoaded", function () {
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
        })
        .catch(function () {});
    });
  }

  loadIncludes();
});
