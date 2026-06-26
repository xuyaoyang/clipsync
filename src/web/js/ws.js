// ClipSync — WebSocket 客户端
const WSClient = (() => {
  let ws = null;
  let reconnectTimer = null;
  let pingTimer = null;
  let onMessageCallbacks = {};
  let onStatusChange = null;
  let retryCount = 0;
  let stopped = false;

  async function connect() {
    if (stopped) return;

    const deviceId = localStorage.getItem('deviceId');
    const deviceName = localStorage.getItem('deviceName') || '未知设备';
    const token = localStorage.getItem('token') || '';
    const platform = getPlatform();

    try {
      await CryptoClient.init();
    } catch (e) {
      console.warn('[WS] 加密初始化失败:', e.message);
    }

    const pubkey = await CryptoClient.getPublicKeyBase64().catch(() => '');

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsURL = wsProtocol + '//' + window.location.host + '/api/connect';
    const url = wsURL + '?deviceId=' + deviceId +
      '&token=' + token +
      '&name=' + encodeURIComponent(deviceName) +
      '&platform=' + platform +
      '&pubkey=' + encodeURIComponent(pubkey);

    try {
      ws = new WebSocket(url);
      ws.onopen = handleOpen;
      ws.onmessage = handleMessage;
      ws.onclose = handleClose;
      ws.onerror = handleError;
    } catch (e) {
      console.error('WebSocket 连接失败:', e);
      scheduleReconnect();
    }
  }

  function handleOpen() {
    console.log('[WS] 已连接');
    retryCount = 0;
    updateStatus('connected');
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  async function handleMessage(event) {
    try {
      const msg = JSON.parse(event.data);

      // 处理密钥协商
      const keyExchange = msg.payload && msg.payload.serverPubKey;
      if (keyExchange && msg.payload.encryptedMasterKey) {
        try {
          await CryptoClient.setMasterKeyFromNegotiation(
            msg.payload.serverPubKey,
            msg.payload.encryptedMasterKey
          );
          console.log('[WS] 密钥协商成功');
        } catch (e) {
          console.error('[WS] 密钥协商失败:', e);
        }
      }

      let payload = msg.payload;
      if (payload && payload.encrypted && CryptoClient.hasKey()) {
        try {
          payload = await CryptoClient.decryptJSON(payload);
        } catch (e) {
          console.error('[WS] 解密消息失败:', e);
          return;
        }
      }

      const callback = onMessageCallbacks[msg.type];
      if (callback) callback(payload, msg);

      const allCb = onMessageCallbacks['*'];
      if (allCb) allCb(payload, msg);
    } catch (e) {
      console.error('[WS] 解析失败:', e);
    }
  }

  function handleClose(event) {
    console.log('[WS] 断开, code:', event.code);
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    updateStatus('disconnected');
    scheduleReconnect();
  }

  function handleError(error) {
    console.error('[WS] 错误:', error);
    updateStatus('error');
  }

  function scheduleReconnect() {
    if (reconnectTimer || stopped) return;
    const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
    retryCount++;
    console.log('[WS] ' + delay + 'ms 后重连 (#' + retryCount + ')');
    updateStatus('reconnecting');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  // 停止重连（被拒/被撤后调用）
  function stopReconnect() {
    stopped = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (ws) { ws.close(); ws = null; }
    updateStatus('disconnected');
  }

  // 手动重连（用户重新请求时调用）
  function restart() {
    stopped = false;
    retryCount = 0;
    connect();
  }

  function updateStatus(status) {
    if (onStatusChange) {
      const map = {
        connected: '🟢 已连接',
        disconnected: '🔴 未连接',
        reconnecting: '🔄 重连中...',
        error: '⚠️ 连接异常'
      };
      onStatusChange({ status, text: map[status] || status });
    }
  }

  function on(type, callback) {
    onMessageCallbacks[type] = callback;
  }

  function setStatusCallback(callback) {
    onStatusChange = callback;
  }

  function getPlatform() {
    const ua = navigator.userAgent;
    if (window.clipSync && window.clipSync.platform) return window.clipSync.platform;
    if (ua.includes('Windows')) return 'win32';
    if (ua.includes('iPad')) return 'ipados';
    if (ua.includes('iPhone')) return 'ipados';
    if (ua.includes('HarmonyOS')) return 'harmonyos';
    return 'other';
  }

  function disconnect() {
    stopReconnect();
  }

  return { connect, disconnect, on, setStatusCallback, stopReconnect, restart };
})();
