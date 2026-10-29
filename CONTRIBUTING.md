# 贡献指南

感谢参与 EasySticker！本文只讲**怎么贡献**。环境、命令、目录与测试细节见
[开发指南](docs/development.md)，架构与设计取舍见 [架构设计](docs/architecture.md)，
可认领的方向见 [路线图](docs/roadmap.md)。

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
npm test            # typecheck + 前端 typecheck + build + vitest
npm run docs:check  # 校验文档相对链接 / 锚点
```

改了**前端**代码，还要执行 `npm run web:build` 刷新内容哈希，否则浏览器会一直使用旧缓存。

## 提交规范

- 使用 [Conventional Commits](https://www.conventionalcommits.org/)：
  `feat|fix|docs|chore|perf|refactor|test(scope): 描述`。
- 一个提交只做一件事；描述说清「为什么」，而不只是「改了什么」。
- 破坏性变更在提交正文用 `BREAKING CHANGE:` 说明。

## 代码约定

- **契约优先**：请求体校验引用 `src/shared/contracts.ts` 的 zod schema。
- **依赖方向**：`routes → services → lib/domain`；领域层不接收 Fastify 实例，
  依赖经 `lib/deps.ts` 的 `AppDeps` 注入。
- **加配置项 / 环境变量**：同步更新 `prompt-config.default.json`、`.env.example`
  和 [配置参考](docs/configuration-reference.md)。
- **改文档**：按 [文档中心 · 维护规则](docs/README.md#维护规则) 更新对应的活文档。

## 可以上手的方向

[路线图](docs/roadmap.md) 按 P1–P6 列出了明确的演进项，标注 `[ ]` 的都可以认领。
建议先从小的、可独立验证的项开始，例如契约迁移、测试护栏或文档纠错。

## 报告问题 / 提 PR

- Bug：使用仓库的 Issue 模板，附最小复现、版本与 `LOG_LEVEL=debug` 的相关日志。
- 安全漏洞：**不要**开公开 Issue，见 [SECURITY.md](SECURITY.md)。
- PR：保持小而聚焦；说明动机与验证方式；关联相关 Issue。

## 许可证

提交即表示你同意以项目的 [Apache-2.0](LICENSE) 许可证发布你的贡献。
