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
