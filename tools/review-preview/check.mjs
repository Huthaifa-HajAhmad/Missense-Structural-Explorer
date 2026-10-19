#!/usr/bin/env node
/** Recorded/illustrative fixtures only. Run against the local Vite preview. */
import fs from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const candidates = [process.env.PLAYWRIGHT_MODULE,
  path.join(root, 'tools/review-preview/node_modules/playwright-core/index.mjs'),
  path.join(root, 'node_modules/playwright-core/index.mjs'),
  path.join(root, 'scratch/literature-browser/node_modules/playwright-core/index.mjs')];
const modulePath = candidates.find(p => p && existsSync(p));
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to an installed playwright-core/index.mjs.');
const { chromium } = await import(pathToFileURL(path.resolve(modulePath)).href);
const executablePath = [process.env.BROWSER_PATH, process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
const output = path.join(root, 'scratch/review-preview');
await fs.mkdir(output, { recursive: true });
// Start an isolated fixture server unless the caller provides one.
let server;
let previewUrl = process.env.REVIEW_PREVIEW_URL;
if (!previewUrl) {
 const { createServer } = await import('vite');
 server = await createServer({ root, server: { host: '127.0.0.1', port: 5189, fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } } });
 await server.listen();
 previewUrl = server.resolvedUrls.local[0] + 'tools/review-preview/index.html';
}
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const checks = [], errors = [];
const check = (name, pass) => { checks.push({ name, pass }); if (!pass) console.log('FAIL', name); };
// Use actual wheel input: scrollIntoView would make hidden-overflow panes look reachable.
async function reachWithWheel(page, locator) {
 const size = page.viewportSize();
 await page.locator('.data-screen-layout, .data-screen-primary').evaluateAll(es => es.forEach(e => { e.scrollTop = 0; }));
 const pane = await page.locator('.data-screen-primary').boundingBox();
 await page.mouse.move(pane.x + pane.width / 2, Math.min(size.height - 60, Math.max(100, pane.y + 400)));
 for (let i = 0; i < 12; i++) {
  const bounds = await locator.boundingBox();
  if (bounds && bounds.y >= 0 && bounds.y < size.height - 40) return true;
  await page.mouse.wheel(0, 500); await page.waitForTimeout(100);
 }
 return false;
}
try {
 const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
 page.on('pageerror', e => errors.push(e.message));
 await page.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
 await page.getByRole('button', { name: 'Computational', exact: true }).waitFor();
 await page.getByRole('button', { name: 'Computational', exact: true }).click();
 check('Lane selection shares inspector', (await page.getByRole('region', { name: 'Selected evidence reading' }).innerText()).includes('Computational'));
 await page.getByRole('tab', { name: 'Criterion records' }).click();
 check('Criteria table preserves engine record', (await page.locator('.ins-record-table').innerText()).includes('PP3'));
 await page.getByLabel('Workspace', { exact: true }).selectOption('literature');
 await page.getByLabel('Workspace', { exact: true }).selectOption('insights');
 check('Insights view persists', await page.getByRole('tab', { name: 'Criterion records' }).getAttribute('aria-selected') === 'true');
 await page.getByRole('button', { name: 'Show in evidence map' }).click();
 check('Explicit lane reveal focuses', await page.getByRole('button', { name: 'Computational', exact: true }).evaluate(e => e === document.activeElement));
 for (const width of [1500, 800, 390]) {
  await page.setViewportSize({ width, height: 1100 });
  check('Insights final section reachable by wheel ' + width, await reachWithWheel(page, page.locator('.ins-screen [role="tabpanel"] > :last-child')));
  await page.getByRole('tab', { name: 'Criterion records' }).click();
  check('Insights guide reachable by wheel ' + width, await reachWithWheel(page, page.locator('.ins-details')));
  await page.getByRole('tab', { name: 'Written summary' }).click();
  check('Written summary reachable ' + width, await reachWithWheel(page, page.locator('.ins-prose')));
  await page.getByRole('tab', { name: 'Evidence map' }).click();
  check('Insights fits width ' + width, await page.locator('.ins-screen').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
  if (width <= 1000) check('Narrow Insights expands into page scroll ' + width, await page.locator('.data-screen-primary').evaluate(e => e.scrollHeight <= e.clientHeight + 1));
  await page.locator('.data-screen-layout, .data-screen-primary, .lit-view').evaluateAll(elements => elements.forEach(e => { e.scrollTop = 0; }));
  await page.screenshot({ path: `${output}/insights-${width}-light.png` });
 }
 await page.setViewportSize({ width: 1500, height: 1100 });
 check('Open inspector button removed', (await page.getByRole('button', { name: 'Open inspector' }).count()) === 0);
 await page.getByRole('button', { name: 'Collapse Inspector Panel', exact: true }).click();
 check('Inspector collapses', (await page.getByLabel('Collapsed Context Inspector').count()) === 1);
 await page.getByRole('button', { name: 'Expand Context Inspector', exact: true }).click();
 check('Inspector uses registered section', await page.getByRole('region', { name: 'Selected evidence reading' }).evaluate(e => e.id === 'inspector-evidence-reading'));
 check('Review actions meet 44px touch size', await page.locator('.review-action').evaluateAll(es => { const visible = es.filter(e => e.getBoundingClientRect().height > 0); return visible.length > 0 && visible.every(e => e.getBoundingClientRect().height >= 44); }));
 await page.emulateMedia({ media: 'print' });
 check('Closed classification disclosure prints', await page.locator('.ins-tiers').evaluate(e => e.getBoundingClientRect().height > 0));
 await page.emulateMedia({ media: 'screen' });
 await page.getByRole('tab', { name: 'Written summary' }).click();
 check('Rule-based summary labelled', await page.getByText('Rule-based synthesis', { exact: false }).isVisible());
 await page.getByRole('button', { name: 'Switch theme', exact: true }).click();
 await page.getByRole('tab', { name: 'Evidence map' }).click();
 await page.screenshot({ path: `${output}/insights-dark.png` });
 await page.getByRole('button', { name: 'Switch theme', exact: true }).click();
 await page.getByLabel('Workspace', { exact: true }).selectOption('literature');
 await page.emulateMedia({ media: 'print' });
 check('Closed search facts print', await page.locator('.lit-facts').evaluate(e => e.getBoundingClientRect().height > 0));
 await page.emulateMedia({ media: 'screen' });
 await page.getByRole('button', { name: 'Show all tiers' }).click();
 check('Desk bounded at eight', await page.locator('.lit-row').count() === 8);
 await page.getByRole('tab', { name: 'Mention coverage' }).click();
 check('Shortlist export disabled in coverage', await page.getByRole('button', { name: 'Export shortlist', exact: true }).isDisabled());
 check('Coverage rows are navigation, not toggles', await page.locator('.lit-coverage__rows button[aria-pressed]').count() === 0);
 await page.emulateMedia({ media: 'print' });
 check('Coverage figure and abstract counts print', await page.locator('.lit-coverage').isVisible() && await page.locator('.lit-text-coverage').isVisible());
 await page.emulateMedia({ media: 'screen' });
 check('Coverage has no duplicate papers', await page.locator('.lit-row').count() === 0);
 check('Coverage denominator is loaded count', (await page.locator('.lit-coverage').innerText()).includes('25 loaded papers'));
 await page.getByRole('tab', { name: 'Reading desk' }).click();
 await page.locator('[data-testid="paper-91000000"]').getByRole('button', { name: 'Inspect source' }).click();
 await page.getByRole('tab', { name: 'Mention coverage' }).click();
 await page.getByRole('button', { name: /^Names only NAE1/ }).click();
 check('Hidden source notice', await page.getByText('This paper is outside the current reading desk or filters. Its source remains selected.').isVisible());
 await page.getByRole('button', { name: 'Show selected source record' }).click();
 check('Selected source revealed and focused', await page.locator('#lit-paper-91000000').evaluate(e => e === document.activeElement));
 check('All records exposed', await page.locator('.lit-row').count() === 25);
 await page.getByLabel('Search literature', { exact: true }).fill('NAE1');
 check('Reveal consumed; typing keeps focus', await page.getByLabel('Search literature', { exact: true }).evaluate(e => e === document.activeElement));
 await page.getByLabel('Search literature', { exact: true }).fill('');
 await page.getByRole('tab', { name: 'Reading desk' }).click();
 await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
 for (const width of [1500, 800, 390]) {
  await page.setViewportSize({ width, height: 1100 });
  check('Literature fits width ' + width, await page.locator('.lit-screen').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
  await page.getByRole('tab', { name: 'Mention coverage' }).click();
  check('Coverage fits width ' + width, await page.locator('.lit-coverage').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
  await page.locator('.data-screen-layout, .data-screen-primary, .lit-view').evaluateAll(elements => elements.forEach(e => { e.scrollTop = 0; }));
  await page.screenshot({ path: `${output}/literature-${width}-light.png` });
 }
 await page.setViewportSize({ width: 1500, height: 1100 });
 await page.getByRole('button', { name: 'Switch theme', exact: true }).click();
 await page.screenshot({ path: `${output}/literature-dark.png` });
 await page.getByRole('tab', { name: 'Reading desk' }).click();
 await page.getByRole('button', { name: 'Load 25 more', exact: true }).click();
 await page.getByRole('tab', { name: 'Reading desk' }).click();
 check('Pagination deduplicates and retains all records', await page.locator('.lit-row').count() === 36);
 for (const width of [800, 390]) {
  await page.setViewportSize({ width, height: 1100 });
  check('Source records fit width ' + width, await page.locator('.lit-table-wrap').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
  await page.locator('[data-testid="paper-91000000"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/literature-records-${width}.png` });
 }
 await page.setViewportSize({ width: 1500, height: 1100 });
 await page.getByLabel('Example', { exact: true }).selectOption('Sparse');
 await page.getByTestId('literature-papers').getByRole('button', { name: 'Search Europe PMC', exact: true }).click();
 await page.waitForFunction(() => document.querySelectorAll('.lit-row').length === 2);
 check('Sparse papers remain accessible', await page.locator('.lit-row').count() === 2);
 await page.getByLabel('Example', { exact: true }).selectOption('Missing');
 await page.getByTestId('literature-papers').getByRole('button', { name: 'Search Europe PMC', exact: true }).click();
 await page.getByTestId('literature-empty').waitFor();
 await page.getByRole('tab', { name: 'Mention coverage' }).click();
 await page.getByRole('button', { name: 'Open reading desk', exact: true }).click();
 check('Empty coverage returns focus to reading desk', await page.getByRole('tab', { name: 'Reading desk' }).evaluate(e => e === document.activeElement));
 check('Missing papers have explicit empty state', await page.getByText('No papers returned', { exact: true }).isVisible());
 await page.getByLabel('Example', { exact: true }).selectOption('Degraded');
 await page.getByTestId('literature-papers').getByRole('button', { name: 'Search Europe PMC', exact: true }).click();
 await page.locator('.lit-row').first().waitFor();
 check('Degraded query identified', (await page.getByTestId('literature-finding').innerText()).includes('cache'));
 await page.getByLabel('Example', { exact: true }).selectOption('Error');
 await page.getByTestId('literature-papers').getByRole('button', { name: 'Search Europe PMC', exact: true }).click();
 await page.getByText('Europe PMC search failed.', { exact: true }).waitFor();
 check('Provider failure stays visible beside retained sources', await page.locator('.lit-row').count() > 0);
 await page.getByLabel('Workspace', { exact: true }).selectOption('insights');
 await page.getByLabel('Example', { exact: true }).selectOption('Strength suffix');
 await page.getByRole('button', { name: 'Computational', exact: true }).click();
 check('Suffixed strength shown in inspector', (await page.getByRole('region', { name: 'Selected evidence reading' }).innerText()).includes('Recorded strength: Moderate.'));
 check('Suffixed strength shown in map', await page.locator('[data-lane="computational"] .ins-dim').innerText() === 'Moderate');
 await page.getByLabel('Workspace', { exact: true }).selectOption('literature');
 await page.getByLabel('Example', { exact: true }).selectOption('Unsupported notation');
 await page.getByRole('tab', { name: 'Mention coverage' }).click();
 await page.locator('.lit-coverage').waitFor();
 check('Unsupported notation has no zero-match variant group', await page.locator('.lit-coverage__rows button').count() === 2 && (await page.locator('.lit-coverage').innerText()).includes('check the gene only'));
 await page.getByLabel('Workspace', { exact: true }).selectOption('insights');
 await page.getByRole('button', { name: 'Computational', exact: true }).click();
 await page.getByLabel('Example', { exact: true }).selectOption('New allele');
 check('New allele resets selection', await page.getByRole('button', { name: 'Clear selection', exact: true }).count() === 0);
 await page.getByRole('tab', { name: 'Evidence gaps' }).click();
 check('Gaps own the missing-evidence questions', await page.getByRole('heading', { name: 'Still needed to decide' }).isVisible() && await page.locator('.ins-lane').count() === 0);
 await page.getByLabel('Workspace', { exact: true }).selectOption('report');
 await page.getByRole('tab', { name: 'Citations & methods' }).click();
 check('Report methods have a dedicated view', await page.locator('#report-method').isVisible() && !await page.locator('#report-classification').isVisible());
 await page.getByRole('tab', { name: 'Narrative & notes' }).click();
 check('Narrative view excludes methods', !await page.locator('#report-method').isVisible());
 for (const width of [1500, 800, 390]) {
  await page.setViewportSize({ width, height: 1100 });
  check('Report fits width ' + width, await page.locator('.rpt-screen').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
  await page.screenshot({ path: `${output}/report-writing-${width}.png` });
 }
 await page.setViewportSize({ width: 1500, height: 1100 });
 await page.getByRole('tab', { name: 'Citations & methods' }).click();
 await page.emulateMedia({ media: 'print' });
 check('Print retains classification outside current view', await page.locator('#report-classification').isVisible());
 await page.emulateMedia({ media: 'screen' });
 await page.screenshot({ path: `${output}/report-sources.png` });
 // Keep unrelated Query checks available; synthesis reviews can select their owned surface.
 if (process.env.REVIEW_PREVIEW_SCOPE !== 'synthesis') {
 await page.getByLabel('Workspace', { exact: true }).selectOption('search');
 // The accession field has no reveal step: it is on first paint, and its STATE owns the label row's
 // right slot (where Set/Hide used to be), so the state and the control it describes share one line.
 const accession = page.locator('#input-uniprot-acc');
 check('Query accession field needs no disclosure', await accession.isVisible());
 await accession.focus();
 check('Query accession is keyboard reachable', await accession.evaluate(e => e === document.activeElement));
 await accession.fill('Q9H8M5');
 // The two route columns share row baselines: the notation field (left, row 2) sits level with the
 // coordinate field (right, row 2), at the same height. The accession now lives under them (left, row 3).
 const inputRows = await page.locator('#input-variant-notation, #input-genomic-coords').evaluateAll(elements => elements.map(e => { const r = e.getBoundingClientRect(); return { top: r.top, height: r.height, width: r.width }; }));
 const wide = (await page.viewportSize()).width >= 1024;
 check('Query notation and coordinate fields share a baseline', inputRows.length === 2 && (!wide || (Math.abs(inputRows[0].top - inputRows[1].top) < 1 && Math.abs(inputRows[0].height - inputRows[1].height) < 1)));
 const accessionBox = await accession.boundingBox();
 check('Query accession sits below the notation field', accessionBox !== null && accessionBox.y > inputRows[0].top + inputRows[0].height);
 // The state reads from the label row, above the control — and above its own input's top edge.
 const state = page.locator('#input-uniprot-acc-status');
 const stateBox = await state.boundingBox();
 check('Query accession state sits in the label row', stateBox !== null && accessionBox !== null && stateBox.y + stateBox.height <= accessionBox.y + 1);
 check('Query accession state names the format', (await state.innerText()).trim() === 'Format OK');
 await page.screenshot({ path: `${output}/query-desktop.png` });
 await page.setViewportSize({ width: 390, height: 1100 });
 check('Query fits phone viewport', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
 await page.screenshot({ path: `${output}/query-phone.png` });
 }
 check('No runtime errors', errors.length === 0);
 await fs.writeFile(`${output}/checks.json`, JSON.stringify({ checks, errors }, null, 2));
 console.log(JSON.stringify({ passed: checks.filter(c => c.pass).length, total: checks.length, failed: checks.filter(c => !c.pass), errors }));
 if (checks.some(c => !c.pass) || errors.length) process.exitCode = 1;
} finally { await browser.close(); await server?.close(); }
