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

  test('a benchmark control fills the query', async ({ screen }) => {
    await screen.getByRole('button', 'Load benchmark PAH p.Arg408Trp').tap();
    await expect(screen.getByRole('textbox', 'Gene symbol')).toHaveValue('PAH');
    await expect(screen.getByRole('textbox', /^Protein or cDNA notation/)).toHaveValue('p.Arg408Trp');
  });

  test('Analyse variant completes the evidence stage and names the variant', async ({ screen }) => {
    await screen.getByRole('button', 'Load benchmark PAH p.Arg408Trp').tap();
    await screen.getByRole('button', 'Analyse variant').tap();
    await expect(screen.getByRole('button', 'Copy link to PAH p.Arg408Trp')).toBeVisible();
    await expect(screen.getByRole('button', /^Evidence .*Complete$/)).toBeVisible({ timeout: 120_000 });
  });

  test('a completed analysis exposes the evidence sub-tabs', async ({ screen }) => {
    await screen.getByRole('button', 'Load benchmark PAH p.Arg408Trp').tap();
    await screen.getByRole('button', 'Analyse variant').tap();
    await expect(screen.getByRole('button', /^Evidence .*Complete$/)).toBeVisible({ timeout: 120_000 });
    for (const tab of ['Population data', 'In-silico predictors', 'Interfaces & PPI']) {
      await expect(screen.getByRole('button', tab)).toBeVisible();
    }
  });
});
