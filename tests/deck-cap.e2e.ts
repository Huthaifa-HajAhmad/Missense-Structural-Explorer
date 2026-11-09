import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { monitorSettled, skipTour } from './support.js';

/**
 * The deck (query card, recents, monitor) ends where the monitor's service list ends. A taller
 * Pipeline tab, a minimum height, or typing a variant must not push the cards down the page.
 */
describe('deck height cap', { tags: ['search'] }, () => {
  test('the deck ends at the service list and typing a variant does not move it', async ({ app, browser, screen }) => {
    await skipTour(browser);
    await browser.addInitScript(() => {
      try {
        localStorage.setItem('variant_search_history', JSON.stringify([
          { gene: 'CNNM2', variant: 'p.Glu357Lys', uniprotId: 'Q9H8M5' },
        ]));
      } catch {
        // about:blank and opaque origins deny storage and would end this script before the style below is added.
      }
      // Compact service rows, as on a machine with tighter font metrics: the list is then shorter than
      // any fixed minimum height the monitor could carry. Added as soon as <head> exists, so the app's
      // first measurement already sees it (DOMContentLoaded comes after the app's own scripts have run).
      const addStyle = () => {
        if (!document.head) return false;
        const style = document.createElement('style');
        style.textContent = '.telemetry-service { min-block-size: 0 !important; padding-block: .25rem !important; }';
        document.head.appendChild(style);
        return true;
      };
      if (!addStyle()) {
        const watcher = new MutationObserver(() => { if (addStyle()) watcher.disconnect(); });
        watcher.observe(document, { childList: true, subtree: true });
      }
    });
    await browser.setViewport({ width: 1753, height: 981 });
    await app.open('/');
    await browser.evaluate(() => document.fonts.ready.then(() => new Promise<string>(r => setTimeout(() => r('ok'), 600))));
    await expect(screen.getByRole('button', 'Select recent search CNNM2 p.Glu357Lys')).toBeVisible();
    await monitorSettled(browser);

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

  test('a grown query card pushes the recents card down: the form never scrolls and the history has one scrollbar', async ({ app, browser, screen }) => {
    await skipTour(browser);
    await browser.addInitScript(() => {
      try {
        const genes = ['NAE1', 'PAH', 'TP53', 'BRCA1', 'SOD1', 'CFTR', 'LMNA', 'MYH7', 'GBA1', 'FGFR3'];
        localStorage.setItem('variant_search_history', JSON.stringify(genes.map(gene => ({ gene, variant: 'p.Arg100Trp', query: `${gene} p.Arg100Trp` }))));
      } catch {
        // about:blank and opaque origins deny storage.
      }
    });
    await browser.setViewport({ width: 1753, height: 981 });
    await app.open('/');
    await expect(screen.getByRole('heading', 'Recent analyses 10')).toBeVisible();
    await monitorSettled(browser);
    await screen.getByText('Optional refinements', { exact: true }).tap();
    await browser.evaluate(() => new Promise<string>(r => setTimeout(() => r('ok'), 500)));

    const layout = await browser.evaluate(() => {
      const form = document.querySelector<HTMLElement>('.workbench-query > form')!;
      const query = document.querySelector('.workbench-query')!.getBoundingClientRect();
      const recents = document.querySelector<HTMLElement>('.workbench-recents')!;
      const scrollers = [...recents.querySelectorAll<HTMLElement>('*')]
        .filter(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1);
      return {
        formScrolls: form.scrollHeight > form.clientHeight + 1,
        queryEndsAboveRecents: query.bottom <= recents.getBoundingClientRect().top,
        benchmarks: document.querySelectorAll('.workbench-benchmark').length,
        scrollers: scrollers.map(el => el.className),
      };
    });
    expect(layout.formScrolls, 'the query card shows all of its fields without a scrollbar').toBe(false);
    expect(layout.queryEndsAboveRecents, 'the recents card starts below the query card').toBe(true);
    expect(layout.benchmarks, 'the benchmark controls are not shown beside a history').toBe(0);
    expect(layout.scrollers, 'the history list is the only scroller in the recents card').toEqual(['workbench-recent-list']);
    await app.screenshot('query-pushes-recents');
  });

  test('the stacked layout keeps the monitor at its content height', async ({ app, browser }) => {
    await skipTour(browser);
    await browser.setViewport({ width: 1753, height: 981 });
    await app.open('/');
    await monitorSettled(browser);
    for (const width of [390, 900, 1100]) {
      await browser.setViewport({ width, height: 900 });
      await browser.evaluate(() => new Promise<string>(r => setTimeout(() => r('ok'), 400)));
      const heights = await browser.evaluate(() => ({
        monitor: Math.round(document.querySelector('.workbench-rail')!.getBoundingClientRect().height),
        panel: Math.round(document.querySelector('#panel-telemetry .telemetry-scroll')!.scrollHeight),
      }));
      expect(heights.monitor >= heights.panel, `at ${width}px the monitor holds its service list (${heights.monitor} vs ${heights.panel})`).toBe(true);
    }
  });
});
