// ClipSync — 主应用逻辑
const App = (() => {
  let currentFilter = 'all';
  let isSending = false;  // 防重复发送

  async function init() {
    UI.init();

    // 初始化设备身份
    initDeviceIdentity();

    // 初始化设备管理
    DeviceManager.init();

    // 绑定事件
    bindEvents();

    // 设置 WebSocket 回调
    setupWebSocket();

    // 设置输入框自动伸缩
    setupAutoResize();

    // 连接 WebSocket
    WSClient.connect();

    // 加载已有内容
    loadItems();

    // 注册 Service Worker（PWA 离线支持）
    registerSW();

    // 初始化剪贴板监听（仅 Electron）
    initClipboardMonitor();

    console.log('[App] 初始化完成');
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;

    // SW 更新接管时自动刷新，确保用户拿到最新代码
    let swRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!swRefreshing) {
        swRefreshing = true;
        console.log('[SW] 检测到更新，自动刷新...');
        window.location.reload();
      }
    });

    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('[SW] 已注册, scope:', reg.scope);

        // 如果页面加载时已有等待中的新 SW，立即激活
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        // 新 SW 安装完成 → 刷新
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] 新版本就绪，刷新页面');
                window.location.reload();
              }
            });
          }
        });
      })
      .catch((err) => {
        console.warn('[SW] 注册失败:', err.message);
      });
  }

  function initDeviceIdentity() {
    if (!localStorage.getItem('deviceId')) {
      localStorage.setItem('deviceId', generateUUID());
    }

    // 如果已有自定义名称（非自动生成的默认名），保留它
    const existingName = localStorage.getItem('deviceName');
    const defaultNames = ['我的设备', '我的电脑', '我的 iPad', '我的 iPhone', '我的华为手机'];

    if (!existingName || defaultNames.includes(existingName)) {
      // 自动检测更友好的设备名称
      const detected = detectDeviceName();
      localStorage.setItem('deviceName', detected);
      console.log('[App] 设备名称:', detected);
    }
  }

  // 根据 User-Agent 和平台信息检测设备名称
  function detectDeviceName() {
    const ua = navigator.userAgent;

    // Windows Electron：使用电脑主机名
    if (window.clipSync && window.clipSync.platform === 'win32') {
      const hostname = window.clipSync.hostname || '';
      if (hostname) return hostname.replace(/\.local$/, '');
      return 'Windows 电脑';
    }

    // iPhone
    if (ua.includes('iPhone') || (ua.includes('iOS') && !ua.includes('iPad'))) {
      const m = ua.match(/iPhone OS (\d+)[._](\d+)/);
      if (m) return `iPhone (iOS ${m[1]}.${m[2]})`;
      return 'iPhone';
    }

    // iPad
    if (ua.includes('iPad')) {
      const m = ua.match(/CPU OS (\d+)[._](\d+)/);
      if (m) return `iPad (iPadOS ${m[1]}.${m[2]})`;
      return 'iPad';
    }

    // HarmonyOS
    if (ua.includes('HarmonyOS') || ua.includes('OpenHarmony')) {
      // 尝试提取设备型号，如 "ALN-AL80"
      const m = ua.match(/(?:HarmonyOS|OpenHarmony)[^;)]*;\s*([A-Za-z0-9][A-Za-z0-9\-_\s]{1,20})(?:;|\))/);
      if (m) return m[1].trim();
      return '华为设备';
    }

    // Android
    if (ua.includes('Android')) {
      const m = ua.match(/Android\s[\d.]+\s*;\s*([^;)]+)/);
      if (m) {
        const model = m[1].trim();
        // 去除 "zh-cn" 这类语言标签
        if (/^[a-z]{2}-[a-z]{2}$/i.test(model)) return '安卓设备';
        return model;
      }
      return '安卓设备';
    }

    // Mac
    if (ua.includes('Macintosh') || ua.includes('Mac OS X')) return 'Mac 电脑';

    // Linux
    if (ua.includes('Linux')) return 'Linux 设备';

    return '未知设备';
  }

  function setupWebSocket() {
    WSClient.setStatusCallback((statusInfo) => {
      UI.updateServerStatus(statusInfo.text);
    });

    // 收到新内容
    WSClient.on('new_item', (item) => {
      UI.prependItem(item);
      UI.showToast('收到新内容: ' + (item.type === 'text' ? item.content.slice(0, 20) + '...' : item.fileName));
    });

    // 内容被删除
    WSClient.on('item_deleted', (data) => {
      UI.removeItem(data.id);
    });

    // 连接成功
    WSClient.on('welcome', (data) => {
      UI.updateServerStatus('🟢 已连接');
      UI.updateDeviceCount(data.deviceCount);
      // 密钥协商成功后重新加载（如果之前因密钥未就绪而加载失败）
      if (CryptoClient.hasKey()) loadItems();
    });

    // 需要授权
    WSClient.on('auth_required', (data) => {
      UI.updateServerStatus('⏳ 等待管理员审批...');
      UI.showToast('已发送连接请求，请在电脑端审批');
    });

    // 授权通过
    WSClient.on('auth_approved', (data) => {
      if (data.token) {
        localStorage.setItem('token', data.token);
      }
      UI.updateServerStatus('🟢 已授权');
      UI.showToast('连接已通过审批！');
      loadItems();
    });

    // 授权被拒
    WSClient.on('auth_rejected', (data) => {
      localStorage.removeItem('token');
      WSClient.stopReconnect();
      UI.updateServerStatus('🚫 连接被拒绝');
      UI.showToast('连接请求被拒绝');
    });

    // 授权被撤回（管理员移除设备）
    WSClient.on('auth_revoked', (data) => {
      localStorage.removeItem('token');
      WSClient.stopReconnect();
      UI.updateServerStatus('🚫 授权被移除');
      UI.showToast('授权已被移除，请重新请求连接');
    });

    // 待审批设备通知（PC 管理端收到）
    WSClient.on('pending_device', (data) => {
      DeviceManager.onPendingDevice(data);
    });

    WSClient.on('pending_device_removed', (data) => {
      DeviceManager.onPendingDeviceRemoved(data.deviceId);
    });

    // 设备上线/下线
    WSClient.on('device_online', () => {
      loadItems();
      DeviceManager.loadAuthorized();
    });
    WSClient.on('device_offline', () => {
      loadItems();
      DeviceManager.loadAuthorized();
    });
  }

  // ===== 剪贴板监听 =====

  function initClipboardMonitor() {
    const btn = document.getElementById('btnClipboardToggle');
    if (!btn) return;

    let active = false;

    // Electron 环境：恢复状态并注册监听
    if (window.clipSync && window.clipSync.toggleClipboardMonitor) {
      active = localStorage.getItem('clipboardMonitor') === 'true';
      if (active) window.clipSync.toggleClipboardMonitor(true);

      window.clipSync.onClipboardText((text) => {
        handleClipboardContent(text, null);
      });
      window.clipSync.onClipboardImage((base64) => {
        handleClipboardContent(null, base64);
      });
    }

    updateUI();

    btn.addEventListener('click', () => {
      if (!window.clipSync || !window.clipSync.toggleClipboardMonitor) {
        UI.showToast('此功能仅桌面端可用');
        return;
      }
      active = !active;
      localStorage.setItem('clipboardMonitor', active ? 'true' : 'false');
      window.clipSync.toggleClipboardMonitor(active);
      updateUI();
    });

    function updateUI() {
      btn.style.background = active ? 'rgba(255,255,255,0.4)' : '';
      btn.textContent = active ? '📋●' : '📋';
    }
  }

  async function handleClipboardContent(text, imageBase64) {
    if (isSending) return;
    isSending = true;
    const sourceDevice = localStorage.getItem('deviceName') || '本机';

    try {
      if (text) {
        const item = await API.createText(text, sourceDevice);
        UI.prependItem(item);
        UI.showToast('📋 已自动同步剪贴板文字');
      } else if (imageBase64) {
        const byteStr = atob(imageBase64);
        const bytes = new Uint8Array(byteStr.length);
        for (let i = 0; i < byteStr.length; i++) {
          bytes[i] = byteStr.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'image/png' });
        const file = new File([blob], 'clipboard-' + Date.now() + '.png', { type: 'image/png' });
        const item = await API.uploadFile(file, sourceDevice);
        UI.prependItem(item);
        UI.showToast('🖼️ 已自动同步剪贴板图片');
      }
    } catch (e) {
      console.error('[Clipboard] 自动同步失败:', e);
    } finally {
      isSending = false;
    }
  }

  // 加载内容列表
  async function loadItems() {
    try {
      const data = await API.getItems(currentFilter);
      UI.renderItems(data.items);
    } catch (e) {
      console.error('加载内容失败:', e);
      // 服务器未就绪时不报错
    }
  }

  // 发送文字
  async function sendText() {
    if (isSending) return;
    const text = UI.getInputText();
    if (!text) return;

    isSending = true;
    UI.setSendEnabled(false);
    try {
      const sourceDevice = localStorage.getItem('deviceName') || '本机';
      const item = await API.createText(text, sourceDevice);
      UI.prependItem(item);
      UI.clearInput();
      UI.showToast('已发送');
    } catch (e) {
      console.error('发送失败:', e);
      UI.showToast('发送失败: ' + e.message);
    } finally {
      UI.setSendEnabled(true);
      isSending = false;
    }
  }

  // 发送文件
  async function sendFiles(files) {
    if (isSending) return;
    isSending = true;
    UI.setSendEnabled(false);

    const sourceDevice = localStorage.getItem('deviceName') || '本机';

    // 转为数组（FileList 在部分浏览器上迭代不可靠）
    const fileArray = Array.from(files);
    console.log('[App] 准备发送 ' + fileArray.length + ' 个文件');

    for (const file of fileArray) {
      try {
        const item = await API.uploadFile(file, sourceDevice);
        UI.prependItem(item);
        UI.showToast('已发送: ' + file.name);
      } catch (e) {
        console.error('[App] 上传失败:', file.name, e);
        UI.showToast('上传失败: ' + file.name + ' - ' + e.message);
      }
    }

    console.log('[App] 全部发送完成');
    UI.setSendEnabled(true);
    isSending = false;
  }

  // 切换筛选
  function setFilter(type) {
    currentFilter = type;
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.type === type);
    });
    loadItems();
  }

  // 事件绑定
  function bindEvents() {
    const els = UI.getEls();

    // 发送按钮
    els.btnSend && els.btnSend.addEventListener('click', sendText);

    // 回车发送
    els.inputText && els.inputText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendText();
      }
    });

    // 附件按钮
    els.btnAttach && els.btnAttach.addEventListener('click', () => {
      els.fileInput.click();
    });

    // 文件选择
    els.fileInput && els.fileInput.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        await sendFiles(e.target.files);  // 等待全部上传完成再清空
        e.target.value = '';
      }
    });

    // 分类标签
    els.tabs && els.tabs.forEach(tab => {
      tab.addEventListener('click', () => setFilter(tab.dataset.type));
    });

    // 拖拽上传
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) {
        await sendFiles(e.dataTransfer.files);
      }
    });

    // 粘贴图片
    document.addEventListener('paste', async (e) => {
      const items = e.clipboardData.items;
      const imageFiles = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          imageFiles.push(item.getAsFile());
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        await sendFiles(imageFiles);
      }
    });

    // 打开文件夹按钮
    const btnOpenFolder = document.getElementById('btnOpenFolder');
    btnOpenFolder && btnOpenFolder.addEventListener('click', async () => {
      try {
        // Electron 环境：通过主进程 IPC 打开（有 GUI 上下文，窗口正常置顶）
        if (window.clipSync && window.clipSync.openUploadFolder) {
          await window.clipSync.openUploadFolder();
        } else {
          await API.openFolder();
        }
        UI.showToast('文件夹已打开');
      } catch (e) {
        UI.showToast('打开失败: ' + e.message);
      }
    });

    // 二维码按钮
    const qrOverlay = document.getElementById('qrOverlay');
    const qrDialog = document.getElementById('qrDialog');
    const btnQRCode = document.getElementById('btnQRCode');
    const btnCloseQR = document.getElementById('btnCloseQR');

    btnQRCode && btnQRCode.addEventListener('click', async () => {
      // 加载二维码
      const qrSvg = document.getElementById('qrSvg');
      const qrUrl = document.getElementById('qrUrl');
      try {
        const data = await API.requestQRCode();
        qrSvg.replaceChildren();
        const doc = new DOMParser().parseFromString(data.svg, 'image/svg+xml');
        const svg = doc.documentElement;
        if (svg && svg.nodeName.toLowerCase() === 'svg') {
          qrSvg.appendChild(document.importNode(svg, true));
        } else {
          throw new Error('二维码格式无效');
        }
        qrUrl.textContent = data.url;
      } catch (e) {
        qrSvg.replaceChildren();
        const error = document.createElement('p');
        error.style.color = 'red';
        error.textContent = '加载失败';
        qrSvg.appendChild(error);
        qrUrl.textContent = '请检查服务是否启动';
      }
      qrOverlay.hidden = false;
      qrDialog.hidden = false;
    });

    btnCloseQR && btnCloseQR.addEventListener('click', () => {
      qrOverlay.hidden = true;
      qrDialog.hidden = true;
    });

    qrOverlay && qrOverlay.addEventListener('click', () => {
      qrOverlay.hidden = true;
      qrDialog.hidden = true;
    });
  }

  function setupAutoResize() {
    const textarea = UI.getEls().inputText;
    if (!textarea) return;
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    });
  }

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
