import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Public /demo focus acceptance.
 *
 * Drives the real rendered route with the keyboard, blocks every non-loopback
 * request, and checks forced-colors focus paint, default-color non-regression,
 * and the public demo's keyboard-only outcomes. No auth, provider, Supabase, or
 * production endpoint is contacted; the demo is synthetic.
 */

test.describe.configure({ timeout: 90_000 });
test.use({ serviceWorkers: 'block' });

type Rgb = readonly [number, number, number];

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RingResult {
  painted: number;
  maxContrast: number;
  unfocusedPainted: number;
  difference: number;
}

interface FocusSnapshot {
  tagName: string;
  className: string;
  focusVisible: boolean;
  outlineStyle: string;
  outlineWidth: number;
  outlineOffset: number;
  boxShadow: string;
}

interface NetworkGuard {
  unexpected: string[];
}

const BAND_PX = 6;
// Skip the first 2px outside the border box: fractional element offsets can
// otherwise sample the element's own border, while both focus rings start at 2px.
const EDGE_GUARD_PX = 2;

function tabTarget(page: Page, selector: string) {
  return page.evaluate(
    (candidate) =>
      document.activeElement instanceof Element && document.activeElement.matches(candidate),
    selector,
  );
}

async function tabTo(page: Page, selector: string, maxPresses = 12): Promise<void> {
  for (let press = 1; press <= maxPresses; press += 1) {
    await page.keyboard.press('Tab');
    if (await tabTarget(page, selector)) return;
  }
  throw new Error(`Tab did not reach ${selector} within ${maxPresses} presses.`);
}

async function readFocus(locator: Locator): Promise<FocusSnapshot> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      tagName: element.tagName,
      className: element instanceof HTMLElement ? element.className : '',
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
      outlineOffset: Number.parseFloat(style.outlineOffset) || 0,
      boxShadow: style.boxShadow,
    };
  });
}

async function expectForcedFocusPaint(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused();
  const focus = await readFocus(locator);
  expect(focus.focusVisible).toBe(true);
  expect(focus.outlineStyle).toBe('solid');
  expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(focus.outlineOffset).toBeGreaterThanOrEqual(1);
  expect(focus.boxShadow, 'forced colors must not rely on a dropped box-shadow').toBe('none');
}

async function expectDefaultFocusPaint(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused();
  // Demo controls animate box-shadow; wait for the settled two-layer ring.
  await expect(locator).toHaveCSS('box-shadow', /0px 0px 0px 2px, .*0px 0px 0px 4px/);
  const focus = await readFocus(locator);
  expect(focus.focusVisible).toBe(true);
  expect(focus.outlineStyle, 'default colors keep the custom ring').toBe('none');
  expect(focus.boxShadow).toContain('0px 0px 0px 2px');
  expect(focus.boxShadow).toContain('0px 0px 0px 4px');
}

/**
 * Pixel proof of a rendered focus ring. Chromium decodes its own screenshot in
 * an OffscreenCanvas; no image-format code lives in this spec. The caller must
 * already have keyboard focus on the control. Focus is moved away to capture a
 * negative sample, then restored so the keyboard journey can continue.
 */
async function measureRenderedRing(page: Page, locator: Locator): Promise<RingResult> {
  await locator.scrollIntoViewIfNeeded();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('Focused control has no rendered box.');

  const margin = 10;
  const clip: Rect = {
    x: Math.max(0, Math.floor(box.x - margin)),
    y: Math.max(0, Math.floor(box.y - margin)),
    width: 0,
    height: 0,
  };
  clip.width = Math.min(viewport.width, Math.ceil(box.x + box.width + margin)) - clip.x;
  clip.height = Math.min(viewport.height, Math.ceil(box.y + box.height + margin)) - clip.y;

  const focusedPng = (await page.screenshot({ clip, animations: 'disabled' })).toString('base64');
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const unfocusedPng = (await page.screenshot({ clip, animations: 'disabled' })).toString('base64');

  const result = await page.evaluate(
    async ({ focusedPng, unfocusedPng, clip, box, band, guard }) => {
      const decode = async (base64: string): Promise<ImageData> => {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No 2D context for screenshot decode.');
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };

      const focused = await decode(focusedPng);
      const unfocused = await decode(unfocusedPng);
      const scaleX = focused.width / clip.width;
      const scaleY = focused.height / clip.height;
      const left = (box.x - clip.x) * scaleX;
      const top = (box.y - clip.y) * scaleY;
      const right = left + box.width * scaleX;
      const bottom = top + box.height * scaleY;

      const channel = (value: number): number => {
        const normalized = value / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      const luminance = ([red, green, blue]: Rgb): number =>
        0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
      const contrast = (first: Rgb, second: Rgb): number => {
        const firstLuminance = luminance(first);
        const secondLuminance = luminance(second);
        return (
          (Math.max(firstLuminance, secondLuminance) + 0.05) /
          (Math.min(firstLuminance, secondLuminance) + 0.05)
        );
      };
      const pixel = (image: ImageData, x: number, y: number): Rgb => {
        const index = (y * image.width + x) * 4;
        return [
          image.data[index] ?? 0,
          image.data[index + 1] ?? 0,
          image.data[index + 2] ?? 0,
        ];
      };
      const background = pixel(focused, 1, 1);
      const inBand = (x: number, y: number): boolean => {
        const inside =
          x >= left - guard * scaleX &&
          x <= right + guard * scaleX &&
          y >= top - guard * scaleY &&
          y <= bottom + guard * scaleY;
        const near =
          x >= left - band * scaleX &&
          x <= right + band * scaleX &&
          y >= top - band * scaleY &&
          y <= bottom + band * scaleY;
        return near && !inside;
      };
      const startX = Math.max(0, Math.floor(left - band * scaleX));
      const endX = Math.min(focused.width - 1, Math.ceil(right + band * scaleX));
      const startY = Math.max(0, Math.floor(top - band * scaleY));
      const endY = Math.min(focused.height - 1, Math.ceil(bottom + band * scaleY));
      let painted = 0;
      let maxContrast = 0;
      let unfocusedPainted = 0;
      let difference = 0;
      for (let y = startY; y <= endY; y += 1) {
        for (let x = startX; x <= endX; x += 1) {
          if (!inBand(x, y)) continue;
          const focusedPixel = pixel(focused, x, y);
          const ratio = contrast(focusedPixel, background);
          if (ratio >= 3) painted += 1;
          if (ratio > maxContrast) maxContrast = ratio;
          if (contrast(pixel(unfocused, x, y), background) >= 3) unfocusedPainted += 1;
          const unfocusedPixel = pixel(unfocused, x, y);
          if (Math.max(
            Math.abs(focusedPixel[0] - unfocusedPixel[0]),
            Math.abs(focusedPixel[1] - unfocusedPixel[1]),
            Math.abs(focusedPixel[2] - unfocusedPixel[2]),
          ) > 24) {
            difference += 1;
          }
        }
      }
      return { painted, maxContrast, unfocusedPainted, difference };

    },
    { focusedPng, unfocusedPng, clip, box, band: BAND_PX, guard: EDGE_GUARD_PX },
  );

  await locator.focus();
  await expect(locator).toBeFocused();
  expect(await locator.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  return result;
}

async function expectVisiblePixelFocus(page: Page, locator: Locator): Promise<void> {
  const ring = await measureRenderedRing(page, locator);
  expect(ring.maxContrast, 'rendered focus ring must reach 3:1 against its background').toBeGreaterThanOrEqual(3);
  expect(ring.painted, 'rendered focus ring must have substantial painted area').toBeGreaterThan(200);
  expect(ring.unfocusedPainted, 'unfocused control must not show a focus ring').toBeLessThanOrEqual(10);
  expect(ring.difference, 'focus must paint a measurable ring').toBeGreaterThan(200);
}

async function installNetworkGuard(page: Page): Promise<NetworkGuard> {
  const origin = new URL(test.info().project.use.baseURL ?? '').origin;
  expect(new URL(origin).hostname, 'run the synthetic demo on the isolated preview').toBe('127.0.0.1');
  const guard: NetworkGuard = { unexpected: [] };
  await page.routeWebSocket('**/*', async (socket) => {
    guard.unexpected.push('WebSocket');
    await socket.close();
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = request.headers();
    const credentialed = Boolean(headers.authorization || headers.apikey);
    const backend = /^\/(functions|rest|auth|storage)\/v1(\/|$)/.test(url.pathname);
    if (!credentialed && !backend && url.origin === origin) {
      await route.continue();
      return;
    }
    const fontRequest = /^https:\/\/fonts\.(googleapis|gstatic)\.com$/.test(url.origin);
    if (credentialed || backend || !fontRequest) guard.unexpected.push(`${url.origin}${url.pathname}`);
    await route.abort();
  });
  return guard;
}

function expectLoopbackOnly(guard: NetworkGuard): void {
  expect(guard.unexpected, 'public demo must only use preview assets; fonts were blocked').toEqual([]);
}

async function openPublicDemo(page: Page, forcedColors: 'active' | 'none'): Promise<NetworkGuard> {
  await page.emulateMedia({ forcedColors });
  const guard = await installNetworkGuard(page);
  await page.goto('/demo', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('main.resume-demo-shell')).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: /Supabase-backed multi-provider AI router prototype/i }),
  ).toBeVisible();
  await expect(page.getByText(/Synthetic Data/i).first()).toBeVisible();
  const tabs = page.getByRole('tablist', { name: 'Demo scenarios' }).getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'demo-tab-architecture');
  await expect(page.locator('input')).toHaveCount(0);
  expect(await page.context().cookies(), 'fresh context must not carry ambient auth').toEqual([]);
  return guard;
}

test('forced colors: keyboard focus is visibly painted and demo controls still work', async ({ page }) => {
  const guard = await openPublicDemo(page, 'active');
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);

  await page.keyboard.press('Tab');
  const brand = page.locator('.resume-demo-brand');
  await expectForcedFocusPaint(brand);
  await expectVisiblePixelFocus(page, brand);

  await page.keyboard.press('Tab');
  await expectForcedFocusPaint(page.locator('.resume-demo-nav-links a').first());
  await page.keyboard.press('Tab');
  await expectForcedFocusPaint(page.locator('.resume-demo-nav-app-link'));
  await page.keyboard.press('Tab');
  await expectForcedFocusPaint(page.locator('.resume-demo-actions a').first());
  await page.keyboard.press('Tab');
  await expectForcedFocusPaint(page.locator('.resume-demo-actions a').nth(1));

  await tabTo(page, '.demo-tab[aria-selected="true"]');
  const selectedTab = page.locator('.demo-tab[aria-selected="true"]');
  await expect(selectedTab).toHaveAttribute('id', 'demo-tab-architecture');
  await expectForcedFocusPaint(selectedTab);
  await expectVisiblePixelFocus(page, selectedTab);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const debateTab = page.getByRole('tab', { name: /3\. Multi-Model Debate/i });
  await expect(debateTab).toHaveAttribute('aria-selected', 'true');
  await expect(debateTab).toBeFocused();
  await expect(page.locator('.route-model-name')).toHaveText('Claude Sonnet 5.5 vs. GPT-6 Sol');
  await expect(page.locator('.demo-route-reason')).toContainText('Multi-draft debate mode');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'demo-tab-debate-mode');
  await expectForcedFocusPaint(debateTab);

  await tabTo(page, '.demo-control-btn[aria-label="Replay scenario"]');
  const replay = page.locator('.demo-control-btn[aria-label="Replay scenario"]');
  await expectForcedFocusPaint(replay);
  await expectVisiblePixelFocus(page, replay);

  const primary = page.locator('.demo-control-btn.primary');
  const output = page.locator('.demo-formatted-output');
  await page.keyboard.press('Space');
  await expect(primary).toHaveAttribute('aria-label', 'Pause streaming');
  await page.waitForTimeout(300);
  const firstStripe = (await output.innerText()).trim();
  expect(firstStripe.length).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect((await output.innerText()).trim().length).toBeGreaterThan(firstStripe.length);

  await page.keyboard.press('Space');
  await expect(primary).toHaveAttribute('aria-label', 'Play streaming');
  const paused = (await output.innerText()).trim();
  await page.waitForTimeout(250);
  expect((await output.innerText()).trim()).toBe(paused);

  await tabTo(page, '.demo-control-btn[aria-label="Reset demo state"]');
  const reset = page.locator('.demo-control-btn[aria-label="Reset demo state"]');
  await expectForcedFocusPaint(reset);
  await page.keyboard.press('Enter');
  await expect(page.locator('.demo-stream-pre')).toHaveText('(Click play to stream response...)');
  await expect(primary).toHaveAttribute('aria-label', 'Play streaming');
  await expectForcedFocusPaint(reset);

  expectLoopbackOnly(guard);
});

test('default colors: public demo focus ring and keyboard behavior are not regressed', async ({ page }) => {
  const guard = await openPublicDemo(page, 'none');
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(false);

  await page.keyboard.press('Tab');
  await expectDefaultFocusPaint(page.locator('.resume-demo-brand'));

  await tabTo(page, '.demo-tab[aria-selected="true"]');
  const architectureTab = page.locator('.demo-tab[aria-selected="true"]');
  await expect(architectureTab).toHaveAttribute('id', 'demo-tab-architecture');
  await expectDefaultFocusPaint(architectureTab);
  await expectVisiblePixelFocus(page, architectureTab);

  const bodyBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bodyBackground, 'default colors must keep the dark theme, not forced light colors').not.toBe(
    'rgb(255, 255, 255)',
  );

  await page.keyboard.press('ArrowRight');
  const fastTab = page.getByRole('tab', { name: /2\. Fast Concept Path/i });
  await expect(fastTab).toHaveAttribute('aria-selected', 'true');
  await expect(fastTab).toBeFocused();
  await expect(page.locator('.route-model-name')).toHaveText('Gemini 3.8 Flash');
  await expect(page.locator('.demo-formatted-output')).toContainText('Optimistic vs. Pessimistic Locking');
  await expectDefaultFocusPaint(fastTab);

  await tabTo(page, '.demo-control-btn[aria-label="Replay scenario"]');
  const replay = page.locator('.demo-control-btn[aria-label="Replay scenario"]');
  await expectDefaultFocusPaint(replay);

  await page.keyboard.press('Enter');
  const primary = page.locator('.demo-control-btn.primary');
  await expect(primary).toHaveAttribute('aria-label', 'Pause streaming');
  await page.waitForTimeout(300);
  expect((await page.locator('.demo-formatted-output').innerText()).trim().length).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(primary).toHaveAttribute('aria-label', 'Play streaming');

  expectLoopbackOnly(guard);
});

test('Show Full Response is discoverable by its visible control name', async ({ page }) => {
  const guard = await openPublicDemo(page, 'none');
  const showFullResponse = page.getByRole('button', { name: 'Show Full Response' });
  await expect(showFullResponse).toBeVisible();
  await expect(showFullResponse).toHaveText(/Show Full Response/);
  expectLoopbackOnly(guard);
});

test('Show Full Response completes the response, exposes Replay, and keeps usable focus', async ({ page }) => {
  const guard = await openPublicDemo(page, 'none');

  await tabTo(page, '.demo-tab[aria-selected="true"]');
  await page.keyboard.press('ArrowRight');
  const fastTab = page.getByRole('tab', { name: /2\. Fast Concept Path/i });
  await expect(fastTab).toHaveAttribute('aria-selected', 'true');
  await expect(fastTab).toBeFocused();

  await tabTo(page, '.demo-control-btn[aria-label="Replay scenario"]');
  const replay = page.locator('.demo-control-btn[aria-label="Replay scenario"]');
  const primary = page.locator('.demo-control-btn.primary');
  await expect(replay).toBeFocused();
  await page.keyboard.press('Space');
  await expect(primary).toHaveAttribute('aria-label', 'Pause streaming');

  await page.keyboard.press('Tab');
  const showFullResponse = page.locator('.demo-control-btn').filter({ hasText: 'Show Full Response' });
  await expect(showFullResponse).toBeFocused();
  await expect(showFullResponse).toBeEnabled();
  await page.keyboard.press('Enter');

  const output = page.locator('.demo-formatted-output');
  await expect(output).toContainText('reserve pessimistic');
  await expect(output).toContainText('ledger credit balance admissions');
  await expect(page.locator('.demo-stream-pre')).toHaveCount(0);
  await expect(primary).toHaveAttribute('aria-label', 'Replay scenario');
  await expect(showFullResponse).toBeDisabled();

  // Activation must not strand focus on a disabled button or on BODY.
  await expect(replay).toBeFocused();
  await expect(replay).toBeEnabled();
  expect(
    await replay.evaluate((element) => element.matches(':focus-visible')),
    'focus moved to Replay must remain keyboard-visible',
  ).toBe(true);

  await page.keyboard.press('Enter');
  await expect(primary).toHaveAttribute('aria-label', 'Pause streaming');
  await page.waitForTimeout(300);
  expect((await output.innerText()).trim().length).toBeGreaterThan(0);

  expectLoopbackOnly(guard);
});
