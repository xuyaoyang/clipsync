// ClipSync — HTTP 服务器模块
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { getDB } = require('../database');
const itemsDB = require('../database/items');
const devicesDB = require('../database/devices');
const multer = require('multer');
const { encrypt, decrypt, encryptJSON } = require('./crypto-utils');
let app = null;
let httpServer = null;

// 修复双重 UTF-8 编码的文件名（UTF-8 字节被误当作 Latin-1 再编码）
// 例如："éé..." → "隔震..."
function fixFileNameEncoding(fileName) {
  if (!fileName) return fileName;

  // 已经含中文，说明编码正确，无需修复
  if (/[一-鿿]/.test(fileName)) return fileName;

  try {
    const buf = Buffer.from(fileName, 'latin1');
    const decoded = buf.toString('utf8');
    // 解码后包含中文字符 → 确认是双重编码 → 使用解码结果
    if (decoded !== fileName && /[一-鿿]/.test(decoded)) {
      return decoded;
    }
  } catch (e) { /* ignore */ }
  return fileName;
}

function isLocalRequest(req) {
  return req.ip === '127.0.0.1' ||
    req.ip === '::1' ||
    req.ip === '::ffff:127.0.0.1';
}

function getRequestToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}

function sanitizeUploadFileName(fileName) {
  const raw = path.basename(fixFileNameEncoding(fileName) || 'untitled');
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

function createApp(uploadDir) {
  app = express();

  // 中间件
  app.use(express.json({ limit: '50mb' }));

  // API 鉴权 + 加解密中间件
  app.use('/api', (req, res, next) => {
    // 公开路由
    if (req.path === '/status' || req.path === '/qrcode') {
      return next();
    }

    if (req.path === '/open-folder' && !isLocalRequest(req)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '仅桌面端可打开文件夹' } });
    }

    // 本地连接直接放行（Electron / 本机浏览器）
    if (!isLocalRequest(req)) {
      const token = getRequestToken(req);
      if (!token || !devicesDB.isValidToken(token)) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '未授权的设备，请等待管理员审批' } });
      }
      req.deviceId = devicesDB.getDeviceIdByToken(token);
    }

    // 加解密
    const key = require('../database').getMasterKey();
    const encryptOk = req.headers['x-clipsync-encryption'] === '1';

    if (req.body && req.body.encrypted && key) {
      try {
        const decrypted = decrypt(req.body.data, key);
        req.body = JSON.parse(decrypted);
      } catch (e) {
        return res.status(400).json({ error: { code: 'DECRYPT_FAILED', message: '解密失败' } });
      }
    }

    if (key && encryptOk) {
      const orig = res.json.bind(res);
      res.json = function (data) {
        if (data && data.error) return orig(data);
        return orig(encryptJSON(data, key));
      };
    }

    next();
  });

  // 确保上传目录存在
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // Multipart 文件上传（支持大文件）
  const tempUploadDir = path.join(uploadDir, '.tmp');
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        fs.mkdirSync(tempUploadDir, { recursive: true });
        cb(null, tempUploadDir);
      },
      filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.random().toString(16).slice(2);
        cb(null, unique + '.upload');
      }
    }),
    limits: { fileSize: 500 * 1024 * 1024 }  // 500MB
  });

  // ===== 静态文件服务（Web 界面） =====
  const webDir = path.join(__dirname, '..', 'web');
  app.use(express.static(webDir));

  // ===== API 路由 =====

  // 健康检查
  app.get('/api/status', (req, res) => {
    res.json({
      status: 'ok',
      version: '1.0.0',
      uptime: process.uptime(),
      serverTime: Date.now()
    });
  });

  // 获取内容列表
  app.get('/api/items', (req, res) => {
    try {
      const { type, limit, offset } = req.query;
      const result = itemsDB.getList({
        type: type || 'all',
        limit: parseInt(limit) || 50,
        offset: parseInt(offset) || 0
      });
      res.json(result);
    } catch (e) {
      console.error('[API] 获取列表失败:', e);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
    }
  });

  // 创建文字内容
  app.post('/api/items', (req, res) => {
    try {
      const { type, content, sourceDevice } = req.body;

      if (type === 'text') {
        if (!content || !content.trim()) {
          return res.status(400).json({ error: { code: 'BAD_REQUEST', message: '内容不能为空' } });
        }
        const item = itemsDB.create({
          type: 'text',
          content: content.trim(),
          sourceDevice: sourceDevice || '未知设备'
        });
        // 通过 WebSocket 广播（由 websocket 模块处理）
        app.emit('new-item', item);
        return res.status(201).json(item);
      }

      // 对于图片和文件，通过 upload 接口处理
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: '图片和文件请使用 /api/upload 接口' } });
    } catch (e) {
      console.error('[API] 创建内容失败:', e);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
    }
  });

  // 上传文件/图片（multipart/form-data，支持大文件）
  app.post('/api/upload', (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: '文件过大，最大支持 500MB' } });
        }
        return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: err.message } });
      }

      try {
        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: { code: 'BAD_REQUEST', message: '缺少文件' } });
        }

        const sourceDevice = req.body.sourceDevice || '未知设备';
        const mimeType = file.mimetype || 'application/octet-stream';
        const fileName = sanitizeUploadFileName(file.originalname);

        // 确定类型（白名单：只将浏览器可渲染的图片归为 image）
        const RENDERABLE_IMAGE = ['image/jpeg','image/png','image/gif','image/webp','image/bmp','image/svg+xml','image/ico','image/x-icon','image/avif'];
        const isImage = mimeType && RENDERABLE_IMAGE.includes(mimeType);
        const type = isImage ? 'image' : 'file';

        // 保存文件 — 按日期分文件夹，方便用户直接浏览
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const dateDir = path.join(uploadDir, today);
        fs.mkdirSync(dateDir, { recursive: true });

        // 同名文件加序号，避免覆盖
        const filePath = resolveUniqueFilePath(dateDir, fileName);
        fs.renameSync(file.path, filePath);

        const item = itemsDB.create({
          type,
          content: null,
          fileName: fileName,
          fileSize: file.size,
          mimeType: mimeType,
          filePath,
          sourceDevice: sourceDevice
        });

        app.emit('new-item', item);
        res.status(201).json(item);
      } catch (e) {
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (unlinkErr) { /* ignore */ }
        }
        console.error('[API] 上传失败:', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
      }
    });
  });

  // 获取单条内容
  app.get('/api/items/:id', (req, res) => {
    try {
      const item = itemsDB.getById(req.params.id);
      if (!item) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: '内容不存在或已过期' } });
      }
      res.json(item);
    } catch (e) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
    }
  });

  // 下载文件
  app.get('/api/items/:id/file', (req, res) => {
    try {
      const item = itemsDB.getFileById(req.params.id);
      if (!item || !item.file_path) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: '文件不存在或已过期' } });
      }
      if (!fs.existsSync(item.file_path)) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: '文件已被清理' } });
      }
      res.setHeader('Content-Type', item.mime_type || 'application/octet-stream');
      const fname = item.file_name;
      if (/^[\x00-\x7F]*$/.test(fname)) {
        res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
      } else {
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fname)}`);
      }
      fs.createReadStream(item.file_path).pipe(res);
    } catch (e) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
    }
  });

  // 增量同步
  app.post('/api/items/sync', (req, res) => {
    try {
      const { lastSyncAt } = req.body;
      const result = itemsDB.getChanges(lastSyncAt || 0);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
    }
  });

  // 获取已授权设备列表
  app.get('/api/devices', (req, res) => {
    try {
      const devices = devicesDB.getAllDevices();
      res.json({ devices });
    } catch (e) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
    }
  });

  // 移除设备授权
  app.delete('/api/devices/:id', (req, res) => {
    try {
      const deviceId = req.params.id;
      devicesDB.removeDevice(deviceId);
      // 同时断开该设备的 WebSocket 连接
      const websocket = require('./websocket');
      websocket.disconnectDevice(deviceId);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
    }
  });

  // 审批设备
  app.post('/api/devices/approve', (req, res) => {
    try {
      const { deviceId, action } = req.body;
      const websocket = require('./websocket');

      if (action === 'approve') {
        const success = websocket.approveDevice(deviceId);
        if (success) {
          res.json({ status: 'approved' });
        } else {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: '设备不在待审批列表中' } });
        }
      } else if (action === 'reject') {
        const success = websocket.rejectDevice(deviceId);
        if (success) {
          res.json({ status: 'rejected' });
        } else {
          res.status(404).json({ error: { code: 'NOT_FOUND', message: '设备不在待审批列表中' } });
        }
      } else {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: '无效的操作' } });
      }
    } catch (e) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
    }
  });

  // 获取待审批设备列表
  app.get('/api/devices/pending', (req, res) => {
    try {
      const websocket = require('./websocket');
      const pending = websocket.getPendingDevices();
      res.json({ pending });
    } catch (e) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
    }
  });

  // 生成二维码（SVG 格式，方便手机扫码连接）
  app.get('/api/qrcode', async (req, res) => {
    try {
      const QRCode = require('qrcode');
      const localIP = require('./mdns').getPrimaryIP();
      const port = httpServer ? httpServer.address().port : 9527;
      const url = `http://${localIP}:${port}`;
      const svg = await QRCode.toString(url, { type: 'svg', margin: 2, width: 256 });
      res.json({ url, svg });
    } catch (e) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
    }
  });

  // 打开文件存储目录（Windows 资源管理器）
  app.post('/api/open-folder', (req, res) => {
    try {
      if (!isLocalRequest(req)) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: '仅桌面端可打开文件夹' } });
      }

      const { spawn } = require('child_process');
      const folderPath = uploadDir;
      let cmd, args;

      if (process.platform === 'win32') {
        cmd = 'explorer';
        args = [folderPath];
      } else if (process.platform === 'darwin') {
        cmd = 'open';
        args = [folderPath];
      } else {
        cmd = 'xdg-open';
        args = [folderPath];
      }

      const proc = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      proc.unref();
      proc.on('error', (err) => {
        console.error('[API] 打开文件夹失败:', err.message);
      });

      res.json({ success: true, path: folderPath });
    } catch (e) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
    }
  });

  return app;
}

function start(port, uploadDir) {
  const dir = uploadDir || path.join(__dirname, '..', '..', 'data', 'files');
  const app = createApp(dir);

  return new Promise((resolve, reject) => {
    let currentPort = port;

    function tryListen() {
      httpServer = http.createServer(app);

      httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          currentPort++;
          if (currentPort - port >= 10) {
            return reject(new Error(`端口 ${port}-${currentPort - 1} 均被占用`));
          }
          console.log(`[HTTP] 端口 ${currentPort - 1} 被占用，尝试端口 ${currentPort}...`);
          return tryListen();
        }
        reject(err);
      });

      httpServer.on('listening', () => {
        console.log(`[HTTP] 服务器启动: http://0.0.0.0:${currentPort}`);
        resolve({ app, httpServer, port: currentPort });
      });

      httpServer.listen(currentPort);
    }

    tryListen();
  });
}

function getApp() { return app; }
function getServer() { return httpServer; }

module.exports = { start, getApp, getServer };
