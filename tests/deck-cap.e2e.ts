import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

/**
 * The deck (query card, recents, monitor) ends where the monitor's service list ends. A taller
 * Pipeline tab, a minimum height, or typing a variant must not push the cards down the page.
 */
describe('deck height cap', { tags: ['search'] }, () => {
  test('the deck ends at the service list and typing a variant does not move it', async ({ app, browser, screen }) => {
    await skipTour(browser);
    await browser.addInitScript(() => {
      localStorage.setItem('variant_search_history', JSON.stringify([
        { gene: 'CNNM2', variant: 'p.Glu357Lys', uniprotId: 'Q9H8M5' },
      ]));
      // Compact service rows, as on a machine with tighter font metrics: the list is then shorter than
      // any fixed minimum height the monitor could carry.
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '.telemetry-service { min-block-size: 0 !important; padding-block: .25rem !important; }';
        document.head.appendChild(style);
      });
    });
    await browser.setViewport({ width: 1753, height: 981 });
    await app.open('/');
    await browser.evaluate(() => document.fonts.ready.then(() => new Promise<string>(r => setTimeout(() => r('ok'), 600))));
    await expect(screen.getByRole('button', 'Select recent search CNNM2 p.Glu357Lys')).toBeVisible();

    const measure = () => browser.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const list = document.querySelector('#panel-telemetry .telemetry-scroll')!;
      return {
        deck: Math.round(box('.workbench-deck').height),
        monitorBottom: Math.round(box('.workbench-rail').bottom),
        recentsBottom: Math.round(box('.workbench-recents').bottom),
        // Space between the last service row and the bottom of the list's own box.
        slack: Math.round(list.getBoundingClientRect().bottom - list.lastElementChild!.getBoundingClientRect().bottom),
      };
    });
    const before = await measure();
    expect(before.slack <= 2, `no empty band under the service list (${before.slack}px)`).toBe(true);
    expect(Math.abs(before.monitorBottom - before.recentsBottom) <= 1, 'recents and monitor share a bottom edge').toBe(true);

    await screen.getByRole('textbox', /^Variant/).fill('CNNM2 p.Glu357Lys');
    await browser.evaluate(() => new Promise<string>(r => setTimeout(() => r('ok'), 800)));
    const after = await measure();
    expect(after.deck, `typing a variant keeps the deck height (${before.deck} → ${after.deck})`).toBe(before.deck);
    expect(Math.abs(after.monitorBottom - after.recentsBottom) <= 1, 'still one shared bottom edge').toBe(true);
    await app.screenshot('deck-cap');
  });
});
