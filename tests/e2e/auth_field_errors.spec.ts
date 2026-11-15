// Behavioral regression: field-associated auth errors + focus recovery.
// Scripted browser evidence against the built preview; no live auth provider.

import { test, expect } from '@playwright/test';

test.describe('Auth field-associated errors', () => {
  test('empty email submit marks the email field and recovers focus', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#email');

    await page.getByRole('button', { name: /sign in to prismatix/i }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/email is required/i);

    const email = page.locator('#email');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toHaveAttribute('aria-describedby', 'auth-field-error');
    await expect(email).toBeFocused();
  });

  test('missing password marks the password field and recovers focus', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#email');

    await page.fill('#email', 'synth-user@prismatix.test');
    await page.getByRole('button', { name: /sign in to prismatix/i }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/password is required/i);

    const password = page.locator('#password');
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    await expect(password).toHaveAttribute('aria-describedby', 'auth-field-error');
    await expect(password).toBeFocused();
    await expect(page.locator('#email')).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('forgot-password without email associates the error with email', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#email');

    // AuthenticatedApp only wires reset when the callback exists; assert control present.
    const forgot = page.getByRole('button', { name: /forgot password/i });
    await expect(forgot).toBeVisible();
    await forgot.click();

    await expect(page.getByRole('alert')).toContainText(/enter your email/i);
    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#email')).toBeFocused();
  });
});
