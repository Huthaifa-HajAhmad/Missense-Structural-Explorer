import { describe, beforeEach, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

describe('variant search form', { tags: ['search'] }, () => {
  beforeEach(async ({ app, browser }) => {
    await skipTour(browser);
    await app.open('/');
  });

  test('lists the four benchmark controls on first run', async ({ screen }) => {
    await expect(screen.getByRole('region', 'No recent analyses')).toBeVisible();
    for (const label of ['PAH p.Arg408Trp', 'FGFR3 p.Gly380Arg', 'GBA1 p.Leu483Pro', 'CNNM2 p.Glu357Lys']) {
      await expect(screen.getByRole('button', `Load benchmark ${label}`)).toBeVisible();
    }
  });

  test('typing enables Clear and Clear empties the fields', async ({ screen }) => {
    const gene = screen.getByRole('textbox', 'Gene symbol');
    await expect(screen.getByRole('button', 'Clear query fields')).toBeDisabled();
    await gene.fill('PAH');
    await expect(screen.getByRole('button', 'Clear query fields')).toBeEnabled();
    await screen.getByRole('button', 'Clear query fields').tap();
    await expect(gene).toHaveValue('');
  });

  test('a notation example fills the protein field', async ({ screen }) => {
    await screen
      .getByRole('button', 'Use example p.Arg408Trp in the Variant notation field')
      .tap();
    await expect(screen.getByRole('textbox', /^Protein or cDNA notation/)).toHaveValue('p.Arg408Trp');
  });

  test('the sidebar switches between Services and Pipeline', async ({ screen }) => {
    await expect(screen.getByRole('tab', 'Services')).toBeSelected();
    await screen.getByRole('tab', 'Pipeline').tap();
    await expect(screen.getByRole('tab', 'Pipeline')).toBeSelected();
  });
});
