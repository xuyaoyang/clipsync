# 数据模型定义 — ClipSync

## 1. ClipItem（同步内容）

```typescript
interface ClipItem {
  id: string;           // UUID v4，唯一标识
  type: 'text' | 'image' | 'file';
  content: string;      // 文字内容；图片/文件为存储路径引用
  fileName: string | null;   // 原始文件名
  fileSize: number | null;   // 文件大小（字节）
  mimeType: string | null;   // MIME 类型，如 "image/png"
  filePath: string | null;   // 服务器端内部字段，不通过 API/WebSocket 返回
  createdAt: number;    // 创建时间戳（毫秒）
  expiresAt: number;    // 过期时间戳 = createdAt + 86400000
  sourceDevice: string; // 来源设备 ID
}
```

### 数据库表结构

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
CREATE INDEX idx_items_created_at ON items(created_at);
```

### 状态转换

```
[创建] → 活跃（expiresAt > now）
         ↓
      已过期（expiresAt ≤ now）
         ↓
     [定时清理] → 从数据库和磁盘删除
```

---

## 2. AuthorizedDevice（已授权设备）

```typescript
interface AuthorizedDevice {
  id: string;           // 设备唯一 ID（客户端生成并存储）
  name: string;         // 设备名称
  platform: string;     // 'win32' | 'ipados' | 'harmonyos' | 'other'
  token: string;        // 授权 Token（服务器生成，64 位随机字符串）
  authorizedAt: number; // 授权时间戳
  lastSeenAt: number;   // 最后在线时间戳
}
```

### 数据库表结构

```sql
CREATE TABLE IF NOT EXISTS authorized_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  authorized_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE INDEX idx_devices_token ON authorized_devices(token);
```

### 设备生命周期

```
[未知设备] → 发送连接请求 → [待审批] → 用户批准 → [已授权]
                                                    ↓
                                         用户移除授权 → [已移除]
```

---

## 3. PendingDevice（待审批设备，仅内存）

```typescript
interface PendingDevice {
  id: string;
  name: string;
  platform: string;
  ipAddress: string;
  requestedAt: number;
}
```

不持久化到数据库。服务器重启后待审批列表清空，设备需重新请求。

---

## 4. 客户端本地存储

移动端浏览器使用 localStorage 存储：

| Key | 值 | 说明 |
|-----|-----|------|
| `deviceId` | UUID | 设备唯一标识 |
| `deviceName` | string | 设备名称 |
| `token` | string | 服务器颁发的授权 Token |
| `lastSyncAt` | number | 上次同步时间戳 |
| `cachedItems` | JSON[] | 本地缓存的内容列表（用于离线查看） |

---

## 5. 文件存储规范

- 图片/文件存储在 `data/files/<item-id>/` 目录下
- 保留原始文件名
- 24 小时过期时连同目录一起删除
- 文件路径存储在 `items.file_path` 字段
- `items.file_path` 仅供服务端下载和清理使用，不暴露给前端 API 或 WebSocket 消息

### 目录示例

```
data/
├── files/
│   ├── uuid-1/
│   │   └── screenshot.png
│   ├── uuid-2/
│   │   └── document.pdf
│   └── ...
└── clipsync.db          # SQLite 数据库文件
```
