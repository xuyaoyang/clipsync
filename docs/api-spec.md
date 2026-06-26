# API 接口规范 — ClipSync

## 基础信息

- 协议：HTTP/1.1
- 格式：JSON
- 编码：UTF-8
- 端口：9527
- 基路径：`/api`

## 认证机制

除 WebSocket 连接请求外，所有已授权 API 需在请求头中携带 Token：

```
Authorization: Bearer <token>
```

WebSocket 连接时在 URL 参数中携带：

```
ws://<host>:9527/api/connect?deviceId=<id>&token=<token>&name=<name>&platform=<platform>
```

---

## 1. 内容接口

### 1.1 获取内容列表

```
GET /api/items?type=text&limit=50&offset=0
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 否 | 筛选类型：text / image / file，不传返回全部 |
| limit | number | 否 | 每页数量，默认 50，最大 200 |
| offset | number | 否 | 偏移量，默认 0 |

**成功响应 (200)：**
```json
{
  "items": [
    {
      "id": "uuid-string",
      "type": "text",
      "content": "文字内容",
      "fileName": null,
      "fileSize": null,
      "mimeType": "text/plain",
      "createdAt": 1716998400000,
      "expiresAt": 1717084800000,
      "sourceDevice": "我的电脑"
    }
  ],
  "total": 42
}
```

### 1.2 创建内容（文字）

```
POST /api/items
Content-Type: application/json
```

**请求体：**
```json
{
  "type": "text",
  "content": "要同步的文字内容",
  "sourceDevice": "我的电脑"
}
```

**成功响应 (201)：**
```json
{
  "id": "uuid-string",
  "type": "text",
  "content": "要同步的文字内容",
  "createdAt": 1716998400000,
  "expiresAt": 1717084800000,
  "sourceDevice": "我的电脑"
}
```

### 1.3 创建内容（图片/文件）

```
POST /api/items
Content-Type: multipart/form-data
```

**表单字段：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 是 | "image" 或 "file" |
| file | file | 是 | 文件二进制数据 |
| sourceDevice | string | 是 | 来源设备名称 |

**成功响应 (201)：** 同 1.2，但包含 fileName、fileSize、mimeType

### 1.4 获取单条内容

```
GET /api/items/:id
```

**成功响应 (200)：** 返回单条 ClipItem

### 1.5 下载文件

```
GET /api/items/:id/file
```

**成功响应 (200)：** 返回文件二进制流（Content-Type 为原始 MIME 类型）

### 1.6 增量同步

```
POST /api/items/sync
Content-Type: application/json
```

**请求体：**
```json
{
  "lastSyncAt": 1716998400000,
  "knownIds": ["id1", "id2"]
}
```

**成功响应 (200)：**
```json
{
  "newItems": [...],
  "deletedIds": ["id3"],
  "serverTime": 1717084800000
}
```

---

## 2. WebSocket 消息

### 连接

```
ws://<host>:9527/api/connect?deviceId=<id>&token=<token>&name=<name>&platform=<platform>
```

### 消息格式（统一）

```json
{
  "type": "message_type",
  "payload": {},
  "timestamp": 1716998400000
}
```

### 消息类型

| type | 方向 | 说明 | payload |
|------|------|------|---------|
| `welcome` | Server→Client | 连接成功 | `{ serverVersion, deviceCount }` |
| `auth_required` | Server→Client | 需要授权 | `{ message }` |
| `auth_rejected` | Server→Client | 授权被拒 | `{ message }` |
| `new_item` | Server→Client | 新内容通知 | ClipItem 对象 |
| `item_deleted` | Server→Client | 内容被删除 | `{ id }` |
| `device_online` | Server→Client | 设备上线 | `{ deviceId, deviceName, platform }` |
| `device_offline` | Server→Client | 设备下线 | `{ deviceId }` |

---

## 3. 设备管理接口（仅服务器端）

### 3.1 获取待审批设备

```
GET /api/devices/pending
```

### 3.2 审批设备

```
POST /api/devices/approve
Content-Type: application/json
```

```json
{
  "deviceId": "abc123",
  "action": "approve",     // "approve" | "reject"
  "remember": true         // 是否记住
}
```

### 3.3 已授权设备列表

```
GET /api/devices
```

### 3.4 移除设备

```
DELETE /api/devices/:id
```

---

## 4. 电脑互联接口

### 4.1 获取局域网电脑状态

```
GET /api/peers
```

**成功响应 (200)：**
```json
{
  "peers": [
    {
      "id": "server-device-id",
      "name": "DESKTOP-ABC",
      "host": "192.168.1.20",
      "port": 9527,
      "status": "connected",
      "last_seen_at": 1716998400000,
      "updated_at": 1716998400000
    }
  ]
}
```

### 4.2 手动重连电脑

```
POST /api/peers/:id/reconnect
```

**成功响应 (200)：**
```json
{ "success": true }
```

---

## 5. 错误响应格式

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "设备未授权，请等待管理员审批"
  }
}
```

### 错误码

| HTTP 状态码 | code | 说明 |
|-------------|------|------|
| 400 | `BAD_REQUEST` | 请求参数错误 |
| 401 | `UNAUTHORIZED` | 未授权 |
| 404 | `NOT_FOUND` | 内容不存在或已过期 |
| 413 | `FILE_TOO_LARGE` | 文件过大 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |
