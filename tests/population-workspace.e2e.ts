import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

// Production tabs/rail/CSS with explicitly illustrative data, without live provider dependencies.
test('population states, keyboard tabs and inspector survive responsive layouts', { tags: ['population'], timeout: 120_000 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Example').selectOption('Absent');
  await expect(screen.getByRole('region', 'Population source coverage')).toBeVisible();
  await expect(screen.getByRole('button', 'Open inspector')).toHaveCount(0);
  await expect(screen.getByTestId('verdict-chip')).toHaveText('PM2 · Supporting');

  for (const width of [1440, 800, 390]) {
    await browser.setViewport({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      // Set the starting theme through the same settings the real app persists.
      const dark = await browser.evaluate(() => document.documentElement.classList.contains('dark'));
      if (dark !== (theme === 'dark')) await screen.getByRole('button', 'Switch theme').tap();
      await expect(screen.getByRole('region', 'Population source coverage')).toBeVisible();
      expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await app.screenshot(`population-absent-${width}-${theme}`);
    }
  }
  await browser.setViewport({ width: 1440, height: 1000 });
  await screen.getByRole('button', 'gnomAD exomes').tap();
  const inspector = screen.getByRole('region', 'Selected evidence reading');
  await expect(inspector.getByRole('heading', 'gnomAD exomes')).toBeVisible();
  await screen.getByRole('tab', 'Comparison').press('ArrowRight');
  await expect(screen.getByRole('tab', 'Clinical assertion')).toBeSelected();
  await expect(inspector.getByRole('heading', 'gnomAD exomes')).toBeVisible();
  await expect(screen.getByTestId('clinvar-panel')).toBeVisible();
  await expect(screen.getByTestId('population-readings')).toHaveCount(0);
  await app.screenshot('population-clinical-assertion');
  await screen.getByRole('tab', 'Clinical assertion').press('ArrowLeft');
  await expect(screen.getByRole('button', 'gnomAD exomes')).toHaveAttribute('aria-pressed', 'true');
  await screen.getByText(/Rule thresholds.*app-defined frequency policy/).tap();
  expect(await browser.evaluate(() => document.querySelectorAll('.pop-scale__marker').length)).toBe(0);
  for (const example of ['Zero', 'Missing']) {
    await screen.getByRole('combobox', 'Example').selectOption(example);
    await expect(screen.getByRole('region', 'Population source coverage')).toBeVisible();
    await app.screenshot(`population-${example.toLowerCase()}`);
  }
  await screen.getByRole('combobox', 'Example').selectOption('Mixed');
  await expect(screen.getByRole('image', /How often is this allele observed/)).toBeVisible();
  await app.screenshot('population-measured');
  await screen.getByRole('button', 'Collapse Inspector Panel').tap();
  await screen.getByRole('button', 'Expand Context Inspector').tap();
  await expect(inspector.getByRole('heading', 'gnomAD exomes')).toBeVisible();
});
