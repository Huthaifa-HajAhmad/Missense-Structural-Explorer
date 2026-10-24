import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

// Populated fixtures exercise the production workspaces without submitting real analyses.
test('walk through populated workspaces in both themes', { tags: ['design', 'shell'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 1000 });
  /* Two tones in both themes: every panel body is the primary surface, and a context panel is told
     apart by its header strip (the shared header wash), never by a darker body. */
  const checkSurfaces = async (name: string) => {
    expect(await browser.evaluate(() => {
      const workspace = document.querySelector('.exploration-workspace');
      if (!workspace) return 'no exploration workspace';
      const primary = workspace.querySelector(':scope > .data-screen-primary');
      if (!primary) return 'no primary panel';
      const rounded = (el: Element) => {
        const s = getComputedStyle(el);
        return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius]
          .every(r => parseFloat(r) >= 12);
      };
      const surface = getComputedStyle(primary).backgroundColor;
      if (!rounded(primary)) return 'primary corners are not all rounded';
      const inspector = workspace.querySelector(':scope > aside[data-workspace-inspector]');
      const rail = workspace.querySelector(':scope > aside[data-workspace-inspector-rail]');
      if (inspector) {
        if (getComputedStyle(inspector).backgroundColor !== surface) return 'inspector body is not the primary surface';
        const heading = inspector.querySelector('.inspector-heading');
        if (!heading) return 'inspector has no .inspector-heading strip';
        if (getComputedStyle(heading).backgroundColor === surface) return 'inspector heading lacks the header wash';
        if (!rounded(inspector)) return 'inspector corners are not all rounded';
      } else if (rail) {
        const r = getComputedStyle(rail);
        if (r.borderTopWidth !== '0px' || r.backgroundColor !== 'rgba(0, 0, 0, 0)') return 'collapsed rail is framed';
      }
      const literature = primary.querySelector('.lit-view');
      if (literature && getComputedStyle(literature).backgroundColor !== surface) return 'literature surface differs';
      return 'ok';
    }), `${name}: primary and context retain consistent surface roles`).toBe('ok');
  };
  const capture = async (name: string) => {
    await expect(screen.getByRole('heading').first()).toBeVisible();
    await expect(screen.getByText(/^(Loading (frequency comparison|predictor comparison|stability comparison|feature contributions|residue distribution)|Preparing tissue comparison)/).first()).not.toBeVisible();
    await browser.evaluate(() => document.fonts.ready.then(() => true));
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} fits the page`).toBe(true);
    await app.screenshot(name + '-light');
    await checkSurfaces(name);
    await screen.getByRole('button', 'Switch theme').tap();
    await checkSurfaces(name);
    await app.screenshot(name + '-dark');
    await screen.getByRole('button', 'Switch theme').tap();
  };
  await app.open('/tools/evidence-preview/index.html');
  for (const tab of ['Population Data', 'Predictors', 'Gene-disease', 'Expression', 'Species & models', 'RNA splicing', 'Functional domains', 'Residue shifts & pockets', 'Structural perturbation', 'AlphaGenome']) {
    await screen.getByRole('combobox', 'Evidence').selectOption(tab);
    await capture(tab.replace(/[^a-z0-9]+/gi, '-'));
  }
  await app.open('/tools/review-preview/index.html');
  for (const tab of ['Insights', 'Literature', 'Report']) {
    await screen.getByRole('combobox', 'Workspace').selectOption(tab);
    await capture(tab);
  }
  await app.open('/tools/energetics-preview/index.html');
  await capture('Energetics');
  await app.open('/tools/exploration-preview/index.html');
  await capture('Landscape');
  await screen.getByRole('button', 'Inspect in 3D').tap();
  await expect(screen.getByRole('heading', '3D structure', { exact: true })).toBeVisible();
  await capture('3D-structure');
});
