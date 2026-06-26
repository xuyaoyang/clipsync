// ClipSync — UI 渲染与交互模块
const UI = (() => {
  let els = {};
  let items = [];           // 当前显示的内容列表
  let pendingItems = new Set();  // 已插入内容 ID（去重用，最多保留 200 条）

  function init() {
    els = {
      contentList: document.getElementById('contentList'),
      inputText: document.getElementById('inputText'),
      btnSend: document.getElementById('btnSend'),
      btnAttach: document.getElementById('btnAttach'),
      fileInput: document.getElementById('fileInput'),
      serverStatus: document.getElementById('serverStatus'),
      deviceCount: document.getElementById('deviceCount'),
      tabs: document.querySelectorAll('.tab')
    };
  }

  // 将 DB 返回的 snake_case 字段名归一化为 camelCase
  function normalizeItem(item) {
    return {
      id: item.id,
      type: item.type,
      content: item.content,
      fileName: item.file_name || item.fileName,
      fileSize: item.file_size || item.fileSize,
      mimeType: item.mime_type || item.mimeType,
      filePath: item.file_path || item.filePath,
      createdAt: item.created_at || item.createdAt,
      expiresAt: item.expires_at || item.expiresAt,
      sourceDevice: item.source_device || item.sourceDevice
    };
  }

  // 渲染内容列表
  function renderItems(newItems) {
    items = (newItems || []).map(normalizeItem);
    if (items.length === 0) {
      els.contentList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <p>暂无同步内容</p>
          <p class="empty-hint">在下方输入文字或拖拽文件开始同步</p>
        </div>`;
      return;
    }

    els.contentList.innerHTML = items.map(item => renderCard(item)).join('');
    // 只绑定新卡片的事件
    bindCardActions(els.contentList);
  }

  // 添加新卡片到顶部
  function prependItem(item) {
    item = normalizeItem(item);
    // 去重
    if (pendingItems.has(item.id)) return;
    // 限制 Set 大小，防止内存泄漏
    if (pendingItems.size > 200) {
      const iter = pendingItems.values();
      for (let i = 0; i < 50; i++) pendingItems.delete(iter.next().value);
    }
    pendingItems.add(item.id);
    items.unshift(item);

    const empty = els.contentList.querySelector('.empty-state');
    if (empty) empty.remove();

    els.contentList.insertAdjacentHTML('afterbegin', renderCard(item));
    const card = els.contentList.firstElementChild;
    if (card) {
      card.style.animation = 'none';
      card.offsetHeight;
      card.style.animation = 'cardIn 0.3s ease-out';
      // 只绑定新卡片的事件
      bindCardActions(card);
    }
  }

  // 移除卡片
  function removeItem(id) {
    const card = els.contentList.querySelector('[data-id="' + id + '"]');
    if (card) {
      card.style.opacity = '0';
      card.style.transform = 'translateX(-20px)';
      setTimeout(() => card.remove(), 200);
    }
    items = items.filter(i => i.id !== id);
    if (items.length === 0) {
      els.contentList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <p>暂无同步内容</p>
        </div>`;
    }
  }

  // 渲染单张卡片
  function renderCard(item) {
    const now = Date.now();
    const remaining = item.expiresAt - now - 0;
    const createdAgo = formatTime(Date.now() - item.createdAt);
    const remainingStr = formatRemaining(remaining);
    const isExpiring = remaining < 3600000;

    let html = '';
    if (item.type === 'text') {
      html = renderTextCard(item, createdAgo, remainingStr, isExpiring);
    } else if (item.type === 'image') {
      html = renderImageCard(item, createdAgo, remainingStr, isExpiring);
    } else {
      html = renderFileCard(item, createdAgo, remainingStr, isExpiring);
    }
    return html;
  }

  function renderTextCard(item, ago, remain, expiring) {
    const safeContent = escapeHtml(item.content || '');
    const safeId = item.id;
    return `
      <div class="card" data-id="${safeId}" data-type="text">
        <div class="card-header">
          <span class="card-icon">📝</span>
          <span class="card-meta">${ago} · 来自 ${escapeHtml(item.sourceDevice)}</span>
          ${expiring ? '<span class="expires-warning">即将过期</span>' : ''}
        </div>
        <div class="card-content">${safeContent}</div>
        <div class="card-actions">
          <button class="btn-action btn-copy" data-id="${safeId}" data-type="text" data-content="${escapeAttr(item.content || '')}">复制</button>
          <span class="card-meta" style="margin-left:auto;">${remain}后过期</span>
        </div>
      </div>`;
  }

  function renderImageCard(item, ago, remain, expiring) {
    const safeId = item.id;
    const url = API.getFileURL(item.id);
    const safeFileName = escapeHtml(item.fileName || '未知');
    const fileNameAttr = escapeAttr(item.fileName || '');
    return `
      <div class="card" data-id="${safeId}" data-type="image">
        <div class="card-header">
          <span class="card-icon">🖼️</span>
          <span class="card-meta">${ago} · 来自 ${escapeHtml(item.sourceDevice)}</span>
          ${expiring ? '<span class="expires-warning">即将过期</span>' : ''}
        </div>
        <div class="card-body-row">
          <div class="card-thumb-wrap">
            <img class="card-thumbnail" src="${url}" alt="${safeFileName}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" style="width:80px;height:80px;object-fit:cover;border-radius:4px;">
            <div class="card-thumb-fallback" style="display:none;width:80px;height:80px;background:var(--bg-primary);border-radius:4px;align-items:center;justify-content:center;font-size:32px;border:1px solid var(--border);">📷</div>
          </div>
          <div class="card-body-info">
            <div style="font-size:13px;">${safeFileName}</div>
            <div style="font-size:12px;color:var(--text-secondary);">${formatSize(item.fileSize)}</div>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-action btn-preview" data-id="${safeId}">查看大图</button>
          <button class="btn-action btn-save" data-id="${safeId}">保存</button>
          <span class="card-meta" style="margin-left:auto;">${remain}后过期</span>
        </div>
      </div>`;
  }

  function renderFileCard(item, ago, remain, expiring) {
    const safeId = item.id;
    const icon = getFileIcon(item.fileName || '');
    return `
      <div class="card" data-id="${safeId}" data-type="file">
        <div class="card-header">
          <span class="card-icon">${icon}</span>
          <span class="card-meta">${ago} · 来自 ${escapeHtml(item.sourceDevice)}</span>
          ${expiring ? '<span class="expires-warning">即将过期</span>' : ''}
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <div>
            <div style="font-size:13px;font-weight:500;">${escapeHtml(item.fileName || '未知文件')}</div>
            <div style="font-size:12px;color:var(--text-secondary);">${formatSize(item.fileSize)}</div>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-action btn-save" data-id="${safeId}">下载</button>
          <span class="card-meta" style="margin-left:auto;">${remain}后过期</span>
        </div>
      </div>`;
  }

  // 绑定卡片按钮事件（container 可以是整个列表或单张卡片）
  function bindCardActions(container) {
    // 复制文字
    container.querySelectorAll('.btn-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const content = btn.dataset.content;
        copyToClipboard(content);
        showToast('已复制到剪贴板');
      });
    });

    // 保存文件
    container.querySelectorAll('.btn-save').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const url = API.getFileURL(id);
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        a.click();
      });
    });

    // 预览图片
    container.querySelectorAll('.btn-preview').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const url = API.getFileURL(id);
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
        overlay.innerHTML = '<img src="' + url + '" style="max-width:90%;max-height:90%;border-radius:4px;">';
        overlay.addEventListener('click', () => overlay.remove());
        document.body.appendChild(overlay);
      });
    });

    // 点击文字卡片展开/收起
    container.querySelectorAll('.card-content').forEach(el => {
      el.addEventListener('click', function() {
        this.classList.toggle('expanded');
      });
    });
  }

  // 复制到剪贴板
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(textarea);
  }

  // Toast 提示
  function showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.className = 'toast';
    document.body.appendChild(toast);
    // 动画结束后移除
    toast.addEventListener('animationend', () => toast.remove());
    // 兜底：2.5s 后强制移除
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2500);
  }

  // 更新状态栏
  function updateServerStatus(text) {
    if (els.serverStatus) els.serverStatus.innerHTML = '<span class="status-dot"></span> ' + text;
  }

  function updateDeviceCount(count) {
    if (els.deviceCount) els.deviceCount.textContent = count > 0 ? count + ' 台设备在线' : '';
  }

  // 获取/清空输入
  function getInputText() { return els.inputText.value.trim(); }
  function clearInput() { els.inputText.value = ''; els.inputText.style.height = 'auto'; }
  function setSendEnabled(enabled) { if (els.btnSend) els.btnSend.disabled = !enabled; }

  // 获取 DOM 元素引用
  function getEls() { return els; }

  // ===== 工具函数 =====
  function formatTime(ms) {
    if (ms < 60000) return '刚刚';
    if (ms < 3600000) return Math.floor(ms / 60000) + ' 分钟前';
    if (ms < 86400000) return Math.floor(ms / 3600000) + ' 小时前';
    return Math.floor(ms / 86400000) + ' 天前';
  }

  function formatRemaining(ms) {
    if (ms <= 0) return '已过期';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return h + '小时' + (m > 0 ? m + '分钟' : '');
    if (m > 0) return m + '分钟';
    return '不到1分钟';
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(1) + ' GB';
  }

  function getFileIcon(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    const map = { pdf:'📕', doc:'📘', docx:'📘', xls:'📗', xlsx:'📗', ppt:'📙', pptx:'📙', zip:'📦', rar:'📦', '7z':'📦', mp3:'🎵', mp4:'🎬', jpg:'🖼️', png:'🖼️', gif:'🖼️', txt:'📄', html:'🌐', js:'⚡', py:'🐍', exe:'⚙️', apk:'📱' };
    return map[ext] || '📄';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return {
    init, renderItems, prependItem, removeItem,
    updateServerStatus, updateDeviceCount,
    getInputText, clearInput, setSendEnabled,
    getEls, showToast
  };
})();
