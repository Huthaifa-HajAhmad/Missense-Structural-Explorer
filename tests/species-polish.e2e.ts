import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

test('species review and source layouts', { tags: ['species'], timeout: 120_000 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Species & models');
  await screen.getByRole('combobox', 'Example').selectOption('Mixed');
  await expect(screen.getByText('Review context', { exact: true })).toBeVisible();
  await screen.getByRole('tab', 'Orthology & screens').tap();
  await expect(screen.getByRole('columnheader', 'Reported phenotype categories')).toBeVisible();
  await app.screenshot('species-mouse-categories');
  await screen.getByRole('tab', 'Protein alignments').tap();
  await expect(screen.getByTestId('residue-alignment-card')).toBeVisible();
  await app.screenshot('species-alignment-summary');
  await screen.getByRole('tab', 'Phenotype annotations').tap();
  await expect(screen.getByText('Disease phenotype comparison')).toBeVisible();
  await expect(screen.getByTestId('model-phenotypes-card')).toContainText('Illustrative motor-neuron condition');
  // Give one illustrative zebrafish a summary count without resolved terms, as in the reported bug.
  await browser.evaluate(async () => {
    const modulePath = '/src/stores/useVariantAnalysisStore.ts';
    const { useVariantAnalysisStore: store } = await import(/* @vite-ignore */ modulePath);
    const state = store.getState();
    const load = state.extraContexts['phenotypes:SOD1'];
    store.setState({ extraContexts: { ...state.extraContexts, 'phenotypes:SOD1': { ...load, data: {
      ...load.data, species: load.data.species.map((s: { symbol: string }) => s.symbol === 'sod1a' ? { ...s, total: 27 } : s),
    } } } });
    return true;
  });
  await screen.getByText('sod1a', { exact: true }).tap();
  await expect(screen.getByText(/27 summaries have no resolved phenotype terms/)).toBeVisible();
  await expect(screen.getByText(/No term details can be displayed/)).toBeVisible();
  for (const width of [1440, 800]) {
    await browser.setViewport({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      const dark = await browser.evaluate(() => document.documentElement.classList.contains('dark'));
      if (dark !== (theme === 'dark')) await screen.getByRole('button', 'Switch theme').tap();
      await screen.getByRole('combobox', 'Evidence').selectOption('Species & models');
      await screen.getByRole('tab', 'Phenotype annotations').tap();
      await expect(screen.getByTestId('model-phenotypes-card')).toBeVisible();
      await app.screenshot(`species-${width}-${theme}`);
    }
  }
});
