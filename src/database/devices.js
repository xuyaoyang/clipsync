// ClipSync — 设备授权表操作模块
const { getDB } = require('./index');
const crypto = require('crypto');

// 生成随机 Token（64 位十六进制字符串）
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 检查设备是否已授权
function isAuthorized(deviceId, token) {
  const db = getDB();
  const device = db.prepare(
    'SELECT * FROM authorized_devices WHERE id = ? AND token = ?'
  ).get(deviceId, token);
  return !!device;
}

// 添加授权设备
function addDevice({ id, name, platform }) {
  const db = getDB();
  const token = generateToken();
  const now = Date.now();

  // 如果设备 ID 已存在，更新 token
  const existing = db.prepare('SELECT id FROM authorized_devices WHERE id = ?').get(id);
  if (existing) {
    db.prepare(
      'UPDATE authorized_devices SET name = ?, platform = ?, token = ?, authorized_at = ?, last_seen_at = ? WHERE id = ?'
    ).run(name, platform, token, now, now, id);
  } else {
    db.prepare(
      'INSERT INTO authorized_devices (id, name, platform, token, authorized_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, name, platform, token, now, now);
  }

  return { token };
}

// 移除授权设备
function removeDevice(id) {
  const db = getDB();
  return db.prepare('DELETE FROM authorized_devices WHERE id = ?').run(id);
}

// 获取所有已授权设备
function getAllDevices() {
  const db = getDB();
  return db.prepare('SELECT * FROM authorized_devices ORDER BY last_seen_at DESC').all();
}

// 更新设备最后在线时间
function updateLastSeen(id) {
  const db = getDB();
  db.prepare('UPDATE authorized_devices SET last_seen_at = ? WHERE id = ?').run(Date.now(), id);
}

// 检查 token 是否有效（在已授权列表中）
function isValidToken(token) {
  if (!token) return false;
  const db = getDB();
  const device = db.prepare(
    'SELECT id FROM authorized_devices WHERE token = ?'
  ).get(token);
  return !!device;
}

// 根据 token 获取设备 ID
function getDeviceIdByToken(token) {
  if (!token) return null;
  const db = getDB();
  const device = db.prepare('SELECT id FROM authorized_devices WHERE token = ?').get(token);
  return device ? device.id : null;
}

module.exports = { generateToken, isAuthorized, isValidToken, getDeviceIdByToken, addDevice, removeDevice, getAllDevices, updateLastSeen };
