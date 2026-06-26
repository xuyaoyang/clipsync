// ClipSync Service Worker — PWA 离线支持
const CACHE_NAME = 'clipsync-v29';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/api.js',
  '/js/crypto-client.js',
  '/js/ws.js',
  '/js/ui.js',
  '/js/devices.js',
  '/js/app.js',
  '/manifest.json',
  '/assets/icon-192.png',
  '/assets/icon-512.png'
];

// ===== 安装：预缓存静态资源 =====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// ===== 激活：清理旧缓存 =====
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// ===== 消息处理 =====
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ===== 请求拦截 =====
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API 请求：只走网络，不缓存动态数据
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(apiNetworkOnly(event.request));
    return;
  }

  // HTML 和 JS：始终网络优先（开发阶段确保拿到最新代码）
  if (url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname.endsWith('.js')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // CSS、图片等静态资源：缓存优先
  event.respondWith(cacheFirst(event.request));
});

// API 不返回旧缓存，避免内容列表、设备列表或文件下载过期
async function apiNetworkOnly(request) {
  try {
    return await fetch(request);
  } catch (e) {
    return new Response(JSON.stringify({ error: { code: 'OFFLINE', message: '无法连接到服务器' } }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 网络优先策略（静态 HTML/JS）
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // 缓存成功的 GET 响应
    if (request.method === 'GET' && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    // 网络失败，尝试从缓存返回
    const cached = await caches.match(request);
    if (cached) return cached;
    // 无缓存则返回错误
    return new Response(JSON.stringify({ error: { code: 'OFFLINE', message: '无法连接到服务器' } }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 缓存优先策略（静态资源）
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    // 后台更新缓存
    fetch(request).then((response) => {
      if (response.ok) {
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, response);
        });
      }
    }).catch(() => {});
    return cached;
  }
  // 缓存未命中，尝试网络
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    return new Response('离线，无法加载资源', { status: 503 });
  }
}
