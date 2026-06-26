// ClipSync — 局域网电脑互联同步模块
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocket } = require('ws');
const itemsDB = require('../database/items');
const peersDB = require('../database/peers');
const mdns = require('./mdns');

let app = null;
let uploadDir = null;
let localDeviceId = null;
let localPort = 9527;
const connections = new Map();
const syncingIds = new Set();

function init(options = {}) {
  app = options.app;
  uploadDir = options.uploadDir;
  localPort = options.port || 9527;
  localDeviceId = options.deviceId;

  mdns.startScanning((event, service) => {
    if (event === 'up') handleServiceUp(service);
    if (event === 'down') handleServiceDown(service);
  });

  console.log('[Peers] 电脑互联模块已启动');
}

function handleServiceUp(service) {
  const peerId = service.txt && service.txt.deviceId;
  if (!peerId || peerId === localDeviceId) return;

  const host = pickAddress(service);
  if (!host || !service.port) return;

  const peer = peersDB.upsertPeer({
    id: peerId,
    name: service.txt.hostname || service.name || '远程电脑',
    host,
    port: service.port
  });

  connectPeer(peer.id);
}

function handleServiceDown(service) {
  const peerId = service.txt && service.txt.deviceId;
  if (!peerId || peerId === localDeviceId) return;
  peersDB.updateStatus(peerId, 'offline');
  const conn = connections.get(peerId);
  if (conn && conn.ws) {
    try { conn.ws.close(); } catch (e) { /* ignore */ }
  }
}

function pickAddress(service) {
  const addresses = service.addresses || [];
  const ipv4 = addresses.find(addr => /^\d+\.\d+\.\d+\.\d+$/.test(addr) && !addr.startsWith('127.'));
  if (ipv4) return ipv4;
  if (service.host) return service.host;
  return service.referer && service.referer.address ? service.referer.address : null;
}

function connectPeer(peerId) {
  const peer = peersDB.getPeer(peerId);
  if (!peer || !peer.host || !peer.port) return false;

  const existing = connections.get(peerId);
  if (existing && existing.ws && (existing.ws.readyState === WebSocket.OPEN || existing.ws.readyState === WebSocket.CONNECTING)) {
    return true;
  }

  const qs = new URLSearchParams({
    deviceId: localDeviceId,
    token: peer.token || '',
    name: os.hostname(),
    platform: process.platform
  });
  const wsUrl = `ws://${peer.host}:${peer.port}/api/connect?${qs.toString()}`;

  peersDB.updateStatus(peerId, peer.token ? 'connecting' : 'pending');
  const ws = new WebSocket(wsUrl);
  const state = { ws, peer, reconnectTimer: null };
  connections.set(peerId, state);

  ws.on('open', () => {
    peersDB.updateStatus(peerId, peer.token ? 'connected' : 'pending');
  });

  ws.on('message', (data) => {
    handlePeerMessage(peerId, data.toString()).catch((err) => {
      console.error('[Peers] 处理远程消息失败:', err.message);
    });
  });

  ws.on('close', () => {
    const current = connections.get(peerId);
    if (current && current.ws === ws) {
      peersDB.updateStatus(peerId, 'offline');
      scheduleReconnect(peerId);
    }
  });

  ws.on('error', (err) => {
    console.error('[Peers] 连接失败:', peer.name, err.message);
    peersDB.updateStatus(peerId, 'error');
  });

  return true;
}

function scheduleReconnect(peerId) {
  const state = connections.get(peerId);
  if (!state || state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connectPeer(peerId);
  }, 10000);
}

async function handlePeerMessage(peerId, raw) {
  const msg = JSON.parse(raw);

  if (msg.type === 'auth_required') {
    peersDB.updateStatus(peerId, 'pending');
    return;
  }

  if (msg.type === 'auth_rejected') {
    peersDB.updateStatus(peerId, 'rejected');
    return;
  }

  if (msg.type === 'auth_approved' && msg.payload && msg.payload.token) {
    peersDB.saveToken(peerId, msg.payload.token);
    await syncFromPeer(peerId);
    return;
  }

  if (msg.type === 'welcome') {
    peersDB.updateStatus(peerId, 'connected');
    await syncFromPeer(peerId);
    return;
  }

  if (msg.type === 'new_item' && msg.payload) {
    await importRemoteItem(peerId, msg.payload);
  }
}

async function syncFromPeer(peerId) {
  const peer = peersDB.getPeer(peerId);
  if (!peer || !peer.token) return;

  try {
    const data = await fetchJSON(peer, '/api/items?limit=200&offset=0');
    for (const item of data.items || []) {
      await importRemoteItem(peerId, item);
    }
  } catch (e) {
    console.error('[Peers] 增量补齐失败:', peer.name, e.message);
  }
}

async function importRemoteItem(peerId, item) {
  if (!item || !item.id || syncingIds.has(item.id) || itemsDB.exists(item.id)) return;
  syncingIds.add(item.id);

  try {
    const peer = peersDB.getPeer(peerId);
    if (!peer || !peer.token) return;

    let filePath = null;
    if (item.type === 'image' || item.type === 'file') {
      filePath = await downloadRemoteFile(peer, item);
      if (!filePath) return;
    }

    const saved = itemsDB.createSynced({
      id: item.id,
      type: item.type,
      content: item.content,
      fileName: item.fileName,
      fileSize: item.fileSize,
      mimeType: item.mimeType,
      filePath,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      sourceDevice: item.sourceDevice || peer.name
    });

    if (app && saved) app.emit('new-item', saved);
  } catch (e) {
    console.error('[Peers] 同步远程内容失败:', e.message);
  } finally {
    syncingIds.delete(item.id);
  }
}

async function downloadRemoteFile(peer, item) {
  const fileName = sanitizeFileName(item.fileName || 'untitled');
  const today = new Date(item.createdAt || Date.now()).toISOString().slice(0, 10);
  const dateDir = path.join(uploadDir, today);
  fs.mkdirSync(dateDir, { recursive: true });
  const filePath = resolveUniqueFilePath(dateDir, fileName);

  const url = `http://${peer.host}:${peer.port}/api/items/${item.id}/file?token=${encodeURIComponent(peer.token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载远程文件失败: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function fetchJSON(peer, apiPath) {
  const res = await fetch(`http://${peer.host}:${peer.port}${apiPath}`, {
    headers: { Authorization: `Bearer ${peer.token}` }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function sanitizeFileName(fileName) {
  const raw = path.basename(fileName || 'untitled');
  const cleaned = raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return cleaned || 'untitled';
}

function resolveUniqueFilePath(dir, fileName) {
  let filePath = path.join(dir, fileName);
  let counter = 1;
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  while (fs.existsSync(filePath)) {
    filePath = path.join(dir, `${base} (${counter})${ext}`);
    counter++;
  }
  return filePath;
}

function listPeers() {
  return peersDB.getAllPeers();
}

function reconnectPeer(peerId) {
  const conn = connections.get(peerId);
  if (conn && conn.ws) {
    try { conn.ws.close(); } catch (e) { /* ignore */ }
  }
  return connectPeer(peerId);
}

module.exports = { init, listPeers, reconnectPeer, connectPeer };
