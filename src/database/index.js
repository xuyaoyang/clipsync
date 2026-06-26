// ClipSync — 数据库初始化模块
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

let db = null;

function init(dbPath) {
  // 确保数据目录存在
  const dir = dbPath || path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const dbFile = path.join(dir, 'clipsync.db');
  db = new Database(dbFile);

  // 启用 WAL 模式（更好的并发性能）
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 创建内容表
  db.exec(`
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
    )
  `);

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_items_expires_at ON items(expires_at);
    CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
    CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at);
  `);

  // 创建设备表
  db.exec(`
    CREATE TABLE IF NOT EXISTS authorized_devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      authorized_at INTEGER NOT NULL,
      last_seen_at INTEGER
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_devices_token ON authorized_devices(token);
  `);

  // 创建电脑互联表（保存远程电脑连接信息和授权 token）
  db.exec(`
    CREATE TABLE IF NOT EXISTS peer_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT,
      port INTEGER,
      token TEXT,
      status TEXT NOT NULL DEFAULT 'discovered',
      last_seen_at INTEGER,
      updated_at INTEGER NOT NULL
    )
  `);

  // 创建配置表（存储主密钥等持久化数据）
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 首次启动时生成主密钥
  const existingKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('master_key');
  if (!existingKey) {
    const { generateMasterKey } = require('../server/crypto-utils');
    const masterKey = generateMasterKey();
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('master_key', masterKey.toString('base64'));
    console.log('[DB] 已生成主加密密钥');
  }

  // 每台服务端电脑拥有稳定 ID，用于 mDNS 发现和电脑互联授权
  const existingDeviceId = db.prepare('SELECT value FROM settings WHERE key = ?').get('server_device_id');
  if (!existingDeviceId) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('server_device_id', uuidv4());
    console.log('[DB] 已生成本机服务 ID');
  }

  console.log('[DB] 数据库初始化完成:', dbFile);
  return db;
}

function getDB() {
  if (!db) {
    throw new Error('数据库未初始化，请先调用 init()');
  }
  return db;
}

function close() {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] 数据库已关闭');
  }
}

// 获取主加密密钥
function getMasterKey() {
  if (!db) throw new Error('数据库未初始化');
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('master_key');
  return row ? Buffer.from(row.value, 'base64') : null;
}

function getSetting(key) {
  if (!db) throw new Error('数据库未初始化');
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  if (!db) throw new Error('数据库未初始化');
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

// 清理过期内容（删除数据库记录和关联文件）
function cleanExpired() {
  if (!db) return { deleted: 0 };
  const now = Date.now();

  // 先查出要删除的文件路径
  const expired = db.prepare(
    'SELECT id, file_path FROM items WHERE expires_at <= ?'
  ).all(now);

  let deletedFiles = 0;
  const emptiedDirs = new Set();
  for (const item of expired) {
    if (item.file_path) {
      try {
        if (fs.existsSync(item.file_path)) {
          fs.unlinkSync(item.file_path);
          deletedFiles++;
          // 记录可能变空的目录
          emptiedDirs.add(path.dirname(item.file_path));
        }
      } catch (e) {
        console.error('[DB] 删除文件失败:', item.file_path, e.message);
      }
    }
  }
  // 清理空目录
  for (const dir of emptiedDirs) {
    try {
      const remaining = fs.readdirSync(dir);
      if (remaining.length === 0) {
        fs.rmdirSync(dir);
      }
    } catch (e) { /* 目录可能已被其他清理操作删除 */ }
  }

  // 删除数据库记录
  const result = db.prepare('DELETE FROM items WHERE expires_at <= ?').run(now);
  if (result.changes > 0 || deletedFiles > 0) {
    console.log(`[DB] 清理过期: ${result.changes} 条记录, ${deletedFiles} 个文件`);
  }
  return { deleted: result.changes, files: deletedFiles };
}

module.exports = { init, getDB, close, cleanExpired, getMasterKey, getSetting, setSetting };
