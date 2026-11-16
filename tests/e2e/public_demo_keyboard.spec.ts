import { test, expect } from '@playwright/test';

test('393px public demo keeps keyboard-selected tabs visible', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto('/demo');
  const tablist = page.getByRole('tablist', { name: 'Demo scenarios' });
  const tabs = tablist.getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');

  const selectedTab = tabs.nth(2);
  await expect(selectedTab).toHaveAttribute('aria-selected', 'true');
  await expect(selectedTab).toBeFocused();
  const revealState = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.demo-tabs')!;
    const tab = document.querySelector<HTMLElement>('.demo-tab[aria-selected="true"]')!;
    const listRect = list.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    return {
      scrolled: list.scrollLeft > 0,
      tabVisible: tabRect.left >= listRect.left && tabRect.right <= listRect.right,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  expect(revealState.scrolled).toBe(true);
  expect(revealState.tabVisible).toBe(true);
  expect(revealState.pageOverflow).toBe(false);
  await expect(page.getByText(/Synthetic Data/)).toBeVisible();
});
