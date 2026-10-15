import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Doctor: the app starts, the engine runs, and the shell renders its primary landmarks.
test('app shell renders', { tags: ['smoke'] }, async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByRole('navigation', 'Primary navigation')).toBeVisible();
  await expect(screen.getByRole('button', 'Analyse variant')).toBeVisible();
});
