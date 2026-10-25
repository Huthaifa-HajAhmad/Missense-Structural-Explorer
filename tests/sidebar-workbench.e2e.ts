import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

test('sidebar groups, resizing, collapse and mobile navigation', { tags: ['navigation'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 1000 });
  await app.open('/');
  // A closed drawer is inert and slid fully off-screen; read that from the DOM, since the locator still resolves its controls.
  const drawerClosed = () => browser.evaluate(async () => {
    const rail = document.querySelector('aside.ms-root')!;
    const read = () => `${rail.getAttribute('data-drawer')}/${rail.getBoundingClientRect().right <= 0 ? 'offscreen' : 'onscreen'}/${rail.hasAttribute('inert')}`;
    for (let i = 0; i < 40 && read() !== 'closed/offscreen/true'; i++) await new Promise(r => setTimeout(r, 100));
    return read();
  });
  const settle = () => browser.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))).then(() => true));
  // The open counterpart of drawerClosed: visible, on-screen and still interactive.
  const drawerOpened = () => browser.evaluate(async () => {
    const rail = document.querySelector('aside.ms-root')!;
    const rect = () => rail.getBoundingClientRect();
    const read = () => `${rail.getAttribute('data-drawer')}/${rect().left >= 0 && rect().right > 0 ? 'onscreen' : 'offscreen'}/${rail.hasAttribute('inert') ? 'inert' : 'live'}`;
    for (let i = 0; i < 40 && read() !== 'open/onscreen/live'; i++) await new Promise(r => setTimeout(r, 100));
    return read();
  });
  // The header trigger exposes aria-controls/aria-expanded, so real focus
  // place-keeping is assertable here (it was invisible to the old assertions).
  const activeElementIsTrigger = () => browser.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.getAttribute?.('aria-controls') === 'main-navigation' && el.getAttribute('aria-expanded') !== null;
  });
  // The groups are always listed: nothing has opened Evidence yet, and its pages are already there.
  await expect(screen.getByRole('button', 'Interfaces & PPI', { exact: true })).toBeVisible();
  await expect(screen.getByRole('button', 'AlphaFold2', { exact: true })).toBeVisible();
  await screen.getByRole('button', 'Evidence', { exact: true }).tap();
  await expect(screen.getByRole('heading', /^Population data/i)).toBeVisible();
  // A parent is a link, not a toggle: pressing it again neither collapses the group nor announces a state.
  await screen.getByRole('button', 'Evidence', { exact: true }).tap();
  await expect(screen.getByRole('button', 'Interfaces & PPI', { exact: true })).toBeVisible();
  expect(await browser.evaluate(() => document.querySelector('.ms-nav-btn[data-view="evidence"]')!.hasAttribute('aria-expanded')), 'a parent row is not a disclosure').toBe(false);
  await screen.getByRole('button', 'Interfaces & PPI', { exact: true }).tap();
  await expect(screen.getByRole('heading', 'Interfaces & PPI')).toBeVisible();
  await settle();
  expect(await browser.evaluate(() => {
    const list = document.getElementById('ms-children-evidence')!.getBoundingClientRect();
    return [...document.querySelectorAll('#ms-children-evidence button')].every(button => button.getBoundingClientRect().bottom <= list.bottom + 1);
  }), 'all Evidence links fit inside the expanded group');
  await app.screenshot('sidebar-expanded');
  await screen.getByRole('button', 'Switch to dark mode').tap();
  await app.screenshot('sidebar-dark');
  await screen.getByRole('separator', 'Resize sidebar').press('End');
  await settle();
  await screen.getByRole('separator', 'Resize sidebar').press('Home');
  await settle();
  // Re-widen and KEEP the wide value: the drawer clamp below only bites against a
  // persisted rail wider than a phone viewport.
  await screen.getByRole('separator', 'Resize sidebar').press('End');
  await settle();
  await screen.getByRole('button', 'Collapse sidebar').tap();
  await settle();
  await expect(screen.getByRole('button', /^Expand sidebar/)).toBeVisible();
  await screen.getByRole('button', 'Energetics', { exact: true }).tap();
  await expect(screen.getByRole('heading', 'Energetics', { exact: true })).toBeVisible();
  await app.screenshot('sidebar-collapsed');
  await screen.getByRole('button', /^Expand sidebar/).tap();
  await browser.setViewport({ width: 390, height: 844 });
  await expect(screen.getByRole('button', 'Open navigation')).toBeVisible();
  await settle();
  await screen.getByRole('button', 'Open navigation').tap();
  await screen.getByRole('button', 'RNA splicing', { exact: true }).scrollIntoView();
  await app.screenshot('sidebar-mobile');
  await screen.getByRole('button', 'RNA splicing', { exact: true }).tap();
  await expect(screen.getByRole('heading', 'RNA splicing')).toBeVisible();
  await settle();
  expect(await drawerClosed(), 'the drawer closes after a pick').toBe('closed/offscreen/true');
  // Prove the drawer actually opened before Escape: the role locator resolves controls
  // inside a closed, hidden drawer, so without this guard a broken open path would let
  // the Escape assertion pass with a drawer that was never open.
  await screen.getByRole('button', 'Open navigation').tap();
  expect(await drawerOpened(), 'the drawer opens from the header trigger').toBe('open/onscreen/live');
  await screen.getByRole('button', 'Close navigation').press('Escape');
  await settle();
  expect(await drawerClosed(), 'Escape closes the drawer').toBe('closed/offscreen/true');
  expect(await activeElementIsTrigger(), 'focus returns to the header trigger after verifying Escape').toBe(true);
  // The width cap must survive a persisted wide rail: drawer mode drops the inline
  // min-width, so max-inline-size actually bounds the drawer on phones.
  await browser.setViewport({ width: 320, height: 800 });
  await screen.getByRole('button', 'Open navigation').tap();
  expect(await drawerOpened(), 'the drawer opens from the header trigger at 320px').toBe('open/onscreen/live');
  // drawerOpened fires while the slide is still finishing (`left >= 0` is true ~8px
  // before the transform settles); let the transition finish before measuring geometry.
  await settle();
  const frame = await browser.evaluate(() => {
    const rect = document.querySelector('aside.ms-root')!.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: window.innerWidth };
  });
  expect(frame.left >= 7.5, 'drawer keeps the shell inset at a 320px viewport').toBe(true);
  expect(frame.right <= frame.viewport - 47.5, 'drawer stays capped so a dismissal scrim survives').toBe(true);
});
