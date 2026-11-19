import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

// The FoldX Packing & geometry readings, moved from the retired Structural perturbation tab to Energetics.
test('Energetics shows Packing & geometry as its own view', { tags: ['design', 'shell'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 1000 });
  await app.open('/tools/mechanism-preview/index.html');
  await screen.getByRole('combobox', 'Example').selectOption('NAE1 packing');
  await screen.getByRole('combobox', 'Workspace').selectOption('energetics');
  await screen.getByRole('tab', 'Packing & geometry', { exact: true }).tap();
  await expect(screen.getByRole('heading', 'What changed in the modelled protein structure?')).toBeVisible();
  await expect(screen.getByText('Heavy-atom clashes: 3 → 5')).toBeVisible();
  await expect(screen.getByTestId('packing-readings')).toBeVisible();
  await expect(screen.getByText('Van der Waals clash term').first()).toBeVisible();
  // The language-model readings are gone from every view of the tab.
  expect(await browser.evaluate(() => /SaProt|ESM-2|ESMC|VESM/.test(document.body.innerText))).toBe(false);
  await app.screenshot('energetics-packing');
});
