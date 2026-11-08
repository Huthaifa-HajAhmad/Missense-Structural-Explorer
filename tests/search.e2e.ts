import { describe, beforeEach, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { monitorSettled, skipTour } from './support.js';

describe('variant search form', { tags: ['search'] }, () => {
  beforeEach(async ({ app, browser }) => {
    await skipTour(browser);
    // Every test starts from the same viewport; one test below sets its own.
    await browser.setViewport({ width: 1280, height: 800 });
    await app.open('/');
  });

  test('lists the four benchmark controls on first run', async ({ screen, app, browser }) => {
    await browser.setViewport({ width: 1440, height: 1100 });
    await expect(screen.getByRole('region', 'No recent analyses')).toBeVisible();
    for (const label of ['PAH p.Arg408Trp', 'FGFR3 p.Gly380Arg', 'GBA1 p.Leu483Pro', 'CNNM2 p.Glu357Lys']) {
      await expect(screen.getByRole('button', `Run benchmark ${label}`)).toBeVisible();
    }
    await app.screenshot('variant-workbench');
  });

  test('typing enables Clear and Clear empties the fields', async ({ screen }) => {
    await screen.getByText('Optional refinements', { exact: true }).tap();
    const gene = screen.getByRole('textbox', 'Gene symbol');
    await expect(screen.getByRole('button', 'Clear query fields')).toBeDisabled();
    await gene.fill('PAH');
    await expect(screen.getByRole('button', 'Clear query fields')).toBeEnabled();
    await screen.getByRole('button', 'Clear query fields').tap();
    await expect(gene).toHaveValue('');
  });

  test('the quick entry line fills the parsed fields', async ({ screen }) => {
    await screen.getByRole('textbox', /^Variant/).fill('NAE1 p.Asp116Gly');
    await screen.getByText('Optional refinements', { exact: true }).tap();
    await expect(screen.getByRole('textbox', 'Gene symbol')).toHaveValue('NAE1');
    await expect(screen.getByRole('textbox', /^Protein or cDNA notation/)).toHaveValue('p.Asp116Gly');
  });

  test('the sidebar switches between Services and Pipeline', async ({ screen }) => {
    await expect(screen.getByRole('tab', 'Services')).toBeSelected();
    await screen.getByRole('tab', 'Pipeline').tap();
    await expect(screen.getByRole('tab', 'Pipeline')).toBeSelected();
  });

  test('optional AI instructions retain their value when collapsed', async ({ screen }) => {
    const instructions = screen.getByRole('textbox', 'AI Focus Area & Custom Analysis Instructions');
    await screen.getByText('Optional refinements', { exact: true }).tap();
    await instructions.fill('Focus on the cofactor loop');
    await screen.getByText('Optional refinements', { exact: true }).tap();
    await expect(screen.getByText('AI focus set')).toBeVisible();
    await expect(instructions).not.toBeVisible();
    await screen.getByText('Optional refinements', { exact: true }).tap();
    await expect(instructions).toHaveValue('Focus on the cofactor loop');
  });

  test('populated history and monitor remain usable on desktop and mobile', async ({ app, browser, screen }) => {
    await browser.addInitScript(() => {
      localStorage.setItem('variant_search_history', JSON.stringify([
        { gene: 'PAH', variant: 'p.Arg408Trp', uniprotId: 'P00439' },
        { gene: 'FGFR3', variant: 'p.Gly380Arg', uniprotId: 'P22607' },
        { gene: 'NAE1', variant: 'p.Asp116Gly', uniprotId: 'Q13564' },
      ]));
    });
    await browser.setViewport({ width: 1660, height: 1200 });
    await app.open('/');
    await expect(screen.getByRole('button', 'Select recent search PAH p.Arg408Trp')).toBeVisible();
    await expect(screen.getByRole('button', 'Show details for Ensembl VEP')).toBeVisible();
    await screen.getByRole('button', 'Show details for Ensembl VEP').tap();
    await expect(screen.getByRole('button', 'Hide details for Ensembl VEP')).toBeExpanded();
    await screen.getByRole('button', 'Hide details for Ensembl VEP').tap();
    const monitor = await screen.getByRole('complementary', 'Services and pipeline').boundingBox();
    const recents = await screen.getByRole('region', /Recent analyses/).boundingBox();
    expect(Boolean(monitor && recents && Math.abs(monitor.y + monitor.height - recents.y - recents.height) <= 1), 'monitor and populated recents share a bottom edge');
    await app.screenshot('services-and-recents');
    await screen.getByRole('tab', 'Pipeline').tap();
    await expect(screen.getByText('Pipeline ready', { exact: true })).toBeVisible();
    await app.screenshot('pipeline-and-recents');
    await screen.getByRole('button', 'Switch to dark mode').tap();
    await app.screenshot('pipeline-dark');
    await browser.setViewport({ width: 390, height: 844 });
    await screen.getByRole('region', /Recent analyses/).scrollIntoView();
    await app.screenshot('recents-mobile-dark');
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal page overflow');
    await screen.getByRole('tab', 'Services').tap();
    await screen.getByRole('button', 'Show details for Ensembl VEP').tap();
    await expect(screen.getByRole('button', 'Hide details for Ensembl VEP')).toBeExpanded();
    await app.screenshot('services-mobile-dark');
    await screen.getByRole('button', 'Clear search history').tap();
    await expect(screen.getByRole('region', 'No recent analyses')).toBeVisible();
    await expect(screen.getByRole('button', /^Select recent search/)).toHaveCount(0);
  });

  test('one recent entry does not shorten the monitor', async ({ app, browser, screen }) => {
    await browser.addInitScript(() => {
      localStorage.setItem('variant_search_history', JSON.stringify([
        { gene: 'CNNM2', variant: 'p.Glu357Lys', uniprotId: 'Q9H8M5' },
      ]));
    });
    await browser.setViewport({ width: 1753, height: 981 });
    await app.open('/');
    await expect(screen.getByRole('button', 'Select recent search CNNM2 p.Glu357Lys')).toBeVisible();
    await monitorSettled(browser);
    // Measured on Services first: the monitor is the taller of its two tabpanels, and the query card
    // claim below compares against that layout, not against a shrunk Pipeline.
    const layout = await browser.evaluate(() => {
      const monitor = document.querySelector('.workbench-rail')!.getBoundingClientRect();
      const recents = document.querySelector('.workbench-recents')!.getBoundingClientRect();
      const query = document.querySelector('.workbench-query')!.getBoundingClientRect();
      return {
        height: monitor.height,
        aligned: Math.abs(monitor.bottom - recents.bottom) < 2,
        gap: recents.top - query.bottom,
        queryHeight: query.height,
        recentsHeight: recents.height,
        bodyHeight: document.querySelector(".workbench-query-body")!.getBoundingClientRect().height,
        fieldsOpen: Boolean(document.querySelector(".qe-refine #input-gene-symbol")),
        deckVar: (document.querySelector('.workbench-deck') as HTMLElement).style.getPropertyValue('--workbench-deck-h'),
      };
    });
    expect(layout.height >= 640, 'monitor keeps its full desktop height').toBe(true);

    expect(layout.aligned, 'both columns share a bottom edge').toBe(true);
    expect(layout.gap <= 20, 'Recents starts directly below the query form').toBe(true);
    expect(layout.fieldsOpen, 'parsed fields are available immediately').toBe(true);
    expect(layout.recentsHeight >= 200, 'history reserves room for three entries').toBe(true);
    expect(layout.queryHeight - layout.bodyHeight < 150, 'the form has no stretched empty band');
    /* With the monitor at its full telemetry height, a one-entry tray stretches rather than
       shrinking it — deliberate (2026-11-06), so the tray is checked on order, not on standing taller. */
    expect(layout.gap >= 0, 'the tray reads below the form, whatever its stretched height').toBe(true);
    await app.screenshot('single-recent-full-monitor');

    // The pipeline tab then holds the deck's height too: the summary has settled, so the switch moves nothing.
    await screen.getByRole('tab', 'Pipeline').tap();
    const pipelineHeight = await browser.evaluate(() => document.querySelector('.workbench-rail')!.getBoundingClientRect().height);
    // The measured design height is the deck's, and the monitor renders IT rather than the visible
    // tab's own content: that is the contract the tab switch must never break. (The design itself
    // may still grow while the test runs — a diagnostics poll can add a line to the summary — so
    // the check is "rail follows the design", not "the design is frozen".)
    const pipelineVar = await browser.evaluate(() => (document.querySelector('.workbench-deck') as HTMLElement).style.getPropertyValue('--workbench-deck-h'));
    const designPipeline = parseFloat(pipelineVar);
    expect(Number.isFinite(designPipeline), `the deck carries a measured design height (${pipelineVar})`).toBe(true);
    expect(designPipeline, `the design height never shrinks (${layout.deckVar} → ${pipelineVar})`).toBeGreaterThanOrEqual(parseFloat(layout.deckVar) - 1);
    expect(Math.abs(pipelineHeight - designPipeline) <= 1, `the monitor renders the design height, not the tab's content (${pipelineHeight.toFixed(1)} vs ${designPipeline})`).toBe(true);
    expect(Math.abs(pipelineHeight - layout.height) <= 1, `monitor height switches without moving (${layout.height.toFixed(0)} → ${pipelineHeight.toFixed(0)})`).toBe(true);
    await app.screenshot('pipeline-recent-full-monitor');
    await browser.setViewport({ width: 390, height: 844 });
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow on mobile').toBe(true);
  });

  test('the switch paints one thumb from the tab list itself', async ({ app, browser, screen }) => {
    await browser.setViewport({ width: 1753, height: 981 });
    await app.open('/');
    const paint = await browser.evaluate(() => {
      const list = document.querySelector('.workbench-monitor-tabs')!;
      const tabs = [...list.querySelectorAll('[role="tab"]')];
      const thumb = getComputedStyle(list, '::after');
      return {
        thumbBackground: thumb.backgroundColor,
        thumbWidth: parseFloat(thumb.width),
        tabBackgrounds: tabs.map(t => getComputedStyle(t).backgroundColor),
        tabBorders: tabs.map(t => getComputedStyle(t).borderBlockEndWidth),
        selected: tabs.findIndex(t => t.getAttribute('aria-selected') === 'true'),
      };
    });
    // The raised thumb belongs to the track: it is one background on the list's ::after, while each
    // tab stays a transparent, rule-less button. One painted surface, not one per segment.
    expect(paint.thumbBackground !== 'rgba(0, 0, 0, 0)', 'the thumb has a surface of its own').toBe(true);
    expect(paint.tabBackgrounds.every(c => c === 'rgba(0, 0, 0, 0)'), 'the tabs paint nothing').toBe(true);
    expect(paint.tabBorders.every(w => w === '0px'), 'the tabs carry no rule of their own').toBe(true);
    // The thumb is half the two-segment list, and the selected tab is the first one.
    const listWidth = await browser.evaluate(() => document.querySelector('.workbench-monitor-tabs')!.getBoundingClientRect().width);
    expect(Math.abs(paint.thumbWidth - (listWidth - 6) / 2) <= 1, 'the thumb spans exactly one segment').toBe(true);
    expect(paint.selected, 'Services is selected first').toBe(0);
    await app.screenshot('switch-thumb');
  });

  test('an empty submit opens the refinements strip and the browser focuses the missing field', async ({ screen, browser, app }) => {
    await browser.setViewport({ width: 1753, height: 981 });
    await app.open('/');
    await screen.getByRole('button', 'Analyse variant').tap();
    await expect(screen.getByText('Optional refinements')).toBeVisible();
    // The strip opening is only the means; the point is that the required, empty, until-then hidden
    // field takes the focus, so the user is told what to fill without hunting for it.
    await browser.evaluate(() => new Promise<string>(r => setTimeout(() => r('settled'), 200)));
    expect(await browser.evaluate(() => document.activeElement?.id ?? ''), 'focus lands on the gene field').toBe('input-gene-symbol');
    await app.screenshot('empty-submit-focus');
  });

  test('both tabpanels stay mounted: the Services badge keeps its reading while Pipeline is open', async ({ app, browser, screen }) => {
    await browser.setViewport({ width: 1753, height: 981 });
    await app.open('/');
    await expect(screen.getByRole('heading', /No recent analyses/)).toBeVisible();
    // Tests before this one may have left the app on Pipeline, and `open` does not reset view state.
    await screen.getByRole('tab', 'Services').tap();
    const panelMount = () => browser.evaluate(() => {
      const t = document.getElementById('panel-telemetry')!;
      const p = document.getElementById('panel-pipeline')!;
      return {
        bothMounted: Boolean(t) && Boolean(p),
        telemetryShown: !t.hasAttribute('inert'),
        pipelineShown: !p.hasAttribute('inert'),
        telemetryHasSummary: Boolean(t.querySelector('.telemetry-summary')),
      };
    });

    const first = await panelMount();
    expect(first.bothMounted, 'both tabpanels are mounted ' + JSON.stringify(first)).toBe(true);
    expect(first.telemetryShown && !first.pipelineShown, `telemetry is shown first ${JSON.stringify(first)}`).toBe(true);
    expect(first.telemetryHasSummary, 'the telemetry panel keeps its content').toBe(true);

    await screen.getByRole('tab', 'Pipeline').tap();
    const second = await panelMount();
    expect(second.bothMounted, 'both tabpanels are still mounted').toBe(true);
    expect(!second.telemetryShown && second.pipelineShown, `the switch moved the view without losing a panel ${JSON.stringify(second)}`).toBe(true);
    expect(second.telemetryHasSummary, 'the switch did not unmount the telemetry panel').toBe(true);

    // The badge on the Services tab names the same count its panel computed.
    const reading = await browser.evaluate(() => {
      const badge = document.querySelector('.workbench-monitor-tabs .workbench-monitor-count');
      return badge?.textContent?.trim() ?? null;
    });
    expect(reading !== null && /^\d+\/\d+$/.test(reading), `the Services badge holds a count (${reading})`).toBe(true);
    await screen.getByRole('tab', 'Services').tap();
    await app.screenshot('services-badge');
  });

  test('a grown query card scrolls instead of dropping the recents card and moving the monitor', async ({ app, browser, screen }) => {
    await browser.addInitScript(() => {
      localStorage.setItem('variant_search_history', JSON.stringify([
        { gene: 'CNNM2', variant: 'p.Glu357Lys', uniprotId: 'Q9H8M5' },
      ]));
    });
    await browser.setViewport({ width: 1753, height: 981 });
    await app.open('/');
    await browser.evaluate(() => document.fonts.ready.then(() => new Promise<string>(r => setTimeout(() => r('ok'), 300))));
    await expect(screen.getByRole('button', 'Select recent search CNNM2 p.Glu357Lys')).toBeVisible();
    await monitorSettled(browser);

    const closed = await browser.evaluate(() => ({
      monitor: Math.round(document.querySelector('.workbench-rail')!.getBoundingClientRect().height * 10) / 10,
      recentsH: Math.round(document.querySelector('.workbench-recents')!.getBoundingClientRect().height * 10) / 10,
      deck: getComputedStyle(document.querySelector('.workbench-deck')!).getPropertyValue('--workbench-deck-h'),
    }));
    expect(closed.deck !== '', `the deck's design height was measured (${closed.deck})`).toBe(true);

    await screen.getByText('Optional refinements', { exact: true }).tap();
    await browser.evaluate(() => new Promise<string>(r => setTimeout(() => r('ok'), 400)));
    const open = await browser.evaluate(() => {
      const r = (sel: string) => (document.querySelector(sel) as HTMLElement).getBoundingClientRect();
      const recents = r('.workbench-recents');
      const monitor = r('.workbench-rail');
      return {
        monitor: Math.round(monitor.height * 10) / 10,
        recents: Math.round(recents.height * 10) / 10,
        aligned: Math.abs(monitor.bottom - recents.bottom) <= 1,
      };
    });
    // The deck's height is the monitor's measured content, and the query card grows into it: the
    // recents card yields (shrinks, scrolls inside itself) instead of dropping the column or the
    // monitor, and the two columns still share their bottom edge. The health summary has settled
    // before the first measurement, so the monitor does not move at all.
    expect(Math.abs(open.monitor - closed.monitor) <= 1, `the monitor keeps its height when the query expands (${closed.monitor} → ${open.monitor})`).toBe(true);
    expect(open.recents <= closed.recentsH - 20, `the recents card yields to the expansion (${closed.recentsH} → ${open.recents})`).toBe(true);
    expect(open.aligned, 'both columns still share a bottom edge').toBe(true);
    // And the grown card never lurches past the deck it shares: it fits its row (scrolling inside
    // when its content is taller), it does not push the deck taller.
    const cardOverflow = await browser.evaluate(() => {
      const deck = document.querySelector('.workbench-deck')!.getBoundingClientRect();
      const card = document.querySelector('.workbench-query')!.getBoundingClientRect();
      return Math.round((card.bottom - deck.bottom) * 10) / 10;
    });
    expect(cardOverflow <= 2, `the expanded card stays inside the deck (${cardOverflow}px past)`).toBe(true);
    await app.screenshot('expansion-scrolls');
  });

  test('an open service drawer scrolls inside the monitor and never raises the deck', async ({ app, browser, screen }) => {
    await browser.setViewport({ width: 1753, height: 981 });
    await app.open('/');
    await monitorSettled(browser);
    const deckHeight = () => browser.evaluate(() =>
      parseFloat((document.querySelector('.workbench-deck') as HTMLElement).style.getPropertyValue('--workbench-deck-h')));
    const closed = await deckHeight();

    await screen.getByRole('button', 'Show details for Gemini Clinical AI').tap();
    await expect(screen.getByRole('button', 'Hide details for Gemini Clinical AI')).toBeExpanded();
    // Any re-measure (a resize, a health poll) must read the list as if the drawer were shut.
    await browser.evaluate(() => new Promise<string>(r => {
      window.dispatchEvent(new Event('resize'));
      setTimeout(() => r('ok'), 300);
    }));
    const open = await deckHeight();
    expect(Math.abs(open - closed) <= 1, `the deck keeps its height when a drawer opens (${closed} → ${open})`).toBe(true);
    await app.screenshot('service-drawer-open');
  });
});
