// ClipSync — 设备管理模块
const DeviceManager = (() => {
  let pendingCount = 0;
  let currentPendingDevice = null; // 当前弹窗显示的待审批设备
  const pendingDeviceIds = new Set();

  function init() {
    bindEvents();
    updateLocalInfo();
  }

  function bindEvents() {
    // 设置按钮 → 打开设备面板
    const btnSettings = document.getElementById('btnSettings');
    if (btnSettings) {
      btnSettings.addEventListener('click', openPanel);
    }

    // 关闭面板
    const btnClose = document.getElementById('btnClosePanel');
    if (btnClose) {
      btnClose.addEventListener('click', closePanel);
    }

    // 点击遮罩关闭面板
    const overlay = document.getElementById('deviceOverlay');
    if (overlay) {
      overlay.addEventListener('click', closePanel);
    }

    // 审批弹窗按钮
    const btnApprove = document.getElementById('btnApprove');
    const btnReject = document.getElementById('btnReject');
    if (btnApprove) {
      btnApprove.addEventListener('click', approveCurrent);
    }
    if (btnReject) {
      btnReject.addEventListener('click', rejectCurrent);
    }

    // 审批弹窗遮罩
    const approvalOverlay = document.getElementById('approvalOverlay');
    if (approvalOverlay) {
      approvalOverlay.addEventListener('click', closeApproval);
    }

    // 设备名称编辑
    const btnEditName = document.getElementById('btnEditName');
    const btnSaveName = document.getElementById('btnSaveName');
    const btnCancelName = document.getElementById('btnCancelName');
    const inputDeviceName = document.getElementById('inputDeviceName');
    const localNameEl = document.getElementById('localName');
    const localNameEdit = document.getElementById('localNameEdit');

    if (btnEditName) {
      btnEditName.addEventListener('click', () => {
        inputDeviceName.value = localStorage.getItem('deviceName') || '';
        localNameEl.parentElement.hidden = true;
        localNameEdit.hidden = false;
        inputDeviceName.focus();
        inputDeviceName.select();
      });
    }

    const saveName = () => {
      const newName = inputDeviceName.value.trim();
      if (newName) {
        localStorage.setItem('deviceName', newName);
        if (localNameEl) localNameEl.textContent = newName;
        UI.showToast('设备名称已更新');
      }
      localNameEl.parentElement.hidden = false;
      localNameEdit.hidden = true;
    };

    if (btnSaveName) btnSaveName.addEventListener('click', saveName);
    if (inputDeviceName) {
      inputDeviceName.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveName();
        if (e.key === 'Escape') {
          localNameEl.parentElement.hidden = false;
          localNameEdit.hidden = true;
        }
      });
    }
    if (btnCancelName) {
      btnCancelName.addEventListener('click', () => {
        localNameEl.parentElement.hidden = false;
        localNameEdit.hidden = true;
      });
    }
  }

  // 更新本机信息
  function updateLocalInfo() {
    const nameEl = document.getElementById('localName');
    const idEl = document.getElementById('localId');
    if (nameEl) nameEl.textContent = localStorage.getItem('deviceName') || '-';
    if (idEl) idEl.textContent = localStorage.getItem('deviceId') || '-';
  }

  // 打开发设备管理面板
  async function openPanel() {
    document.getElementById('deviceOverlay').hidden = false;
    document.getElementById('devicePanel').hidden = false;
    await Promise.all([loadAuthorized(), loadPending(), loadPeers()]);
    updateLocalInfo();
  }

  function closePanel() {
    document.getElementById('deviceOverlay').hidden = true;
    document.getElementById('devicePanel').hidden = true;
  }

  // 加载已授权设备
  async function loadAuthorized() {
    const container = document.getElementById('authorizedList');
    try {
      const data = await API.getDevices();
      if (data.devices && data.devices.length > 0) {
        container.innerHTML = data.devices.map(d => `
          <div class="device-entry">
            <div class="device-info">
              <span class="device-name">${escape(d.name)}</span>
              <span class="device-meta">${escape(d.platform)} · 最后在线: ${formatLastSeen(d.last_seen_at)}</span>
            </div>
            <button class="btn-remove" data-id="${escape(d.id)}">移除</button>
          </div>
        `).join('');

        // 绑定移除按钮
        container.querySelectorAll('.btn-remove').forEach(btn => {
          btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            try {
              await API.removeDevice(id);
              UI.showToast('已移除设备授权');
              loadAuthorized();
            } catch (e) {
              UI.showToast('移除失败: ' + e.message);
            }
          });
        });
      } else {
        container.innerHTML = '<p class="panel-hint">暂无已授权设备</p>';
      }
    } catch (e) {
      console.error('加载设备列表失败:', e);
      container.innerHTML = '<p class="panel-hint">加载失败</p>';
    }
  }

  // 加载待审批设备
  async function loadPending() {
    const section = document.getElementById('pendingSection');
    const container = document.getElementById('pendingList');
    try {
      const data = await API.getPendingDevices();
      pendingCount = data.pending ? data.pending.length : 0;
      pendingDeviceIds.clear();
      (data.pending || []).forEach(d => pendingDeviceIds.add(d.deviceId));
      updateBadge();

      if (pendingCount > 0) {
        section.hidden = false;
        container.innerHTML = data.pending.map(d => `
          <div class="pending-entry">
            <div class="device-info">
              <span class="device-name">${escape(d.name)}</span>
              <span class="device-meta">${escape(d.platform)} · ${escape(d.ipAddress || '')}</span>
            </div>
            <div class="pending-actions">
              <button class="btn-reject-sm" data-id="${escape(d.deviceId)}">拒绝</button>
              <button class="btn-approve-sm" data-id="${escape(d.deviceId)}">接受</button>
            </div>
          </div>
        `).join('');

        container.querySelectorAll('.btn-approve-sm').forEach(btn => {
          btn.addEventListener('click', () => handleApprove(btn.dataset.id));
        });
        container.querySelectorAll('.btn-reject-sm').forEach(btn => {
          btn.addEventListener('click', () => handleReject(btn.dataset.id));
        });
      } else {
        section.hidden = true;
        container.innerHTML = '';
      }
    } catch (e) {
      console.error('加载待审批列表失败:', e);
    }
  }

  async function loadPeers() {
    const container = document.getElementById('peerList');
    if (!container) return;

    try {
      const data = await API.getPeers();
      if (data.peers && data.peers.length > 0) {
        container.innerHTML = data.peers.map(peer => `
          <div class="device-entry peer-entry">
            <div class="device-info">
              <span class="device-name">${escape(peer.name)}</span>
              <span class="device-meta">${escape(peer.host || '-')}:${escape(String(peer.port || '-'))} · ${formatPeerStatus(peer.status)} · 最后在线: ${formatLastSeen(peer.last_seen_at)}</span>
            </div>
            <button class="btn-reconnect" data-id="${escape(peer.id)}">重连</button>
          </div>
        `).join('');

        container.querySelectorAll('.btn-reconnect').forEach(btn => {
          btn.addEventListener('click', async () => {
            try {
              await API.reconnectPeer(btn.dataset.id);
              UI.showToast('已尝试重新连接');
              loadPeers();
            } catch (e) {
              UI.showToast('重连失败: ' + e.message);
            }
          });
        });
      } else {
        container.innerHTML = '<p class="panel-hint">暂无发现的电脑</p>';
      }
    } catch (e) {
      console.error('加载电脑互联列表失败:', e);
      container.innerHTML = '<p class="panel-hint">加载失败</p>';
    }
  }

  // 收到 WebSocket 新待审批设备通知
  function onPendingDevice(device) {
    if (!pendingDeviceIds.has(device.deviceId)) {
      pendingDeviceIds.add(device.deviceId);
      pendingCount++;
    }
    updateBadge();
    // 显示审批弹窗
    showApproval(device);
  }

  function onPendingDeviceRemoved(deviceId) {
    if (pendingDeviceIds.delete(deviceId)) {
      pendingCount = Math.max(0, pendingCount - 1);
      updateBadge();
    }
    if (currentPendingDevice && currentPendingDevice.deviceId === deviceId) {
      closeApproval();
    }
    loadPending();
  }

  // 显示审批弹窗
  function showApproval(device) {
    currentPendingDevice = device;
    document.getElementById('reqName').textContent = device.name || '未知设备';
    document.getElementById('reqPlatform').textContent = device.platform || 'other';
    document.getElementById('reqIP').textContent = device.ipAddress || '';
    document.getElementById('approvalOverlay').hidden = false;
    document.getElementById('approvalDialog').hidden = false;
  }

  function closeApproval() {
    document.getElementById('approvalOverlay').hidden = true;
    document.getElementById('approvalDialog').hidden = true;
    currentPendingDevice = null;
  }

  async function approveCurrent() {
    if (!currentPendingDevice) return;
    await handleApprove(currentPendingDevice.deviceId);
    closeApproval();
  }

  async function rejectCurrent() {
    if (!currentPendingDevice) return;
    await handleReject(currentPendingDevice.deviceId);
    closeApproval();
  }

  async function handleApprove(deviceId) {
    try {
      await API.approveDevice(deviceId, '', '', 'approve');
      UI.showToast('设备已批准');
      pendingDeviceIds.delete(deviceId);
      pendingCount = Math.max(0, pendingCount - 1);
      updateBadge();
      loadPending();
      loadAuthorized();
      loadPeers();
    } catch (e) {
      UI.showToast('审批失败: ' + e.message);
    }
  }

  async function handleReject(deviceId) {
    try {
      await API.approveDevice(deviceId, '', '', 'reject');
      UI.showToast('设备已拒绝');
      pendingDeviceIds.delete(deviceId);
      pendingCount = Math.max(0, pendingCount - 1);
      updateBadge();
      loadPending();
    } catch (e) {
      UI.showToast('操作失败: ' + e.message);
    }
  }

  // 更新角标
  function updateBadge() {
    const badge = document.getElementById('pendingBadge');
    if (!badge) return;
    if (pendingCount > 0) {
      badge.textContent = pendingCount;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function escape(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function formatLastSeen(ts) {
    if (!ts) return '未知';
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    return Math.floor(diff / 86400000) + ' 天前';
  }

  function formatPeerStatus(status) {
    const map = {
      discovered: '已发现',
      pending: '待审批',
      connecting: '连接中',
      connected: '已连接',
      offline: '离线',
      rejected: '已拒绝',
      error: '异常'
    };
    return map[status] || status || '未知';
  }

  return { init, onPendingDevice, onPendingDeviceRemoved, loadAuthorized, loadPending, loadPeers };
})();
