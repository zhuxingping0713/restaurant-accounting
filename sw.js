// Service Worker - 离线缓存
const CACHE_NAME = 'zhuji-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // API 请求不缓存，直接走网络
    if (e.request.url.includes('/api/')) return;
    e.respondWith(
        caches.match(e.request).then(cached =>
            cached || fetch(e.request)
        )
    );
});
