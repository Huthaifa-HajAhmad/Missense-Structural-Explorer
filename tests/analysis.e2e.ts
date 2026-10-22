import { describe, beforeEach, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

// Live: drives a real analysis, so it depends on the app's external data sources
// (Ensembl, ClinVar, UniProt, ...). Select with `--tag live`.
describe('benchmark analysis', { tags: ['live'], timeout: 180_000 }, () => {
  beforeEach(async ({ app, browser }) => {
    await skipTour(browser);
    await app.open('/');
  });

  test('a benchmark fill-only control fills the query without running', async ({ screen }) => {
    await screen.getByRole('button', 'Fill the form with PAH p.Arg408Trp without running').tap();
    // The parsed fields sit behind the quick-entry disclosure.
    await screen.getByText(/^Edit parsed fields/).tap();
    await expect(screen.getByRole('textbox', 'Gene symbol')).toHaveValue('PAH');
    await expect(screen.getByRole('textbox', /^Protein or cDNA notation/)).toHaveValue('p.Arg408Trp');
  });

  test('Analyse variant completes the evidence stage and names the variant', async ({ screen }) => {
    await screen.getByRole('button', 'Fill the form with PAH p.Arg408Trp without running').tap();
    await screen.getByRole('button', 'Analyse variant').tap();
    await expect(screen.getByRole('button', 'Copy link to PAH p.Arg408Trp')).toBeVisible();
    await expect(screen.getByRole('button', /^Evidence .*Complete$/)).toBeVisible({ timeout: 120_000 });
  });

  test('a benchmark run exposes the evidence sub-tabs', async ({ screen }) => {
    // The card runs the benchmark directly, like a Recent analyses entry.
    await screen.getByRole('button', 'Run benchmark PAH p.Arg408Trp').tap();
    await expect(screen.getByRole('button', /^Evidence .*Complete$/)).toBeVisible({ timeout: 120_000 });
    for (const tab of ['Population data', 'In-silico predictors', 'Interfaces & PPI']) {
      await expect(screen.getByRole('button', tab)).toBeVisible();
    }
  });
});
