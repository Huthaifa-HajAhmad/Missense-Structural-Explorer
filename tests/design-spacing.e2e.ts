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
    // The review's own width: two notation columns side by side, examples on one line.
    await browser.setViewport({ width: 1876, height: 1050 });
    await app.open('/');
    // The parsed fields live behind the quick-entry disclosure; the rhythm below is the open form's.
    await screen.getByText(/^Edit parsed fields/).tap();
  });

  test('the reserved helper band costs nothing when no column shows a hint', async ({ screen, app }) => {
    const gene = screen.getByRole('textbox', 'Gene symbol');
    const protein = screen.getByRole('textbox', /^Protein or cDNA notation/);
    const genomic = screen.getByRole('textbox', /^Genomic coordinates/);

    const geneBox = await box(gene, 'gene input');
    const proteinBox = await box(protein, 'protein input');
    const genomicBox = await box(genomic, 'coordinate input');

    // Was a reserved-but-empty 32px helper band plus the row gap: 80px from one control to the next.
    const rowGap = proteinBox.y - (geneBox.y + geneBox.height);
    expect(rowGap < 60, `gene-to-protein control gap is ${rowGap.toFixed(1)}px (was ~80, target ~48)`);

    // The reservation's whole purpose: the two columns' row 2 shares a baseline, whatever hints show.
    expect(
      Math.abs(proteinBox.y - genomicBox.y) <= 1,
      `row 2 is ${Math.abs(proteinBox.y - genomicBox.y).toFixed(1)}px out of alignment across columns`
    );

    // One line for the disclosure, with the chip it belongs to (it used to sit a whole row lower).
    const chip = await box(
      screen.getByRole('button', 'Use example p.Arg408Trp in the Variant notation field'),
      'protein example chip'
    );
    const more = await box(screen.getByText('More protein & cDNA formats'), 'example disclosure');
    expect(
      Math.abs(more.y - chip.y) <= 6,
      `example chip and its disclosure are ${Math.abs(more.y - chip.y).toFixed(1)}px apart vertically (should share a line)`
    );

    await app.screenshot('01-form-rhythm');

    // The open panel takes the full row, so its chips lay out across the column instead of stacking
    // under the disclosure's own text width.
    const chips = screen.getByRole('button', /in the Variant notation field$/);
    const before = await chips.count();
    await screen.getByText('More protein & cDNA formats').tap();
    expect((await chips.count()) > before, 'the disclosure reveals more examples');
    await app.screenshot('01b-examples-open');
  });

  test('a hint is paid for only while it is shown, and never misaligns the columns', async ({ screen }) => {
    // A coordinate makes the build row explainable: one line of helper text, reserved in BOTH columns.
    await screen.getByRole('textbox', /^Genomic coordinates/).fill('16-66823281-T-C');

    const protein = await box(screen.getByRole('textbox', /^Protein or cDNA notation/), 'protein input');
    const genomic = await box(screen.getByRole('textbox', /^Genomic coordinates/), 'coordinate input');
    expect(
      Math.abs(protein.y - genomic.y) <= 1,
      `row 2 drifted ${Math.abs(protein.y - genomic.y).toFixed(1)}px while one column showed a hint`
    );
  });

  test('the monitor aligns with the query heading and Recent analyses follows the form', async ({ screen, app }) => {
    const form = await box(screen.getByRole('region', 'Variant query'), 'form card');
    const rail = await box(screen.getByRole('complementary', 'Services and pipeline'), 'services rail');
    const recent = await box(screen.getByRole('region', /recent analyses/i), 'recent analyses card');

    expect(Math.abs(form.y - rail.y) <= 1, 'query and monitor headings share a starting line');
    expect(Math.abs(rail.y + rail.height - recent.y - recent.height) <= 1, 'the monitor ends at the bottom of recents');
    await screen.getByText(/^Edit parsed fields/).tap();
    const railClosed = await box(screen.getByRole('complementary', 'Services and pipeline'), 'services rail, fields closed');
    const recentsClosed = await box(screen.getByRole('region', /recent analyses/i), 'recents, fields closed');
    expect(Math.abs(railClosed.y + railClosed.height - recentsClosed.y - recentsClosed.height) <= 1, 'the monitor still meets recents after closing the editors');

    // The recent card is its own row, not the form column's tail.
    expect(recent.y > form.y + form.height, 'Recent analyses should start below the form card');
    expect(Math.abs(recent.x - form.x) <= 1, 'the cards share the left edge');

    await app.screenshot('02-deck');
  });

  test('the deck stacks in reading order below the breakpoint', async ({ screen, browser, app }) => {
    await browser.setViewport({ width: 720, height: 900 });
    await app.open('/');
    await screen.getByText(/^Edit parsed fields/).tap();

    const form = await box(screen.getByRole('region', 'Variant query'), 'form card');
    const recent = await box(screen.getByRole('region', /recent analyses/i), 'recent analyses card');
    const rail = await box(screen.getByRole('complementary', 'Services and pipeline'), 'services rail');

    // Form, then the recents, then the rail: the order the old nesting produced, kept.
    expect(form.y + form.height < recent.y, 'the form closes above Recent analyses');
    expect(recent.y + recent.height < rail.y, 'Recent analyses closes above the rail');
  });

  test('the UniProt state sits in the label-row slot, above the field it describes', async ({ screen, app }) => {
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
    await screen.getByRole('textbox', /^Genomic coordinates/).fill('16-66823281-T-C');
    await screen.getByRole('textbox', /^Protein or cDNA notation/).fill('p.Asp116Gly');

    await expect(
      screen.getByText('Using the coordinate; the protein/cDNA field is not analysed.')
    ).toBeVisible();
    // No alarm-styled card, and no button that would delete the input the run uses.
    await expect(screen.getByRole('button', 'Clear coordinate')).toHaveCount(0);

    await app.screenshot('04-both-routes-quiet');
  });
});
