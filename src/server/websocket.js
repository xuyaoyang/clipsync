// ClipSync — WebSocket 服务模块
const { WebSocketServer } = require('ws');
const url = require('url');
const devicesDB = require('../database/devices');
const { getMasterKey, generateECDHKeyPair, deriveSharedKey, encrypt } = require('../server/crypto-utils');

let wss = null;
let masterKey = null; // 缓存主密钥
// 已连接客户端映射: deviceId -> { ws, deviceName, platform }
const clients = new Map();
// 待审批队列
const pendingDevices = [];

function getMasterKeyCached() {
  if (!masterKey) {
    masterKey = require('../database').getMasterKey();
  }
  return masterKey;
}

function init(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/api/connect' });

  wss.on('connection', (ws, req) => {
    const params = url.parse(req.url, true).query;
    const { deviceId, token, name, platform, pubkey } = params;

    if (!deviceId) {
      ws.send(JSON.stringify({ type: 'error', payload: { message: '缺少 deviceId' } }));
      ws.close();
      return;
    }

    // 本地连接自动授权（127.0.0.1 或 ::1）
    const isLocal = req.socket.remoteAddress === '127.0.0.1' ||
                    req.socket.remoteAddress === '::1' ||
                    req.socket.remoteAddress === '::ffff:127.0.0.1';

    // 检查授权
    if ((token && devicesDB.isAuthorized(deviceId, token)) || isLocal) {
      // 已授权设备或本地连接，直接接受
      if (isLocal && !(token && devicesDB.isAuthorized(deviceId, token))) {
        const newToken = devicesDB.addDevice({
          id: deviceId,
          name: name || '本机',
          platform: platform || 'win32'
        });
        acceptConnection(ws, deviceId, name, platform);
        ws.send(JSON.stringify({
          type: 'auth_approved',
          payload: { token: newToken.token, isLocal: true, ...buildKeyExchange(pubkey) },
          timestamp: Date.now()
        }));
        return;
      }
      acceptConnection(ws, deviceId, name, platform, pubkey);
    } else {
      // 未授权设备，加入待审批队列
      pendingDevices.push({
        ws, deviceId, name: name || '未知设备', platform: platform || 'other',
        ipAddress: req.socket.remoteAddress, pubkey
      });

      ws.send(JSON.stringify({
        type: 'auth_required',
        payload: { message: '请等待管理员审批' },
        timestamp: Date.now()
      }));

      const pendingInfo = {
        deviceId,
        name: name || '未知设备',
        platform: platform || 'other',
        ipAddress: req.socket.remoteAddress
      };

      console.log(`[WS] 新设备请求连接: ${name} (${platform}) [${deviceId}]`);

      broadcastToAuthorized({
        type: 'pending_device',
        payload: pendingInfo,
        timestamp: Date.now()
      });

      if (global.onPendingDevice) {
        global.onPendingDevice(pendingInfo);
      }
    }
  });

  console.log('[WS] WebSocket 服务已启动');
  return wss;
}

// ECDH 密钥交换：用客户端公钥加密主密钥
function buildKeyExchange(clientPubKeyBase64) {
  if (!clientPubKeyBase64) return {};
  try {
    const key = getMasterKeyCached();
    if (!key) return {};
    const serverECDH = generateECDHKeyPair();
    const sharedKey = deriveSharedKey(serverECDH, Buffer.from(clientPubKeyBase64, 'base64'));
    const encryptedMasterKey = encrypt(key.toString('base64'), sharedKey);
    return {
      serverPubKey: serverECDH.getPublicKey('base64', 'uncompressed'),
      encryptedMasterKey
    };
  } catch (e) {
    console.error('[WS] 密钥协商失败:', e.message);
    return {};
  }
}

function acceptConnection(ws, deviceId, name, platform, pubkey) {
  // 如果同设备已连接，先断开旧连接
  const existing = clients.get(deviceId);
  if (existing) {
    try { existing.ws.close(); } catch (e) { /* ignore */ }
  }

  // 心跳保活
  let isAlive = true;
  const pingInterval = setInterval(() => {
    if (!isAlive) {
      try { ws.terminate(); } catch (e) { /* ignore */ }
      return;
    }
    isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  }, 30000);
  ws.on('pong', () => { isAlive = true; });

  clients.set(deviceId, { ws, deviceName: name, platform, supportsEncryption: !!pubkey });

  // 发送欢迎消息（包含密钥协商信息）
  ws.send(JSON.stringify({
    type: 'welcome',
    payload: {
      message: '已连接到 ClipSync',
      serverVersion: '1.0.0',
      deviceCount: clients.size,
      ...buildKeyExchange(pubkey)
    },
    timestamp: Date.now()
  }));

  // 通知其他设备有新设备上线
  broadcast({
    type: 'device_online',
    payload: { deviceId, deviceName: name, platform },
    timestamp: Date.now()
  }, deviceId);

  // 监听消息
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ping') return;
      handleMessage(deviceId, msg);
    } catch (e) {
      console.error('[WS] 消息解析失败:', e.message);
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    clients.delete(deviceId);
    broadcast({
      type: 'device_offline',
      payload: { deviceId },
      timestamp: Date.now()
    });
    console.log(`[WS] 设备断开: ${name} (${deviceId})`);
  });

  devicesDB.updateLastSeen(deviceId);
  console.log(`[WS] 设备已连接: ${name} (${platform}) [${deviceId}]`);
}

function handleMessage(deviceId, msg) {
  console.log(`[WS] 收到消息: device=${deviceId} type=${msg.type}`);
}

function broadcast(message, excludeDeviceId = null) {
  const data = JSON.stringify(message);
  for (const [id, client] of clients) {
    if (id !== excludeDeviceId && client.ws.readyState === 1) {
      try { client.ws.send(data); } catch (e) { /* ignore */ }
    }
  }
}

function broadcastToAuthorized(message) {
  const data = JSON.stringify(message);
  for (const [id, client] of clients) {
    if (client.ws.readyState === 1) {
      try { client.ws.send(data); } catch (e) { /* ignore */ }
    }
  }
}

// 通知有新内容（广播给所有客户端，前端去重避免重复显示）
function notifyNewItem(item) {
  const data = JSON.stringify({
    type: 'new_item',
    payload: item,
    timestamp: Date.now()
  });
  for (const [id, client] of clients) {
    if (client.ws.readyState !== 1) continue;
    try { client.ws.send(data); } catch (e) { /* ignore */ }
  }
}

function notifyItemDeleted(itemId) {
  broadcast({
    type: 'item_deleted',
    payload: { id: itemId },
    timestamp: Date.now()
  });
}

function approveDevice(deviceId) {
  const idx = pendingDevices.findIndex(d => d.deviceId === deviceId);
  if (idx === -1) return false;

  const pending = pendingDevices[idx];
  pendingDevices.splice(idx, 1);

  const result = devicesDB.addDevice({
    id: pending.deviceId,
    name: pending.name,
    platform: pending.platform
  });

  pending.ws.send(JSON.stringify({
    type: 'auth_approved',
    payload: { token: result.token, ...buildKeyExchange(pending.pubkey) },
    timestamp: Date.now()
  }));

  acceptConnection(pending.ws, pending.deviceId, pending.name, pending.platform, pending.pubkey);

  return true;
}

function rejectDevice(deviceId) {
  const idx = pendingDevices.findIndex(d => d.deviceId === deviceId);
  if (idx === -1) return false;

  const pending = pendingDevices[idx];
  pendingDevices.splice(idx, 1);

  pending.ws.send(JSON.stringify({
    type: 'auth_rejected',
    payload: { message: '管理员拒绝了你的连接请求' },
    timestamp: Date.now()
  }));

  pending.ws.close();
  return true;
}

function getPendingDevices() {
  return pendingDevices.map(d => ({
    deviceId: d.deviceId,
    name: d.name,
    platform: d.platform,
    ipAddress: d.ipAddress,
    requestedAt: Date.now()
  }));
}

function getConnectedClients() {
  const list = [];
  for (const [id, client] of clients) {
    list.push({ deviceId: id, deviceName: client.deviceName, platform: client.platform });
  }
  return list;
}

function disconnectDevice(deviceId) {
  const client = clients.get(deviceId);
  if (!client) return;
  try {
    client.ws.send(JSON.stringify({
      type: 'auth_revoked',
      payload: { message: '管理员已移除你的授权' },
      timestamp: Date.now()
    }));
  } catch (e) { /* ignore */ }
  try { client.ws.close(); } catch (e) { /* ignore */ }
  clients.delete(deviceId);
  console.log(`[WS] 强制断开: ${deviceId}`);
}

module.exports = { init, broadcast, notifyNewItem, notifyItemDeleted, approveDevice, rejectDevice, getPendingDevices, getConnectedClients, disconnectDevice };
