# 技术架构设计 — ClipSync

## 1. 总体架构

```
┌─────────────────────────────────────────────┐
│              同步核心（Web 应用）              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ 局域网发现 │  │ 内容同步  │  │ 24h 过期   │  │
│  │ (mDNS)   │  │ (HTTP)   │  │ (定时清理)  │  │
│  └──────────┘  └──────────┘  └───────────┘  │
│         一套 UI：HTML + CSS + JS              │
│         颜色主题：淡蓝色 #F0F7FF              │
└─────────────────────────────────────────────┘
         │            │              │
    ┌────▼────┐  ┌────▼────┐  ┌─────▼─────┐
    │ Windows │  │ iPadOS  │  │ HarmonyOS │
    │ Electron│  │ PWA     │  │ PWA       │
    │ 桌面App │  │ 浏览器   │  │ 浏览器    │
    └─────────┘  └─────────┘  └───────────┘
```

## 2. 技术选型

| 层次 | 技术 | 版本要求 | 选型理由 |
|------|------|----------|----------|
| 桌面框架 | Electron | ≥ 28.x | 成熟稳定，Node.js 生态丰富 |
| 后端服务 | Express | ≥ 4.x | 轻量 HTTP 框架 |
| 实时通信 | ws (WebSocket) | ≥ 8.x | 轻量 WebSocket 库 |
| 设备发现 | bonjour | ≥ 3.x | Node.js mDNS 实现 |
| 数据库 | better-sqlite3 | ≥ 9.x | 同步 SQLite，无需额外安装 |
| 前端 | 原生 HTML/CSS/JS | — | 零依赖，减少复杂度 |
| 打包 | electron-builder | ≥ 24.x | 打包为 exe 安装程序 |
| UUID | uuid | ≥ 9.x | 生成唯一 ID |

## 3. 模块架构

```
src/
├── main/
│   ├── main.js          # Electron 主进程入口
│   ├── tray.js          # 系统托盘管理
│   └── preload.js       # 预加载脚本（安全桥接）
├── server/
│   ├── index.js         # 服务器启动入口
│   ├── http-server.js   # Express HTTP 服务器
│   ├── websocket.js     # WebSocket 管理
│   ├── mdns.js          # mDNS 广播与扫描
│   ├── auth.js          # 设备授权管理
│   └── routes/
│       ├── items.js     # 内容 CRUD 路由
│       └── devices.js   # 设备管理路由
├── database/
│   ├── index.js         # 数据库初始化
│   ├── items.js         # 内容表操作
│   └── devices.js       # 设备表操作
└── web/
    ├── index.html       # 主页面
    ├── css/
    │   └── style.css    # 样式
    ├── js/
    │   ├── app.js       # 主逻辑
    │   ├── api.js       # API 调用封装
    │   ├── ws.js        # WebSocket 客户端
    │   └── ui.js        # UI 渲染
    └── assets/
        └── icon.svg     # 应用图标
```

## 4. 通信协议

### 4.1 HTTP REST API
- 基路径：`http://<server-ip>:9527/api`
- 格式：JSON
- 文件上传：`multipart/form-data`

### 4.2 WebSocket
- 端点：`ws://<server-ip>:9527/api/connect`
- 首次连接携带设备信息和 token
- 消息类型：
  - `new_item` — 新内容通知
  - `item_deleted` — 内容被删除
  - `device_online` — 设备上线
  - `device_offline` — 设备下线
  - `sync_request` — 请求同步
  - `sync_response` — 同步响应

### 4.3 mDNS
- 服务类型：`_clipsync._tcp.local`
- 端口：9527
- TXT 记录：`{ version: "1.0", platform: "win32" }`

## 5. 数据库设计

### 5.1 内容表 (items)
```sql
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('text', 'image', 'file')),
  content TEXT,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  file_path TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  source_device TEXT NOT NULL
);

CREATE INDEX idx_items_expires_at ON items(expires_at);
CREATE INDEX idx_items_type ON items(type);
```

### 5.2 设备表 (authorized_devices)
```sql
CREATE TABLE IF NOT EXISTS authorized_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  authorized_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
```

## 6. 安全模型

- 网络层：仅绑定局域网 IP（0.0.0.0 但路由器不转发 mDNS）
- 应用层：Token 认证 + 白名单
- 数据层：24h 自动销毁

## 7. 部署架构

- Windows：Electron 打包为便携版或 NSIS 安装包
- 移动端：静态 Web 页面，通过 PC 的 HTTP 服务访问
- PWA：Service Worker 缓存静态资源，Manifest 实现桌面图标
