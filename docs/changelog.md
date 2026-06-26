# 变更记录 — ClipSync

## [Unreleased] — v1.0.0 (开发中)

### 2026-06-26
- 新增 GitHub 项目 README，补充项目介绍、运行方式、手机连接说明、目录结构和上传前检查。
- 新增 `.gitignore`，排除 `node_modules/`、`dist/`、`data/` 运行数据和本地临时文件。
- 新增 `.gitattributes`，统一文本和 Windows 脚本换行规则。
- 新增 `data/.gitkeep`，保留运行数据目录结构但不提交本地同步内容。
- 初始化 Git 版本控制准备工作。

### 2026-06-24
- 重新打包并覆盖安装包含 2026-06-17 修复的 ClipSync。
- 验证安装版监听 `0.0.0.0:9527`，本机及局域网地址均可正常访问。
- 添加 Windows 专用网络防火墙规则：TCP 9527 和 UDP 5353。

### 2026-06-17
- 修复安装版打开后空白页：
  - 打包后数据目录从安装目录改为用户数据目录，避免 `Program Files` 无写入权限导致 SQLite 打开失败。
  - Electron 窗口关闭 preload 沙盒，修复 preload 中 `require('os')` 无法加载的问题。
- 打包配置改为优先使用本地 Electron 运行时，减少打包时下载 Electron 失败的概率。

### 2026-05-29
- 🏗️ 项目初始化
  - 创建项目目录结构
  - 编写需求规格说明
  - 编写技术架构设计
  - 编写 UI 设计规范
  - 编写 API 接口规范
  - 编写数据模型定义
  - 编写开发执行步骤
  - 编写 CLAUDE.md 助手指引
- 🚀 核心功能实现
  - npm 项目初始化 + 依赖安装
  - SQLite 数据库（内容表 + 设备表 + WAL 模式）
  - HTTP 服务器（Express, 端口 9527）
  - WebSocket 实时推送 + 设备授权握手
  - mDNS 局域网广播与发现
  - 设备授权模块（白名单 + Token 认证 + 审批流程）
  - 核心 API（内容 CRUD、文件上传、增量同步、设备管理）
  - 24h 过期机制（定时清理 + 启动清理）
  - 前端界面（HTML/CSS/JS，淡蓝色主题、三种内容卡片）
  - Electron 主进程集成（内嵌后端 + start-electron.bat）
- 🎨 设备授权 UI
  - 审批弹窗（居中弹出，接受/拒绝按钮）
  - 设备管理侧滑面板（已授权列表 + 待审批列表 + 本机信息）
  - 角标通知（待审批数量 badge）
  - 本地连接自动授权（127.0.0.1 / ::1）
- 📱 PWA 适配
  - manifest.json（全屏、主题色、图标）
  - Service Worker（离线缓存 + 网络优先 API）
  - 图标生成脚本（192x192 + 512x512 PNG）

### 2026-05-30
- 🐛 Bug 修复
  - 修复设备管理面板无法关闭（CSS [hidden] 优先级问题）
  - 修复多图片只显示第一张（DB snake_case ↔ 前端 camelCase 字段映射）
  - 修复手机一次性选多张照片只收到一张：
    - `FileList` → `Array.from()` 转换（手机浏览器迭代兼容性）
    - `sendFiles` 改为 `await`，避免提前 `e.target.value = ''` 释放文件引用
    - JSON body 限制 10MB → 50MB（手机照片 base64 编码后可能超 10MB）
  - 修复 HEIC/HEIF 文件无法预览：
    - 服务器检测 HEIC/HEIF MIME，归类为 `file` 而非 `image`
    - `<img>` 标签添加 `onerror` 兜底（加载失败时显示文件图标占位）
  - 修复 Service Worker 缓存导致前端代码不更新
    - `CACHE_NAME` 升级为 `clipsync-v3`
    - HTML/JS 改为网络优先策略
    - 添加 SW 更新检测 → 自动刷新页面
  - 修复大文件上传失败（>50MB）：
    - JSON+base64 → multipart/form-data（multer）
    - 文件大小限制 50MB → 500MB，无 base64 膨胀
  - 修复中文文件名乱码：
    - 新增 `fixFileNameEncoding()` 处理双重 UTF-8 编码
    - 下载响应头改用 RFC 5987 `filename*=UTF-8''` 编码
- ✨ 新功能
  - 二维码扫码连接：电脑端生成二维码（`/api/qrcode`），手机扫码直接打开 ClipSync
- 🖥️ Electron 集成
  - 系统托盘（tray.js）：最小化到托盘、右键菜单、双击恢复窗口
  - 开机自启：`app.setLoginItemSettings`，支持 `--hidden` 参数静默启动
  - electron-builder 打包配置：NSIS 安装包，77MB
  - 修复启动报错：`ELECTRON_RUN_AS_NODE=1` 环境变量导致 Electron 以纯 Node.js 运行
    - `package.json` electron 脚本加 `unset ELECTRON_RUN_AS_NODE`
    - `start-electron.bat` 加 `set ELECTRON_RUN_AS_NODE=`
  - 中文菜单栏（文件/编辑/视图/帮助）+ 单实例锁（重复启动激活已有窗口）

### 2026-05-31
- 🔐 端到端加密
  - ECDH (P-256) 密钥协商 + AES-256-GCM 内容加密
  - 浏览器端：Web Crypto API（CryptoClient），localStorage 持久化主密钥
  - 服务端：Node.js crypto 模块，主密钥存 SQLite settings 表
  - WebSocket 握手时自动完成密钥交换，API 请求/响应自动加解密
  - 文件下载 URL 不加密（直接传输），上传的 multipart 文件体不加密
- 📋 剪贴板自动监听
  - 主进程每 1.5 秒轮询剪贴板（文字 + 图片），去重后推送给前端自动同步
  - 设备管理面板底部有开关（默认关闭），状态存 localStorage
  - 仅 Electron 环境可用，浏览器中开关自动隐藏
- 🐛 修复手机浏览器无法连接
  - 非安全上下文（HTTP LAN IP）下 Web Crypto API 不可用，CryptoClient 自动降级为明文传输
  - API 请求头 `X-ClipSync-Encryption` 告知服务器是否支持加密，服务器按需加密响应
  - WebSocket 广播按客户端分别处理：支持加密的发密文，不支持的发明文
- 📱 响应式布局微调
  - 媒体查询断点：≤374px / 375-430px / 431-768px / ≤400px
  - 触控目标 ≥ 44px（iOS 无障碍标准）
  - Toast 消息改为 CSS class，移动端居中不截断
  - iOS 平滑滚动 (`-webkit-overflow-scrolling: touch`)
  - `apple-mobile-web-app-capable` 全屏模式
  - 文件输入 `accept` 属性支持拍照（移动端相机/相册）
  - 设备面板/弹窗移动端全宽
  - 输入框 iOS 字体 16px 防自动缩放
  - safe-area-inset-bottom 适配刘海屏

### 2026-06-01
- 🎨 自定义应用图标
  - 蓝色渐变圆角矩形 + 白色剪贴板 + 双箭头同步图标
  - 纯 JS PNG 生成脚本 (`scripts/make-icons.js`)，无需额外依赖
  - 覆盖 16/32/48/64/128/192/256/512 所有尺寸
- 🐛 修复：移除设备时强制断开 WebSocket 连接
- 🐛 修复：被拒/被撤后停止自动重连，不再反复弹审批窗
- 🐛 修复：`uploadFile` 缺少 Authorization 头导致 401
- 🐛 修复：API 鉴权中间件防止未授权设备查看历史消息
- 🐛 修复：数据库 snake_case → camelCase 字段统一映射
- 🐛 修复：加密格式 Node.js vs Web Crypto 不兼容（authTag 位置）
- 🐛 修复：端口被占用时自动尝试下一个端口，不再崩溃
- 🐛 修复：手机浏览器无法连接（Web Crypto 非安全上下文降级）
- 🐛 修复：发送后不实时显示（API 响应直接更新 UI + WebSocket 广播）

---

## 版本号规范

格式：`v<主版本>.<次版本>.<修订号>`

| 类型 | 说明 |
|------|------|
| 主版本 | 重大架构变更、不兼容的 API 修改 |
| 次版本 | 新功能添加、向后兼容 |
| 修订号 | Bug 修复、微小改进 |
