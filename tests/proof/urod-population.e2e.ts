import { describe, beforeEach, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from '../support.js';

// Proof run for the Evidence audit: UROD p.Gly318Arg on Population data and Species & models.
describe('UROD population proof', { tags: ['live', 'proof'], timeout: 300_000 }, () => {
  beforeEach(async ({ app, browser }) => {
    await skipTour(browser);
    await app.open('/');
  });

  test('Population data and Species & models render for UROD p.Gly318Arg', async ({ screen, app }) => {
    // The genomic allele from the reviewed screenshot: protein notation alone is ambiguous for Gly→Arg.
    await screen.getByRole('textbox', 'Variant').fill('1-45015346-G-A');
    await screen.getByRole('button', 'Analyse variant').tap();
    await expect(screen.getByRole('button', /^Evidence .*Complete/)).toBeVisible({ timeout: 240_000 });
    await screen.getByRole('button', 'Population data').tap();
    await expect(screen.getByRole('heading', 'Population data')).toBeVisible();
    // The headline finding, as a contract rather than a screenshot: gnomAD v4 puts this allele at
    // FAF95 1.618% in the African-ancestry group — above the 1% BS1 cut-point. A regression back to
    // the old "combined 0.104% between the cut-points" outcome fails these two assertions.
    await expect(screen.getByTestId('verdict-chip')).toBeVisible();
    await expect(screen.getByTestId('verdict-chip')).toHaveText('BS1');
    await expect(screen.getByTestId('figure-headline')).toHaveText('1.62%');
    await app.screenshot('population');
    await screen.getByRole('button', 'Species & models').tap();
    await expect(screen.getByRole('heading', 'Species & models')).toBeVisible();
    await expect(screen.getByText(/species with returned records/)).toBeVisible({ timeout: 90_000 });
    await app.screenshot('species');
  });
});
