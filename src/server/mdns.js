// ClipSync — mDNS 局域网发现模块
const bonjour = require('bonjour');
const os = require('os');

let instance = null;
let service = null;
let browser = null;

// 启动 mDNS 服务广播
function startBroadcast(port) {
  try {
    instance = bonjour();

    // 广播服务
    service = instance.publish({
      name: `ClipSync-${os.hostname()}`,
      type: '_clipsync._tcp.local',
      port: port,
      txt: {
        version: '1.0.0',
        platform: process.platform,
        hostname: os.hostname()
      }
    });

    service.on('error', (err) => {
      console.error('[mDNS] 广播错误:', err.message);
      // mDNS 失败不影响核心功能
    });

    console.log(`[mDNS] 服务已广播: ClipSync-${os.hostname()}._clipsync._tcp.local`);
  } catch (e) {
    console.error('[mDNS] 启动失败:', e.message);
    // 不阻塞：mDNS 是辅助功能，手动输入 IP 也可以连接
  }
}

// 扫描局域网内的 ClipSync 服务
function startScanning(callback) {
  try {
    if (!instance) {
      instance = bonjour();
    }

    browser = instance.find({ type: '_clipsync._tcp.local' });

    browser.on('up', (svc) => {
      const info = {
        name: svc.name,
        host: svc.host || svc.referer?.address,
        port: svc.port,
        addresses: svc.addresses,
        txt: svc.txt
      };
      console.log('[mDNS] 发现服务:', info.name, info.host, info.port);
      if (callback) callback('up', info);
    });

    browser.on('down', (svc) => {
      console.log('[mDNS] 服务下线:', svc.name);
      if (callback) callback('down', { name: svc.name });
    });

    browser.on('error', (err) => {
      console.error('[mDNS] 扫描错误:', err.message);
    });

    console.log('[mDNS] 开始扫描局域网服务...');
  } catch (e) {
    console.error('[mDNS] 扫描启动失败:', e.message);
  }
}

// 停止所有 mDNS 活动
function stop() {
  try {
    if (browser) { browser.stop(); browser = null; }
    if (service) { service.stop(); service = null; }
    if (instance) { instance.destroy(); instance = null; }
  } catch (e) { /* ignore */ }
}

// 获取本机局域网 IP 地址
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      // IPv4，内网地址，非回环
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push({ name, address: addr.address });
      }
    }
  }
  return ips;
}

// 获取首选局域网 IP
function getPrimaryIP() {
  const ips = getLocalIPs();
  if (ips.length === 0) return '127.0.0.1';

  // 优先选择 192.168.x.x 或 10.x.x.x
  const preferred = ips.find(ip => ip.address.startsWith('192.168.'));
  if (preferred) return preferred.address;

  const alt = ips.find(ip => ip.address.startsWith('10.'));
  if (alt) return alt.address;

  return ips[0].address;
}

module.exports = { startBroadcast, startScanning, stop, getLocalIPs, getPrimaryIP };
