# EasySticker 文档索引

> **维护原则：文档只保留两类 —— 描述「当前实现」的活文档，和明确标注为只读的历史/业务材料。**
> 没有第三类。任何「写了但没人维护」的中间态都会在几周内变成误导。

## 活文档（改代码时同步更新）

| 文档 | 回答什么问题 | 什么时候必须改 |
|------|-------------|---------------|
| [../README.md](../README.md) | 这是什么、能做什么、怎么跑起来 | 新增/删除用户可见功能；改快速开始或 Docker 部署步骤 |
| [development.md](development.md) | 本地怎么开发、有哪些命令、代码怎么组织 | 改脚本 / 目录结构 / 测试方式 / 编码约定 |
| [architecture.md](architecture.md) | 代码怎么分层、为什么这么设计、还欠什么 | 改模块边界；做出一项值得记住的技术决策；完成/新增待办项 |
| [configuration-reference.md](configuration-reference.md) | 每个配置项和环境变量是什么、默认值多少 | 增删配置项或环境变量 |
| [pack-format.md](pack-format.md) | 存储模型、ZIP 结构、`metadata.json` 字段 | 改 metadata schema、打包结构、保留期语义 |
| [operations.md](operations.md) | 怎么部署、怎么排障、数据怎么清理和备份 | 改部署方式；加环境变量（同步写进配置参考）；改清理策略 |
| [../CHANGELOG.md](../CHANGELOG.md) | 每个版本改了什么 | 每次发版 |

## 仓库级规范

| 文件 | 说明 |
|------|------|
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献流程、提交规范、可认领方向 |
| [../SECURITY.md](../SECURITY.md) | 安全模型与漏洞上报渠道 |

## 只读材料（不随代码更新）

| 文档 | 说明 |
|------|------|
| [history.md](history.md) | 已落地改造与关键决策的记录。**描述的是当时的状态，不是现状**。细节看 `git log` |
| [business/](business/) | 市场调研与运营策略。与代码实现解耦，日期即调研时点 |
| [internal/HANDOFF.md](internal/HANDOFF.md) | 会话接力说明（内部产物）。基线数字一律以命令输出为准 |

## 参考实现（不是文档，但比文档更可信）

- **接口契约**：`src/shared/contracts.ts`（zod schema）+ `/docs`（Swagger UI）
- **全部配置项与默认值**：`prompt-config.default.json`
- **全部环境变量与默认值**：`.env.example`
- **全部 HTTP 路由**：`src/routes/*.ts`
- **测试现状**：`npm test` / `npm run test:e2e` 输出的数字就是唯一事实来源，文档里不写死
- **文档体检**：`npm run docs:check` 校验内部链接与锚点

## 刻意不写文档的部分

以下内容以前有独立文档，已合并或删除 —— 因为它们的维护成本高于价值：

- **测试报告**：测试结果的快照几天就过期。跑 `npm test` / `npm run test:e2e` 即可。
- **日志配置**：Pino 到 stdout + 环境变量，已并入 [operations.md](operations.md)。
- **压测脚本**：几条 autocannon 命令，已并入 [operations.md](operations.md)。
- **HTTP provider 契约**：`type: "http"` 提供商已删除（生图统一走 OpenAI 兼容），契约文档随之作废。
- **单次改造的实施记录**（认证重构、UX v2、多平台）：已压缩进 [history.md](history.md)，
  实现细节交给 `git log -p`。
