import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';

// Production UI and loader, controlled provider responses. No scientific/live data is fabricated
// as an observation: the preview labels these records illustrative throughout the flow.
test('dosage failure recovers to a verified empty lookup without blocking disease review', { tags: ['gene-disease'], timeout: 120_000, retries: 0 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Gene-disease');
  await screen.getByRole('combobox', 'Example').selectOption('Single disease');
  await screen.getByRole('combobox', 'Evidence').selectOption('Expression');
  await browser.evaluate(async () => {
    const modulePath = '/src/stores/useVariantAnalysisStore.ts';
    const { useVariantAnalysisStore } = await import(modulePath);
    useVariantAnalysisStore.setState({ dosageContexts: {} });
    const testWindow = window as unknown as { finishDosage: (data: unknown) => void; dosageRequests: number };
    testWindow.dosageRequests = 0;
    const prior = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith('/evidence-context/SOD1/dosage')) return prior(input, init);
      testWindow.dosageRequests++;
      return new Promise<Response>(resolve => { testWindow.finishDosage = data => resolve(Response.json(data)); });
    };
    return true;
  });
  await screen.getByRole('combobox', 'Evidence').selectOption('Gene-disease');
  const dosage = screen.getByTestId('dosage-card');
  await expect(dosage).toContainText('Running');
  await expect(dosage.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  await screen.getByRole('button', 'Review this disease').tap();
  await expect(screen.getByRole('region', 'Submitted validity assertion matrix')).toBeVisible();
  await browser.evaluate(() => {
    (window as unknown as { finishDosage: (data: unknown) => void }).finishDosage({ gene: 'SOD1', status: 'error', record: null, provenance: null, message: 'The ClinGen dosage request timed out. Curation availability could not be checked.' });
    return true;
  });
  await screen.getByRole('tab', 'Dosage').tap();
  await expect(dosage).toContainText('Provider error');
  await expect(dosage).toContainText('timed out');
  await app.screenshot('dosage-provider-error');
  await dosage.getByRole('button', 'Try again').tap();
  await expect(dosage).toContainText('Running');
  await expect(dosage.getByRole('button')).toHaveCount(0);
  await expect(screen.getByTestId('context-sources')).toContainText('Running');
  await browser.evaluate(() => {
    (window as unknown as { finishDosage: (data: unknown) => void }).finishDosage({ gene: 'SOD1', status: 'not-found', record: null,
      provenance: { source: 'ClinGen dosage sensitivity', url: 'https://example.org/illustrative', licence: 'Illustrative fixture', release: null, retrievedAt: '2026-10-16T12:00:00Z', sha256: 'a'.repeat(64), timestampBasis: 'download' },
      message: 'No ClinGen dosage curation is listed for SOD1 in the complete source table. This does not mean copy-number changes are tolerated.' });
    return true;
  });
  await expect(dosage).toContainText('No result');
  await expect(dosage).toContainText('Source table retrieved 2026-10-16');
  await expect(dosage.getByRole('status')).toHaveAttribute('aria-busy', 'false');
  await expect(screen.getByTestId('context-sources')).toContainText('No result');
  await expect(screen.getByTestId('context-sources')).not.toContainText('Provider error');
  await app.screenshot('dosage-verified-empty');
  await screen.getByRole('tab', 'Mechanism').tap();
  await expect(screen.getByRole('heading', 'Disease mechanism')).toBeVisible();
  expect(await browser.evaluate(() => (window as unknown as { dosageRequests: number }).dosageRequests)).toBe(2);
});
