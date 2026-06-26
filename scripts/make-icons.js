// 生成 ClipSync 应用图标 — 使用纯 JS zlib 写 PNG
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'src', 'web', 'assets');
const BG1 = [0x4A, 0x90, 0xD9]; // 主蓝
const BG2 = [0x3A, 0x70, 0xB9]; // 深蓝
const WHITE = [255, 255, 255, 255];
const ICON_BLUE = [0x4A, 0x90, 0xD9, 255];
const TRANSPARENT = [0, 0, 0, 0];

function lerp(a, b, t) { return a + (b - a) * t; }

function gradientColor(y, h) {
  const t = y / h;
  return [
    Math.round(lerp(BG1[0], BG2[0], t)),
    Math.round(lerp(BG1[1], BG2[1], t)),
    Math.round(lerp(BG1[2], BG2[2], t)),
    255
  ];
}

function fillRoundedRect(buf, W, x, y, w, h, r, getColor) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const cx = px < x + r ? x + r - px : px > x + w - 1 - r ? px - (x + w - 1 - r) : 0;
      const cy = py < y + r ? y + r - py : py > y + h - 1 - r ? py - (y + h - 1 - r) : 0;
      const dist = Math.sqrt(cx * cx + cy * cy);
      if (dist > r) {
        if ((px < x + r && py < y + r) || (px > x + w - 1 - r && py < y + r) ||
            (px < x + r && py > y + h - 1 - r) || (px > x + w - 1 - r && py > y + h - 1 - r)) {
          continue;
        }
      }
      const idx = (py * W + px) * 4;
      const c = typeof getColor === 'function' ? getColor(px, py) : getColor;
      buf[idx] = c[0]; buf[idx + 1] = c[1]; buf[idx + 2] = c[2]; buf[idx + 3] = c[3];
    }
  }
}

function drawCenteredTriangle(buf, W, cx, topY, botY, leftX, rightX, color) {
  for (let py = Math.round(topY); py <= Math.round(botY); py++) {
    const t = (py - topY) / (botY - topY);
    const halfW = leftX + (rightX - leftX) * t;
    const lx = Math.round(cx - halfW / 2);
    const rx = Math.round(cx + halfW / 2);
    for (let px = Math.max(0, lx); px <= Math.min(W - 1, rx); px++) {
      const idx = (py * W + px) * 4;
      buf[idx] = color[0]; buf[idx + 1] = color[1]; buf[idx + 2] = color[2]; buf[idx + 3] = 255;
    }
  }
}

function createIconBuf(W) {
  const buf = Buffer.alloc(W * W * 4, 0);

  // 1. 圆角矩形背景
  const pad = Math.round(W * 0.06);
  const bgW = W - pad * 2;
  const bgH = W - pad * 2;
  const bgR = Math.round(W * 0.18);
  fillRoundedRect(buf, W, pad, pad, bgW, bgH, bgR, (x, y) => gradientColor(y, W));

  // 2. 剪贴板 — 白色圆角矩形
  const cbW = Math.round(W * 0.42);
  const cbH = Math.round(W * 0.50);
  const cbR = Math.round(W * 0.05);
  const cbX = Math.round((W - cbW) / 2);
  const cbY = Math.round(W * 0.24);
  fillRoundedRect(buf, W, cbX, cbY, cbW, cbH, cbR, WHITE);

  // 3. 剪贴板顶部夹子
  const clipW = Math.round(W * 0.12);
  const clipH = Math.round(W * 0.09);
  const clipX = Math.round((W - clipW) / 2);
  const clipY = cbY - clipH + Math.round(W * 0.01);
  fillRoundedRect(buf, W, clipX, clipY, clipW, clipH, Math.round(W * 0.015), WHITE);

  // 4. 双箭头同步图标（蓝色）
  const arrowTop = Math.round(W * 0.48);
  const arrowBot = Math.round(W * 0.57);
  const arrowL = Math.round(W * 0.28);
  const arrowR = Math.round(W * 0.72);
  const cx = Math.round(W / 2);

  // 左箭头 ←
  drawCenteredTriangle(buf, W, cx - Math.round(W * 0.12), arrowTop, arrowBot, 0, Math.round(W * 0.12), ICON_BLUE);

  // 右箭头 →
  drawCenteredTriangle(buf, W, cx + Math.round(W * 0.12), arrowTop, arrowBot, Math.round(W * 0.12), 0, ICON_BLUE);

  return buf;
}

// 写 PNG 文件
function writePNG(buf, W, filepath) {
  const rawData = [];
  for (let y = 0; y < W; y++) {
    rawData.push(0); // filter byte
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      rawData.push(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
    }
  }
  const raw = Buffer.from(rawData);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  const chunks = [];

  // PNG signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);      // width
  ihdr.writeUInt32BE(W, 4);      // height
  ihdr[8] = 8;                    // bit depth
  ihdr[9] = 6;                    // color type (RGBA)
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(makeChunk('IHDR', ihdr));

  // IDAT
  chunks.push(makeChunk('IDAT', compressed));

  // IEND
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  fs.writeFileSync(filepath, Buffer.concat(chunks));
  console.log(`Wrote ${filepath} (${W}x${W})`);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type);
  const crcData = Buffer.concat([typeB, data]);
  const crc = crc32(crcData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeB, data, crcBuf]);
}

// CRC32
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 生成
[16, 32, 48, 64, 128, 192, 256, 512].forEach(s => {
  const buf = createIconBuf(s);
  const name = s === 512 ? 'icon-512.png' : s === 192 ? 'icon-192.png' : `icon-${s}.png`;
  writePNG(buf, s, path.join(ASSETS, name));
});

console.log('Icons generated!');
