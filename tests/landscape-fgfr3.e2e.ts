import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

// Live provider check: this intentionally uses the query flow without replacing network responses.
test('FGFR3 landscape keeps labels and selection readable', { tags: ['live', 'landscape'], timeout: 240_000 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1750, height: 1000 });
  await app.open('/');
  await screen.getByRole('button', 'Run benchmark FGFR3 p.Gly380Arg').tap();
  await expect(screen.getByRole('button', 'Copy link to FGFR3 p.Gly380Arg')).toBeVisible({ timeout: 120_000 });
  await screen.getByRole('button', /^Landscape/).first().tap();
  await expect(browser.locator('.lsr-selection-heading')).toContainText('G380R', { timeout: 120_000 });
  await expect(browser.locator('.ls-overview button[aria-label^="Ig-like C2-type 1"]')).toBeVisible({ timeout: 120_000 });
  await expect(browser.locator('.ls-overview button[aria-label^="Ig-like C2-type 1"]')).toContainText('Ig-C2 1');
  await expect(browser.locator('.ls-overview button[aria-label^="Intrinsically disordered region"]').first()).toContainText('126\u2013153');
  await expect(browser.locator('.ls-overview')).not.toContainText('Loading whole-protein scores', { timeout: 120_000 });
  await expect(browser.locator('.ls-overview')).not.toContainText('context pending', { timeout: 120_000 });
  await app.screenshot('fgfr3-landscape-overview');
  expect(await browser.evaluate(() => {
    const body = document.querySelector<HTMLElement>('.inspector-body')!;
    body.scrollTop = body.scrollHeight;
    return getComputedStyle(document.querySelector('.lsr-kv__value')!).fontFamily.includes('Source Sans');
  })).toBe(true);
  expect(await browser.evaluate(() => {
    const heading = document.querySelector('.lsr-selection-heading')!.getBoundingClientRect();
    const body = document.querySelector('.inspector-body')!.getBoundingClientRect();
    return heading.top >= body.top - 1 && heading.bottom < body.bottom;
  })).toBe(true);
  await app.screenshot('fgfr3-inspector-scrolled');
});
