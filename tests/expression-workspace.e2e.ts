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
  await expect(screen.getByTestId('expression-finding')).toContainText('29 TPM');
  await expect(screen.getByText(/Linear TPM scale: 0–36/)).toBeVisible();
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
      for (const [view, card] of [['Tissue explorer', 'expression-finding'], ['Sampling & coverage', 'context-records'], ['Protein measurements', 'hpa-card'], ['Expression at variant', 'pext-card']]) {
        await screen.getByRole('tab', view).tap();
        await expect(screen.getByTestId(card)).toBeVisible();
        await expect(screen.getByTestId('expression-finding')).toHaveCount(view === 'Protein measurements' || view === 'Expression at variant' ? 0 : 1);
        expect(await browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await app.screenshot(`${view}-${width}-${theme}`);
      }
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
