import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('first visit shows the onboarding tour', { tags: ['shell'] }, async ({ app, browser }) => {
  await app.open('/');
  await expect(browser.locator('[data-testid="onboarding-tour"]')).toBeVisible();
});
