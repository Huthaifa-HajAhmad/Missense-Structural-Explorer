import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { skipTour } from './support.js';
import { EVIDENCE_TABS } from '../src/shared/evidenceTabs.js';

// Production components, wrapper and styles; providers use explicit illustrative fixtures.
for (const tab of EVIDENCE_TABS) {
test(`${tab.label} subtabs have populated labelled panels and fit light, dark and narrow layouts`, { tags: ['evidence-consistency'], timeout: 120_000, retries: 0 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
    await browser.setViewport({ width: 1440, height: 1000 });
    await app.open(tab.id === 'interfaces' ? '/tools/mechanism-preview/index.html' : '/tools/evidence-preview/index.html');
    await screen.getByRole('combobox', 'Evidence').selectOption(tab.id === 'clinical' ? 'Population Data' : tab.id === 'predictors' ? 'Predictors' : tab.id === 'gene-disease' ? 'Gene-disease' : tab.label);
    await expect(screen.getByRole('heading', tab.label, { exact: true })).toBeVisible();
    const tabs = await browser.evaluate(() => [...document.querySelector('[data-evidence-screen] [role="tablist"]')!.querySelectorAll('[role="tab"]')].map(el => el.textContent!.trim()));
    expect(tabs.length > 0, `${tab.label}: offers subtab navigation`).toBe(true);
    for (const width of [1440, 390]) {
      await browser.setViewport({ width, height: 1000 });
      for (const theme of ['light', 'dark']) {
        const dark = await browser.evaluate(() => document.documentElement.classList.contains('dark'));
        if (dark !== (theme === 'dark')) await screen.getByRole('button', 'Switch theme').tap();
        for (const name of tabs) {
          await screen.getByRole('tab', name, { exact: true }).tap();
          await expect(screen.getByRole('tab', name, { exact: true })).toBeSelected();
          const state = await browser.evaluate(() => {
            const root = document.querySelector('[data-evidence-screen]')!;
            const selected = root.querySelector('[role="tab"][aria-selected="true"]')!;
            const panel = document.getElementById(selected.getAttribute('aria-controls')!);
            return { labelled: panel?.getAttribute('aria-labelledby') === selected.id,
              content: Boolean(panel?.textContent?.trim()),
              fits: document.documentElement.scrollWidth <= innerWidth + 1,
              roots: document.querySelectorAll('[data-evidence-screen]').length,
              rankLabels: [...root.querySelectorAll('.ag-rank__label')].filter(el => el.getClientRects().length).map(el => { const box = el.getBoundingClientRect(); return { start: box.left, end: box.right }; }) };
          });
          expect(state.labelled, `${tab.label}/${name}: panel labels`).toBe(true);
          expect(state.content, `${tab.label}/${name}: content or explicit empty state`).toBe(true);
          expect(state.fits, `${tab.label}/${name}/${width}/${theme}: page overflow`).toBe(true);
          expect(state.roots).toBe(1);
          expect(state.rankLabels.every((box, i, labels) => i === 0 || box.start >= labels[i - 1].end + 2), `${tab.label}/${width}: rank labels do not overlap`).toBe(true);
          if (tab.id === 'species-models' && name === 'Protein alignments') {
            await expect(screen.getByTestId('residue-alignment-card')).toBeVisible();
            expect(await browser.evaluate(() => document.querySelector('.sm-review') === null)).toBe(true);
          }
          await app.screenshot(`${tab.id}-${name.replaceAll(/[^a-zA-Z0-9]/g, '-')}-${width}-${theme}`);
        }
      }
    }
});
}

test('protein alignment explains a reference mismatch without inventing mapped residues', { tags: ['evidence-consistency'], timeout: 60_000, retries: 0 }, async ({ app, screen, browser }) => {
  await skipTour(browser);
  await browser.setViewport({ width: 1440, height: 1000 });
  await app.open('/tools/evidence-preview/index.html');
  await screen.getByRole('combobox', 'Evidence').selectOption('Species & models');
  await screen.getByRole('combobox', 'Example').selectOption('Mismatch');
  await screen.getByRole('combobox', 'Evidence').selectOption('Species & models');
  await screen.getByRole('tab', 'Protein alignments').tap();
  await expect(screen.getByTestId('residue-alignment-card')).toContainText('No residue is mapped');
  await expect(screen.getByRole('region', 'Residue aligned in each ortholog')).toHaveCount(0);
  expect(await browser.evaluate(() => document.querySelector('.sm-review') === null)).toBe(true);
  await app.screenshot('species-reference-mismatch');
});
