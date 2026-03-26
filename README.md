# EasySticker

Node.js + TypeScript 的表情包自动化生产与发布服务（Fastify）。

## 本地运行

```bash
npm i
npm run dev
```

- Web UI: http://localhost:3000/
- API 文档: http://localhost:3000/docs

## 环境变量

- `PORT`：默认 `3000`
- `HOST`：默认 `0.0.0.0`
- `DATA_DIR`：默认 `./data`
- `LOG_LEVEL`：默认 `info`

## Docker 部署

```bash
docker build -t easysticker .
docker run --rm -p 3000:3000 -e DATA_DIR=/app/data -v "$PWD/data:/app/data" easysticker
```

