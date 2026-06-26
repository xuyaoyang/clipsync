// ClipSync — 电脑互联表操作模块
const { getDB } = require('./index');

function upsertPeer({ id, name, host, port, token, status }) {
  const db = getDB();
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM peer_connections WHERE id = ?').get(id);

  if (existing) {
    db.prepare(`
      UPDATE peer_connections
      SET name = ?, host = ?, port = ?, token = COALESCE(?, token),
          status = ?, last_seen_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name || existing.name,
      host || existing.host,
      port || existing.port,
      token || null,
      status || existing.status,
      now,
      now,
      id
    );
  } else {
    db.prepare(`
      INSERT INTO peer_connections (id, name, host, port, token, status, last_seen_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name || '未知电脑', host || null, port || null, token || null, status || 'discovered', now, now);
  }

  return getPeer(id);
}

function updateStatus(id, status) {
  const db = getDB();
  const now = Date.now();
  if (status === 'connected') {
    db.prepare('UPDATE peer_connections SET status = ?, last_seen_at = ?, updated_at = ? WHERE id = ?').run(status, now, now, id);
    return;
  }
  db.prepare('UPDATE peer_connections SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
}

function saveToken(id, token) {
  const db = getDB();
  db.prepare(`
    UPDATE peer_connections
    SET token = ?, status = 'connected', last_seen_at = ?, updated_at = ?
    WHERE id = ?
  `).run(token, Date.now(), Date.now(), id);
}

function getPeer(id) {
  const db = getDB();
  return db.prepare('SELECT * FROM peer_connections WHERE id = ?').get(id);
}

function getAllPeers() {
  const db = getDB();
  return db.prepare('SELECT id, name, host, port, status, last_seen_at, updated_at FROM peer_connections ORDER BY updated_at DESC').all();
}

module.exports = { upsertPeer, updateStatus, saveToken, getPeer, getAllPeers };
