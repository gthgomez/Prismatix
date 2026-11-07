// public/sw.js
// Prismatix Service Worker - App Shell caching and offline continuity

const CACHE_NAME = 'prismatix-shell-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/prismatix-icon-draft.svg',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-only for all API, auth, Supabase functions, and external provider calls
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/functions/') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('openrouter.ai') ||
    url.hostname.includes('api.openai.com') ||
    url.hostname.includes('api.search.brave.com') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // Stale-while-revalidate for same-origin static assets
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // If offline and request is navigation, return cached /index.html
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            return cachedResponse;
          });

        return cachedResponse || fetchPromise;
      })
    );
  }
});
