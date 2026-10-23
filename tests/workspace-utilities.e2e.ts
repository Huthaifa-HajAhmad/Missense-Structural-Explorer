import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';
import { TOUR_STEPS } from '../src/components/modals/OnboardingModal';

test('utility workspaces and overlays remain reachable in both themes', { tags: ['shell'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open('/');
  const capture = async (name: string) => {
    await browser.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations()
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
      return true;
    });
    await app.screenshot(name);
  };
  for (const theme of ['light', 'dark']) {
    await screen.getByRole('button', /^Console/).first().tap();
    await expect(screen.getByRole('heading', 'Console', { exact: true })).toBeVisible();
    await expect(screen.getByRole('tablist', 'Console streams')).toBeVisible();
    await capture(`console-${theme}`);
    await screen.getByRole('button', /^About/).first().tap();
    await expect(screen.getByRole('heading', 'About Missense & Fold')).toBeVisible();
    await capture(`about-${theme}`);
    await screen.getByRole('button', /^Search views or run a variant/).tap();
    await expect(screen.getByRole('dialog', 'Command palette')).toBeVisible();
    await capture(`palette-${theme}`);
    await screen.getByRole('dialog', 'Command palette').press('Escape');
    await screen.getByRole('button', 'Take the tour', { exact: true }).first().tap();
    await expect(browser.locator('[data-testid="onboarding-tour"]')).toBeVisible();
    await capture(`tour-${theme}`);
    await browser.locator('[data-testid="onboarding-tour"]').press('Escape');
    await expect(browser.locator('[data-testid="onboarding-tour"]')).not.toBeVisible();
    if (theme === 'light') await screen.getByRole('button', 'Switch to dark mode').tap();
  }
});

test('compact Console keeps every stream reachable', { tags: ['shell'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await app.open('/');
  await screen.getByRole('button', /^Console/).first().tap();
  for (const size of [{ width: 390, height: 667 }, { width: 844, height: 390 }]) {
    await browser.setViewport(size);
    for (const stream of [/^Errors/, /^Live events/, /^Waterfall/]) {
      await screen.getByRole('tab', stream).tap();
      expect(await browser.evaluate(() => {
        const root = document.querySelector('.cx-root')!;
        const main = document.querySelector('.cx-main')!;
        main.scrollIntoView({ block: 'end' });
        const r = main.getBoundingClientRect();
        const frame = root.getBoundingClientRect();
        return r.height >= 128 && r.bottom <= frame.bottom + 1 && r.bottom > frame.top &&
          ['auto', 'scroll'].includes(getComputedStyle(root).overflowY) &&
          document.documentElement.scrollWidth <= innerWidth;
      }), `${stream} has usable, reachable content at ${size.width} × ${size.height}`).toBe(true);
    }
    await app.screenshot(`console-compact-${size.width}`);
  }
});

test('header actions share surfaces and retain keyboard focus when signed in', { tags: ['shell'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.route('**/api/v1/auth/session', route => route.fulfill({ json: {
    mode: 'hybrid', provider: 'password', setupAvailable: false, accountsExist: true,
    user: { id: 'design-test', email: 'review@example.test', displayName: 'Design reviewer', role: 'member',
      status: 'active', shareResults: false, placementPref: 'auto', createdAt: 0, lastLoginAt: null },
  } }));
  await browser.route('**/api/v1/my-jobs', route => route.fulfill({ json: { jobs: [] } }));
  await app.open('/');
  await expect(screen.getByRole('button', 'My jobs', { exact: true })).toBeVisible();
  await expect(screen.getByRole('button', 'Account: Design reviewer')).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await screen.getByRole('button', 'Open settings').press('Tab');
    expect(await browser.evaluate(async () => {
      await Promise.all(document.querySelector('.header-actions')!.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => {})));
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('.header-actions .header-action')];
      const reference = getComputedStyle(document.querySelector('#header-settings-btn')!);
      const surface = reference.backgroundColor;
      const shadow = reference.boxShadow;
      return buttons.length >= 5 && buttons.every(button => {
        button.focus();
        const style = getComputedStyle(button);
        return button.matches(':focus-visible') && style.outlineStyle === 'solid' &&
          parseFloat(style.outlineWidth) >= 2 && style.outlineColor !== 'rgba(0, 0, 0, 0)' &&
          style.backgroundColor === surface && style.boxShadow === shadow;
      });
    }), `${theme}: nested account/jobs triggers and header utilities share a visible focus outline`).toBe(true);
    if (theme === 'light') await screen.getByRole('button', 'Switch to dark mode').press('Enter');
  }
});

test('every tour step keeps its footer inside short and narrow viewports', { tags: ['shell'], timeout: 90_000 }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await app.open('/');
  for (const size of [{ width: 667, height: 400 }, { width: 390, height: 667 }, { width: 844, height: 390 }]) {
    await browser.setViewport(size);
    await screen.getByRole('button', 'Take the tour', { exact: true }).first().tap();
    for (let index = 0; index < TOUR_STEPS.length; index++) {
      await expect(screen.getByRole('heading', TOUR_STEPS[index].title, { exact: true })).toBeVisible();
      expect(await browser.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity)
          .map(a => a.finished.catch(() => {})));
        const card = document.querySelector('.tour-card')!.getBoundingClientRect();
        const footer = document.querySelector('.tour-foot')!.getBoundingClientRect();
        return card.top >= 0 && card.bottom <= innerHeight && card.left >= 0 && card.right <= innerWidth &&
          footer.top >= card.top && footer.bottom <= innerHeight;
      }), `${TOUR_STEPS[index].title} fits ${size.width} × ${size.height}`).toBe(true);
      await screen.getByRole('button', index === 0 ? 'Show me around' : index === TOUR_STEPS.length - 1 ? 'Done' : 'Next', { exact: true }).tap();
    }
    await expect(browser.locator('[data-testid="onboarding-tour"]')).not.toBeVisible();
  }
});
