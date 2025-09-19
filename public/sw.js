const CACHE_NAME = 'hiit-timer-cache-v1';
const PRECACHE_URLS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestURL = new URL(event.request.url);
  if (requestURL.origin !== self.location.origin) {
    return;
  }

  if (requestURL.pathname.startsWith('/@vite') || requestURL.pathname.includes('__vite')) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);

      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            cache.put(event.request, response.clone()).catch(() => undefined);
          }
          return response;
        })
        .catch(() => undefined);

      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }

      const response = await networkFetch;
      if (response) {
        return response;
      }

      if (event.request.mode === 'navigate') {
        const fallback = await cache.match('./');
        if (fallback) {
          return fallback;
        }
      }

      const precached = await cache.match(event.request);
      if (precached) {
        return precached;
      }

      return new Response('', { status: 504, statusText: 'Gateway Timeout' });
    })
  );
});
