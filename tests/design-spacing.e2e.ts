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

  test('the refinements are one closed foot strip; open, gene, notation and UniProt share a row', async ({ screen, app, browser }) => {
    await expect(screen.getByText('Optional refinements')).toBeVisible();
    await expect(screen.getByRole('textbox', 'Gene symbol')).not.toBeVisible();
    expect(await browser.evaluate(() => { const form = document.querySelector('.workbench-query > form')!; return form.scrollHeight <= form.clientHeight + 1; }), 'the default form fits without internal scrolling').toBe(true);
    expect(await browser.evaluate(() => { const card = document.querySelector('.workbench-query')!.getBoundingClientRect(); const strip = document.querySelector('.qe-refine')!.getBoundingClientRect(); return !document.querySelector('.qe-options') && Math.abs(card.bottom - strip.bottom) <= 2; }), 'the strip is the card foot, flush with its bottom edge').toBe(true);

    await screen.getByText('Optional refinements').tap();
    const gene = await box(screen.getByRole('textbox', 'Gene symbol'), 'gene');
    const notation = await box(screen.getByRole('textbox', /^Protein or cDNA notation/), 'notation');
    const uniprot = await box(screen.getByRole('textbox', /^UniProt accession/), 'uniprot');
    expect(Math.abs(gene.y - notation.y) <= 1 && Math.abs(gene.y - uniprot.y) <= 1, 'the three fields share one row').toBe(true);
    await expect(screen.getByRole('textbox', /^Genomic coordinates/)).toHaveCount(0);
    await expect(screen.getByRole('textbox', 'AI Focus Area & Custom Analysis Instructions')).toBeVisible();
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
    await screen.getByText('Optional refinements').tap();
    // The strip's fields animate (field-sizing on the textarea); wait out the transition so the
    // measured height is the settled one a reader sees, not a frame mid-change.
    await browser.evaluate(() => new Promise<string>(r => setTimeout(() => r('settled'), 400)));
    const railOpen = await box(screen.getByRole('complementary', 'Services and pipeline'), 'services rail, refinements open');
    // The query card is content-sized, so an opened strip may grow the deck (the query carries the
    // surplus) — but the monitor never loses height; the load-bearing promise is the tab switch.
    expect(railOpen.height >= rail.height - 1, 'opening the refinements never shrinks the monitor').toBe(true);
    await screen.getByRole('tab', 'Pipeline').tap();
    const railPipeline = await box(screen.getByRole('complementary', 'Services and pipeline'), 'services rail, pipeline open');
    expect(Math.abs(railPipeline.height - railOpen.height) <= 1, `switching tabs changes the monitor not at all (${railOpen.height.toFixed(1)} vs ${railPipeline.height.toFixed(1)})`).toBe(true);

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
    await screen.getByText('Optional refinements').tap();
    const input = screen.getByRole('textbox', /^UniProt accession/);
    // No reveal step beyond the refinements strip: the input is a plain field once it is open.
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
    await screen.getByText('Optional refinements').tap();
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

  test('the tour action sits in the tray notice, below the header and above the benchmarks', async ({ app, browser, screen }) => {
    const heading = await box(browser.locator('.workbench-recents-heading'), 'tray header');
    const notice = await box(browser.locator('.workbench-notice'), 'tray notice');
    const tour = await box(browser.locator('.workbench-notice .workbench-tour-link'), 'tour action');
    const firstRow = await box(browser.locator('.workbench-benchmark').first(), 'first benchmark');

    await expect(screen.getByRole('heading', 'No recent analyses')).toBeVisible();
    expect(await browser.locator('.workbench-recents-heading .workbench-tour-link').count(), 'the header carries no tour action').toBe(0);
    expect(notice.y >= heading.y + heading.height - 1, 'the notice starts below the header band').toBe(true);
    expect(tour.x >= notice.x && tour.x + tour.width <= notice.x + notice.width + 1 && tour.y >= notice.y - 1 && tour.y + tour.height <= notice.y + notice.height + 1, 'the tour action sits inside the notice').toBe(true);
    expect(notice.y + notice.height <= firstRow.y + 1, 'the notice ends above the first benchmark').toBe(true);
    expect(firstRow.height >= 56, `benchmark rows are ${firstRow.height.toFixed(1)}px tall (at least 56)`).toBe(true);

    await app.screenshot('05-tray-notice');
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
