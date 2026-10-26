import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

// Hold context responses open to expose the ordering without live scientific providers.
test('warms gene and species evidence before core results or tab visits', { tags: ['search', 'gene-disease'], timeout: 45_000, retries: 0 }, async ({ app, browser, screen }) => {
  await skipTour(browser);
  await browser.addInitScript(() => {
    const state = window as unknown as { contextRequests: string[]; contextsStarted: Promise<void> };
    state.contextRequests = [];
    let started!: () => void;
    state.contextsStarted = new Promise(resolve => { started = resolve; });
    const prior = window.fetch;
    // UROD evidence requests are held open for the whole test (never resolved or restored): the
    // test only observes which requests start, and in what order.
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/evidence-context/UROD')) return prior(input, init);
      state.contextRequests.push(url);
      if (['/UROD', '/UROD/dosage', '/UROD/models', '/UROD/alignment', '/UROD/phenotypes'].every(suffix => state.contextRequests.some(request => request.endsWith(suffix)))) started();
      return new Promise<Response>(() => {});
    };
  });
  await app.open('/');
  await expect(screen.getByRole('heading', 'Analyse a variant')).toBeVisible();
  const beforeCore = await browser.evaluate(async () => {
    const path = '/src/stores/useVariantAnalysisStore.ts';
    const { useVariantAnalysisStore: store } = await import(path);
    store.setState({ gene: 'UROD', variant: 'p.Gly318Arg', uniprotId: 'P06132', analysisState: { isLoading: true, error: null, result: null } });
    const state = window as unknown as { contextRequests: string[]; contextsStarted: Promise<void> };
    await state.contextsStarted;
    return { requests: state.contextRequests, hasResult: !!store.getState().analysisState.result };
  });
  expect(beforeCore.hasResult).toBe(false);
  expect(beforeCore.requests).toContain('/api/v1/evidence-context/UROD');
  expect(beforeCore.requests).toContain('/api/v1/evidence-context/UROD/models');
  await browser.evaluate(async () => {
    const storePath = '/src/stores/useVariantAnalysisStore.ts';
    const factoryPath = '/src/services/pipeline/pipelineStateFactory.ts';
    const { useVariantAnalysisStore: store } = await import(storePath);
    const { createPlaceholderAnalysisState } = await import(factoryPath);
    store.getState().setAnalysisState(createPlaceholderAnalysisState({ gene: 'UROD', variant: 'p.Gly318Arg', uniprotId: 'P06132', residueIndex: 318, wildType: 'G', mutant: 'R' }));
    return true;
  });
  await screen.getByRole('button', /^Gene.disease/).tap();
  await expect(screen.getByTestId('gene-disease-screen')).toBeVisible();
  await screen.getByRole('button', /^Species & models/).tap();
  await expect(screen.getByRole('heading', 'Species & models', { exact: true })).toBeVisible();
  expect(await browser.evaluate(() => (window as unknown as { contextRequests: string[] }).contextRequests.length)).toBe(beforeCore.requests.length);
});
