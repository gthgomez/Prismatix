import { expect, test } from '@playwright/test';

test('public demo text stays readable on its dark panels in both themes', async ({ page }, testInfo) => {
  await page.goto('/demo');
  const skip = page.getByRole('button', { name: 'Skip animation and display full response' });
  if (await skip.isEnabled()) await skip.click();

  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const samples = await page.evaluate(() => {
        type Color = [number, number, number, number];
        const parse = (value: string): Color => {
          const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
          return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0, channels[3] ?? 1];
        };
        const over = (front: Color, back: Color): Color => {
          const alpha = front[3] + back[3] * (1 - front[3]);
          if (!alpha) return [0, 0, 0, 0];
          return [0, 1, 2].map((i) => (front[i]! * front[3] + back[i]! * back[3] * (1 - front[3])) / alpha).concat(alpha) as Color;
        };
        const luminance = (color: Color) => {
          const [r, g, b] = color.slice(0, 3).map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        const selectors = [
          '.resume-demo-brand', '.resume-demo-nav-links a', '.spec-label', '.spec-val',
          '.demo-badge-synthetic', '.demo-title', '.demo-subtitle', '.demo-tab.active',
          '.route-model-name', '.demo-route-meta', '.demo-message-sender', '.demo-message-content',
          '.code-block-lang', '.code-copy-btn', '.code-block-content',
          '.bento-card-arch h2', '.node-name', '.node-role', '.arch-desc',
          '.metric-caption', '.feature-subcard h3', '.feature-subcard p',
          '.safety-paragraph', '.safety-item', '.safety-btn',
        ];
        return selectors.map((selector) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) throw new Error(`Missing contrast sample: ${selector}`);
          let background: Color = [0, 0, 0, 0];
          for (let current: HTMLElement | null = element; current; current = current.parentElement) {
            background = over(background, parse(getComputedStyle(current).backgroundColor));
          }
          background = over(background, [255, 255, 255, 1]);
          const foreground = over(parse(getComputedStyle(element).color), background);
          const a = luminance(foreground);
          const b = luminance(background);
          return { selector, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
        });
      });
      for (const { selector, ratio } of samples) {
        expect(ratio, `${theme} ${width}px ${selector}`).toBeGreaterThanOrEqual(4.5);
      }
      await page.screenshot({ path: testInfo.outputPath(`public-demo-${theme}-${width}.png`), fullPage: true });
    }
  }
});

test('public demo code is readable and keyboard-scrollable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  const skip = page.getByRole('button', { name: 'Skip animation and display full response' });
  if (await skip.isEnabled()) await skip.click();
  const code = page.locator('.demo-formatted-output .code-block-pre');
  await expect(code).toHaveCount(1);
  await expect(code).toHaveAttribute('aria-label', /code block/i);
  await expect(code).toHaveCSS('overflow-x', 'auto');
  const dimensions = await code.evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth }));
  expect(dimensions.content).toBeGreaterThan(dimensions.width);
  await code.focus();
  await expect(code).toBeFocused();
  for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowRight');
  await expect.poll(() => code.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
