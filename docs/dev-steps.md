# 开发执行步骤 — ClipSync

> 本文档追踪每一步的开发进度。每完成一个子任务，标记为 ✅。

## 第 0 步：项目基础设施搭建

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 0.1 | 创建项目目录结构 | ✅ | 2026-05-29 完成 |
| 0.2 | docs/requirements.md | ✅ | 需求规格说明 |
| 0.3 | docs/architecture.md | ✅ | 技术架构设计 |
| 0.4 | docs/design-spec.md | ✅ | UI 设计规范 |
| 0.5 | docs/api-spec.md | ✅ | API 接口规范 |
| 0.6 | docs/data-model.md | ✅ | 数据模型定义 |
| 0.7 | docs/dev-steps.md | ✅ | 本文档 |
| 0.8 | docs/changelog.md | ✅ | 变更记录 |
| 0.9 | CLAUDE.md | ✅ | AI 助手指引 |
| 0.10 | devlog/2026-05-29.md | ✅ | 首日开发日志 |

## 第 1 步：项目初始化

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 1.1 | 初始化 npm 项目（package.json） | ✅ | 2026-05-29 完成 |
| 1.2 | 安装依赖（Electron, Express, ws, bonjour, better-sqlite3, uuid） | ✅ | 使用 npmmirror.com 镜像 |
| 1.3 | 创建 Electron 主进程入口（src/main/main.js） | ✅ | 已更新：启动时内嵌后端服务 |
| 1.4 | 创建预加载脚本（src/main/preload.js） | ✅ | contextBridge API |
| 1.5 | 验证 Electron 窗口能正常启动 | ⚠️ | VS Code bash 终端无法启动 GUI；start-electron.bat 可在资源管理器双击启动 |

## 第 2 步：后端服务模块

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 2.1 | 数据库初始化模块（src/database/index.js） | ✅ | WAL 模式 + 索引导入 |
| 2.2 | HTTP 服务器（src/server/http-server.js） | ✅ | Express，端口 9527 |
| 2.3 | WebSocket 服务（src/server/websocket.js） | ✅ | 实时推送 + 设备授权握手 |
| 2.4 | mDNS 广播与发现（src/server/mdns.js） | ✅ | bonjour 自动发现 |
| 2.5 | 设备授权模块（src/database/devices.js） | ✅ | 白名单 + Token 认证 |
| 2.6 | 服务器启动入口（src/server/index.js） | ✅ | 协调所有模块 |

## 第 3 步：核心功能 API

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 3.1 | 内容 CRUD（内嵌于 http-server.js） | ✅ | GET/POST /api/items |
| 3.2 | 设备审批与管理（内嵌于 http-server.js） | ✅ | GET/POST /api/devices |
| 3.3 | 文件上传处理（base64 JSON） | ✅ | POST /api/upload |
| 3.4 | 增量同步接口 | ✅ | POST /api/items/sync |

## 第 4 步：24 小时过期机制

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 4.1 | 创建内容时自动计算 expiresAt | ✅ | createdAt + 86400000ms |
| 4.2 | 查询时自动过滤过期内容 | ✅ | WHERE expires_at > datetime('now') |
| 4.3 | 定时清理任务（每 60 秒） | ✅ | setInterval(cleanExpired, 60000) |
| 4.4 | 启动时清理 | ✅ | 服务启动时立即清理一次 |

## 第 5 步：前端 Web 界面

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 5.1 | HTML 主结构（src/web/index.html） | ✅ | 顶栏 + 标签 + 列表 + 输入区 |
| 5.2 | CSS 样式（src/web/css/style.css） | ✅ | 淡蓝色主题，响应式 |
| 5.3 | API 调用封装（src/web/js/api.js） | ✅ | fetch + Token 注入 |
| 5.4 | WebSocket 客户端（src/web/js/ws.js） | ✅ | 自动重连 + 指数退避 |
| 5.5 | UI 渲染逻辑（src/web/js/ui.js） | ✅ | 三种卡片 + Toast + 工具函数 |
| 5.6 | 主应用逻辑（src/web/js/app.js） | ✅ | 事件绑定 + 拖拽/粘贴 |
| 5.7 | 文字输入与发送 | ✅ | Enter 发送，自动伸缩 |
| 5.8 | 图片/文件拖拽上传 | ✅ | dragover/drop + paste 图片 |
| 5.9 | 内容卡片渲染（文字/图片/文件） | ✅ | 复制/保存/预览/下载 |
| 5.10 | 分类筛选 | ✅ | 全部/文字/图片/文件 |
| 5.11 | 复制/保存/打开操作 | ✅ | Clipboard API + fallback |
| 5.12 | 设备管理页面 | ✅ | 侧滑面板，显示已授权设备 |
| 5.13 | 设备授权弹窗 | ✅ | 居中弹窗，接受/拒绝按钮 |
| 5.14 | 响应式布局（桌面 + 移动端） | ✅ | CSS 媒体查询 |

## 第 6 步：Electron 集成

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 6.1 | 主窗口加载 Web 界面 | ✅ | 内嵌后端，加载 localhost:9527 |
| 6.2 | 系统托盘（src/main/tray.js） | ✅ | 最小化到托盘、右键菜单、双击恢复 |
| 6.3 | 开机自启选项 | ✅ | app.setLoginItemSettings，支持 --hidden 托盘启动 |
| 6.4 | 打包配置（electron-builder） | ✅ | NSIS 安装包，asar 关闭，数据目录迁移到 userData |
| 6.5 | 打包为 .exe | ✅ | ClipSync Setup 1.0.0.exe (77MB)，NSIS 安装包 |

## 第二阶段：PWA 移动端

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 7.1 | Service Worker | ✅ | 离线缓存 + 网络优先 API |
| 7.2 | Web App Manifest | ✅ | 桌面图标、全屏、主题色 |
| 7.3 | PWA 图标生成 | ✅ | 192x192 + 512x512 PNG |
| 7.4 | 响应式布局微调 | ✅ | 媒体查询（320-768px）、iOS 适配、触控目标、Toast 优化 |
