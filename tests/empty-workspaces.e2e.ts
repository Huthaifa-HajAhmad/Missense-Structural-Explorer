import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

test('walk through empty analysis workspaces', { tags: ['design'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 1000 });
  await app.open('/');
  for (const view of ['Evidence', '3D structure', 'Energetics', 'Landscape', 'Insights', 'Literature', 'Report']) {
    await screen.getByRole('button', new RegExp('^' + view)).first().tap();
    await expect(screen.getByRole('heading', 'No analysis loaded')).toBeVisible();
    await expect(screen.getByRole('button', 'Analyse a variant', { exact: true })).toBeVisible();
    await app.screenshot('empty-' + view.replaceAll(' ', '-'));
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${view} fits the page`);
    await screen.getByRole('button', 'Switch to dark mode').tap();
    await app.screenshot('empty-' + view.replaceAll(' ', '-') + '-dark');
    await screen.getByRole('button', 'Switch to light mode').tap();
    await screen.getByRole('button', 'Analyse a variant', { exact: true }).tap();
    await expect(screen.getByRole('textbox', /^Variant/)).toBeFocused();
  }
  await screen.getByRole('button', /^Evidence/).first().tap();
  for (const label of ['Population data', 'Gene–disease', 'Expression', 'Species & models', 'Functional domains', 'In-silico predictors', 'AlphaGenome', 'RNA splicing', 'Residue shifts & pockets', 'Structural perturbation', 'Interfaces & PPI']) {
    await screen.getByRole('button', label, { exact: true }).tap();
    await expect(screen.getByRole('heading', label, { exact: true })).toBeVisible();
    await expect(screen.getByRole('heading', 'No analysis loaded')).toBeVisible();
  }
  await browser.setViewport({ width: 390, height: 844 });
  await expect(screen.getByRole('button', 'Open navigation')).toBeVisible();
  await browser.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))).then(() => true));
  await expect(screen.getByRole('heading', 'Interfaces & PPI')).toBeVisible();
  expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'empty workspace fits mobile');
  await app.screenshot('empty-mobile');
  await screen.getByRole('button', 'Analyse a variant', { exact: true }).tap();
  await expect(screen.getByRole('textbox', /^Variant/)).toBeFocused();
});
