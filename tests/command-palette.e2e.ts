import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

test('compact search opens a readable palette and keyboard selection navigates', { tags: ['shell'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open('/');
  const trigger = screen.getByRole('button', /^Search views or run a variant/);
  await trigger.tap();
  const input = screen.getByRole('combobox');
  await expect(input).toBeFocused();
  await app.screenshot('palette-browse');
  await input.fill('RNA splicing');
  await expect(screen.getByRole('option', /RNA splicing/)).toBeVisible();
  await app.screenshot('palette-evidence-result');
  await input.press('Enter');
  await expect(screen.getByRole('heading', 'RNA splicing')).toBeVisible();
  await expect(screen.getByRole('dialog', 'Command palette')).not.toBeVisible();
  await trigger.press('Control+k');
  await expect(input).toBeFocused();
  await input.fill('zzzznomatch');
  await expect(screen.getByText(/No results for/)).toBeVisible();
  await input.press('Escape');
  await expect(trigger).toBeFocused();
  await screen.getByRole('button', 'Switch to dark mode').tap();
  await browser.setViewport({ width: 390, height: 667 });
  await trigger.tap();
  await input.fill('population');
  await expect(screen.getByRole('option', /Population data/)).toBeVisible();
  expect(await browser.evaluate(() => {
    const panel = document.querySelector('.cs-palette')!;
    const rect = panel.getBoundingClientRect();
    const rows = [...panel.querySelectorAll('.cs-palette-item')];
    return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight &&
      rows.every(row => row.scrollWidth <= row.clientWidth + 1) &&
      [...panel.querySelectorAll('.cs-palette-item-meta')].every(meta => getComputedStyle(meta).display !== 'none');
  }), 'mobile results retain their descriptions without overflowing').toBe(true);
  await app.screenshot('palette-mobile-dark');
  await screen.getByRole('button', 'Close command palette').tap();
  await expect(trigger).toBeFocused();
});
