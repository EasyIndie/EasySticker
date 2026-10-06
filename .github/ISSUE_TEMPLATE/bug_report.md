---
name: Bug 报告
about: 报告可复现的问题
title: "[Bug] "
labels: ["bug"]
---

## 描述

清晰说明发生了什么，以及你期望的结果。

## 复现步骤

1.
2.
3.

## 环境

- EasySticker 版本 / 提交：`git rev-parse --short HEAD`
- 部署方式：源码 / Docker / 其他
- Node 版本：`node -v`
- 浏览器 / 操作系统：
- AI provider：`mock` / `openai` / `seedream` / 其他

## 日志 / 截图

相关日志（建议 `LOG_LEVEL=debug` 复现一次）与截图。**请先脱敏，不要贴 API Key。**

## 是否已自查

- [ ] 已跑 `npm test` 且通过
- [ ] 已查看 [docs/operations.md](../../docs/operations.md) 的「排障速查」
- [ ] 这不是安全问题（安全问题请走 [SECURITY.md](../../SECURITY.md)，勿开公开 Issue）
