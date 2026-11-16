// Prismatix service worker: network-first shell, validated asset caching, and
// a one-time migration from the original v1 cache.

const CACHE_NAME = 'prismatix-shell-v2';
const CACHE_PREFIX = 'prismatix-shell-';
const PREVIOUS_CACHE = 'prismatix-shell-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/prismatix-icon-draft.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const existingCaches = await caches.keys();
    const migratingV1Shell = existingCaches.includes(PREVIOUS_CACHE);

    // Only remove caches owned by Prismatix; unrelated origin caches belong to
    // other apps on the same host and must not be touched.
    await Promise.all(existingCaches
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));

    await self.clients.claim();

    if (migratingV1Shell) {
      // v1 clients can be stuck before their app module runs, so they cannot
      // listen for controllerchange. Refresh app windows once during this
      // cache-protocol migration; local/session auth storage is untouched.
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const staleShellClients = clients.filter((client) => {
        const url = new URL(client.url);
        return url.origin === self.location.origin && url.pathname.startsWith(self.registration.scope.replace(self.location.origin, ''));
      });
      // Start navigation after activation completes. Awaiting navigate() from
      // activate can hold the worker in `activating` while the navigation's
      // fetch event waits for that same worker to become active.
      await new Promise((resolve) => setTimeout(resolve, 0));
      staleShellClients.forEach((client) => {
        void client.navigate(client.url).catch(() => null);
      });
    }
  })());
});

function isPrismatixRequest(url) {
  return url.origin === self.location.origin;
}

function isScriptPath(pathname) {
  return /\.(?:m?js)$/i.test(pathname);
}

function isStylePath(pathname) {
  return /\.css$/i.test(pathname);
}

function hasExpectedContentType(response, pathname) {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('text/html')) return false;
  if (isScriptPath(pathname)) return /(?:javascript|ecmascript)/.test(contentType);
  if (isStylePath(pathname)) return contentType.includes('text/css');
  return true;
}

function unavailableAsset() {
  return new Response('Prismatix asset is unavailable.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function handleNavigation(request, cache) {
  try {
    const response = await fetch(request);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (response.ok && contentType.includes('text/html')) {
      await cache.put(request, response.clone());
      const url = new URL(request.url);
      if (url.pathname === '/') await cache.put('/index.html', response.clone());
      return response;
    }
    return response;
  } catch {
    const shell = await cache.match('/index.html');
    if (shell && shell.headers.get('content-type')?.toLowerCase().includes('text/html')) return shell;
    return new Response('Prismatix is unavailable offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

async function handleAsset(request, cache, url) {
  const cached = await cache.match(request);
  if (cached && !hasExpectedContentType(cached, url.pathname)) {
    // Remove a corrupt v1 entry (not the whole cache) before trying the network.
    await cache.delete(request);
  } else if (cached) {
    try {
      const response = await fetch(request);
      if (response.ok && hasExpectedContentType(response, url.pathname)) {
        await cache.put(request, response.clone());
        return response;
      }
      return response.status === 200 ? unavailableAsset() : response;
    } catch {
      return cached;
    }
  }

  try {
    const response = await fetch(request);
    if (response.ok && hasExpectedContentType(response, url.pathname)) {
      await cache.put(request, response.clone());
      return response;
    }
    return response.status === 200 ? unavailableAsset() : response;
  } catch {
    return unavailableAsset();
  }
}

async function handleStatic(request, cache) {
  try {
    const response = await fetch(request);
    if (response.ok && !response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
      await cache.put(request, response.clone());
      return response;
    }
    return response.status === 200 && response.headers.get('content-type')?.toLowerCase().includes('text/html')
      ? unavailableAsset()
      : response;
  } catch {
    const cached = await cache.match(request);
    if (cached && !cached.headers.get('content-type')?.toLowerCase().includes('text/html')) return cached;
    return new Response('Prismatix resource is unavailable offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Keep all auth, API, database, provider, and non-GET traffic network-only.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/functions/') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('openrouter.ai') ||
    url.hostname.includes('api.openai.com') ||
    url.hostname.includes('api.search.brave.com') ||
    event.request.method !== 'GET' ||
    !isPrismatixRequest(url)
  ) return;

  event.respondWith(caches.open(CACHE_NAME).then((cache) => {
    if (event.request.mode === 'navigate') return handleNavigation(event.request, cache);
    if (url.pathname.startsWith('/assets/') || event.request.destination === 'script' || event.request.destination === 'style') {
      return handleAsset(event.request, cache, url);
    }
    return handleStatic(event.request, cache);
  }));
});
