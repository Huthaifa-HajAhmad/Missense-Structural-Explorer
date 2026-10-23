import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

// Populated fixtures exercise the production workspaces without submitting real analyses.
test('walk through populated workspaces in both themes', { tags: ['design'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 1000 });
  const capture = async (name: string) => {
    await expect(screen.getByRole('heading').first()).toBeVisible();
    await expect(screen.getByText(/^(Loading (frequency comparison|predictor comparison|stability comparison|feature contributions|residue distribution)|Preparing tissue comparison)/).first()).not.toBeVisible();
    await browser.evaluate(() => document.fonts.ready.then(() => true));
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} fits the page`);
    await app.screenshot(name + '-light');
    await screen.getByRole('button', 'Switch theme').tap();
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
