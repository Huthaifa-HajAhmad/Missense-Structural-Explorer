import type { Browser } from '@e2e-dev/web';

/**
 * A fresh browser context shows the first-run onboarding tour, whose scrim intercepts
 * every pointer event. Mark it completed before the app's own scripts run. Mirrors
 * ONBOARDING_STORAGE_KEY in src/components/modals/OnboardingModal.tsx. Call before
 * `app.open`; the tour's own test (tests/tour.e2e.ts) does not.
 */
export async function skipTour(browser: Browser): Promise<void> {
  await browser.addInitScript(() => {
    // about:blank and opaque origins deny storage; only the app's origin needs the flag.
    try {
      localStorage.setItem('cs-onboarding-completed-v1', 'true');
    } catch {
      /* not the app's origin */
    }
  });
}

/**
 * Wait until the monitor's health summary has arrived and the deck has had time to re-measure. The summary line
 * is the one thing that can still change the deck's design height after the page loads, so a layout check made
 * before it can see the height move for a reason that has nothing to do with the action under test.
 */
export async function monitorSettled(browser: Browser): Promise<void> {
  await browser.evaluate(() => new Promise<string>(resolve => {
    const startedAt = Date.now();
    const poll = () => {
      const arrived = document.querySelector('.workbench-monitor-tabs .workbench-monitor-count');
      if (arrived || Date.now() - startedAt > 15000) setTimeout(() => resolve('settled'), 600);
      else setTimeout(poll, 100);
    };
    poll();
  }));
}
