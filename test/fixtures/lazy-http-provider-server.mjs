import http from "node:http";

const port = Number(process.argv[2]);
if (!port) {
  console.error("missing port");
  process.exit(1);
}

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l4ba7wAAAABJRU5ErkJggg==",
  "base64"
);

let canceled = false;

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "GET" && req.url === "/canceled") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ canceled }));
    return;
  }
  if (req.method === "POST" && req.url === "/cancel") {
    canceled = true;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "POST" && req.url === "/generate") {
    const input = await readJson(req);
    if (input.prompt === "slow") {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    res.writeHead(200, { "content-type": "image/png" });
    res.end(png);
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "NotFound" }));
});

server.listen(port, "127.0.0.1");
