import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

// The existing geometry page mounts production components with documented SOD1 fixtures.
test('landscape geometry and keyboard substitution inspection', { tags: ['landscape'], timeout: 120_000 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 1000 });
  await app.open('/tools/landscape-geometry/index.html');
  await expect(browser.locator('#geometry-report')).toContainText('harness: no console errors');
  const report = await browser.evaluate(() => JSON.parse(decodeURIComponent(escape(atob(document.getElementById('geometry-result')!.textContent!)))));
  expect(report.checks.filter((check: { pass: boolean }) => !check.pass)).toEqual([]);
  expect(report.checks.length).toBe(38);
  const chip = browser.locator('#case-rail-wide .lsr-strip__chip').filter({ hasText: 'S' }).first();
  await chip.press('Enter');
  await expect(browser.locator('#case-rail-wide .lsr-selection-heading')).toContainText('Inspected substitution');
  await expect(browser.locator('#case-rail-wide .lsr-selection-heading')).toContainText('A5S');
  await browser.locator('#case-rail-wide .lsr-return').press('Enter');
  await expect(browser.locator('#case-rail-wide .lsr-selection-heading')).toContainText('Queried substitution');
  await expect(browser.locator('#case-rail-wide .lsr-selection-heading')).toContainText('A5V');
  await browser.locator('#case-tab .ls-span-track__span').first().press('Enter');
  await expect(browser.locator('#case-tab .ls-span-track__detail').first()).toContainText('Cu/Zn superoxide dismutase');
  await browser.locator('#case-tab button').filter({ hasText: 'O/E 0.41' }).press('Enter');
  await expect(browser.locator('#case-tab .ls-span-track__detail').last()).toContainText('O/E 0.414141');
  const missing = browser.locator('#case-tab [data-tone="missing"]');
  await missing.press('Enter');
  await expect(browser.locator('#case-tab .ls-span-track__detail').last()).toContainText('O/E not reported');
  expect(await browser.evaluate(() => {
    const missing = document.querySelector('#case-tab [data-tone="missing"]')!;
    return getComputedStyle(missing.querySelector(".ls-span-track__visual")!).backgroundImage.includes('repeating-linear-gradient');
  })).toBe(true);
  await browser.locator('#case-tab button[aria-label^="Illustrative overlapping annotation"]').press('Enter');
  await expect(browser.locator('#case-tab .ls-span-track__detail').first()).toContainText('deliberately long name');
  expect(await browser.evaluate(() => {
    const spans = [...document.querySelectorAll<HTMLElement>('#case-tab .ls-span-track__span')];
    return spans.length > 0 && spans.every(span => {
      const rect = span.getBoundingClientRect();
      return rect.width >= 24 && rect.height >= 24;
    });
  })).toBe(true);
  expect(await browser.evaluate(() => {
    const focus = document.querySelector('[aria-label="Focus window"]')!;
    const spans = [...focus.querySelectorAll('.ls-span-track__span')];
    const first = spans[0].getBoundingClientRect();
    const second = spans[1].getBoundingClientRect();
    return spans.length >= 2 && second.top >= first.bottom;
  })).toBe(true);
  await browser.locator('#case-tab button[aria-label^="Illustrative one-residue"]').press('Enter');
  await expect(browser.locator('#case-tab .ls-span-track__detail').first()).toContainText('one-residue');
  await app.screenshot('landscape-tracks-and-inspector');
  await browser.setViewport({ width: 390, height: 844 });
  // The geometry page has a fixed-width outer frame; resize its production overview to test a narrow slot.
  await browser.evaluate(async () => {
    const overview = document.querySelector<HTMLElement>('#case-tab .ls-overview')!;
    overview.style.inlineSize = '350px';
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
    return true;
  });
  await expect(browser.locator('#case-tab .ls-overview')).toBeVisible();
  expect(await browser.evaluate(() => {
    const overview = document.querySelector('#case-tab .ls-overview')!;
    return [...overview.querySelectorAll('.ls-span-track__span')].every(span => span.getBoundingClientRect().right <= overview.getBoundingClientRect().right + 1);
  })).toBe(true);
  expect(await browser.evaluate(() => [...document.querySelectorAll<HTMLElement>('#case-tab .ls-overview__label')]
    .every(label => label.scrollWidth <= label.clientWidth + 1))).toBe(true);
  await app.screenshot('landscape-narrow-track');
});
