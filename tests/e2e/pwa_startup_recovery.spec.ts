import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/pwa-upgrade');
const distDir = path.resolve(process.cwd(), 'dist');

test('an old controlled mobile client upgrades after its cached entry is retired', async ({ browser }) => {
  const previousWorker = await readFile(path.join(fixtureDir, 'previous-sw.js'));
  let release: 'previous' | 'current' = 'previous';
  let indexHtml = '';
  const server: Server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const current = release === 'current';

    if (pathname === '/sw.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(current ? await readFile(path.join(process.cwd(), 'public/sw.js')) : previousWorker);
      return;
    }
    if (pathname === '/' || pathname === '/index.html') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(current ? await readFile(path.join(distDir, 'index.html')) : indexHtml);
      return;
    }
    if (current && (pathname === '/demo' || pathname === '/about')) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(await readFile(path.join(distDir, 'index.html')));
      return;
    }
    if (!current && pathname === '/assets/index-BsF4w_.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end("document.querySelector('#root').textContent = 'Previous Prismatix shell'; window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));");
      return;
    }

    if (current && pathname.startsWith('/assets/')) {
      try {
        const content = await readFile(path.join(distDir, pathname.slice(1)));
        const extension = path.extname(pathname);
        response.setHeader('Content-Type', extension === '.js' ? 'text/javascript' : extension === '.css' ? 'text/css' : 'application/octet-stream');
        response.end(content);
      } catch {
        // Models the former Vercel catch-all for a retired hashed asset.
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(await readFile(path.join(distDir, 'index.html')));
      }
      return;
    }

    if (!current && pathname === '/prismatix-icon-draft.svg') {
      response.setHeader('Content-Type', 'image/svg+xml');
      response.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');
      return;
    }
    if (!current && pathname === '/manifest.webmanifest') {
      response.setHeader('Content-Type', 'application/manifest+json');
      response.end('{}');
      return;
    }

    if (current && (pathname === '/prismatix-icon-draft.svg' || pathname === '/manifest.webmanifest')) {
      response.setHeader('Content-Type', pathname.endsWith('.svg') ? 'image/svg+xml' : 'application/manifest+json');
      response.end(await readFile(path.join(process.cwd(), 'public', pathname.slice(1))));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });

  indexHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root">Loading Prismatix...</div><script type="module" src="/assets/index-BsF4w_.js"></script></body></html>`;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port');
  const origin = `http://127.0.0.1:${address.port}`;

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  try {
    await page.goto(origin);
    await expect(page.getByText('Previous Prismatix shell')).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).includes('prismatix-shell-v1'))).toBe(true);
    await expect.poll(() => page.evaluate(async () => {
      const cache = await caches.open('prismatix-shell-v1');
      return Boolean(await cache.match('/')) && Boolean(await cache.match('/index.html'));
    })).toBe(true);

    // Retire only this old hashed entry while retaining the real v1 worker and cached HTML.
    await page.evaluate(async () => {
      const cache = await caches.open('prismatix-shell-v1');
      await cache.delete('/assets/index-BsF4w_.js');
    });
    release = 'current';

    await page.reload();
    // The previous app bundle is gone, so the cached old document cannot run
    // its own updater. Let Chromium perform the service-worker update check
    // (the harness does this explicitly because its first registration is only
    // seconds old, shorter than Chromium's normal update-check interval).
    await expect(page.locator('#root')).toContainText('Loading Prismatix...');
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error('The legacy worker registration was lost');
      await registration.update();
    });
    await expect(page.getByText('Sign in', { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).some((name) => name === 'prismatix-shell-v2'))).toBe(true);
    await expect(page.locator('#root')).not.toContainText('Loading Prismatix...');
    await expect(page.locator('#root')).not.toContainText('Previous Prismatix shell');

    const missingAsset = await page.evaluate(async () => {
      const response = await fetch('/assets/missing-module-after-deploy.js');
      return { status: response.status, contentType: response.headers.get('content-type'), text: await response.text() };
    });
    expect(missingAsset.status).toBe(404);
    expect(missingAsset.contentType).not.toContain('text/html');
    expect(missingAsset.text).not.toContain('<html');
    expect(await page.evaluate(async () => {
      const cache = await caches.open('prismatix-shell-v2');
      return Boolean(await cache.match('/assets/missing-module-after-deploy.js'));
    })).toBe(false);

    await page.goto(`${origin}/demo`);
    await expect(page.getByText('Dynamic Multi-Model Routing')).toBeVisible();
    await context.setOffline(true);
    await page.goto(`${origin}/about`);
    await expect(page.getByText('Dynamic Multi-Model Routing')).toBeVisible();
    await context.setOffline(false);
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('the Vercel SPA rewrite excludes missing hashed assets but keeps deep links', async () => {
  const config = JSON.parse(await readFile(path.join(process.cwd(), 'vercel.json'), 'utf8')) as {
    rewrites: Array<{ source: string; destination: string }>;
  };
  const rewrite = config.rewrites.find((candidate) => candidate.destination === '/index.html');
  expect(rewrite?.source).toBe('/((?!assets/).*)');
  const compiled = new RegExp(`^${rewrite!.source}$`);
  expect(compiled.test('/assets/missing-entry.js')).toBe(false);
  expect(compiled.test('/assets/chunks/missing.css')).toBe(false);
  expect(compiled.test('/')).toBe(true);
  expect(compiled.test('/demo')).toBe(true);
  expect(compiled.test('/about')).toBe(true);
});

test('the inline shell offers recovery when the entry module fails before React mounts', async ({ page }) => {
  const html = await readFile(path.join(distDir, 'index.html'), 'utf8');
  const entry = html.match(/<script type="module" crossorigin src="([^"]+\.js)"><\/script>/)?.[1]
    ?? html.match(/<script type="module" src="([^"]+\.js)"><\/script>/)?.[1];
  expect(entry).toBeTruthy();
  let entryRequests = 0;
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).pathname === entry) {
      entryRequests += 1;
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'retired entry' });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  expect(entryRequests).toBe(1);
  const recovery = page.getByRole('alert');
  await expect(recovery.getByRole('heading', { name: 'Prismatix could not load' })).toBeVisible();
  const retry = recovery.getByRole('button', { name: 'Reload Prismatix' });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(recovery.getByRole('heading', { name: 'Prismatix could not load' })).toBeVisible();
  expect(entryRequests).toBe(2);
});

test('the React boundary offers recovery when the authenticated app chunk fails', async ({ page }) => {
  const assets = await readdir(path.join(distDir, 'assets'));
  const appChunk = assets.find((name) => name.startsWith('AuthenticatedApp-') && name.endsWith('.js'));
  expect(appChunk).toBeTruthy();
  let chunkRequests = 0;
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).pathname === `/assets/${appChunk}`) {
      chunkRequests += 1;
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'retired app chunk' });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  const recovery = page.getByRole('alert');
  await expect(recovery.getByRole('heading', { name: 'Prismatix could not finish loading' })).toBeVisible();
  await expect(recovery.getByRole('button', { name: 'Reload Prismatix' })).toBeVisible();
  expect(chunkRequests).toBeGreaterThan(0);
});
