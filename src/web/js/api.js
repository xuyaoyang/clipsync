// ClipSync — API 调用封装
const API = (() => {
  const baseURL = window.location.origin + '/api';

  function getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    // 只有密钥已就绪才告诉服务器加密（避免启动时密钥未协商导致响应无法解密）
    if (CryptoClient.hasKey()) {
      headers['X-ClipSync-Encryption'] = '1';
    }
    return headers;
  }

  async function request(method, path, body) {
    const options = { method, headers: getHeaders() };

    if (body && method !== 'GET') {
      // 加密请求体
      if (CryptoClient.hasKey()) {
        const encrypted = await CryptoClient.encryptJSON(body);
        options.body = JSON.stringify(encrypted);
      } else {
        options.body = JSON.stringify(body);
      }
    }

    const controller = new AbortController();
    options.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(baseURL + path, options);
      clearTimeout(timer);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
        throw new Error(err.error?.message || '服务器错误: ' + res.status);
      }
      const data = await res.json();

      // 解密响应体
      if (data && data.encrypted && CryptoClient.hasKey()) {
        return CryptoClient.decryptJSON(data);
      }
      return data;
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        throw new Error('请求超时，请检查网络');
      }
      throw e;
    }
  }

  // 内容列表
  async function getItems(type, limit = 100, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (type && type !== 'all') params.set('type', type);
    return request('GET', '/items?' + params);
  }

  // 创建文字
  async function createText(content, sourceDevice) {
    return request('POST', '/items', { type: 'text', content, sourceDevice });
  }

  // 上传文件/图片（multipart/form-data，不加密文件内容，但响应会加密）
  async function uploadFile(file, sourceDevice) {
    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('sourceDevice', sourceDevice);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);

    try {
      const headers = {};
      const token = localStorage.getItem('token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (CryptoClient.hasKey()) {
        headers['X-ClipSync-Encryption'] = '1';
      }
      const res = await fetch(baseURL + '/upload', {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: formData
      });
      clearTimeout(timer);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
        throw new Error(err.error?.message || '上传失败: ' + res.status);
      }
      const data = await res.json();
      // 解密响应
      if (data && data.encrypted && CryptoClient.hasKey()) {
        return CryptoClient.decryptJSON(data);
      }
      return data;
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        throw new Error('上传超时，文件过大或网络不稳定');
      }
      throw e;
    }
  }

  // 文件下载 URL
  function getFileURL(id) {
    const token = localStorage.getItem('token');
    const sep = baseURL.includes('?') ? '&' : '?';
    return baseURL + '/items/' + id + '/file' + (token ? '?token=' + encodeURIComponent(token) : '');
  }

  // 增量同步
  async function sync(lastSyncAt) {
    return request('POST', '/items/sync', { lastSyncAt: lastSyncAt || 0 });
  }

  // 设备管理
  async function getDevices() {
    return request('GET', '/devices');
  }

  async function removeDevice(id) {
    return request('DELETE', '/devices/' + id);
  }

  async function approveDevice(deviceId, deviceName, platform, action) {
    return request('POST', '/devices/approve', { deviceId, deviceName, platform, action });
  }

  async function getPendingDevices() {
    return request('GET', '/devices/pending');
  }

  async function getPeers() {
    return request('GET', '/peers');
  }

  async function reconnectPeer(id) {
    return request('POST', '/peers/' + id + '/reconnect');
  }

  // 获取二维码
  async function requestQRCode() {
    const token = localStorage.getItem('token');
    const url = baseURL + '/qrcode' + (token ? '?token=' + encodeURIComponent(token) : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error('获取二维码失败');
    return res.json();
  }

  // 打开文件存储目录
  async function openFolder() {
    return request('POST', '/open-folder');
  }

  return { getItems, createText, uploadFile, getFileURL, sync, getDevices, removeDevice, approveDevice, getPendingDevices, getPeers, reconnectPeer, requestQRCode, openFolder };
})();
