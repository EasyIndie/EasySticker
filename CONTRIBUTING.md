# 贡献指南

感谢参与 EasySticker！本文只讲**怎么贡献**；环境、命令、目录、测试细节见
[`docs/development.md`](docs/development.md)，架构取舍见 [`docs/architecture.md`](docs/architecture.md)。

---

## 快速开始

```bash
git clone https://github.com/EasyIndie/EasySticker.git
cd EasySticker
npm install
cp .env.example .env      # 本地默认 Mock 模式，可直接跑
npm run dev               # 后端 http://localhost:3000/
npm run web:dev           # 前端 http://localhost:5173/
```

## 提交前必做

```bash
npm test          # typecheck + 前端 typecheck + build + vitest
npm run docs:check  # 校验文档内部链接 / 锚点
```

改了**前端**代码，还要跑 `npm run web:build` 刷新内容哈希，否则浏览器会一直吃旧缓存。

## 提交规范

- 使用 [Conventional Commits](https://www.conventionalcommits.org/)：
  `feat|fix|docs|chore|perf|refactor|test(scope): 描述`。
- 一个提交只做一件事；描述说清"为什么"，而不只是"改了什么"。
- 破坏性变更在提交正文用 `BREAKING CHANGE:` 说明。

## 代码约定（摘要）

- **契约优先**：请求体校验引用 `src/shared/contracts.ts` 的 zod schema。
- **依赖方向**：`routes → services → lib/domain`；领域层不接收 Fastify 实例，
  依赖经 `lib/deps.ts` 的 `AppDeps` 注入。
- **加配置项 / 环境变量**：同步更新 `prompt-config.default.json`、`.env.example`
  和 `docs/configuration-reference.md`。
- **改文档**：按 [`docs/README.md`](docs/README.md) 的分工更新对应的"活文档"。

## 可以上手的方向

`docs/architecture.md` 的 §4「待迁移（P1–P6）」列着明确的演进路线，
标注 `[ ]` 的都是可认领的项（契约统一、组合根拆分、目录模块化、护栏与 CI 等）。

## 报告问题 / 提 PR

- Bug：用仓库的 Issue 模板，附最小复现、版本、`LOG_LEVEL=debug` 的相关日志。
- 安全漏洞：**不要**开公开 Issue，见 [`SECURITY.md`](SECURITY.md)。
- PR：保持小而聚焦；说明动机与验证方式；关联相关 Issue。

## 许可证

提交即表示你同意以项目的 [Apache-2.0](LICENSE) 许可证发布你的贡献。
