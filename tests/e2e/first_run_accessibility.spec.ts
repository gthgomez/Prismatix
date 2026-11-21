import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { setupAuthenticatedMock, signInAsMockUser } from './fixtures/mockAuth';

test('first-run setup and provider dialog expose accessible controls', async ({ page }) => {
  await setupAuthenticatedMock(page, { hasProviderKey: false, conversations: [], messages: [] });
  await signInAsMockUser(page);
  const setup = page.locator('.first-run-card');
  await expect(setup).toBeVisible();

  const check = async (selector: string) => {
    const { violations } = await new AxeBuilder({ page }).include(selector).analyze();
    expect(violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);
  };

  await check('.first-run-card');
  const trigger = setup.getByRole('button', { name: 'Use another provider' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Provider plug-ins' });
  await expect(dialog).toBeVisible();
  await check('dialog[open]');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
