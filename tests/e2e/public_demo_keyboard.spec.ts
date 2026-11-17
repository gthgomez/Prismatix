import { test, expect, type Page } from '@playwright/test';

async function assertKeyboardTabReveal(page: Page, width: number) {
  await page.setViewportSize({ width, height: 851 });
  await page.goto('/demo');
  const tablist = page.getByRole('tablist', { name: 'Demo scenarios' });
  const tabs = tablist.getByRole('tab');
  await expect(tabs).toHaveCount(3);

  await tabs.first().focus();
  const pageScrollY = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('End');

  const selectedTab = tabs.nth(2);
  await expect(selectedTab).toHaveAttribute('aria-selected', 'true');
  await expect(selectedTab).toBeFocused();
  const endState = await readRevealState(page);
  await expectFirstSampleVisible(page, endState, `End at ${width}px`);
  expect(endState.pageOverflow).toBe(false);
  expect(endState.pageScrollY).toBe(pageScrollY);
  if (width <= 393) {
    expect(endState.scrollLeft).toBeGreaterThan(0);
    expect(endState.rightInset).toBeGreaterThanOrEqual(4);
  }

  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(1)).toBeFocused();
  await expectFirstSampleVisible(page, await readRevealState(page), `ArrowLeft at ${width}px`);

  await page.keyboard.press('Home');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.first()).toBeFocused();
  const homeState = await readRevealState(page);
  await expectFirstSampleVisible(page, homeState, `Home at ${width}px`);
  expect(homeState.scrollLeft).toBe(0);
  await expect(page.getByText(/Synthetic Data/)).toBeVisible();
}

async function readRevealState(page: Page) {
  return page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.demo-tabs')!;
    const tab = document.querySelector<HTMLElement>('.demo-tab[aria-selected="true"]')!;
    const listRect = list.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const scrollportLeft = listRect.left + list.clientLeft;
    const scrollportRight = scrollportLeft + list.clientWidth;
    const listStyle = getComputedStyle(list);
    const tabStyle = getComputedStyle(tab);
    const viewport = window.visualViewport;
    return {
      scrollLeft: list.scrollLeft,
      scrollTop: list.scrollTop,
      scrollWidth: list.scrollWidth,
      clientWidth: list.clientWidth,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      scrollport: { left: scrollportLeft, right: scrollportRight, top: listRect.top + list.clientTop, bottom: listRect.top + list.clientTop + list.clientHeight },
      listRect: { left: listRect.left, right: listRect.right, top: listRect.top, bottom: listRect.bottom, width: listRect.width, height: listRect.height },
      tabRect: { left: tabRect.left, right: tabRect.right, top: tabRect.top, bottom: tabRect.bottom, width: tabRect.width, height: tabRect.height },
      tabFullyVisible: tabRect.left >= scrollportLeft && tabRect.right <= scrollportRight,
      rightInset: scrollportRight - tabRect.right,
      overflowX: listStyle.overflowX,
      scrollBehavior: listStyle.scrollBehavior,
      paddingInlineStart: listStyle.paddingInlineStart,
      paddingInlineEnd: listStyle.paddingInlineEnd,
      font: { family: tabStyle.fontFamily, size: tabStyle.fontSize, weight: tabStyle.fontWeight, letterSpacing: tabStyle.letterSpacing, status: document.fonts.status, loadedFaces: document.fonts.size },
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio, visualWidth: viewport?.width ?? null, visualHeight: viewport?.height ?? null, visualScale: viewport?.scale ?? null, scrollX: window.scrollX, scrollY: window.scrollY, documentWidth: document.documentElement.scrollWidth, documentClientWidth: document.documentElement.clientWidth },
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      pageScrollY: window.scrollY,
    };
  });
}

async function expectFirstSampleVisible(page: Page, firstSample: Awaited<ReturnType<typeof readRevealState>>, label: string) {
  let subsequentFrames: unknown[] = [];
  if (!firstSample.tabFullyVisible) {
    subsequentFrames = await page.evaluate(async () => {
      const snapshots: Array<{
        frame: number;
        time: number;
        scrollLeft: number;
        scrollWidth: number;
        clientWidth: number;
        listRect: { left: number; right: number; top: number; bottom: number; width: number; height: number };
        tabRect: { left: number; right: number; top: number; bottom: number; width: number; height: number };
        tabFullyVisible: boolean;
        rightInset: number;
        fontStatus: FontFaceSetLoadStatus;
      }> = [];
      for (let frame = 1; frame <= 12; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const list = document.querySelector<HTMLElement>('.demo-tabs')!;
        const tab = document.querySelector<HTMLElement>('.demo-tab[aria-selected="true"]')!;
        const listRect = list.getBoundingClientRect();
        const tabRect = tab.getBoundingClientRect();
        const scrollportLeft = listRect.left + list.clientLeft;
        const scrollportRight = scrollportLeft + list.clientWidth;
        snapshots.push({
          frame,
          time: performance.now(),
          scrollLeft: list.scrollLeft,
          scrollWidth: list.scrollWidth,
          clientWidth: list.clientWidth,
          listRect: { left: listRect.left, right: listRect.right, top: listRect.top, bottom: listRect.bottom, width: listRect.width, height: listRect.height },
          tabRect: { left: tabRect.left, right: tabRect.right, top: tabRect.top, bottom: tabRect.bottom, width: tabRect.width, height: tabRect.height },
          tabFullyVisible: tabRect.left >= scrollportLeft && tabRect.right <= scrollportRight,
          rightInset: scrollportRight - tabRect.right,
          fontStatus: document.fonts.status,
        });
      }
      return snapshots;
    });
    console.log(`[demo-tab-visibility-diagnostic] ${JSON.stringify({ label, firstSample, subsequentFrames })}`);
  }

  expect(firstSample.tabFullyVisible, `${label} first sample visibility diagnostic`).toBe(true);
}

for (const width of [320, 393, 1280]) {
  test(`${width}px public demo keeps keyboard-selected tabs visible`, async ({ page }) => {
    await assertKeyboardTabReveal(page, width);
  });
}

test('reduced-motion public demo keeps keyboard-selected tabs visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await assertKeyboardTabReveal(page, 393);
});

test('a late font metric change re-reveals the focused demo tab', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 851 });
  await page.goto('/demo');
  const tabs = page.getByRole('tablist', { name: 'Demo scenarios' }).getByRole('tab');
  await page.addStyleTag({
    content: '.demo-tab { box-sizing: border-box; width: 190.984375px; flex: 0 0 190.984375px; }',
  });
  await tabs.first().focus();
  await page.keyboard.press('End');
  await expect(tabs.nth(2)).toBeFocused();
  const beforeFontChange = await readRevealState(page);
  await expectFirstSampleVisible(page, beforeFontChange, 'End before late font metric change at 320px');
  expect(
    Math.abs(beforeFontChange.scrollLeft - (beforeFontChange.scrollWidth - beforeFontChange.clientWidth)),
  ).toBeLessThanOrEqual(1);

  // Reproduce the hosted font-load shift: fallback metrics cap scrolling at
  // 372px, then the loaded font widens the tabs and scroll extent by 19px.
  await page.addStyleTag({
    content: '.demo-tab { box-sizing: border-box; width: 197.1875px; flex: 0 0 197.1875px; }',
  });
  const afterFontChange = await readRevealState(page);
  expect(afterFontChange.scrollWidth).toBeGreaterThan(beforeFontChange.scrollWidth);
  expect(afterFontChange.scrollLeft).toBe(beforeFontChange.scrollLeft);
  expect(afterFontChange.tabFullyVisible).toBe(false);
  expect(afterFontChange.rightInset).toBeLessThan(0);
  expect(afterFontChange.scrollWidth - afterFontChange.clientWidth - afterFontChange.scrollLeft).toBeGreaterThan(18);
  expect(afterFontChange.pageOverflow).toBe(false);
  expect(afterFontChange.pageScrollY).toBe(beforeFontChange.pageScrollY);

  await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
  const afterFontLoad = await readRevealState(page);
  expect(afterFontLoad.tabFullyVisible).toBe(true);
  expect(afterFontLoad.rightInset).toBeGreaterThanOrEqual(4);
  expect(afterFontLoad.scrollLeft).toBeGreaterThan(afterFontChange.scrollLeft);
  expect(afterFontLoad.pageOverflow).toBe(false);
  expect(afterFontLoad.pageScrollY).toBe(beforeFontChange.pageScrollY);
});

test('393px public demo reveals the last tab after two ArrowRight presses', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto('/demo');
  const tabs = page.getByRole('tablist', { name: 'Demo scenarios' }).getByRole('tab');
  await expect(tabs).toHaveCount(3);

  await tabs.first().focus();
  const pageScrollY = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');

  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(2)).toBeFocused();
  const revealState = await readRevealState(page);
  await expectFirstSampleVisible(page, revealState, 'two ArrowRight presses at 393px');
  expect(revealState.scrollLeft).toBeGreaterThan(0);
  expect(revealState.rightInset).toBeGreaterThanOrEqual(4);
  expect(revealState.pageOverflow).toBe(false);
  expect(revealState.pageScrollY).toBe(pageScrollY);
});
