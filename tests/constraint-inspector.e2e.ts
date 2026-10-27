import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

// Live: needs a real analysis for the gene-constraint strip. Select with `--tag live` or `--tag constraint`.
// The strip's readings open a card (click or keyboard focus); the card hands the reading to the
// inspector rail, which Back returns to the page.
test('a constraint reading opens its card, then borrows the inspector rail and gives it back', { tags: ['live', 'constraint'], timeout: 180_000 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1600, height: 1000 });
  await app.open('/');
  await screen.getByRole('button', 'Run benchmark PAH p.Arg408Trp').tap();
  await expect(screen.getByRole('button', /^Evidence .*Complete$/)).toBeVisible({ timeout: 120_000 });
  await screen.getByRole('button', 'Population data').tap();

  const chip = screen.getByRole('button', /^LOEUF/);
  await expect(chip).toBeVisible();
  await expect(screen.getByRole('button', /^Details/)).toHaveCount(0);

  await chip.tap();
  await expect(chip).toHaveAttribute('aria-expanded', 'true');
  const card = screen.getByTestId('constraint-card');
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', 'Open in inspector')).toBeVisible();
  // Pressing on the card's own (non-focusable) text must not close it: Chromium moves focus to
  // <body> on that press, which would blur the chip and take the card away under the pointer.
  await card.getByText('0.36 · 0.45').tap();
  await expect(screen.getByTestId('constraint-card')).toBeVisible();
  // The card sits under its own chip, not at the strip's far edge.
  const placement = await browser.evaluate(() => {
    const c = document.querySelector('[data-testid="constraint-card"]')!.getBoundingClientRect();
    const b = document.querySelector('[data-constraint-chip="loeuf"]')!.getBoundingClientRect();
    return { dx: Math.abs(c.left - b.left), below: c.top >= b.bottom };
  });
  expect(placement.below).toBe(true);
  expect(placement.dx).toBeLessThan(40);
  await app.screenshot('constraint-card-loeuf');

  await card.getByRole('button', 'Open in inspector').tap();
  const view = screen.getByRole('region', 'Gene constraint reference ranges');
  await expect(view).toBeVisible();
  await expect(chip).toHaveAttribute('data-inspected', 'true');
  await expect(view.getByText('Where the cut-points come from')).toBeVisible();
  await app.screenshot('constraint-inspector-loeuf');

  await screen.getByRole('button', /^Back to /).tap();
  await expect(screen.getByRole('region', 'Gene constraint reference ranges')).toHaveCount(0);
  await expect(chip).not.toHaveAttribute('data-inspected', 'true');
  await app.screenshot('constraint-rail-returned');

  // Keyboard: Escape closes a card opened by a click and focus stays on the chip.
  await chip.tap();
  await expect(screen.getByTestId('constraint-card')).toBeVisible();
  await chip.press('Escape');
  await expect(screen.getByTestId('constraint-card')).toHaveCount(0);

  // Narrower strips: the card stays inside the strip, and a resize closes it rather than leaving
  // it pointing at the wrong reading.
  for (const width of [1100, 900]) {
    await browser.setViewport({ width, height: 1000 });
    await screen.getByRole('button', /^Regional O\/E/).tap();
    await expect(screen.getByTestId('constraint-card')).toBeVisible();
    const fit = await browser.evaluate(() => {
      const c = document.querySelector('[data-testid="constraint-card"]')!.getBoundingClientRect();
      const s = document.querySelector('.variant-header')!.getBoundingClientRect();
      return { inside: c.left >= s.left - 0.5 && c.right <= s.right + 0.5 };
    });
    expect(fit.inside).toBe(true);
    // The card fades in over 120ms; the frame is taken once it is opaque, and it must end opaque.
    const settled = await browser.evaluate(async () => {
      const card = document.querySelector('[data-testid="constraint-card"]')!;
      await new Promise((resolve) => setTimeout(resolve, 300));
      return getComputedStyle(card).opacity;
    });
    expect(settled).toBe('1');
    await app.screenshot(`constraint-card-regional-${width}`);
    await browser.setViewport({ width: width - 100, height: 1000 });
    await expect(screen.getByTestId('constraint-card')).toHaveCount(0);
  }
  await browser.setViewport({ width: 1600, height: 1000 });

  // Dark mode reads the same palette.
  await screen.getByRole('button', 'Switch to dark mode').tap();
  await screen.getByRole('button', /^Regional O\/E/).tap();
  await expect(screen.getByTestId('constraint-card')).toBeVisible();
  await app.screenshot('constraint-card-regional-dark');
});
