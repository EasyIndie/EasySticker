# Pi 本地配置

## 自定义指令

`extensions/dev-commands.ts` 为本项目注册了一个 pi 用户指令：

| 指令 | 对应命令 | 用途 |
| --- | --- | --- |
| `/dev` | `npm run dev` | 后端开发服务（http://localhost:3000/） |

支持子操作，不带参数时默认 `start`。**默认仅本机可访问**，需要让局域网其它设备
访问时用 `lan`：

```text
/dev              # 启动后端，仅本机（HOST=127.0.0.1）
/dev lan          # 启动/切换后端为局域网模式（HOST=0.0.0.0，用本机 IP:3000 访问）
/dev status       # 查看运行状态与当前访问模式
/dev logs         # 查看最近日志
/dev restart      # 重启（沿用上次 start/lan 选择的模式）
/dev stop         # 停止
```

访问模式说明：

- **local（默认）**：后端绑定 `127.0.0.1`，只有本机能访问。
- **lan**：后端绑定 `0.0.0.0`（通过 `HOST=0.0.0.0` 环境变量）。局域网设备用本机的
  局域网 IP 加端口访问（如 `http://192.168.x.x:3000`）。

服务在后台运行，不会随 pi 退出而关闭。PID、日志与访问模式写入 `.pi/run/`
（已在 `.gitignore` 中忽略）。

> 开发环境、npm 脚本与测试的完整说明见 [`docs/development.md`](../docs/development.md)。

## 生效方式

- 首次使用需在会话里执行 `/trust` 授予项目信任，然后 `/reload` 重新加载资源。
- 之后输入 `/` 即可在补全菜单中看到 `dev`。

## 想全局可用？

把 `extensions/dev-commands.ts` 复制到 `~/.pi/agent/extensions/` 即可在所有项目中生效（指令会作用于当前会话的工作目录）。若只想个人使用而不改动仓库，也可放到该目录。
