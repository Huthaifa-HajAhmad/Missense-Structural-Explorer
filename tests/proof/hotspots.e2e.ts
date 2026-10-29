import { describe, beforeEach, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from '../support.js';

// Proof run for the Hotspots subtab, the Interfaces atlas and the 3D canvas guide, on SOD1 p.Ala5Val (the
// densest real case): doc/FUNCTIONAL_HOTSPOTS_PLAN.md §0. Live: needs ClinVar/gnomAD, CSpec and AlphaFold DB.
describe('hot-spot proof', { tags: ['live', 'proof'], timeout: 360_000 }, () => {
  beforeEach(async ({ app, browser }) => {
    await skipTour(browser);
    await app.open('/');
  });

  test('Hotspots, Interfaces and the canvas guide render for SOD1 p.Ala5Val', async ({ screen, app }) => {
    await screen.getByRole('textbox', 'Variant').fill('SOD1 p.Ala5Val');
    await screen.getByRole('button', 'Analyse variant').tap();
    await expect(screen.getByRole('button', /^Evidence .*Complete/)).toBeVisible({ timeout: 240_000 });

    await screen.getByRole('button', 'Functional domains').tap();
    await screen.getByRole('tab', 'Hotspots').tap();
    await expect(screen.getByTestId('hotspots-finding')).toBeVisible({ timeout: 120_000 });
    // Six definitions, each with its grade; the 3D score is shown because SOD1's clustering gate passes.
    const view = screen.getByTestId('hotspots-view');
    await expect(view.getByText('Expert specification')).toBeVisible();
    await expect(view.getByText('Published method, benchmarked here')).toBeVisible();
    // The rail traces the same definitions while this view is open.
    await expect(screen.getByTestId('function-rail-hotspots')).toBeVisible();
    await expect(view.getByText(/^PathProx [+-]/)).toBeVisible();
    await expect(screen.getByTestId('hotspots-pm1')).toBeVisible();
    await app.screenshot('hotspots');
    await screen.getByTestId('hotspot-rung-spatial').scrollIntoView();
    await app.screenshot('hotspots-rungs');
    await screen.getByTestId('hotspots-table').scrollIntoView();
    await app.screenshot('hotspots-table');

    await screen.getByTestId('hotspots-show-all-3d').tap();
    await expect(screen.getByTestId('structure-guide-card')).toBeVisible({ timeout: 120_000 });
    // The banner above the canvas and the guide card on it both name the set; the card keys it with its colour.
    await expect(screen.getByTestId('structure-guide-card').getByText(/^ClinVar P\/LP missense residues, germline/)).toBeVisible();
    await screen.getByTestId('structure-guide-card').scrollIntoView();
    await app.screenshot('structure-guide');

    await screen.getByRole('button', /^Evidence/).first().tap();
    await screen.getByRole('button', 'Interfaces & PPI').tap();
    await expect(screen.getByRole('heading', 'Interfaces & PPI').first()).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByTestId('interface-track')).toBeVisible({ timeout: 120_000 });
    await app.screenshot('interfaces');
    await screen.getByTestId('interface-track').scrollIntoView();
    await app.screenshot('interfaces-track');
  });
});
