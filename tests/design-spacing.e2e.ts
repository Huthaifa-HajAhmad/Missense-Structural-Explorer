import { describe, beforeEach, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

/**
 * The search form's vertical rhythm and deck alignment (design review, six annotated marks).
 *
 * Measured at the width the review was annotated at (1876x1050), because every number here is a
 * rendered one: the reserved helper band, the two panels' bottom edges, and the 6px under a control
 * that only exists when the UniProt editor is open. The bounds carry slack for line-height rounding,
 * but each would fail on the defect it pins - the old value is named beside it.
 */

type Box = { x: number; y: number; width: number; height: number };

const box = async (locator: { boundingBox(): Promise<Box | null> }, what: string): Promise<Box> => {
  const b = await locator.boundingBox();
  if (!b) throw new Error(`${what} laid out no box`);
  return b;
};

describe('search form design rhythm', { tags: ['search'] }, () => {
  beforeEach(async ({ app, browser, screen }) => {
    await skipTour(browser);
    // The review's own width: two notation columns side by side.
    await browser.setViewport({ width: 1876, height: 1050 });
    await app.open('/');
  });

  test('gene and notation share a row and the coordinate field is absent', async ({ screen, app, browser }) => {
    const gene = await box(screen.getByRole('textbox', 'Gene symbol'), 'gene');
    const notation = await box(screen.getByRole('textbox', /^Protein or cDNA notation/), 'notation');
    expect(Math.abs(gene.y - notation.y) <= 1, 'the common fields share one row');
    await expect(screen.getByRole('textbox', /^Genomic coordinates/)).toHaveCount(0);
    await expect(screen.getByRole('textbox', /^UniProt accession/)).not.toBeVisible();
    expect(await browser.evaluate(() => { const form = document.querySelector('.workbench-query > form')!; return form.scrollHeight <= form.clientHeight + 1; }), 'the default form fits without internal scrolling').toBe(true);
    await expect(screen.getByRole('heading', 'Optional refinements')).toBeVisible();
    expect(await browser.evaluate(() => { const options = document.querySelector('.qe-options')!; return ['.qe-fields', '.qe-uniprot', '.workbench-ai'].every(selector => Boolean(options.querySelector(selector))) && getComputedStyle(options).backgroundColor !== getComputedStyle(document.querySelector('.workbench-query')!).backgroundColor; }), 'optional controls share one tinted box').toBe(true);
    expect(await browser.evaluate(() => { const card = document.querySelector('.workbench-query')!.getBoundingClientRect(); const options = document.querySelector('.qe-options')!.getBoundingClientRect(); return !document.querySelector('.workbench-query-footer') && Math.abs(card.bottom - options.bottom - 17) <= 2; }), 'the optional box ends with a consistent bottom inset and no footer').toBe(true);
    await app.screenshot('optional-query-box');
  });

  test('the main entry accepts coordinates and exposes their build', async ({ screen }) => {
    await screen.getByRole('textbox', /^Variant/).fill('16-66823281-T-C');
    await expect(screen.getByRole('combobox', 'Genome build this coordinate is expressed in')).toBeVisible();
    await expect(screen.getByRole('textbox', /^Genomic coordinates/)).toHaveCount(0);
  });

  test('the monitor aligns with the query heading and Recent analyses follows the form', async ({ screen, app, browser }) => {
    const form = await box(screen.getByRole('region', 'Variant query'), 'form card');
    const rail = await box(screen.getByRole('complementary', 'Services and pipeline'), 'services rail');
    const recent = await box(screen.getByRole('region', /recent analyses/i), 'recent analyses card');

    expect(Math.abs(form.y - rail.y) <= 1, 'query and monitor headings share a starting line');
    expect(await browser.evaluate(() => { const list = document.querySelector('.telemetry-scroll')!; const rows = list.querySelectorAll('.telemetry-service'); return rows.length === 10 && list.scrollHeight <= list.clientHeight + 1; }), 'all ten service rows fit without being hidden below FoldX').toBe(true);
    await browser.locator('.qe-uniprot > summary').tap();
    const railClosed = await box(screen.getByRole('complementary', 'Services and pipeline'), 'services rail, fields closed');
    expect(Math.abs(railClosed.height - rail.height) <= 1, 'collapsing fields does not resize the monitor');

    // The recent card is its own row, not the form column's tail.
    expect(recent.y > form.y + form.height, 'Recent analyses should start below the form card');
    expect(Math.abs(recent.x - form.x) <= 1, 'the cards share the left edge');

    await app.screenshot('02-deck');
  });

  test('the deck stacks in reading order below the breakpoint', async ({ screen, browser, app }) => {
    await browser.setViewport({ width: 720, height: 900 });
    await app.open('/');

    const form = await box(screen.getByRole('region', 'Variant query'), 'form card');
    const recent = await box(screen.getByRole('region', /recent analyses/i), 'recent analyses card');
    const rail = await box(screen.getByRole('complementary', 'Services and pipeline'), 'services rail');

    // Form, then the recents, then the rail: the order the old nesting produced, kept.
    expect(form.y + form.height < recent.y, 'the form closes above Recent analyses');
    expect(recent.y + recent.height < rail.y, 'Recent analyses closes above the rail');
  });

  test('the UniProt state sits in the label-row slot, above the field it describes', async ({ screen, app }) => {
    await screen.getByText(/^Protein reference/).tap();
    const input = screen.getByRole('textbox', /^UniProt accession/);
    // No reveal step beyond the parsed-fields disclosure: the input is a plain field once it is open.
    await expect(input).toBeVisible();
    await input.fill('Q9H8M5');

    const inputBox = await box(input, 'uniprot input');
    const status = await box(screen.getByText('Format OK'), 'uniprot state badge');

    // In the label row: it ends above the input's top edge, where "Set"/"Hide" used to be.
    expect(
      status.y + status.height <= inputBox.y + 1,
      `the state badge sits ${(status.y + status.height - inputBox.y).toFixed(1)}px into the field (should be above it)`
    );
    expect(status.y > 0, 'the badge is laid out');

    // And the slot's old occupant is gone.
    await expect(screen.getByRole('button', 'Set UniProt accession')).toHaveCount(0);
    await expect(screen.getByRole('button', 'Hide UniProt accession')).toHaveCount(0);

    await app.screenshot('03-uniprot-state');
  });

  test('both routes filled and agreeing states the route without an alarm', async ({ app, screen }) => {
    await screen.getByRole('textbox', /^Variant/).fill('16-66823281-T-C');
    await screen.getByRole('textbox', /^Protein or cDNA notation/).fill('p.Asp116Gly');

    await expect(
      screen.getByText('Using the coordinate; the protein/cDNA field is not analysed.')
    ).toBeVisible();
    // No alarm-styled card, and no button that would delete the input the run uses.
    await expect(screen.getByRole('button', 'Clear coordinate')).toHaveCount(0);

    await app.screenshot('04-both-routes-quiet');
  });
});

/**
 * The first-run tray (design review, three annotated marks): where the tour action belongs, and the two
 * defects in the benchmark tile's highlighted state - a top-only radius that read as a band cut off
 * mid-tile, and a tint whose left edge sat 1px from the gene label.
 */
describe('first-run tray design', { tags: ['search'] }, () => {
  beforeEach(async ({ app, browser }) => {
    await skipTour(browser);
    await browser.setViewport({ width: 1440, height: 900 });
    await app.open('/');
  });

  test('the tour action sits in the tray header, above the sentence and the benchmarks', async ({ app, browser }) => {
    const heading = await box(browser.locator('.workbench-recents-heading'), 'tray header');
    const tour = await box(browser.locator('.workbench-tour-link'), 'tour action');
    const sentence = await box(browser.locator('.workbench-recents-empty > div > p'), 'tray sentence');

    // In the header band: the slot "Clear history" takes once the tray is populated.
    expect(
      tour.y >= heading.y - 1 && tour.y + tour.height <= heading.y + heading.height + 1,
      `tour action spans ${tour.y.toFixed(1)}-${(tour.y + tour.height).toFixed(1)}px, outside the ${heading.y.toFixed(1)}-${(heading.y + heading.height).toFixed(1)}px header band`
    );
    // Right-aligned in it, not floating in the reading column.
    expect(
      heading.x + heading.width - (tour.x + tour.width) <= 32,
      `tour action ends ${(heading.x + heading.width - (tour.x + tour.width)).toFixed(1)}px from the header's right edge`
    );
    // And above the sentence, so "load a benchmark control" is the last thing read before the list.
    expect(
      tour.y + tour.height <= sentence.y + 1,
      `tour action ends at ${(tour.y + tour.height).toFixed(1)}px, inside the sentence at ${sentence.y.toFixed(1)}px`
    );

    await app.screenshot('05-tray-header');
  });

  test('the highlighted benchmark is one rounded surface, clear of its own text', async ({ app, browser, screen }) => {
    await screen.getByRole('button', 'Run benchmark PAH p.Arg408Trp').hover();

    const surface = await browser.evaluate(() => {
      const run = document.querySelector<HTMLButtonElement>('.workbench-benchmark > button')!;
      const style = getComputedStyle(run);
      const gene = run.querySelector<HTMLElement>('span > span')!;
      const radius = style.borderRadius.split(/[\s/]+/).filter(Boolean);
      return {
        radii: radius,
        background: style.backgroundColor,
        // The tint's own edge against the first glyph of the label.
        textInset: gene.getBoundingClientRect().left - run.getBoundingClientRect().left,
      };
    });

    // All four corners, or the band stops mid-tile against "Fill form only" (was 8px 8px 0 0).
    expect(
      new Set(surface.radii).size === 1 && parseFloat(surface.radii[0]) >= 6,
      `corner radii are ${surface.radii.join(' ')} (must be one value, at least 6px)`
    );
    expect(
      surface.background !== 'rgba(0, 0, 0, 0)' && surface.background !== 'transparent',
      'hovering the run action paints its surface'
    );
    // Room between the surface's left edge and the text it holds (was 1px).
    expect(
      surface.textInset >= 8,
      `the gene sits ${surface.textInset.toFixed(1)}px from the surface's left edge`
    );

    await app.screenshot('06-benchmark-hover');
  });
});
