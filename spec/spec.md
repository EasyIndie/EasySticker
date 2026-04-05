# EasySticker 最小化实现规格

## 目标与范围
- 以“微信表情创作最小流程”为目标，跑通：上传主体图 → 提示词 → AI 生成微信规范资产 → 打包 ZIP 下载
- 不做支付、不做自动提审/发布、不做多平台扩展
- UI 保持极简（静态页面），后端提供最少必要 API

## 用户流程
1. 上传一张主体图片并预览
2. 获取提示词模板并允许用户编辑
3. 选择风格与生成数量（8–24），点击生成
4. 生成完成后直接下载 ZIP（内含微信表情专辑资产与 metadata.json）

## 关键约束（微信表情专辑）
- 贴纸：8–24 张，240×240，PNG/JPG/GIF，单张 ≤ 500KB
- 横幅/封面/图标：本版本由系统自动生成并确保满足对应 preset
- 校验仅在服务端内部执行，不对外暴露校验 API

## 架构与接口
- Web UI：单页静态页面，仅提供上传与微信 AI 生成入口
- 配置文件：通过 `prompt-config.json` 统一管理
- AI Provider：支持通过配置中的字典定义多个提供商（如 `mock`, `http`, `doubao` 等），按 `type` 字段区分，并在前端提供切换。
- API：
  - `POST /api/uploads` 上传
  - `GET /api/assets/:id` 读取资产
  - `POST /api/wechat/prompt` 返回提示词模板与风格列表
  - `POST /api/wechat/generate` 生成微信资产并返回 ZIP 下载链接
  - `GET /api/packs/:packId/download` 下载 ZIP

## 约束与非目标
- 不引入重型前端框架
- 不提供发布/提审自动化
- 不提供支付与额度
- 不提供对外校验 API

## 交付物
- 极简 Web UI
- 统一的配置文件 `prompt-config.json`
- AI Provider 抽象与默认 mock
- 微信 AI 生成与 ZIP 导出 API
- 最小单测与文档
