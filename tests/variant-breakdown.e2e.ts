import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import type { Browser } from '@e2e-dev/web';
import { monitorSettled, skipTour } from './support.js';

/** Wait until the run is over (the breakdown stops being busy). Waiting on the breakdown, not on a tab's badge, keeps the check on the card under test. */
const settledBreakdown = (browser: Browser) => browser.evaluate(() => new Promise<string>(resolve => {
  const startedAt = Date.now();
  const poll = () => {
    const busy = document.querySelector('[data-testid="variant-breakdown"]')?.getAttribute('aria-busy');
    if (busy === 'false' || Date.now() - startedAt > 150_000) resolve(String(busy));
    else setTimeout(poll, 250);
  };
  poll();
}));

// Live: the breakdown fills from a real run, so it depends on the app's external data sources. Select with `--tag live`.
describe('variant breakdown', { tags: ['live'], timeout: 240_000 }, () => {
  test('the query card opens at analysis onset, keeps its height as values arrive, and squeezes Recent', async ({ app, browser, screen }) => {
    await skipTour(browser);
    await browser.setViewport({ width: 1753, height: 981 });
    await app.open('/');
    await monitorSettled(browser);
    const card = () => browser.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const recents = box('.workbench-recents');
      return {
        query: Math.round(box('.workbench-query').height),
        grid: Math.round(document.querySelector('[data-testid="variant-breakdown"] .qe-breakdown__grid')?.getBoundingClientRect().height ?? 0),
        recents: Math.round(recents.height),
        shareFloor: Math.abs(recents.bottom - box('.workbench-rail').bottom) <= 2,
      };
    });
    const cellTexts = () => browser.evaluate(() => Object.fromEntries(
      [...document.querySelectorAll('[data-testid="variant-breakdown"] [data-cell]')]
        .map(el => [el.getAttribute('data-cell')!, (el.querySelector('dd')?.textContent ?? '').trim()])));

    await screen.getByRole('textbox', /^Variant/).fill('PAH p.Arg408Trp');
    await expect(screen.getByText('Optional refinements')).toBeVisible();
    const typed = await card();
    expect(await browser.locator('[data-testid="variant-breakdown"]').count(), 'only the parse ticket shows before a run').toBe(0);

    await screen.getByRole('button', 'Analyse variant').tap();
    await expect(screen.getByRole('region', 'Variant breakdown')).toBeVisible();
    const onset = await card();
    const first = await cellTexts();
    expect(first.residue, 'the typed residue is read at once').toContain('408');
    expect(first.gene).toContain('PAH');
    expect(onset.query, `the card grew at onset (${typed.query} → ${onset.query})`).toBeGreaterThan(typed.query + 40);
    expect(onset.recents, `Recent yields to it (${typed.recents} → ${onset.recents})`).toBeLessThan(typed.recents);
    await app.screenshot('breakdown-onset');

    // Wait for the transcript, the last identity field a protein-notation run resolves.
    await browser.evaluate(() => new Promise<string>(resolve => {
      const startedAt = Date.now();
      const poll = () => {
        const text = document.querySelector('[data-cell="transcript"] dd')?.textContent ?? '';
        if ((text && !text.includes('Resolving')) || Date.now() - startedAt > 120_000) resolve('done');
        else setTimeout(poll, 250);
      };
      poll();
    }));
    await settledBreakdown(browser);
    const done = await cellTexts();
    const settled = await card();
    expect(done.residue, 'the residue position and the protein length').toMatch(/^408 of \d+/);
    expect(done.uniprot).toContain('P00439');
    expect(done.transcript, 'a transcript, not the placeholder').not.toContain('Resolving');
    expect(done.build).toContain('GRCh38');
    expect(await browser.locator('[data-testid="variant-breakdown"] [data-state="pending"]').count(), 'nothing is left resolving once the run is over').toBe(0);
    expect(done.numbering, 'the substituted residue is checked against the protein sequence').toContain('Canonical');
    // The grid reserves every cell from the first frame, so values arriving do not move it. (The card itself may still
    // gain the "is loaded in the workspace" line and any notes under the grid.)
    expect(Math.abs(settled.grid - onset.grid) <= 1, `the grid keeps its height as values arrive (${onset.grid} → ${settled.grid})`).toBe(true);
    expect(settled.shareFloor, 'Recent still ends on the monitor floor').toBe(true);
    expect(settled.recents >= 176, `Recent keeps its 11rem floor (${settled.recents}px)`).toBe(true);
    await app.screenshot('breakdown-resolved');
  });

  test('a coordinate run resolves its gene and says which notation the protein change was read from', async ({ app, browser, screen }) => {
    await skipTour(browser);
    await browser.setViewport({ width: 1753, height: 981 });
    await app.open('/');
    const coordinate = 'Chr12(GRCh38):g.102840493G>A';
    await screen.getByRole('textbox', /^Variant/).fill(coordinate);
    await screen.getByRole('button', 'Analyse variant').tap();
    await expect(screen.getByRole('region', 'Variant breakdown')).toBeVisible();
    await settledBreakdown(browser);
    const cells = await browser.evaluate(() => Object.fromEntries(
      [...document.querySelectorAll('[data-testid="variant-breakdown"] [data-cell]')]
        .map(el => [el.getAttribute('data-cell')!, (el.querySelector('dd')?.textContent ?? '').trim()])));
    expect(cells.gene, 'the gene was resolved from the coordinate').toContain('PAH');
    expect(cells.change, 'the protein change names the coordinate it was read from').toContain(`read from ${coordinate}`);
    expect(cells.coordinate).toContain('12-102840493');
    await app.screenshot('breakdown-coordinate');
  });
});
