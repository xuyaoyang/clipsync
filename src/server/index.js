// ClipSync — 服务器启动入口
// 支持独立运行（node src/server/index.js）和 Electron 内嵌
const path = require('path');
const database = require('../database');
const { start: startHTTP } = require('./http-server');
const websocket = require('./websocket');
const mdns = require('./mdns');
const peers = require('./peers');

const PORT = process.env.PORT || 9527;
const CLEAN_INTERVAL = 60 * 1000;

let cleanTimer = null;
let httpServer = null;

async function init(options = {}) {
  const basePort = options.port || PORT;

  console.log('═══════════════════════════════════');
  console.log('  🔵 ClipSync v1.0.0');
  console.log('  局域网跨设备同步服务');
  console.log('═══════════════════════════════════');

  // 1. 数据库
  const dataDir = options.dataDir || path.join(__dirname, '..', '..', 'data');
  database.init(dataDir);
  console.log('[Init] 数据库已初始化:', dataDir);
  const serverDeviceId = database.getSetting('server_device_id');

  const result = database.cleanExpired();
  if (result.deleted > 0) {
    console.log(`[Init] 清理 ${result.deleted} 条过期内容`);
  }

  // 2. HTTP 服务器（端口被占用时自动尝试下一个）
  const uploadDir = path.join(dataDir, 'files');
  const http = await startHTTP(basePort, uploadDir);
  httpServer = http.httpServer;
  const app = http.app;
  const actualPort = http.port;

  // 3. WebSocket
  websocket.init(httpServer);

  // 4. 关联事件 — 新内容广播给所有客户端
  app.on('new-item', (item) => {
    websocket.notifyNewItem(item);
  });

  global.onPendingDevice = (device) => {
    console.log(`[Auth] 待审批设备: ${device.name} (${device.platform})`);
  };

  // 5. mDNS
  mdns.startBroadcast(actualPort, { deviceId: serverDeviceId });

  // 6. 电脑互联：发现同网 ClipSync 电脑并自动同步
  peers.init({ app, uploadDir, port: actualPort, deviceId: serverDeviceId });

  // 7. 定时清理
  cleanTimer = setInterval(() => {
    database.cleanExpired();
  }, CLEAN_INTERVAL);

  // 8. 显示地址
  const localIP = mdns.getPrimaryIP();
  console.log('');
  console.log('  📡 服务已启动！');
  console.log(`  🔗 本机访问: http://localhost:${actualPort}`);
  console.log(`  🔗 局域网访问: http://${localIP}:${actualPort}`);
  console.log('  📱 手机/平板打开浏览器输入上面的局域网地址即可使用');
  console.log('');

  // 非 Electron 环境显示退出提示
  if (!options.electron) {
    console.log('  按 Ctrl+C 停止服务');
    console.log('═══════════════════════════════════');
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } else {
    console.log('═══════════════════════════════════');
  }

  return { app, httpServer, port: actualPort };
}

function shutdown() {
  console.log('\n[Shutdown] 正在关闭服务...');
  if (cleanTimer) {
    clearInterval(cleanTimer);
    cleanTimer = null;
  }
  database.cleanExpired();
  mdns.stop();
  database.close();
  console.log('[Shutdown] 服务已停止');

  // 只在独立运行时退出进程，Electron 中不退出
  if (!process.type || process.type !== 'browser') {
    process.exit(0);
  }
}

function getHttpServer() {
  return httpServer;
}

// 独立运行时自动启动
if (require.main === module) {
  init().catch((err) => {
    console.error('[Fatal] 启动失败:', err);
    process.exit(1);
  });
}

module.exports = { init, shutdown, getHttpServer };
