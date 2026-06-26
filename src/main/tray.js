// ClipSync — 系统托盘模块
const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;
let win = null;

function createTray(mainWindow) {
  win = mainWindow;

  // 加载托盘图标（优先使用 PWA 图标，失败则用纯色备选）
  const iconPath = path.join(__dirname, '..', 'web', 'assets', 'icon-192.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = createFallbackIcon();
  } catch (e) {
    icon = createFallbackIcon();
  }

  // Windows 托盘图标建议 16×16
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开 ClipSync',
      click: () => {
        win.show();
        win.focus();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        require('electron').app.quit();
      }
    }
  ]);

  tray.setToolTip('ClipSync - 局域网同步');
  tray.setContextMenu(contextMenu);

  // 双击托盘图标打开窗口
  tray.on('double-click', () => {
    win.show();
    win.focus();
  });

  return tray;
}

// 备选图标：生成一个简单的蓝色圆角方块（32×32 RGBA）
function createFallbackIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = size / 2;          // 圆心
  const cy = size / 2;
  const outerR = size / 2 - 1;  // 外圆半径
  const innerR = size / 2 - 3;  // 内圆（半透明边界）

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > outerR) continue; // 圆外透明

      buf[i]     = 74;   // R
      buf[i + 1] = 144;  // G
      buf[i + 2] = 217;  // B
      buf[i + 3] = dist > innerR ? 180 : 255; // 边缘半透明
    }
  }

  // createFromBuffer 在不同平台上字节序可能不同
  // 如果平台不支持 raw buffer，回退到空白图标（功能性优先）
  const img = nativeImage.createFromBuffer(buf, { width: size, height: size });
  if (img.isEmpty()) {
    return nativeImage.createEmpty();
  }
  return img;
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, destroyTray };
