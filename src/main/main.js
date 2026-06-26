// ClipSync — Electron 主进程入口
const { app, BrowserWindow, ipcMain, shell, Menu, clipboard, nativeImage } = require('electron');
const { createTray, destroyTray } = require('./tray');
const path = require('path');

let mainWindow = null;
let serverPort = 9527;
let isQuitting = false;

const isDev = process.argv.includes('--dev');
const startHidden = process.argv.includes('--hidden');

// 剪贴板监听状态
let clipboardMonitorActive = false;
let clipboardTimer = null;
let lastClipboardText = '';
let lastClipboardImage = null; // base64 data URL

function startClipboardMonitor() {
  if (clipboardTimer) return;
  clipboardMonitorActive = true;
  console.log('[Main] 剪贴板监听已开启');

  clipboardTimer = setInterval(() => {
    try {
      // 检测文本
      const text = clipboard.readText();
      if (text && text !== lastClipboardText) {
        lastClipboardText = text;
        lastClipboardImage = null;
        mainWindow.webContents.send('clipboard-text', text);
        return;
      }

      // 检测图片
      const img = clipboard.readImage();
      if (!img.isEmpty()) {
        const png = img.toPNG();
        const b64 = png.toString('base64');
        if (b64 !== lastClipboardImage) {
          lastClipboardImage = b64;
          lastClipboardText = '';
          mainWindow.webContents.send('clipboard-image', b64);
        }
      }
    } catch (e) {
      // 剪贴板读取失败（如被其他程序占用），忽略
    }
  }, 1500); // 每 1.5 秒检查一次
}

function stopClipboardMonitor() {
  if (clipboardTimer) {
    clearInterval(clipboardTimer);
    clipboardTimer = null;
  }
  clipboardMonitorActive = false;
  lastClipboardText = '';
  lastClipboardImage = null;
  console.log('[Main] 剪贴板监听已关闭');
}

// IPC：切换剪贴板监听
ipcMain.handle('toggle-clipboard-monitor', async (event, enabled) => {
  if (enabled) {
    startClipboardMonitor();
  } else {
    stopClipboardMonitor();
  }
  return clipboardMonitorActive;
});

ipcMain.handle('get-clipboard-monitor-status', async () => {
  return clipboardMonitorActive;
});

// 单实例锁：重复启动时激活已有窗口而非创建新进程
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 中文菜单栏
function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '设置', enabled: false },
        { type: 'separator' },
        { label: '退出', click: () => { app.quit(); } }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '刷新', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于 ClipSync', click: () => {
          const { dialog } = require('electron');
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '关于 ClipSync',
            message: 'ClipSync v1.0.0',
            detail: '局域网跨设备剪贴板同步工具\n支持文字、图片、文件的实时同步。'
          });
        }}
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 680,
    minWidth: 360,
    minHeight: 500,
    title: 'ClipSync',
    backgroundColor: '#F0F7FF',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // 加载本地服务器上的 Web 界面（而不是 file://）
  // 这样 window.location.origin = http://localhost:9527，API 调用正常工作
  mainWindow.loadURL(`http://localhost:${serverPort}`);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // 开机自启时不弹出窗口，仅显示托盘图标
  mainWindow.once('ready-to-show', () => {
    if (!startHidden) {
      mainWindow.show();
    }
  });

  // 关闭窗口时隐藏到托盘而非退出
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// IPC：用 Electron 主进程打开文件夹（有 GUI 上下文，窗口正常置顶）
ipcMain.handle('open-folder', async (event, folderPath) => {
  const err = await shell.openPath(folderPath);
  if (err) throw new Error(err);
  return true;
});

// 应用就绪
app.whenReady().then(async () => {
  // 0. 设置开机自启（默认开启，用户可在 Windows 任务管理器「启动」中禁用）
  app.setLoginItemSettings({
    openAtLogin: true,
    // 开发时不传 args，打包后传最小化参数
    args: process.argv.includes('--dev') ? [] : ['--hidden']
  });

  // 1. 先启动后端服务（HTTP + WebSocket + mDNS + SQLite）
  try {
    const server = require('../server/index');
    const result = await server.init({
      electron: true,
      // 打包后写入用户数据目录，避免安装目录无写入权限导致空白页
      dataDir: app.isPackaged ? app.getPath('userData') : path.join(__dirname, '..', '..', 'data')
    });
    if (result) serverPort = result.port;
    console.log('[Main] 后端服务已启动，端口:', serverPort);
  } catch (e) {
    console.error('[Main] 后端服务启动失败:', e.message);
  }

  // 2. 等待一小段时间确保服务器就绪
  await new Promise(resolve => setTimeout(resolve, 500));

  // 3. 创建窗口
  createWindow();

  // 4. 创建系统托盘
  createTray(mainWindow);

  // 5. 设置中文菜单栏
  createMenu();

  app.on('activate', () => {
    // macOS Dock 点击：如果窗口被隐藏则显示
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

// 有托盘时，所有窗口关闭也不退出（由托盘菜单的「退出」触发）
app.on('window-all-closed', () => {
  // 不自动退出，应用仍在托盘运行
});

app.on('before-quit', () => {
  isQuitting = true;
  stopClipboardMonitor();
  destroyTray();
});
