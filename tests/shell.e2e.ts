import { describe, beforeEach, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

describe('app shell controls', { tags: ['shell'] }, () => {
  beforeEach(async ({ app, browser }) => {
    await skipTour(browser);
    await app.open('/');
  });

  test('theme toggle flips between dark and light', async ({ screen }) => {
    await screen.getByRole('button', 'Switch to dark mode').tap();
    await expect(screen.getByRole('button', 'Switch to light mode')).toBeVisible();
    await screen.getByRole('button', 'Switch to light mode').tap();
    await expect(screen.getByRole('button', 'Switch to dark mode')).toBeVisible();
  });

  test('sidebar collapses and expands', async ({ screen }) => {
    await screen.getByRole('button', 'Collapse sidebar').tap();
    await expect(screen.getByRole('button', /^Expand sidebar/)).toBeVisible();
    await screen.getByRole('button', /^Expand sidebar/).tap();
    await expect(screen.getByRole('button', 'Collapse sidebar')).toBeVisible();
  });

  test('settings opens from the header', async ({ screen }) => {
    await screen.getByRole('button', 'Open settings').tap();
    await expect(screen.getByRole('dialog').first()).toBeVisible();
  });
});
