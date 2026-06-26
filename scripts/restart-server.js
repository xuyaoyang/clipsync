// 重启 ClipSync 服务器
const { execSync } = require('child_process');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 9527;

// 1. 杀掉所有 node.exe
console.log('[Restart] 正在停止旧进程...');
try { execSync('taskkill /f /im node.exe', { timeout: 5000, stdio: 'ignore' }); } catch(e) {}
try { execSync('taskkill /f /im electron.exe', { timeout: 5000, stdio: 'ignore' }); } catch(e) {}

// 2. 等待端口释放
const net = require('net');
function waitPort(port, retries = 20) {
  return new Promise((resolve) => {
    function check() {
      const server = net.createServer();
      server.once('error', () => { server.close(); retries-- > 0 ? setTimeout(check, 500) : resolve(false); });
      server.once('listening', () => { server.close(); resolve(true); });
      server.listen(port, '0.0.0.0');
    }
    check();
  });
}

waitPort(PORT).then((free) => {
  if (!free) {
    console.error('[Restart] 端口', PORT, '无法释放，请手动重启');
    process.exit(1);
  }
  console.log('[Restart] 端口已释放，启动服务器...');

  // 3. 启动服务器
  const server = spawn('node', ['src/server/index.js'], {
    cwd: path.join(__dirname),
    stdio: 'inherit'
  });

  server.on('exit', (code) => {
    console.log('[Restart] 服务器已退出, code:', code);
    process.exit(code);
  });
});
