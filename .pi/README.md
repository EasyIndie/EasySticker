# Pi 本地配置

## 自定义指令

`extensions/dev-commands.ts` 为本项目注册了两个 pi 用户指令：

| 指令 | 对应命令 | 用途 |
| --- | --- | --- |
| `/dev` | `npm run dev` | 后端开发服务（http://localhost:3000/） |
| `/web` | `npm run web:dev` | 前端开发服务（http://localhost:5173/） |

两者支持相同的子操作，不带参数时默认 `start`：

```text
/dev              # 启动后端（已在运行则只提示）
/dev status       # 查看运行状态
/dev logs         # 查看最近日志
/dev restart      # 重启
/dev stop         # 停止
/web start        # 启动前端
```

服务在后台运行，不会随 pi 退出而关闭。PID 与日志写入 `.pi/run/`（已在 `.gitignore` 中忽略）。

## 生效方式

- 首次使用需在会话里执行 `/trust` 授予项目信任，然后 `/reload` 重新加载资源。
- 之后输入 `/` 即可在补全菜单中看到 `dev`、`web`。

## 想全局可用？

把 `extensions/dev-commands.ts` 复制到 `~/.pi/agent/extensions/` 即可在所有项目中生效（指令会作用于当前会话的工作目录）。若只想个人使用而不改动仓库，也可放到该目录。
