# 文档中心

EasySticker 的文档按**读者任务**组织，而不是按代码目录堆文件。先在下表找到你的角色，
再按推荐顺序阅读即可。

> 文档分三类：**描述当前实现的活文档**、**明确标注为只读的历史 / 业务材料**，
> 以及随流程维护的**项目规范**（CONTRIBUTING / SECURITY / CHANGELOG）。
> 不属于这三类的内容不要新建文档。

---

## 按角色阅读

| 我是… | 推荐顺序 | 目标 |
|-------|---------|------|
| 第一次听说这个项目 | [项目介绍](../README.md) → [使用手册](usage.md) | 判断它是否解决我的问题 |
| 想部署到服务器 | [部署指南](deployment.md) → [配置参考](configuration-reference.md) → [运维手册](operations.md) | 安全上线并知道怎么维护 |
| 想二次开发 | [开发指南](development.md) → [架构设计](architecture.md) → [路线图](roadmap.md) | 能跑起来、改得动 |
| 正在排障 | [运维手册 · 排障速查](operations.md#7-排障速查) → [配置参考](configuration-reference.md) | 快速定位原因 |
| 想贡献代码 | [CONTRIBUTING](../CONTRIBUTING.md) → [开发指南](development.md) → [路线图](roadmap.md) | 找到可认领的切入点 |
| 要对接产物 / 写脚本 | [包格式](pack-format.md) → [配置参考](configuration-reference.md) | 读懂 ZIP 与数据目录 |

---

## 文档地图

### 入门

| 文档 | 回答什么 | 什么时候必须更新 |
|------|---------|-----------------|
| [../README.md](../README.md) | 这是什么、能做什么、怎么在 5 分钟内跑起来 | 新增 / 删除用户可见功能；改快速开始或部署入口 |
| [usage.md](usage.md) | 每个功能怎么用，完整操作流程是什么 | 改 UI 流程、平台规则、编辑 / 还原行为 |

### 部署、配置与运维

| 文档 | 回答什么 | 什么时候必须更新 |
|------|---------|-----------------|
| [deployment.md](deployment.md) | 怎么部署、怎么加反代、上线前要检查什么 | 改部署方式、镜像、反向代理或安全基线 |
| [configuration-reference.md](configuration-reference.md) | 每个配置项 / 环境变量是什么、默认值多少 | 增删配置项或环境变量 |
| [operations.md](operations.md) | 日志、存储、备份、压测、告警、排障怎么做 | 改清理策略、备份方式、监控指标或排障结论 |

### 开发

| 文档 | 回答什么 | 什么时候必须更新 |
|------|---------|-----------------|
| [development.md](development.md) | 本地怎么开发、有哪些命令、代码怎么组织、怎么测试 | 改脚本 / 目录结构 / 测试方式 / 编码约定 |
| [architecture.md](architecture.md) | 代码怎么分层、关键设计决策与理由、扩展点在哪 | 改模块边界；做出一项值得记住的技术决策 |
| [roadmap.md](roadmap.md) | 接下来要做什么、哪些可以认领 | 完成 / 新增 / 调整待办项 |
| [pack-format.md](pack-format.md) | 服务端怎么存、ZIP 与 `metadata.json` 长什么样 | 改 metadata schema、打包结构、保留期语义 |

### 版本与项目规范

| 文档 | 说明 |
|------|------|
| [../CHANGELOG.md](../CHANGELOG.md) | 面向使用者的版本变更（发版时更新） |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献流程、提交规范、可认领方向 |
| [../SECURITY.md](../SECURITY.md) | 安全模型与漏洞上报渠道 |

### 只读材料

这些文档描述**当时的状态**，不随代码更新。需要现状时以活文档和代码为准。

| 文档 | 说明 |
|------|------|
| [history.md](history.md) | 已落地的改造与关键决策记录；细节看 `git log` |
| [business/](business/) | 市场调研与运营策略，日期即调研时点 |
| [internal/HANDOFF.md](internal/HANDOFF.md) | 内部会话交接说明，不属于公开产品文档 |

---

## 事实来源

文档会腐烂，代码不会。以下内容优先相信代码与命令输出：

| 内容 | 唯一事实来源 |
|------|-------------|
| 接口契约 | `src/shared/contracts.ts`（zod）+ `/docs`（Swagger UI） |
| 全部配置项与默认值 | `prompt-config.default.json` |
| 全部环境变量与默认值 | `.env.example` |
| HTTP 路由清单 | `src/routes/*.ts` |
| 平台规格 | `src/services/platform/presets.ts` |
| 测试现状 | `npm test` / `npm run test:e2e` 的输出（文档不写死数量） |

---

## 维护规则

1. **改代码时同步改对应活文档**：对照上面的「什么时候必须更新」列。
2. **新增配置项 / 环境变量**：同时更新 `prompt-config.default.json`、`.env.example`
   和 [configuration-reference.md](configuration-reference.md)。
3. **改用户可见流程**：更新 [usage.md](usage.md)，必要时同步 README 的能力清单。
4. **改部署 / 清理 / 备份策略**：更新 [deployment.md](deployment.md) 或 [operations.md](operations.md)，
   并检查 [SECURITY.md](../SECURITY.md) 的部署基线是否需要同步。
5. **完成路线图项**：把 [roadmap.md](roadmap.md) 的 `[ ]` 改为 `[x]`，必要时在
   [architecture.md](architecture.md) 补一条设计决策。

### 写作约定

- 中文正文；标题不使用 emoji；每篇开头写清「本文负责什么、不负责什么」。
- 用相对链接；带章节锚点时必须能在目标文件里找到对应标题。
- 配置默认值只写在 [configuration-reference.md](configuration-reference.md)，
  其它文档引用它，避免同一默认值在多个地方漂移。
- 不写死测试数量、RPS 等易过期数字；需要时给命令或标注测量环境。

### 文档体检

```bash
npm run docs:check   # 校验所有 Markdown 的相对链接与锚点
```

CI 会在每次提交时执行；重命名文件或调整标题后务必本地跑一遍。
