import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

/**
 * Where two surfaces meet there is one rule, not two (design review: two annotated redundant lines).
 * Measured as rendered borders, because the defect was a pair of 1px rules a few pixels apart.
 */

test('the parse ticket and the fields disclosure share one rule', { tags: ['search'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1753, height: 981 });
  await app.open('/');
  await screen.getByRole('textbox', /^Variant/).fill('NAE1 p.Asp116Gly');
  await expect(screen.getByText(/^Edit parsed fields/)).toBeVisible();
  const rules = await browser.evaluate(() => {
    const ticket = document.querySelector('.qe__ticket')!;
    const fields = document.querySelector('.qe-fields')!;
    return {
      ticketBottom: getComputedStyle(ticket).borderBottomWidth,
      fieldsTop: getComputedStyle(fields).borderTopWidth,
      adjacent: ticket.parentElement!.nextElementSibling === fields,
    };
  });
  expect(rules.adjacent, 'the disclosure follows the ticket').toBe(true);
  expect(
    [rules.ticketBottom, rules.fieldsTop].filter(width => width !== '0px').length,
    `ticket bottom ${rules.ticketBottom}, disclosure top ${rules.fieldsTop}`,
  ).toBe(1);
  await app.screenshot('single-rule-ticket');
});

test('a recognised line is not read back twice: the ticket shows it, the status stays for screen readers', { tags: ['search'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1753, height: 981 });
  await app.open('/');
  const line = screen.getByRole('textbox', /^Variant/);
  await line.fill('NAE1 p.Asp116Gly');
  await expect(screen.getByText(/^Edit parsed fields/)).toBeVisible();
  const read = () => browser.evaluate(() => {
    const status = document.getElementById('input-quick-entry-status')!;
    const box = status.getBoundingClientRect();
    return { text: status.textContent ?? '', visible: box.width > 2 && box.height > 2 };
  });
  const recognised = await read();
  expect(recognised.text, 'the live region still announces the reading').toContain('Reads as');
  expect(recognised.visible, 'but it is not drawn beside the ticket that shows the same values').toBe(false);

  await line.fill('NAE1');
  await expect(screen.getByText(/Add a protein change/)).toBeVisible();
  expect((await read()).visible, 'a hint that is not in the ticket stays visible').toBe(true);
});

test('the current recent row adds no box line against its neighbour\'s rule', { tags: ['search'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.addInitScript(() => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    localStorage.setItem('variant_search_history', JSON.stringify([
      { gene: 'NAE1', variant: 'p.Asp116Gly', query: 'NAE1 p.Asp116Gly' },
      { gene: 'PAH', variant: 'p.Arg408Trp', query: 'PAH p.Arg408Trp' },
      { gene: 'TP53', variant: 'p.Arg175His', query: 'TP53 p.Arg175His' },
    ]));
  });
  await browser.setViewport({ width: 1753, height: 981 });
  await app.open('/');
  await expect(screen.getByRole('heading', /^Recent analyses/)).toBeVisible();
  const visibleBorder = await browser.evaluate(() => {
    const row = document.querySelector<HTMLElement>('.workbench-recent')!;
    // The pressed state needs a live analysis to arise naturally (the store's gene and variant must match the entry); this
    // test pins the CSS the state selects, and VariantSearchPanel.test covers when it is set.
    row.setAttribute('aria-pressed', 'true');
    const style = getComputedStyle(row);
    return ['Top', 'Bottom'].map(side => `${style.getPropertyValue(`border-${side.toLowerCase()}-color`)}`);
  });
  expect(visibleBorder.every(color => color === 'rgba(0, 0, 0, 0)'), `current row border colours ${visibleBorder.join(' / ')}`).toBe(true);
  await app.screenshot('single-rule-recents');
});

test('the empty-state card is two-tone: white start half, accent topics half', { tags: ['shell'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open('/');
  await screen.getByRole('button', 'Population data', { exact: true }).tap();
  await expect(screen.getByText('No analysis loaded')).toBeVisible();
  const tones = () => browser.evaluate(() => {
    const background = (selector: string) => getComputedStyle(document.querySelector(selector)!).backgroundColor;
    // The accent is resolved through a probe, so the suite follows the token instead of restating its hex.
    const probe = document.createElement('div'); probe.style.background = 'var(--cs-accent-wash)'; document.body.append(probe);
    const accent = getComputedStyle(probe).backgroundColor; probe.remove();
    return { card: background('.analysis-empty-card'), topics: background('.analysis-empty-topics'), accent };
  });
  const light = await tones();
  expect(light.card, 'the card body stays white').toBe('rgb(255, 255, 255)');
  expect(light.topics, 'the topics half wears the accent token').toBe(light.accent);
  expect(light.topics, 'and the accent is a real second tone, not white').not.toBe(light.card);
  await app.screenshot('empty-state-light');
  await screen.getByRole('button', 'Switch to dark mode').tap();
  const dark = await tones();
  expect(dark.topics, 'dark mode: the topics half still wears the accent token').toBe(dark.accent);
  expect(dark.topics, 'and it stays distinct from the card').not.toBe(dark.card);
  await app.screenshot('empty-state-dark');
});
