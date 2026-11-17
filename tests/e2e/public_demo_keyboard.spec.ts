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
  expect(endState.tabFullyVisible).toBe(true);
  expect(endState.pageOverflow).toBe(false);
  expect(endState.pageScrollY).toBe(pageScrollY);
  if (width <= 393) {
    expect(endState.scrollLeft).toBeGreaterThan(0);
    expect(endState.rightInset).toBeGreaterThanOrEqual(4);
  }

  await page.keyboard.press('ArrowLeft');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(1)).toBeFocused();
  expect((await readRevealState(page)).tabFullyVisible).toBe(true);

  await page.keyboard.press('Home');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.first()).toBeFocused();
  const homeState = await readRevealState(page);
  expect(homeState.tabFullyVisible).toBe(true);
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
    return {
      scrollLeft: list.scrollLeft,
      tabFullyVisible: tabRect.left >= scrollportLeft && tabRect.right <= scrollportRight,
      rightInset: scrollportRight - tabRect.right,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      pageScrollY: window.scrollY,
    };
  });
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
  expect(revealState.tabFullyVisible).toBe(true);
  expect(revealState.scrollLeft).toBeGreaterThan(0);
  expect(revealState.rightInset).toBeGreaterThanOrEqual(4);
  expect(revealState.pageOverflow).toBe(false);
  expect(revealState.pageScrollY).toBe(pageScrollY);
});
