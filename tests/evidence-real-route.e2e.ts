import { describe, beforeEach, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';
import { EVIDENCE_GUIDES, RESEARCH_GUIDES } from '../src/shared/researchGuides.js';

/**
 * The real route, not the preview harness: a benchmark is run from Search and the Evidence
 * workspace is entered through the sidebar. The three fixture-backed workspace tests pin values
 * from illustrative data; this file pins that every tab of a live analysis mounts, titles itself,
 * and offers its own "About" guide.
 *
 * Live: depends on Ensembl, ClinVar, UniProt and the other upstreams answering. Select with
 * `--tag live`. It asserts that a tab RENDERS its workspace, never an upstream's value, so a
 * changed gnomAD count cannot turn it red.
 */

// Sidebar button -> [workspace heading, EVIDENCE_GUIDES key]. The guide key ties each tab to the
// "About <title>" button the evidence card renders, so a tab that mounts another tab's body fails.
const EVIDENCE_TABS: Array<[button: string, heading: string, guide: string]> = [
  ['Population data', 'Population Data', 'clinical'],
  ['Gene–disease', 'Gene–disease', 'gene-disease'],
  ['Expression', 'Expression', 'expression-models'],
  ['Species & models', 'Species & models', 'species-models'],
  ['Functional domains', 'Functional domains', 'function'],
  ['In-silico predictors', 'Predictors', 'predictors'],
  ['AlphaGenome', 'AlphaGenome', 'alphagenome'],
  ['RNA splicing', 'RNA splicing', 'splicing'],
  ['Residue shifts & pockets', 'Residue shifts and pockets', 'structure'],
  ['Structural perturbation', 'Structural perturbation', 'perturbation'],
  ['Interfaces & PPI', 'Interfaces & PPI', 'interfaces'],
];

const aboutLabel = (guideKey: string): string => `About ${RESEARCH_GUIDES[EVIDENCE_GUIDES[guideKey]].title}`;

describe('real-route analysis views', { tags: ['live', 'evidence'], timeout: 240_000 }, () => {
  beforeEach(async ({ app, browser, screen }) => {
    await skipTour(browser);
    await app.open('/');
    await screen.getByRole('button', 'Run benchmark PAH p.Arg408Trp').tap();
    await expect(screen.getByRole('button', /^Evidence .*Complete$/)).toBeVisible({ timeout: 150_000 });
  });

  test('every Evidence tab mounts its own workspace from the sidebar', async ({ screen, app }) => {
    // The Evidence group's tabs are listed once it is open; opening the row works whether or not it starts open.
    await screen.getByRole('button', /^Evidence/).first().tap();
    for (const [button, heading, guide] of EVIDENCE_TABS) {
      await screen.getByRole('button', button).tap();
      await expect(screen.getByRole('heading', heading).first()).toBeVisible({ timeout: 30_000 });
      await expect(screen.getByRole('button', aboutLabel(guide))).toBeVisible();
    }
    // Evidence names the variant under analysis; MANE Select is the transcript a benchmark resolves to.
    await expect(screen.getByRole('group', 'Active variant')).toBeVisible();
    await expect(screen.getByText('NM_000277.3')).toBeVisible();
    await app.screenshot('evidence-last-tab');
  });

  test('the downstream views open on the analysed variant', async ({ screen }) => {
    // Each sidebar entry lands on a view that is no longer its empty state.
    const views: Array<[button: RegExp, heading: string]> = [
      [/^3D structure/, '3D structure'],
      [/^Energetics/, 'Energetics'],
      [/^Landscape/, 'Residue landscape'],
      [/^Insights/, 'Insights'],
      [/^Literature/, 'Literature'],
    ];
    for (const [button, heading] of views) {
      await screen.getByRole('button', button).first().tap();
      await expect(screen.getByRole('heading', heading).first()).toBeVisible({ timeout: 30_000 });
    }

    // Report with a completed analysis is not the "No report yet" empty state.
    await screen.getByRole('button', /^Report/).first().tap();
    await expect(screen.getByRole('heading', 'No report yet')).toHaveCount(0);
  });
});
