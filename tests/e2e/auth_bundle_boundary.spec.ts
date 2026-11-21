// Built-preview checks for the chat code-split boundary. Supabase traffic is
// intercepted locally; no production auth or provider endpoints are contacted.
import { test, expect, type Page } from '@playwright/test';
import { setupAuthenticatedMock, MOCK_SESSION, MOCK_USER, signInAsMockUser } from './fixtures/mockAuth';

async function watchScriptResponses(page: Page, baseURL: string | undefined) {
  if (!baseURL) throw new Error('Playwright baseURL is required to measure built assets.');
  const trackedOrigin = new URL(baseURL).origin;
  const assets: Array<{ type: string; url: string; bytes: number }> = [];
  page.on('response', async (response) => {
    const type = response.request().resourceType();
    const responseURL = new URL(response.url());
    if (!['script', 'stylesheet'].includes(type) || responseURL.origin !== trackedOrigin) return;
    const headerBytes = Number(await response.headerValue('content-length'));
    const bytes = Number.isFinite(headerBytes) && headerBytes > 0 ? headerBytes : (await response.body()).byteLength;
    assets.push({ type, url: responseURL.pathname, bytes });
  });
  return assets;
}

test('logged-out built route does not download the chat bundle', async ({ page }, testInfo) => {
  const assets = await watchScriptResponses(page, testInfo.project.use.baseURL);
  await page.goto('/');
  await expect(page.locator('#email')).toBeVisible();
  await page.waitForLoadState('networkidle');
  const report = {
    assets,
    totalAssetBytes: assets.reduce((sum, item) => sum + item.bytes, 0),
    scriptBytes: assets.filter((item) => item.type === 'script').reduce((sum, item) => sum + item.bytes, 0),
    stylesheetBytes: assets.filter((item) => item.type === 'stylesheet').reduce((sum, item) => sum + item.bytes, 0),
    chatAssets: assets.filter((item) => /ChatInterface/i.test(item.url)),
  };
  console.info('[release-evidence] logged-out built asset waterfall', JSON.stringify(report));
  await testInfo.attach('logged-out-script-waterfall.json', {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json',
  });
  expect(report.totalAssetBytes).toBeGreaterThan(0);
  expect(report.chatAssets).toEqual([]);
  // Guard against regressing to the previous single 615 KB AuthenticatedApp
  // bundle, whose name did not identify the embedded ChatInterface module.
  expect(report.totalAssetBytes).toBeLessThan(600_000);
});

test('normal mocked sign-in downloads chat only after authentication', async ({ page }, testInfo) => {
  const assets = await watchScriptResponses(page, testInfo.project.use.baseURL);
  await page.route('**/auth/v1/token*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(MOCK_SESSION),
  }));
  await page.route('**/auth/v1/user*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(MOCK_USER),
  }));
  await page.route('**/functions/v1/provider-settings*', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ providers: [], defaultProvider: 'openrouter' }),
  }));
  await page.route('**/rest/v1/**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/');
  await page.locator('#email').fill(MOCK_USER.email);
  await page.locator('#password').fill('synthetic-password');
  await page.getByRole('button', { name: /sign in to prismatix/i }).click();
  await expect(page.getByRole('textbox', { name: /message prismatix/i })).toBeVisible({ timeout: 15000 });
  expect(assets.some((item) => item.type === 'script' && /ChatInterface/i.test(item.url))).toBe(true);
  expect(assets.some((item) => item.type === 'stylesheet' && /ChatInterface/i.test(item.url))).toBe(true);
});

test('reset deep link remains on reset UI without loading chat code', async ({ page }, testInfo) => {
  const assets = await watchScriptResponses(page, testInfo.project.use.baseURL);
  await page.goto('/reset-password?type=recovery');
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(/invalid or expired/i);
  expect(assets.some((item) => /ChatInterface/i.test(item.url))).toBe(false);
});

test('synthetic authenticated fixture loads the deferred chat code', async ({ page }, testInfo) => {
  const assets = await watchScriptResponses(page, testInfo.project.use.baseURL);
  await setupAuthenticatedMock(page, { hasProviderKey: true, conversations: [], messages: [], costLogs: [] });
  await signInAsMockUser(page);
  await expect(page.getByRole('textbox', { name: /message prismatix/i })).toBeVisible();
  expect(assets.some((item) => item.type === 'script' && /ChatInterface/i.test(item.url))).toBe(true);
  expect(assets.some((item) => item.type === 'stylesheet' && /ChatInterface/i.test(item.url))).toBe(true);
});
