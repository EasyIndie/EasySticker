# 验收检查表

## MVP
- 上传一张图片后，页面可预览且能复制/看到 referenceAssetId
- 点击“生成提示词”后，prompt 与 styles 自动填充且可编辑
- 点击“生成并打包”后，返回 packId 与可用下载链接
- 下载 ZIP 可解压，包含 assets 与 metadata.json
- AI_PROVIDER=mock 与 AI_PROVIDER=http 均有清晰配置说明
- `npm test` 通过
