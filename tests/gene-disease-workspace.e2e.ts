import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

// Production components and source states; illustrative records, no live clinical queries.
test('gene-disease finding, hidden pins and empty states remain legible', { tags: ['gene-disease'], timeout: 120_000, retries: 0 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Gene-disease');
  await screen.getByRole('combobox', 'Example').selectOption('Differing assertions');
  await expect(screen.getByRole('heading', 'Submitted validity levels differ')).toBeVisible();
  for (const width of [1440, 800, 390]) {
    await browser.setViewport({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      const dark = await browser.evaluate(() => document.documentElement.classList.contains('dark'));
      if (dark !== (theme === 'dark')) await screen.getByRole('button', 'Switch theme').tap();
      await expect(screen.getByRole('region', 'Submitted validity assertion matrix')).toBeVisible();
      expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width === 1440) {
        expect(await browser.evaluate(() => {
          const last = document.querySelector('.cx-matrix tbody tr:last-child')!.getBoundingClientRect();
          return last.bottom < window.innerHeight - 16;
        })).toBe(true);
      }
      await app.screenshot(`gene-disease-${width}-${theme}`);
    }
  }
  await browser.setViewport({ width: 1440, height: 900 });
  await screen.getByRole('button', 'Panel B: Moderate').press('Enter');
  const inspector = screen.getByRole('region', 'Selected evidence reading');
  await expect(inspector.getByRole('heading', 'Panel B')).toBeVisible();
  await screen.getByRole('tab', 'Validity assertions').press('ArrowRight');
  await expect(screen.getByRole('tab', 'Gene dosage')).toBeSelected();
  await expect(screen.getByRole('searchbox')).toHaveCount(0);
  await expect(screen.getByRole('button', 'Try again')).toHaveCount(0);
  await app.screenshot('gene-disease-no-dosage');
  await screen.getByRole('button', 'Show pinned record').tap();
  await expect(screen.getByRole('button', 'Panel B: Moderate')).toHaveAttribute('aria-pressed', 'true');
  expect(await browser.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null)).toBe('Panel B: Moderate');
  await screen.getByRole('tab', 'Source records').tap();
  await expect(inspector.getByRole('heading', 'Panel B')).toBeVisible();
  await screen.getByRole('tab', 'Assertion comparison').tap();
  await screen.getByText('Review trace', { exact: true }).tap();
  await expect(screen.getByTestId('context-trace')).toContainText('Gene2Phenotype reports undetermined');
  await app.screenshot('gene-disease-pinned-trace');
  await screen.getByRole('combobox', 'Review SOD1 for').selectOption('Choose a disease and inheritance');
  await expect(screen.getByRole('searchbox')).toHaveCount(0);
  await expect(screen.getByRole('region', 'Submitted validity assertion matrix')).toHaveCount(0);
  await app.screenshot('gene-disease-unselected');
});
