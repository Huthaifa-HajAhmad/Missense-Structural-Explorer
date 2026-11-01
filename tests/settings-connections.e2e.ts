import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

const SIGNED_IN = {
  mode: 'hybrid', provider: 'password', setupAvailable: false, accountsExist: true,
  user: { id: 'settings-test', email: 'reviewer@example.test', displayName: 'Settings reviewer', role: 'member',
    status: 'active', shareResults: false, placementPref: 'auto', createdAt: 0, lastLoginAt: null },
};

test('a token note sits in its own group, under no hairline', { tags: ['shell'], timeout: 90_000 }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.route('**/api/v1/auth/session', route => route.fulfill({ json: SIGNED_IN }));
  await browser.route('**/api/v1/me/secrets', route => route.fulfill({
    json: { available: true, secrets: [{ kind: 'biohub', hint: 'wvae', updatedAt: 1, readable: true }] },
  }));
  await app.open('/');
  await screen.getByRole('button', 'Open settings').tap();
  await screen.getByRole('tab', /^Connections/).tap();
  await expect(screen.getByRole('button', 'Remove the Biohub token saved to your account')).toBeVisible();

  const layout = await browser.evaluate(() => {
    const rule = (el: Element) => {
      const s = getComputedStyle(el);
      return s.borderBottomStyle !== 'none' && parseFloat(s.borderBottomWidth) > 0;
    };
    const field = document.querySelector('[data-setting-title="EvolutionaryScale (Forge) token"]')!;
    const strip = document.querySelector('[data-testid="account-token-biohub"]')!;
    const group = field.parentElement!;
    const stripBox = strip.getBoundingClientRect();
    const groupBox = group.getBoundingClientRect();
    return {
      stripInGroup: strip.parentElement === group,
      groupInCard: group.parentElement?.classList.contains('settings-card') ?? false,
      fieldRule: rule(field),
      stripRule: rule(strip),
      stripText: strip.textContent?.trim() ?? '',
      // The card's rule under this group must sit below the note's text, not across it.
      groupRuleBelowStrip: rule(group) && groupBox.bottom >= stripBox.bottom,
    };
  });

  expect(layout.stripInGroup, 'strip shares the token field group').toBe(true);
  expect(layout.groupInCard, 'group is a direct child of the card').toBe(true);
  expect(layout.fieldRule, 'no hairline between the field and its note').toBe(false);
  expect(layout.stripRule, 'no hairline across the note text').toBe(false);
  expect(layout.groupRuleBelowStrip, 'the group rule falls under the note, not through it').toBe(true);
  expect(layout.stripText).toMatch(/Saved to your account \(ends …wvae\)/);

  await browser.evaluate(() => {
    document.querySelector('[data-setting-title="EvolutionaryScale (Forge) token"]')!.scrollIntoView({ block: 'center' });
    return true;
  });
  await app.screenshot('settings-connections-credentials');
});

test('an autofill write into the settings filter is refused and the box stays empty', { tags: ['shell'], timeout: 90_000 }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.route('**/api/v1/auth/session', route => route.fulfill({ json: SIGNED_IN }));
  await app.open('/');
  await screen.getByRole('button', 'Open settings').tap();
  await screen.getByRole('tab', /^Connections/).tap();
  await expect(screen.getByRole('button', 'Show EvolutionaryScale (Forge) token')).toBeVisible();

  // What a password manager does: write an address into the field with no one typing in it.
  const after = await browser.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Filter settings"]')!;
    input.blur();
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(input, 'reviewer@example.test');
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
    return input.value;
  });
  expect(after).toBe('');
  await expect(screen.getByText(/settings found/i)).toHaveCount(0);

  // The reader typing into the filter still works.
  await screen.getByRole('searchbox', /Filter settings/).fill('polar');
  await expect(screen.getByRole('searchbox', /Filter settings/)).toHaveValue('polar');
});
