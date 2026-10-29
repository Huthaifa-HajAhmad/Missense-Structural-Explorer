import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

test('residue schematics retain a shared scale at desktop and phone widths', { timeout: 120_000 }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Residue shifts & pockets');
  await screen.getByRole('combobox', 'Example').selectOption('NAE1');
  await expect(screen.getByTestId('residue-glyph-pair')).toBeVisible();
  await expect(screen.getByText('No heavy side-chain atoms', { exact: true })).toBeVisible();
  for (const width of [1440, 390]) {
    await browser.setViewport({ width, height: 1000 });
    expect(await browser.evaluate(() => {
      const drawings = [...document.querySelectorAll('.rsx-glyph-svg')];
      const boxes = drawings.map(svg => svg.getBoundingClientRect());
      return drawings.length === 2 && drawings[0].getAttribute('viewBox') === drawings[1].getAttribute('viewBox') &&
        Math.abs(boxes[0].width - boxes[1].width) < 1 && boxes.every(box => box.height >= 160) &&
        document.documentElement.scrollWidth <= innerWidth;
    })).toBe(true);
    await app.screenshot(`residue-glyph-${width}`);
  }
  await browser.setViewport({ width: 1440, height: 1000 });
  await expect(screen.getByTestId('residue-marker-key')).toBeVisible();
  await screen.getByRole('button', { name: 'Polarity, less polar' }).click();
  await expect(screen.getByText('Pinned in inspector', { exact: true })).toBeVisible();
  await app.screenshot('residue-selection');
  await screen.getByRole('tab', 'Environment & pockets').click();
  // The records view names the substitution it reports on and does not redraw the schematic.
  await expect(screen.getByTestId('residue-context-line')).toBeVisible();
  await expect(screen.getByTestId('residue-environment')).toBeVisible();
  expect(await browser.evaluate(() => document.querySelectorAll('.rsx-glyph-svg').length)).toBe(0);
  await app.screenshot('residue-environment');
  await screen.getByRole('button', 'Switch theme').click();
  await app.screenshot('residue-dark');
});
