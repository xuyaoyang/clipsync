// ClipSync — Electron 预加载脚本
// 在渲染进程和主进程之间建立安全桥接
const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 给渲染进程（Web 界面）
contextBridge.exposeInMainWorld('clipSync', {
  // 获取当前平台信息
  platform: process.platform,
  hostname: require('os').hostname(),

  // 获取应用版本
  getVersion: () => ipcRenderer.invoke('get-version'),

  // 获取本机 IP 地址
  getLocalIP: () => ipcRenderer.invoke('get-local-ip'),

  // 剪贴板操作
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  writeClipboard: (text) => ipcRenderer.invoke('write-clipboard', text),

  // 剪贴板监听控制
  toggleClipboardMonitor: (enabled) => ipcRenderer.invoke('toggle-clipboard-monitor', enabled),
  getClipboardMonitorStatus: () => ipcRenderer.invoke('get-clipboard-monitor-status'),

  // 文件操作
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),

  // 应用控制
  minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),
  quit: () => ipcRenderer.send('quit-app'),
  openUploadFolder: () => ipcRenderer.invoke('open-upload-folder'),

  // 接收主进程消息
  onServerStatus: (callback) => {
    ipcRenderer.on('server-status', (event, status) => callback(status));
  },
  onDeviceRequest: (callback) => {
    ipcRenderer.on('device-request', (event, device) => callback(device));
  },
  onClipboardText: (callback) => {
    ipcRenderer.on('clipboard-text', (event, text) => callback(text));
  },
  onClipboardImage: (callback) => {
    ipcRenderer.on('clipboard-image', (event, base64) => callback(base64));
  }
});
