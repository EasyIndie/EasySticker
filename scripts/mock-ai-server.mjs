import http from "node:http";
import sharp from "sharp";

const port = Number(process.env.MOCK_AI_PORT || 8787);
const responseMode = process.env.MOCK_AI_RESPONSE || "json";

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function renderImage(body) {
  const width = Number(body.width || 1024);
  const height = Number(body.height || 1024);
  const text = String(body.style || "mock").slice(0, 20);
  const hasRef = Boolean(body.referenceImageBase64 || body.referenceImageUrl || body.referenceImageAssetId);
  const bg = hasRef ? "#2a7fff" : "#666666";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="${bg}"/>
  <circle cx="${Math.floor(width * 0.35)}" cy="${Math.floor(height * 0.42)}" r="${Math.floor(Math.min(width, height) * 0.22)}" fill="rgba(255,255,255,0.35)"/>
  <text x="50%" y="14%" text-anchor="middle" font-family="Arial" font-size="${Math.floor(height * 0.06)}" fill="white">${text}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(404);
    res.end();
    return;
  }

  try {
    const body = await readJson(req);
    const image = await renderImage(body);
    if (responseMode === "binary") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(image);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ mime: "image/png", imageBase64: image.toString("base64") }));
  } catch {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "mock-ai-error" }));
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`mock-ai-server listening on http://127.0.0.1:${port}\n`);
});

