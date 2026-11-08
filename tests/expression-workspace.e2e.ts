import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

test('expression expansion, exact pins and source availability', { tags: ['expression'], timeout: 120_000, retries: 0 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Expression');
  await screen.getByRole('combobox', 'Example').selectOption('Dense expression');
  const chart = screen.getByRole('img', /Adult tissue expression/);
  await expect(chart).toBeVisible();
  for (const width of [1440, 800, 390]) {
    await browser.setViewport({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      const dark = await browser.evaluate(() => document.documentElement.classList.contains('dark'));
      if (dark !== (theme === 'dark')) await screen.getByRole('button', 'Switch theme').tap();
      await expect(chart).toBeVisible();
      expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width === 1440) expect(await browser.evaluate(() => {
        const plot = document.querySelector('.evw-plot')!.getBoundingClientRect();
        return plot.top + 4 * 32 < window.innerHeight;
      })).toBe(true);
      await app.screenshot(`expression-${width}-${theme}`);
    }
  }
  await browser.setViewport({ width: 1440, height: 900 });
  await screen.getByRole('button', 'Show all 54 records').tap();
  await expect(chart).toContainText('Illustrative tissue 54');
  await screen.getByRole('tab', 'Sampling & coverage').tap();
  await screen.getByRole('button', 'Illustrative tissue 54').press('Enter');
  const inspector = screen.getByRole('region', 'Selected evidence reading');
  await expect(inspector.getByRole('heading', 'Illustrative tissue 54')).toBeVisible();
  await screen.getByRole('button', 'Show first 20').tap();
  await screen.getByRole('tab', 'Tissue explorer').tap();
  await screen.getByRole('button', 'Show pinned record').tap();
  expect(await browser.evaluate(() => document.activeElement?.textContent ?? null)).toBe('Illustrative tissue 54');
  await app.screenshot('expression-recovered-pin');
  await screen.getByRole('combobox', 'Example').selectOption('Pediatric unavailable');
  // A changed analysed allele resets the app's active Evidence tab.
  await screen.getByRole('combobox', 'Evidence').selectOption('Expression');
  await screen.getByRole('tab', 'Pediatric RNA').tap();
  await expect(screen.getByTestId('expression-finding')).toContainText('Pediatric measurements are not available here');
  await expect(screen.getByRole('searchbox')).toHaveCount(0);
  await expect(screen.getByRole('combobox', 'Sampled age cohort')).toHaveCount(0);
  await app.screenshot('expression-pediatric-unavailable');
  await screen.getByRole('tab', 'Sampling & coverage').tap();
  await expect(screen.getByRole('heading', 'Human pediatric expression')).toBeVisible();
  await expect(screen.getByRole('region', 'Human pediatric expression').getByRole('button', 'Check again')).toBeVisible();
  expect(await browser.evaluate(() => {
    const heading = [...document.querySelectorAll('h2')].find(node => node.textContent === 'Human pediatric expression')!;
    const status = heading.closest('section')!.querySelector('[role="status"]')!;
    status.scrollIntoView({ block: 'center' });
    const style = getComputedStyle(status);
    return { direction: style.flexDirection, inset: style.paddingInlineStart };
  })).toEqual({ direction: 'column', inset: '16px' });
  await app.screenshot('pediatric-missing-card');
  await screen.getByRole('combobox', 'Example').selectOption('Mixed');
  await screen.getByRole('combobox', 'Evidence').selectOption('Expression');
  await screen.getByRole('tab', 'Tissue explorer').tap();
  await screen.getByRole('combobox', 'Sampled age cohort').selectOption('Pre-pubertal (8 to approximately 13)');
  // The chart carries the value; the tissue explorer no longer repeats it in a summary or a scale caption.
  await expect(screen.getByRole('img', /Pediatric tissue and age cohorts/)).toContainText('29 TPM');
  await expect(screen.getByTestId('expression-finding')).toHaveCount(0);
  await expect(screen.getByText(/Linear TPM scale/)).toHaveCount(0);
  await screen.getByRole('tab', 'Sampling & coverage').tap();
  await screen.getByRole('button', 'Brain').press('Enter');
  await expect(inspector).toContainText('29');
  await app.screenshot('expression-pediatric-record');
});


test('pext map explains region shading without an unrelated RNA headline', { tags: ['expression'], timeout: 120_000, retries: 0 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Expression');
  await browser.evaluate(async () => {
    const modulePath = '/src/stores/useVariantAnalysisStore.ts';
    const { useVariantAnalysisStore: store } = await import(modulePath);
    const analysis = store.getState().analysisState;
    const gene = analysis.result.metadata.gene;
    store.setState({ analysisState: { ...analysis, result: { ...analysis.result, predictorData: { ...analysis.result.predictorData, gnomadVariantId: '21-550-A-T', gnomadVariantAssembly: 'GRCh38' } } } });
    store.setState({ extraContexts: { ...store.getState().extraContexts, [`pext:${gene}`]: { status: 'ready', data: {
      gene, status: 'ready', geneId: 'illustrative', chrom: '21', flags: [], provenance: null, message: null,
      regions: Array.from({ length: 10 }, (_, i) => ({ start: 100 + i * 200, stop: 199 + i * 200, mean: i === 0 ? null : i / 10, tissues: [{ tissue: 'brain_cortex', value: 0.2 }, { tissue: 'kidney_cortex', value: 0.4 }, { tissue: 'liver', value: 0.6 }] })),
    } } } });
    return null;
  });
  await screen.getByRole('tab', 'Expression at variant').tap();
  await expect(screen.getByRole('heading', 'Coding expression map')).toBeVisible();
  await expect(screen.getByTestId('expression-finding')).toHaveCount(0);
  await expect(screen.getByRole('img', /Mean base-level pext across 10 coding regions/)).toBeVisible();
  await screen.getByRole('button', 'Change review systems').tap();
  await expect(screen.getByRole('group', 'Review systems')).toBeVisible();
  await screen.getByRole('button', 'Renal', { exact: true }).tap();
  await expect(screen.getByRole('rowheader', 'Kidney cortex')).toBeVisible();
  await screen.getByText('Other tissues (1)', { exact: true }).tap();
  await expect(screen.getByRole('rowheader', 'Liver')).toBeVisible();
  await screen.getByText('All coding region values (10)', { exact: true }).press('Enter');
  await expect(screen.getByRole('region', 'Coding region values')).toContainText('Not reported');
  await browser.setViewport({ width: 1900, height: 1000 });
  expect(await browser.evaluate(() => document.querySelector('.xp-pext-map')!.getBoundingClientRect().width)).toBe(900);
  await app.screenshot('pext-wide-region-values');
  await screen.getByText('All coding region values (10)', { exact: true }).press('Enter');
  await browser.evaluate(() => { (document.querySelector('.xp-review-settings') as HTMLDetailsElement).open = false; return null; });
  for (const width of [1440, 800, 390]) {
    await browser.setViewport({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      const dark = await browser.evaluate(() => document.documentElement.classList.contains('dark'));
      if (dark !== (theme === 'dark')) await screen.getByRole('button', 'Switch theme').tap();
      expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const tops: Array<Record<string, number | null>> = [];
      for (const [view, card] of [['Tissue explorer', 'context-records'], ['Sampling & coverage', 'context-records'], ['Protein measurements', 'hpa-card'], ['Expression at variant', 'pext-card']]) {
        await screen.getByRole('tab', view).tap();
        await expect(screen.getByTestId(card)).toBeVisible();
        // Only the sampling view opens with the source summary; the other three open with their own figure.
        await expect(screen.getByTestId('expression-finding')).toHaveCount(view === 'Sampling & coverage' ? 1 : 0);
        expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        tops.push(await browser.evaluate(() => {
          const top = (selector: string) => { const node = document.querySelector(selector); return node ? Math.round(node.getBoundingClientRect().top + window.scrollY) : null; };
          return { navigation: top('.evw-navigation'), review: top('.xp-review-settings'), panel: top('.xp-workspace > .evw-panel') };
        }));
        await app.screenshot(`${view}-${width}-${theme}`);
      }
      // The shared chrome must not move when the reader switches view.
      for (const key of ['navigation', 'review', 'panel']) expect(new Set(tops.map(t => t[key])).size).toBe(1);
    }
  }
});


test('pediatric provider failure exposes recovery on the sampling view', { tags: ['expression'], timeout: 120_000, retries: 0 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Expression');
  await browser.evaluate(async () => {
    const modulePath = '/src/stores/useVariantAnalysisStore.ts';
    const { useVariantAnalysisStore: store } = await import(modulePath);
    const gene = store.getState().analysisState.result.metadata.gene;
    store.setState({ developmentalContexts: { [gene]: { status: 'error', data: null, error: 'Illustrative pediatric source failure.' } } });
    return null;
  });
  await screen.getByRole('tab', 'Sampling & coverage').tap();
  await expect(screen.getByText('Illustrative pediatric source failure.', { exact: true })).toBeVisible();
  await expect(screen.getByRole('button', 'Try again')).toBeVisible();
  expect(await browser.evaluate(() => {
    const heading = [...document.querySelectorAll('h2')].find(node => node.textContent === 'Human pediatric expression')!;
    const status = heading.closest('section')!.querySelector('[role="status"]')!;
    status.scrollIntoView({ block: 'center' });
    const style = getComputedStyle(status);
    return { direction: style.flexDirection, inset: style.paddingInlineStart };
  })).toEqual({ direction: 'column', inset: '16px' });
  await app.screenshot('pediatric-provider-error-card');
});


test('expression record controls have consistent heights', { tags: ['expression'], timeout: 120_000, retries: 0 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Expression');
  await screen.getByRole('combobox', 'Example').selectOption('Dense expression');
  await screen.getByText('Review context', { exact: true }).tap();
  const selected = await browser.evaluate(() => [...document.querySelectorAll('.xp-frame .ctx-chip[aria-pressed="true"]')].map(node => node.textContent!));
  for (const name of selected) await screen.getByRole('button', name, { exact: true }).tap();
  await expect(screen.getByRole('button', 'Choose systems')).toBeVisible();
  for (const width of [1440, 800, 390]) {
    await browser.setViewport({ width, height: 1000 });
    const controls = [screen.getByRole('searchbox', 'Search records'), screen.getByRole('button', 'Choose systems'), screen.getByRole('button', 'Show all 54 records')];
    for (const control of controls) {
      const box = await control.boundingBox();
      expect(box !== null && Math.abs(box.height - 38) <= 0.5).toBe(true);
    }
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await app.screenshot(`record-controls-${width}`);
  }
  await screen.getByRole('tab', 'Pediatric RNA').tap();
  await expect(screen.getByRole('combobox', 'Sampled age cohort')).toBeVisible();
  const cohort = await screen.getByRole('combobox', 'Sampled age cohort').boundingBox();
  expect(cohort !== null && Math.abs(cohort.height - 38) <= 0.5).toBe(true);
});


test('secondary source controls keep their width, selection border and keyboard navigation', { tags: ['expression'], timeout: 120_000, retries: 0 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Expression');
  const adult = screen.getByRole('tab', 'Adult RNA');
  const before = await adult.boundingBox();
  await adult.press('ArrowRight');
  await expect(screen.getByRole('tab', 'Pediatric RNA')).toBeSelected();
  const after = await adult.boundingBox();
  expect(before !== null && after !== null && Math.abs(before.width - after.width) < 0.5).toBe(true);
  expect(await browser.evaluate(() => {
    const selected = document.querySelector('.workspace-tabs[data-variant="secondary"] [aria-selected="true"]')!;
    const style = getComputedStyle(selected);
    return style.borderTopColor !== getComputedStyle(selected.parentElement!).borderTopColor;
  })).toBe(true);
  await screen.getByRole('tab', 'Pediatric RNA').press('ArrowLeft');
  await expect(adult).toBeSelected();
  await app.screenshot('secondary-source-selection');
});

test('Gene-disease presentation and search share a height and grow with text', { tags: ['expression'], timeout: 120_000, retries: 0 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Gene-disease');
  await screen.getByRole('combobox', 'Example').selectOption('Differing assertions');
  const mode = screen.getByRole('group', 'Validity presentation');
  const search = screen.getByRole('searchbox', 'Search records');
  for (const width of [1440, 800, 390]) {
    await browser.setViewport({ width, height: 900 });
    const groupBox = await mode.boundingBox();
    const searchBox = await search.boundingBox();
    expect(groupBox !== null && searchBox !== null && Math.abs(groupBox.height - searchBox.height) <= 0.5).toBe(true);
    expect(groupBox !== null && Math.abs(groupBox.height - 38) <= 0.5).toBe(true);
  }
  await browser.evaluate(() => {
    document.querySelectorAll<HTMLElement>('.cx-record-toolbar input[type="search"], .cx-record-toolbar .cs-seg-control button').forEach(node => { node.style.fontSize = '24px'; });
    return null;
  });
  const grownMode = await mode.boundingBox();
  const grownSearch = await search.boundingBox();
  expect(grownMode !== null && grownMode.height > 38 && grownSearch !== null && grownSearch.height > 38).toBe(true);
  expect(grownMode !== null && grownSearch !== null && Math.abs(grownMode.height - grownSearch.height) <= 0.5).toBe(true);
  expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await app.screenshot('record-controls-text-zoom');
});


test('coding map labels remain legible for narrow and dense regions', { tags: ['expression'], timeout: 120_000, retries: 0 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Expression');
  for (const count of [9, 320]) {
    await browser.evaluate(async ({ count }: { count: number }) => {
      const modulePath = '/src/stores/useVariantAnalysisStore.ts';
      const { useVariantAnalysisStore: store } = await import(modulePath);
      const analysis = store.getState().analysisState;
      const gene = analysis.result.metadata.gene;
      let start = 100;
      const lengths = count === 9 ? [1621, 35, 144, 138, 170, 94, 66, 185, 207] : Array.from({ length: count }, () => 10);
      const regions = lengths.map(length => {
        const region = { start, stop: start + length - 1, mean: 1, tissues: [] };
        start += length + 20;
        return region;
      });
      const active = count === 9 ? 0 : 159;
      const pos = regions[active].start + 1;
      store.setState({ analysisState: { ...analysis, result: { ...analysis.result, predictorData: { ...analysis.result.predictorData, gnomadVariantId: `21-${pos}-A-T`, gnomadVariantAssembly: 'GRCh38' } } } });
      store.setState({ extraContexts: { ...store.getState().extraContexts, [`pext:${gene}`]: { status: 'ready', data: { gene, status: 'ready', geneId: 'illustrative', chrom: '21', flags: [], provenance: null, message: null, regions } } } });
      return null;
    }, { count });
    await screen.getByRole('tab', 'Expression at variant').tap();
    await expect(screen.getByRole('img', new RegExp(`Mean base-level pext across ${count} coding regions`))).toBeVisible();
    const labels = await browser.evaluate(async () => {
      await document.fonts.ready;
      return [...document.querySelectorAll<SVGTextElement>('.xp-pext-map [data-region-label]')].map(node => {
        const box = node.getBBox();
        return { number: node.textContent, start: box.x, end: box.x + box.width, y: box.y };
      });
    });
    expect(labels.some(label => label.number === (count === 9 ? '2' : '160'))).toBe(true);
    if (count === 9) expect(labels.length).toBe(9);
    else expect(labels.length < 50).toBe(true);
    for (let i = 1; i < labels.length; i++) expect(labels[i].start > labels[i - 1].end).toBe(true);
    expect(new Set(labels.map(label => label.y)).size).toBe(1);
    await app.screenshot(`coding-map-${count}-regions`);
  }
});
