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

test('GATA4 names only its own atoms and shows a readable distant pocket at phone width', { timeout: 120_000 }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Residue shifts & pockets');
  await screen.getByRole('combobox', 'Example').selectOption('GATA4');
  await screen.getByRole('tab', 'Residue comparison').click();
  // Ser to Cys has no atom beyond CB, OG and SG, so the drawing's atom titles must not name any other.
  const titles = await browser.evaluate(() => [...document.querySelectorAll('.rsx-glyph-svg title')].map(t => t.textContent).join('|'));
  expect(titles).toContain('OG = gamma oxygen');
  expect(titles).toContain('SG = gamma sulfur');
  expect(/CD|CE|CZ|NE|NH/.test(titles)).toBe(false);
  await expect(screen.getByTestId('residue-marker-key')).toContainText('Arrow: direction of the change');
  const charge = screen.getByRole('button', { name: /^Net charge/ });
  await expect(charge).toContainText('No change');
  await expect(charge).toContainText('0 = 0');
  await screen.getByRole('tab', 'Environment & pockets').click();
  for (const width of [1440, 390]) {
    await browser.setViewport({ width, height: 1000 });
    await expect(screen.getByTestId('pocket-strip-key')).toContainText('80.7 Å to the cavity centre');
    await expect(screen.getByTestId('pocket-strip-key')).toContainText('4, 8, 12 Å cut-points');
    await browser.evaluate(() => {
      document.querySelector('[data-testid="pocket-distance-strip"]')!.scrollIntoView({ block: 'center' });
      return true;
    });
    expect(await browser.evaluate(() => {
      const strip = document.querySelector('[data-testid="pocket-distance-strip"]')!;
      const bounds = strip.getBoundingClientRect();
      const labels = [...strip.querySelectorAll('.rsx-pocket-strip__axis-tick')].map(el => el.getBoundingClientRect());
      return document.documentElement.scrollWidth <= innerWidth && strip.scrollWidth <= strip.clientWidth &&
        labels.every((box, i) => box.left >= bounds.left && box.right <= bounds.right && (!i || labels[i - 1].right < box.left));
    })).toBe(true);
    await app.screenshot(`gata4-pocket-${width}`);
  }
});
