// ClipSync — 内容表操作模块
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./index');

// DB 列名 snake_case → 前端 camelCase
function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    fileName: row.file_name,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    sourceDevice: row.source_device
  };
}

function mapRows(rows) {
  return (rows || []).map(mapRow);
}

function rowFromId(id) {
  const db = getDB();
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id);
}

function exists(id) {
  return !!rowFromId(id);
}

// 创建内容
function create({ type, content, fileName, fileSize, mimeType, filePath, sourceDevice }) {
  const db = getDB();
  const id = uuidv4();
  const now = Date.now();
  const expiresAt = now + 24 * 60 * 60 * 1000; // 24 小时

  const stmt = db.prepare(`
    INSERT INTO items (id, type, content, file_name, file_size, mime_type, file_path, created_at, expires_at, source_device)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, type, content || null, fileName || null, fileSize || null,
           mimeType || null, filePath || null, now, expiresAt, sourceDevice);

  return mapRow(db.prepare('SELECT * FROM items WHERE id = ?').get(id));
}

// 插入远程同步内容，保留原始 ID 和过期时间，用于跨电脑去重
function createSynced({ id, type, content, fileName, fileSize, mimeType, filePath, createdAt, expiresAt, sourceDevice }) {
  const db = getDB();
  if (!id) throw new Error('同步内容缺少 id');
  if (exists(id)) return mapRow(rowFromId(id));

  const stmt = db.prepare(`
    INSERT INTO items (id, type, content, file_name, file_size, mime_type, file_path, created_at, expires_at, source_device)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    type,
    content || null,
    fileName || null,
    fileSize || null,
    mimeType || null,
    filePath || null,
    createdAt || Date.now(),
    expiresAt || Date.now() + 24 * 60 * 60 * 1000,
    sourceDevice || '远程电脑'
  );

  return mapRow(rowFromId(id));
}

// 获取单条内容（外部调用时返回 mapped row）
function getById(id) {
  const db = getDB();
  return mapRow(db.prepare('SELECT * FROM items WHERE id = ? AND expires_at > ?').get(id, Date.now()));
}

// 获取带内部文件路径的内容，仅供服务端下载/清理使用
function getFileById(id) {
  const db = getDB();
  return db.prepare('SELECT * FROM items WHERE id = ? AND expires_at > ?').get(id, Date.now());
}

// 获取内容列表
function getList({ type, limit = 50, offset = 0 }) {
  const db = getDB();
  const now = Date.now();

  let query = 'SELECT * FROM items WHERE expires_at > ?';
  const params = [now];

  if (type && type !== 'all') {
    query += ' AND type = ?';
    params.push(type);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const items = db.prepare(query).all(...params);

  // 总数
  let countQuery = 'SELECT COUNT(*) as total FROM items WHERE expires_at > ?';
  const countParams = [now];
  if (type && type !== 'all') {
    countQuery += ' AND type = ?';
    countParams.push(type);
  }
  const { total } = db.prepare(countQuery).get(...countParams);

  return { items: mapRows(items), total };
}

// 删除单条内容
function remove(id) {
  const db = getDB();
  const item = db.prepare('SELECT file_path FROM items WHERE id = ?').get(id);
  if (item && item.file_path) {
    const fs = require('fs');
    const path = require('path');
    try {
      if (fs.existsSync(item.file_path)) {
        fs.unlinkSync(item.file_path);
        // 尝试清理空目录
        const dir = path.dirname(item.file_path);
        const remaining = fs.readdirSync(dir);
        if (remaining.length === 0) {
          fs.rmdirSync(dir);
        }
      }
    } catch (e) {
      console.error('[Items] 删除文件失败:', item.file_path, e.message);
    }
  }
  return db.prepare('DELETE FROM items WHERE id = ?').run(id);
}

// 增量同步：获取指定时间之后的新内容，以及已删除的 ID
function getChanges(since) {
  const db = getDB();
  const now = Date.now();

  // 新内容（创建时间在 since 之后，且未过期）
  const newItems = db.prepare(
    'SELECT * FROM items WHERE created_at > ? AND expires_at > ? ORDER BY created_at ASC'
  ).all(since, now);

  return { newItems: mapRows(newItems), serverTime: now };
}

module.exports = { create, createSynced, exists, getById, getFileById, getList, remove, getChanges };
