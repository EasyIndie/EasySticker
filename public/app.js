const uploadForm = document.getElementById("uploadForm");
const uploadResult = document.getElementById("uploadResult");
const originalPreview = document.getElementById("originalPreview");
const processedPreview = document.getElementById("processedPreview");
const processForm = document.getElementById("processForm");
const processResult = document.getElementById("processResult");
const generateForm = document.getElementById("generateForm");
const generateResult = document.getElementById("generateResult");
const generatedList = document.getElementById("generatedList");
const healthBtn = document.getElementById("healthBtn");
const healthResult = document.getElementById("healthResult");

let currentUploadId = null;
let currentAssetId = null;

healthBtn.addEventListener("click", async () => {
  const res = await fetch("/api/health");
  const json = await res.json();
  healthResult.textContent = JSON.stringify(json, null, 2);
});

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  uploadResult.textContent = "上传中...";

  const fileEl = document.getElementById("file");
  const file = fileEl.files?.[0];
  if (!file) return;

  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/api/uploads", { method: "POST", body: form });
  const json = await res.json();
  uploadResult.textContent = JSON.stringify(json, null, 2);

  currentUploadId = json?.uploadId ?? null;
  currentAssetId = null;
  generatedList.innerHTML = "";
  generateResult.textContent = "";
  processResult.textContent = "";

  if (json?.original?.url) {
    originalPreview.src = json.original.url;
  }
  processedPreview.removeAttribute("src");
});

processForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUploadId) return;

  processResult.textContent = "处理中...";
  const threshold = Number(document.getElementById("threshold").value);
  const softness = Number(document.getElementById("softness").value);

  const res = await fetch(`/api/process/${currentUploadId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threshold, softness })
  });
  const json = await res.json();
  processResult.textContent = JSON.stringify(json, null, 2);
  if (json?.assetId) {
    currentAssetId = json.assetId;
    processedPreview.src = json.url;
  }
});

generateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const assetId = currentAssetId ?? currentUploadId;
  if (!assetId) return;

  generateResult.textContent = "生成中...";
  generatedList.innerHTML = "";

  const sizesRaw = document.getElementById("sizes").value;
  const sizes = sizesRaw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const format = document.getElementById("format").value;
  const effect = document.getElementById("effect").value;
  const text = document.getElementById("overlayText").value.trim();

  const body = { assetId, sizes, format, effect, text: text ? { content: text } : undefined };
  const res = await fetch("/api/generate/static", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  generateResult.textContent = JSON.stringify(json, null, 2);

  const results = json?.results ?? [];
  for (const r of results) {
    const wrap = document.createElement("div");
    const label = document.createElement("div");
    label.className = "muted";
    label.textContent = `${r.size}px`;
    const img = document.createElement("img");
    img.className = "preview";
    img.src = r.url;
    wrap.appendChild(label);
    wrap.appendChild(img);
    generatedList.appendChild(wrap);
  }
});
