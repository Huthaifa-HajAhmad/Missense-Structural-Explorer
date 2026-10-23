import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

test('the query and monitor clear the viewport bottom with three recent analyses', { tags: ['shell'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.addInitScript(() => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    localStorage.setItem('variant_search_history', JSON.stringify([
      { gene: 'NAE1', variant: 'p.Asp116Gly', query: 'Chr16(GRCh38):g.66823281T>C' },
      { gene: 'PAH', variant: 'p.Arg408Trp', query: 'Chr12(GRCh38):g.102840401C>T' },
      { gene: 'TP53', variant: 'p.Arg175His', query: 'Chr17(GRCh38):g.7675088C>T' },
    ]));
  });
  await browser.setViewport({ width: 1753, height: 981 });
  await app.open('/');
  await expect(screen.getByRole('heading', 'Recent analyses 3')).toBeVisible();
  await browser.evaluate(() => document.fonts.ready.then(() => true));
  expect(await browser.evaluate(() => {
    const query = document.querySelector('.workbench-query')!.getBoundingClientRect();
    const recents = document.querySelector('.workbench-recents')!.getBoundingClientRect();
    const monitor = document.querySelector('.workbench-rail')!.getBoundingClientRect();
    return query.top <= 210 && Math.abs(query.top - monitor.top) <= 1 &&
      Math.abs(recents.bottom - monitor.bottom) <= 1 && monitor.bottom <= innerHeight - 20;
  }), 'panels start higher, align, and retain a bottom gutter').toBe(true);
  await app.screenshot('query-panels-three-recents');
});

test('a long history keeps the deck in place and opens the rest on request', { tags: ['shell'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.addInitScript(() => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    const genes = ['NAE1', 'PAH', 'TP53', 'BRCA1', 'SOD1', 'CFTR', 'LMNA', 'MYH7'];
    localStorage.setItem('variant_search_history', JSON.stringify(
      genes.map(gene => ({ gene, variant: 'p.Arg100Trp', query: `${gene} p.Arg100Trp` })),
    ));
  });
  await browser.setViewport({ width: 1753, height: 981 });
  await app.open('/');
  await expect(screen.getByRole('heading', 'Recent analyses 8')).toBeVisible();
  const deck = () => browser.evaluate(() => {
    const recents = document.querySelector('.workbench-recents')!.getBoundingClientRect();
    const monitor = document.querySelector('.workbench-rail')!.getBoundingClientRect();
    return {
      rows: document.querySelectorAll('.workbench-recent-list > li').length,
      aligned: Math.abs(recents.bottom - monitor.bottom) <= 1,
      fits: monitor.bottom <= innerHeight - 20,
    };
  });
  expect(await deck(), 'three rows, aligned, above the fold').toEqual({ rows: 3, aligned: true, fits: true });
  await screen.getByRole('button', 'Show 5 more').tap();
  expect((await deck()).rows, 'the rest open in place').toBe(8);
  await expect(screen.getByRole('button', 'Show fewer')).toBeExpanded();
});

test('Search has one page scroller and opens the palette directly', { tags: ['shell'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await app.open('/');
  await screen.getByText(/^Edit parsed fields/).tap();
  for (const width of [1440, 390]) {
    await browser.setViewport({ width, height: 844 });
    const geometry = await browser.evaluate(() => {
      let node: Element | null = document.querySelector('.search-workspace');
      let scrollers = 0;
      while (node) {
        if (['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1) scrollers++;
        node = node.parentElement;
      }
      const monitor = document.querySelector('.telemetry-scroll');
      return { scrollers, fits: document.documentElement.scrollWidth <= innerWidth,
        monitorFits: !monitor || monitor.scrollWidth <= monitor.clientWidth + 1 };
    });
    expect(geometry.scrollers, `one Search scroll owner at ${width}px`).toBe(1);
    expect(geometry.fits).toBe(true);
    expect(geometry.monitorFits, 'service hit areas stay inside the monitor').toBe(true);
    await app.screenshot(`search-${width}`);
    await screen.getByRole('button', /^Search views or run a variant/).tap();
    await expect(screen.getByRole('dialog', 'Command palette')).toBeVisible();
    await screen.getByRole('dialog', 'Command palette').press('Escape');
    await expect(screen.getByRole('dialog', 'Command palette')).not.toBeVisible();
    expect(await browser.evaluate(() => document.activeElement?.hasAttribute('data-palette-trigger') ?? false),
      'closing the palette returns focus to its trigger').toBe(true);
  }
});

test('Literature stacks its white panels with one page scroller on mobile', { tags: ['shell'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 390, height: 844 });
  await app.open('/tools/review-preview/index.html');
  await screen.getByRole('combobox', 'Workspace').selectOption('Literature');
  await expect(screen.getByRole('heading', 'Literature', { exact: true })).toBeVisible();
  expect(await browser.evaluate(() => {
    const workspace = document.querySelector('.review-workspace')!;
    const main = workspace.querySelector('.data-screen-primary')!;
    const literature = main.querySelector('.lit-view')!;
    const inspector = workspace.querySelector('[data-workspace-inspector]')!;
    const heading = inspector.querySelector('.inspector-heading');
    return heading !== null &&
      getComputedStyle(literature).backgroundColor === getComputedStyle(main).backgroundColor &&
      getComputedStyle(main).backgroundColor === getComputedStyle(inspector).backgroundColor &&
      getComputedStyle(heading).backgroundColor !== getComputedStyle(main).backgroundColor &&
      getComputedStyle(literature).overflowY === 'visible' &&
      main.getBoundingClientRect().bottom <= inspector.getBoundingClientRect().top &&
      document.documentElement.scrollWidth <= innerWidth;
  }), 'stacked panels share one body surface, the inspector keeps its header wash, and one workspace scroller').toBe(true);
  await app.screenshot('literature-mobile');
});

test('the sidebar has a quiet divider and marks one legible current page', { tags: ['shell'] }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 640 });
  await app.open('/');
  await screen.getByRole('button', 'Evidence', { exact: true }).tap();
  await expect(screen.getByRole('button', 'Population data', { exact: true })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    const result = await browser.evaluate(() => {
      // Resolve any CSS colour (oklch, color-mix) to sRGB through a canvas.
      const ctx = document.createElement('canvas').getContext('2d')!;
      const rgb = (color: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const lum = (c: number[]) => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
      const contrast = (a: string, b: string) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m); return (x + .05) / (y + .05); };
      const root = document.querySelector('.ms-root')!;
      const nav = root.querySelector('.ms-nav')!;
      const rootStyle = getComputedStyle(root);
      const canvas = getComputedStyle(document.body).backgroundColor;
      const current = [...nav.querySelectorAll('[aria-current="page"]')];
      const active = nav.querySelector<HTMLElement>('.ms-sub-btn[data-active="true"]')!;
      const branch = getComputedStyle(active, '::before');
      const trunk = getComputedStyle(nav.querySelector('.ms-sub-btn')!, '::after');
      return {
        quietDivider: rootStyle.borderInlineEndWidth === '1px' && rootStyle.boxShadow === 'none',
        noNativeBar: getComputedStyle(nav).scrollbarWidth === 'none',
        noChevrons: nav.querySelectorAll('.lucide-chevron-down, .lucide-chevron-right').length === 0,
        oneCurrent: current.length === 1 && current[0] === active,
        cursor: getComputedStyle(active).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(active).boxShadow === 'none',
        branchOnTop: branch.zIndex === '1' && branch.borderLeftColor !== trunk.borderLeftColor,
        trunkLegible: contrast(trunk.borderLeftColor, canvas) >= 1.5,
      };
    });
    expect(result, `${theme} sidebar contract`).toEqual({
      quietDivider: true, noNativeBar: true, noChevrons: true, oneCurrent: true, cursor: true, branchOnTop: true, trunkLegible: true,
    });
    await app.screenshot(`sidebar-tree-${theme}`);
    if (theme === 'light') await screen.getByRole('button', 'Switch to dark mode').tap();
  }
});
