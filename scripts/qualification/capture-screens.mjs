#!/usr/bin/env node
// Captures representative desktop/mobile screenshots of the REAL backend build.
// Requires the local stack, functions serve and the deterministic stub, plus a
// preview server on PLAYWRIGHT_PORT (default 4174).

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveQualificationEnvironment } from './env-contract.mjs';

let target;
try {
  target = resolveQualificationEnvironment(process.env, { requireAnonKey: false });
} catch (error) {
  console.error(`capture-screens: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const APP = process.env.APP_URL ?? 'http://127.0.0.1:4174';
const APP_HOST = (() => {
  try {
    return new URL(APP).hostname.toLowerCase();
  } catch {
    return '';
  }
})();
const appIsLoopback = ['127.0.0.1', 'localhost', '::1'].includes(APP_HOST);
if (!appIsLoopback) {
  console.error(`capture-screens: APP_URL must be the qualification preview (loopback), got ${APP}`);
  process.exit(1);
}

const OUT = resolve(process.env.SCREENSHOT_DIR ?? 'docs/engineering/campaigns/evidence/2026-11-24/screens');
const STUB = target.stubUrl;
const USER = { email: 'qual-a@example.test', password: 'qual-pass-a-1234' };
const WIDTHS = (process.env.SCREEN_WIDTHS ?? '360,390,768,1440').split(',').map(Number);
const THEMES = (process.env.SCREEN_THEMES ?? 'light,dark').split(',');

async function setScenario(scenario) {
  await fetch(`${STUB}/__control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario }),
  });
}

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });
const failures = [];

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const height = width <= 390 ? 844 : width === 768 ? 1024 : 900;
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      colorScheme: theme,
    });
    await context.addInitScript((selected) => {
      localStorage.setItem('prismatix-theme', selected);
    }, theme);
    const page = await context.newPage();
    const tag = `${theme}-${width}`;

    try {
      await page.goto(APP, { waitUntil: 'networkidle' });
      await page.locator('#email').waitFor({ timeout: 20000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${tag}-01-auth.png`, fullPage: true });

      await page.locator('#email').fill(USER.email);
      await page.locator('#password').fill(USER.password);
      await page.getByRole('button', { name: /sign in to prismatix/i }).click();

      const composer = page.getByRole('textbox', { name: 'Message Prismatix' });
      await composer.waitFor({ timeout: 25000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/${tag}-02-workspace-empty.png`, fullPage: true });

      const spend = page.getByRole('button', { name: /\$\d+\.\d{2}/ }).first();
      if (await spend.isVisible().catch(() => false)) {
        await spend.click();
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/${tag}-03-spend.png`, fullPage: true });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }

      const settings = page.getByRole('button', { name: /provider settings/i }).first();
      if (await settings.isVisible().catch(() => false)) {
        await settings.click();
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${OUT}/${tag}-04-provider-settings.png`, fullPage: true });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }

      await setScenario('default');
      await composer.fill(`Screenshot journey ${tag}`);
      const send = page.getByRole('button', { name: /^Send message/ });
      await send.waitFor({ timeout: 15000 });
      for (let i = 0; i < 40 && (await send.isDisabled()); i++) await page.waitForTimeout(250);
      await composer.press('Enter');
      await page.getByText('Prismatix deterministic stub response.').first().waitFor({ timeout: 25000 });
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      // Viewport frame (fixed/sticky chrome renders where a user sees it).
      await page.screenshot({ path: `${OUT}/${tag}-05-conversation-viewport.png`, fullPage: false });
      await page.screenshot({ path: `${OUT}/${tag}-06-conversation-full.png`, fullPage: true });

      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        viewportHeight: window.innerHeight,
      }));
      if (metrics.scrollWidth - metrics.clientWidth > 1) {
        failures.push(`${tag}: horizontal overflow ${metrics.scrollWidth - metrics.clientWidth}px ${JSON.stringify(metrics)}`);
      }
    } catch (error) {
      failures.push(`${tag}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    } finally {
      await context.close();
    }
  }
}

await browser.close();

console.log(JSON.stringify({ out: OUT, themes: THEMES, widths: WIDTHS, failures }, null, 2));
if (failures.length > 0) process.exit(1);
