import { describe, beforeEach, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

// Sidebar views that render without an analysis loaded, and the heading each one lands on.
const VIEWS: Array<[button: RegExp, heading: string]> = [
  [/^3D structure/, '3D structure'],
  [/^Energetics/, 'Energetics'],
  [/^Landscape/, 'Residue landscape'],
  [/^Insights/, 'Insights'],
  [/^Literature/, 'Literature'],
  [/^Report/, 'No report yet'],
  [/^About/, 'About Missense & Fold'],
];

describe('sidebar navigation', { tags: ['navigation'] }, () => {
  beforeEach(async ({ app, browser }) => {
    await skipTour(browser);
    await app.open('/');
  });

  for (const [button, heading] of VIEWS) {
    test(`opens ${heading}`, async ({ screen }) => {
      await screen.getByRole('button', button).first().tap();
      await expect(screen.getByRole('heading', heading).first()).toBeVisible();
    });
  }

  test('returns to Search from another view', async ({ screen }) => {
    await screen.getByRole('button', /^About/).tap();
    await screen.getByRole('button', /^Search/).first().tap();
    await expect(screen.getByRole('heading', 'Analyse a variant')).toBeVisible();
  });
});
