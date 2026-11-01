import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from '../support.js';

test('live GATA4 burial agrees in the tab and inspector', { tags: ['live'], timeout: 240_000 }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await app.open('/');
  await screen.getByRole('textbox', 'Variant', { exact: true }).fill('GATA4 p.Ser159Cys');
  await screen.getByRole('button', 'Analyse variant').click();
  await expect(screen.getByRole('button', 'Copy link to GATA4 p.Ser159Cys')).toBeVisible({ timeout: 180_000 });
  await screen.getByRole('button', 'Residue shifts & pockets', { exact: true }).click();
  await expect(screen.getByTestId('residue-shifts-tab')).toContainText('relative accessibility', { timeout: 180_000 });
  await screen.getByRole('tab', 'Environment & pockets').click();
  // The structure that was really read is named; the old text claimed "not assessed" here.
  expect(await browser.evaluate(() => /AlphaFold model|PDB [0-9A-Z]{4}/.test(document.querySelector('[data-testid="burial-cause"]')?.textContent ?? ''))).toBe(true);
  await expect(screen.getByTestId('burial-rsa-row')).toContainText('Surface');
  await expect(screen.getByTestId('residue-trace')).toContainText('Surface');
  expect(await browser.evaluate(() => {
    const reading = document.querySelector('[data-testid="burial-rsa-row"] .rsx-num')?.textContent?.trim();
    return !!reading && document.querySelector('[data-testid="residue-trace"]')!.textContent!.includes(reading);
  })).toBe(true);
  await app.screenshot('gata4-live-burial');
});
