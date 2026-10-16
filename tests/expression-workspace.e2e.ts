import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

test('expression expansion, exact pins and source availability', { tags: ['expression'], timeout: 120_000, retries: 0 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Expression');
  await screen.getByRole('combobox', 'Example').selectOption('Dense expression');
  const chart = screen.getByRole('img', /Adult tissue expression/);
  await expect(chart).toBeVisible();
  for (const width of [1440, 800, 390]) {
    await browser.setViewport({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      const dark = await browser.evaluate(() => document.documentElement.classList.contains('dark'));
      if (dark !== (theme === 'dark')) await screen.getByRole('button', 'Switch theme').tap();
      await expect(chart).toBeVisible();
      expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width === 1440) expect(await browser.evaluate(() => {
        const plot = document.querySelector('.evw-plot')!.getBoundingClientRect();
        return plot.top + 4 * 32 < window.innerHeight;
      })).toBe(true);
      await app.screenshot(`expression-${width}-${theme}`);
    }
  }
  await browser.setViewport({ width: 1440, height: 900 });
  await screen.getByRole('button', 'Show all 54 records').tap();
  await expect(chart).toContainText('Illustrative tissue 54');
  await screen.getByRole('tab', 'Source records').tap();
  await screen.getByRole('button', 'Illustrative tissue 54').press('Enter');
  const inspector = screen.getByRole('region', 'Selected evidence reading');
  await expect(inspector.getByRole('heading', 'Illustrative tissue 54')).toBeVisible();
  await screen.getByRole('button', 'Show first 20').tap();
  await screen.getByRole('tab', 'Tissue explorer').tap();
  await screen.getByRole('button', 'Show pinned record').tap();
  expect(await browser.evaluate(() => document.activeElement?.textContent ?? null)).toBe('Illustrative tissue 54');
  await app.screenshot('expression-recovered-pin');
  await screen.getByRole('combobox', 'Example').selectOption('Pediatric unavailable');
  await screen.getByRole('tab', 'Pediatric RNA').tap();
  await expect(screen.getByTestId('expression-finding')).toContainText('Pediatric measurements are not available here');
  await expect(screen.getByRole('searchbox')).toHaveCount(0);
  await expect(screen.getByRole('combobox', 'Sampled age cohort')).toHaveCount(0);
  await app.screenshot('expression-pediatric-unavailable');
  await screen.getByRole('combobox', 'Example').selectOption('Mixed');
  await screen.getByRole('tab', 'Tissue explorer').tap();
  await screen.getByRole('combobox', 'Sampled age cohort').selectOption('Pre-pubertal (8 to approximately 13)');
  await expect(screen.getByTestId('expression-finding')).toContainText('29 TPM');
  await expect(screen.getByText(/Linear TPM scale: 0–36/)).toBeVisible();
  await screen.getByRole('tab', 'Source records').tap();
  await screen.getByRole('button', 'Brain').press('Enter');
  await expect(inspector).toContainText('29');
  await app.screenshot('expression-pediatric-record');
});
