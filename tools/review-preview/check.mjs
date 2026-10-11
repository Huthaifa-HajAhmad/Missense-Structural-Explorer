#!/usr/bin/env node
/** Recorded/illustrative fixtures only. Run against the local Vite preview. */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const candidates = [process.env.PLAYWRIGHT_MODULE,
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
 await page.goto(process.env.REVIEW_PREVIEW_URL ?? 'http://127.0.0.1:5187/tools/review-preview/index.html');
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
 await page.getByRole('button', { name: 'Open inspector', exact: true }).click();
 check('Open inspector uses registered section', await page.getByRole('region', { name: 'Selected evidence reading' }).evaluate(e => e.id === 'inspector-evidence-reading' && e === document.activeElement));
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
 check('Coverage denominator is loaded count', (await page.locator('.lit-coverage').innerText()).includes('25 loaded papers'));
 await page.locator('[data-testid="paper-91000000"]').getByRole('button', { name: 'Inspect source' }).click();
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
  check('Coverage fits width ' + width, await page.locator('.lit-coverage').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
  await page.locator('.data-screen-layout, .data-screen-primary, .lit-view').evaluateAll(elements => elements.forEach(e => { e.scrollTop = 0; }));
  await page.screenshot({ path: `${output}/literature-${width}-light.png` });
 }
 await page.setViewportSize({ width: 1500, height: 1100 });
 await page.getByRole('button', { name: 'Switch theme', exact: true }).click();
 await page.screenshot({ path: `${output}/literature-dark.png` });
 await page.getByRole('button', { name: 'Load 25 more', exact: true }).click();
 await page.getByRole('tab', { name: 'Source records' }).click();
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
 await page.locator('.lit-coverage').waitFor();
 check('Unsupported notation has no zero-match variant group', await page.locator('.lit-coverage__rows button').count() === 2 && (await page.locator('.lit-coverage').innerText()).includes('check the gene only'));
 await page.getByLabel('Workspace', { exact: true }).selectOption('insights');
 await page.getByRole('button', { name: 'Computational', exact: true }).click();
 await page.getByLabel('Example', { exact: true }).selectOption('New allele');
 check('New allele resets selection', await page.getByRole('button', { name: 'Clear selection', exact: true }).count() === 0);
 check('No runtime errors', errors.length === 0);
 await fs.writeFile(`${output}/checks.json`, JSON.stringify({ checks, errors }, null, 2));
 console.log(JSON.stringify({ passed: checks.filter(c => c.pass).length, total: checks.length, failed: checks.filter(c => !c.pass), errors }));
 if (checks.some(c => !c.pass) || errors.length) process.exitCode = 1;
} finally { await browser.close(); }
