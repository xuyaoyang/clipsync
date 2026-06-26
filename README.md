# ClipSync

ClipSync 是一个局域网跨设备内容同步工具，用来在 Windows 电脑、iPadOS 平板和 HarmonyOS 手机之间同步文字、图片和文件。

当前版本以 Windows Electron 桌面端为核心：电脑启动后会在局域网内提供同步服务，手机或平板通过浏览器访问电脑地址即可使用。

## 主要功能

- 文字、图片、文件同步
- 局域网 HTTP + WebSocket 实时推送
- mDNS 局域网设备发现
- 新设备连接审批和授权管理
- 内容 24 小时后自动过期清理
- 二维码扫码连接
- Windows 托盘运行和开机自启
- PWA 资源支持，移动端可添加到主屏幕

## 运行环境

- Windows 10 或 Windows 11
- Node.js 18+
- npm

项目使用 Electron、Express、ws、bonjour、better-sqlite3 和原生 HTML/CSS/JS。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动 Windows 桌面端

推荐在 Windows 上双击运行：

```text
start-electron.bat
```

也可以在支持类 Unix 环境变量语法的终端中运行：

```bash
npm run electron
```

启动后，电脑端默认监听：

```text
http://127.0.0.1:9527
```

如果 9527 被占用，程序会自动尝试后续端口。

### 3. 手机或平板连接

1. 确保手机、平板和电脑在同一个 Wi-Fi 或同一个局域网内。
2. 在电脑端查看二维码或局域网访问地址。
3. 用手机浏览器访问类似下面的地址：

```text
http://电脑局域网IP:9527
```

4. 首次连接时，在电脑端审批新设备。

如果手机无法访问，请检查 Windows 防火墙是否允许 ClipSync 或 TCP 9527 入站连接。

## 常用命令

```bash
# 启动后端服务，主要用于接口调试
npm start

# 开发模式启动后端服务
npm run dev

# 启动 Electron 桌面端
npm run electron

# 打包 Windows 安装程序
npm run build
```

注意：`better-sqlite3` 是原生模块。如果本机 Node.js ABI 与 Electron ABI 不一致，单独运行 `npm start` 可能失败；最终验证请以 Electron 桌面端或打包产物为准。

## 项目结构

```text
同步程序/
├── docs/                  # 需求、架构、API、数据模型、开发步骤和变更记录
├── devlog/                # 每次开发会话日志
├── scripts/               # 图标生成、调试和维护脚本
├── src/
│   ├── main/              # Electron 主进程、托盘、preload
│   ├── server/            # HTTP、WebSocket、mDNS 和加密工具
│   ├── database/          # SQLite 数据访问
│   └── web/               # 前端页面、样式、脚本和 PWA 资源
├── data/                  # 本地运行数据，不提交到 Git
├── dist/                  # 打包输出，不提交到 Git
└── package.json
```

## 数据与安全

- 同步内容默认保存 24 小时，到期自动清理。
- 首次连接的新设备需要电脑端审批。
- 已授权设备使用 token 认证。
- 支持 Web Crypto 的环境会尝试加密传输；不支持的局域网 HTTP 环境会自动降级为明文传输。
- 本工具面向可信局域网使用，不建议暴露到公网。

## 开发规范

开发前请先阅读：

- `AGENTS.md`
- `docs/dev-steps.md`
- `docs/changelog.md`
- 涉及功能对应的 `docs/*.md`

每次开发会话需要更新：

- `devlog/YYYY-MM-DD.md`
- `docs/changelog.md`

## GitHub 上传前检查

```bash
git status
git log --oneline --max-count=5
```

确认只提交源码、文档和配置文件，不提交：

- `node_modules/`
- `dist/`
- `data/` 运行数据
- 本地日志、缓存、临时文件

## 许可证

MIT
