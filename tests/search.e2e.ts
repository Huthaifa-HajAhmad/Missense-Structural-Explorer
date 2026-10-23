import { describe, beforeEach, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

describe('variant search form', { tags: ['search'] }, () => {
  beforeEach(async ({ app, browser }) => {
    await skipTour(browser);
    // Every test starts from the same viewport; one test below sets its own.
    await browser.setViewport({ width: 1280, height: 800 });
    await app.open('/');
  });

  test('lists the four benchmark controls on first run', async ({ screen, app, browser }) => {
    await browser.setViewport({ width: 1440, height: 1100 });
    await expect(screen.getByRole('region', 'No recent analyses')).toBeVisible();
    for (const label of ['PAH p.Arg408Trp', 'FGFR3 p.Gly380Arg', 'GBA1 p.Leu483Pro', 'CNNM2 p.Glu357Lys']) {
      await expect(screen.getByRole('button', `Run benchmark ${label}`)).toBeVisible();
    }
    await app.screenshot('variant-workbench');
  });

  test('typing enables Clear and Clear empties the fields', async ({ screen }) => {
    await screen.getByText(/^Edit parsed fields/).tap();
    const gene = screen.getByRole('textbox', 'Gene symbol');
    await expect(screen.getByRole('button', 'Clear query fields')).toBeDisabled();
    await gene.fill('PAH');
    await expect(screen.getByRole('button', 'Clear query fields')).toBeEnabled();
    await screen.getByRole('button', 'Clear query fields').tap();
    await expect(gene).toHaveValue('');
  });

  test('a notation example fills the protein field', async ({ screen }) => {
    await screen.getByText(/^Edit parsed fields/).tap();
    await screen
      .getByRole('button', 'Use example p.Arg408Trp in the Variant notation field')
      .tap();
    await expect(screen.getByRole('textbox', /^Protein or cDNA notation/)).toHaveValue('p.Arg408Trp');
  });

  test('the quick entry line fills the parsed fields', async ({ screen }) => {
    await screen.getByRole('textbox', /^Variant/).fill('NAE1 p.Asp116Gly');
    await screen.getByText(/^Edit parsed fields/).tap();
    await expect(screen.getByRole('textbox', 'Gene symbol')).toHaveValue('NAE1');
    await expect(screen.getByRole('textbox', /^Protein or cDNA notation/)).toHaveValue('p.Asp116Gly');
  });

  test('the sidebar switches between Services and Pipeline', async ({ screen }) => {
    await expect(screen.getByRole('tab', 'Services')).toBeSelected();
    await screen.getByRole('tab', 'Pipeline').tap();
    await expect(screen.getByRole('tab', 'Pipeline')).toBeSelected();
  });

  test('optional AI instructions retain their value when collapsed', async ({ screen }) => {
    const instructions = screen.getByRole('textbox', 'AI Focus Area & Custom Analysis Instructions');
    await screen.getByText('AI focus & custom instructions', { exact: true }).tap();
    await instructions.fill('Focus on the cofactor loop');
    await screen.getByText('AI focus & custom instructions', { exact: true }).tap();
    await expect(screen.getByText('26 chars set')).toBeVisible();
    await expect(instructions).not.toBeVisible();
    await screen.getByText('AI focus & custom instructions', { exact: true }).tap();
    await expect(instructions).toHaveValue('Focus on the cofactor loop');
  });

  test('populated history and monitor remain usable on desktop and mobile', async ({ app, browser, screen }) => {
    await browser.addInitScript(() => {
      localStorage.setItem('variant_search_history', JSON.stringify([
        { gene: 'PAH', variant: 'p.Arg408Trp', uniprotId: 'P00439' },
        { gene: 'FGFR3', variant: 'p.Gly380Arg', uniprotId: 'P22607' },
        { gene: 'NAE1', variant: 'p.Asp116Gly', uniprotId: 'Q13564' },
      ]));
    });
    await browser.setViewport({ width: 1660, height: 1200 });
    await app.open('/');
    await expect(screen.getByRole('button', 'Select recent search PAH p.Arg408Trp')).toBeVisible();
    await expect(screen.getByRole('button', 'Show details for Ensembl VEP')).toBeVisible();
    await screen.getByRole('button', 'Show details for Ensembl VEP').tap();
    await expect(screen.getByRole('button', 'Hide details for Ensembl VEP')).toBeExpanded();
    await screen.getByRole('button', 'Hide details for Ensembl VEP').tap();
    const monitor = await screen.getByRole('complementary', 'Services and pipeline').boundingBox();
    const recents = await screen.getByRole('region', /Recent analyses/).boundingBox();
    expect(Boolean(monitor && recents && Math.abs(monitor.y + monitor.height - recents.y - recents.height) <= 1), 'monitor and populated recents share a bottom edge');
    await app.screenshot('services-and-recents');
    await screen.getByRole('tab', 'Pipeline').tap();
    await expect(screen.getByText('Pipeline ready', { exact: true })).toBeVisible();
    await app.screenshot('pipeline-and-recents');
    await screen.getByRole('button', 'Switch to dark mode').tap();
    await app.screenshot('pipeline-dark');
    await browser.setViewport({ width: 390, height: 844 });
    await screen.getByRole('region', /Recent analyses/).scrollIntoView();
    await app.screenshot('recents-mobile-dark');
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal page overflow');
    await screen.getByRole('tab', 'Services').tap();
    await screen.getByRole('button', 'Show details for Ensembl VEP').tap();
    await expect(screen.getByRole('button', 'Hide details for Ensembl VEP')).toBeExpanded();
    await app.screenshot('services-mobile-dark');
    await screen.getByRole('button', 'Clear search history').tap();
    await expect(screen.getByRole('region', 'No recent analyses')).toBeVisible();
    await expect(screen.getByRole('button', /^Select recent search/)).toHaveCount(0);
  });
});
