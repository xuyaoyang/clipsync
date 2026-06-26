// 重构上传端点为 multipart/form-data
const fs = require('fs');
let c = fs.readFileSync('src/server/http-server.js', 'utf8');

// 1. Add multer require
c = c.replace(
  "const devicesDB = require('../database/devices');",
  "const devicesDB = require('../database/devices');\nconst multer = require('multer');"
);

// 2. Add multer config after uploadDir creation
c = c.replace(
  '// ===== 静态文件服务（Web 界面） =====',
  `// Multipart 文件上传（支持大文件）
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 }  // 500MB
  });

  // ===== 静态文件服务（Web 界面） =====`
);

// 3. Replace the old /api/upload endpoint
const oldStart = "// 上传文件/图片（使用 JSON + base64，简单可靠）";
const oldEnd = "    }\n  });";

const newEndpoint = `// 上传文件/图片（multipart/form-data，支持大文件）
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
        const buffer = file.buffer;
        const fileName = file.originalname || 'untitled';

        // 确定类型（白名单：只将浏览器可渲染的图片归为 image）
        const RENDERABLE_IMAGE = ['image/jpeg','image/png','image/gif','image/webp','image/bmp','image/svg+xml','image/ico','image/x-icon','image/avif'];
        const isImage = mimeType && RENDERABLE_IMAGE.includes(mimeType);
        const type = isImage ? 'image' : 'file';

        // 保存文件
        const itemId = require('uuid').v4();
        const fileDir = path.join(uploadDir, itemId);
        fs.mkdirSync(fileDir, { recursive: true });
        const filePath = path.join(fileDir, fileName);
        fs.writeFileSync(filePath, buffer);

        const item = itemsDB.create({
          type,
          content: null,
          fileName: fileName,
          fileSize: buffer.length,
          mimeType: mimeType,
          filePath,
          sourceDevice: sourceDevice
        });

        app.emit('new-item', item);
        res.status(201).json(item);
      } catch (e) {
        console.error('[API] 上传失败:', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });
      }
    });
  });`;

// Find old endpoint boundaries
const startIdx = c.indexOf(oldStart);
const afterStart = c.substring(startIdx);
// Find the matching closing pattern
const endMarker = "app.emit('new-item', item);\n      res.status(201).json(item);\n    } catch (e) {\n      console.error('[API] 上传失败:', e);\n      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: e.message } });\n    }\n  });";

if (startIdx > -1) {
  const endIdx = c.indexOf(endMarker, startIdx);
  if (endIdx > -1) {
    c = c.substring(0, startIdx) + newEndpoint + c.substring(endIdx + endMarker.length);
    console.log('OK: replaced upload endpoint');
  } else {
    console.log('ERROR: end marker not found');
  }
} else {
  console.log('ERROR: start marker not found');
}

fs.writeFileSync('src/server/http-server.js', c, 'utf8');
console.log('Done');
