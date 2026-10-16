#!/usr/bin/env node
/** Production explanation entry points; illustrative content, no live scientific services. */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modulePath = [process.env.PLAYWRIGHT_MODULE,
  path.join(root, 'node_modules/playwright-core/index.mjs'),
  path.join(root, 'scratch/literature-browser/node_modules/playwright-core/index.mjs')].find(p => p && existsSync(p));
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to an installed playwright-core/index.mjs.');
const { chromium } = await import(pathToFileURL(path.resolve(modulePath)).href);
const executablePath = [process.env.BROWSER_PATH, process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
const output = path.join(root, 'scratch/explanation-preview');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const checks = [], errors = [];
const check = (name, pass) => { checks.push({ name, pass }); if (!pass) console.error('FAIL', name); };
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.EXPLANATION_PREVIEW_URL ?? 'http://127.0.0.1:5188/tools/explanation-preview/index.html');
  const open = async name => {
    await page.getByRole('button', { name, exact: true }).click();
    await page.locator('dialog:modal').waitFor();
    await page.waitForTimeout(250);
  };
  for (const [button, title] of [
    ['About FoldX', /FoldX/], ['About REVEL', /REVEL/], ['Explain RMSD', /RMSD/],
    ['Read the 3D view', /3D/], ['Explain LLR', /likelihood/], ['Why no result?', /Missing/],
  ]) {
    await open(button);
    check(`${button}: own topic`, await page.getByRole('heading', { level: 2, name: title }).count() === 1);
    check(`${button}: initial focus`, await page.evaluate(() => document.activeElement?.tagName === 'H2'));
    check(`${button}: no topic browser`, await page.getByRole('searchbox').count() === 0 && await page.getByText('All topics', { exact: true }).count() === 0);
    await page.keyboard.press('Escape');
    check(`${button}: Escape closes`, await page.locator('dialog').count() === 0);
    check(`${button}: restores focus`, await page.getByRole('button', { name: button, exact: true }).evaluate(el => document.activeElement === el));
  }
  await open('About REVEL');
  await page.getByText('Published evidence bands', { exact: true }).click();
  check('Calibration retains numeric evidence bands', await page.getByRole('table').isVisible());
  await page.keyboard.press('Escape');
  await open('About FoldX');
  await page.keyboard.press('Control+k');
  check('Command shortcut cannot open a palette behind the drawer', await page.getByRole('dialog').count() === 1 && await page.getByPlaceholder(/search views/i).count() === 0);
  await page.keyboard.press('Control+b');
  check('Sidebar shortcut yields to the drawer', await page.getByLabel('Sidebar toggle count').textContent() === '0');
  await page.getByRole('button', { name: 'Close explanation' }).focus();
  await page.keyboard.press('Tab');
  check('Tab still moves inside the drawer after shortcuts', await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement) && document.activeElement?.getAttribute('aria-label') !== 'Close explanation'));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+b');
  check('Sidebar shortcut resumes after dismissal', await page.getByLabel('Sidebar toggle count').textContent() === '1');
  await page.keyboard.press('Control+k');
  check('Command shortcut resumes after dismissal', await page.getByPlaceholder(/search views/i).isVisible());
  await page.keyboard.press('Escape');

  for (const [width, height, textSize] of [[320, 568, '100%'], [667, 375, '100%'], [390, 700, '200%']]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(size => document.documentElement.style.fontSize = size, textSize);
    await open('About VESM embeddings');
    check(`${width}x${height} text ${textSize}: readable body and reachable exit`, await page.locator('dialog').evaluate(el => {
      const body = el.querySelector('.rgd-body').getBoundingClientRect();
      const exit = el.querySelector('.rgd-close').getBoundingClientRect();
      return body.height > 80 && exit.bottom <= innerHeight && el.scrollWidth <= el.clientWidth;
    }));
    await page.screenshot({ path: `${output}/vesm-${width}-${height}-${textSize.replace('%', '')}.png` });
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => document.documentElement.style.fontSize = '');
  await page.setViewportSize({ width: 390, height: 700 });
  await open('About VESM embeddings');
  await page.locator('dialog').evaluate(dialog => {
    const text = [...dialog.querySelectorAll('h2, h3, p, button, dt, dd, strong, a, li, span')];
    const sizes = text.map(el => parseFloat(getComputedStyle(el).fontSize));
    text.forEach((el, i) => el.style.fontSize = `${sizes[i] * 2}px`);
  });
  check('Doubled text retains a scrollable reading and visible exit', await page.locator('dialog').evaluate(dialog => {
    const body = dialog.querySelector('.rgd-body');
    const exit = dialog.querySelector('.rgd-close').getBoundingClientRect();
    return body.clientHeight > 80 && body.scrollHeight > body.clientHeight && body.scrollWidth <= body.clientWidth && exit.bottom <= innerHeight;
  }));
  await page.screenshot({ path: `${output}/vesm-doubled-text.png` });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1500, height: 900 });
  await open('About FoldX');
  await page.getByRole('button', { name: /stability change/, exact: false }).scrollIntoViewIfNeeded();
  const savedScroll = await page.locator('.rgd-body').evaluate(el => el.scrollTop);
  await page.getByRole('button', { name: /stability change/, exact: false }).click();
  await page.getByRole('button', { name: 'Back to FoldX' }).click();
  check('Returning from a related concept restores the reading position', Math.abs(await page.locator('.rgd-body').evaluate(el => el.scrollTop) - savedScroll) < 2);
  await page.keyboard.press('Escape');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
    for (const width of [1500, 800, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open('About FoldX');
      const geometry = await page.locator('dialog').evaluate(el => {
        const rect = el.getBoundingClientRect(), body = el.querySelector('.rgd-body');
        return { right: rect.right, left: rect.left, width: rect.width, height: rect.height,
          overflow: el.scrollWidth > el.clientWidth || body.scrollWidth > body.clientWidth,
          scrollable: body.scrollHeight > body.clientHeight,
          backdrop: getComputedStyle(el, '::backdrop').backgroundColor };
      });
      check(`${theme} ${width}: right-side geometry`, Math.abs(geometry.right - width) < 2 && geometry.left >= 0 && Math.abs(geometry.height - 900) < 2);
      check(`${theme} ${width}: no content overflow`, !geometry.overflow);
      check(`${theme} ${width}: scrollable explanation`, geometry.scrollable);
      check(`${theme} ${width}: dimmed backdrop`, /0\.48/.test(geometry.backdrop));
      await page.screenshot({ path: `${output}/foldx-${width}-${theme}.png` });
      const before = await page.evaluate(() => scrollY);
      await page.locator('.rgd-body').hover();
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(100);
      check(`${theme} ${width}: content scroll keeps context`, await page.evaluate(y => scrollY === y && document.querySelector('.rgd-body').scrollTop > 0, before));
      await page.getByRole('button', { name: 'Return to workspace', exact: true }).click();
    }
  }
  await page.setViewportSize({ width: 1500, height: 900 });
  await open('About FoldX');
  await page.getByRole('button', { name: 'Return to workspace', exact: true }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  check('Keyboard does not reach background controls', await page.evaluate(() => !document.querySelector('main').contains(document.activeElement)));
  await page.evaluate(() => document.querySelector('main button').focus());
  check('Modal makes background controls inert', await page.evaluate(() => !document.querySelector('main').contains(document.activeElement)));
  await page.mouse.click(30, 400);
  check('Backdrop click closes drawer', await page.locator('dialog').count() === 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open('Explain LLR');
  check('OS reduced motion disables animation', await page.locator('dialog').evaluate(el => getComputedStyle(el).animationName === 'none'));
  await page.screenshot({ path: `${output}/llr-example-dark.png` });
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Toggle reduced motion', exact: true }).click();
  await open('Explain RMSD');
  check('App reduced motion disables animation', await page.locator('dialog').evaluate(el => getComputedStyle(el).animationName === 'none'));
  // Exercise contextual links in the real Evidence dashboard and its selected-record inspector.
  await page.goto(new URL('/tools/mechanism-preview/index.html', page.url()).href);
  await page.getByRole('button', { name: 'About Interfaces & protein interactions', exact: true }).waitFor();
  await open('About Interfaces & protein interactions');
  check('Evidence workspace opens its own subject', await page.getByRole('dialog', { name: 'Interfaces & protein interactions', exact: true }).count() === 1);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Assemblies & models', exact: true }).click();
  await open('About this complex prediction');
  check('Complex record teaches Boltz-2', await page.getByRole('dialog', { name: 'Boltz-2 complex prediction', exact: true }).count() === 1);
  await page.keyboard.press('Escape');
  await open('How to read binding change');
  check('Binding record teaches DDMut-PPI', await page.getByRole('dialog', { name: 'DDMut-PPI binding change', exact: true }).count() === 1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Binding energy change', exact: true }).click();
  await open('Background for this reading');
  check('Pinned binding reading retains its specific method', await page.getByRole('dialog', { name: 'DDMut-PPI binding change', exact: true }).count() === 1);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByLabel('Evidence', { exact: true }).selectOption('splicing');
  await open('About RNA splicing');
  check('Switching workspace changes the explanation', await page.getByRole('dialog', { name: 'RNA splicing', exact: true }).count() === 1);
  check('Narrow workspace drawer has no horizontal overflow', await page.locator('dialog').evaluate(el => el.scrollWidth <= el.clientWidth));
  await page.screenshot({ path: `${output}/splicing-workspace-390.png` });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1500, height: 900 });
  const subjects = await page.evaluate(async () => {
    const { EVIDENCE_GUIDES, RESEARCH_GUIDES } = await import('/src/shared/researchGuides.ts');
    return Object.entries(EVIDENCE_GUIDES).map(([tab, key]) => ({ tab, title: RESEARCH_GUIDES[key].title }));
  });
  const observedTopics = new Set();
  const collectTopics = async () => {
    for (const key of await page.locator('[data-explanation-topic]:visible').evaluateAll(els => els.map(el => el.dataset.explanationTopic))) observedTopics.add(key);
  };
  for (const { tab, title } of subjects) {
    await page.getByLabel('Evidence', { exact: true }).selectOption(tab);
    await open(`About ${title}`);
    check(`${tab}: actual workspace control opens the intended subject`, await page.getByRole('dialog', { name: title, exact: true }).count() === 1);
    await page.keyboard.press('Escape');
    await collectTopics();
    const topicTabs = page.locator(`[id^="evidence-${tab}-tab-"]`);
    for (let i = 0; i < await topicTabs.count(); i++) { await topicTabs.nth(i).click(); await collectTopics(); }
    if (tab === 'predictors') await page.getByRole('tab', { name: 'Native score scales', exact: true }).click();
    if (tab === 'predictors') {
      const collapsed = page.locator('.prd-group__toggle[aria-expanded="false"]');
      while (await collapsed.count()) await collapsed.first().click();
      await collectTopics();
    }
  }
  await page.getByLabel('Example', { exact: true }).selectOption('Embedding fallback');
  await page.getByLabel('Evidence', { exact: true }).selectOption('perturbation');
  await page.getByRole('tab', { name: 'Sequence embeddings', exact: true }).click();
  await page.locator('[data-explanation-topic="vesm_embedding"]').waitFor();
  await collectTopics();
  await open('About the VESM fallback');
  check('Fallback record opens embedding guidance rather than LLR guidance', await page.getByRole('dialog', { name: 'VESM embedding analysis', exact: true }).count() === 1);
  await page.keyboard.press('Escape');
  for (const view of ['search', 'structure_alphafold', 'energetics', 'landscape', 'insights', 'literature', 'report']) {
    await page.getByLabel('Workspace', { exact: true }).selectOption(view);
    await page.locator('[data-explanation-topic]:visible').first().waitFor();
    await collectTopics();
    if (view === 'energetics') { await page.getByRole('tab', { name: 'Engine records', exact: true }).click(); await collectTopics(); }
    const trigger = page.locator('[data-explanation-topic]:visible').first();
    await trigger.click();
    await page.locator('dialog:modal').waitFor();
    check(`${view}: workspace guide opens from a rendered control`, !await page.getByRole('heading', { level: 2, name: 'Explanation unavailable', exact: true }).count());
    await page.keyboard.press('Escape');
  }
  const coverage = await page.evaluate(async roots => {
    const { RESEARCH_GUIDES, GUIDE_ALIASES } = await import('/src/shared/researchGuides.ts');
    const reached = new Set();
    const visit = key => { key = GUIDE_ALIASES[key] ?? key; if (reached.has(key) || !RESEARCH_GUIDES[key]) return; reached.add(key); RESEARCH_GUIDES[key].related.forEach(visit); };
    roots.forEach(visit);
    return { observedRoots: roots, total: Object.keys(RESEARCH_GUIDES).length, reachable: reached.size, unobserved: Object.keys(RESEARCH_GUIDES).filter(key => !reached.has(key)) };
  }, [...observedTopics]);
  await fs.writeFile(path.join(output, 'coverage.json'), JSON.stringify(coverage, null, 2));
  check('Every subject is reachable from observed workspace controls and related links', coverage.unobserved.length === 0);
  if (coverage.unobserved.length) console.error('Unobserved routes:', coverage.unobserved);
  await page.route('**/api/v1/**', async route => {
    const endpoint = new URL(route.request().url()).pathname;
    const data = endpoint.endsWith('diagnostics') ? {
      status: 'ok', timestamp: new Date().toISOString(), foldxReady: false, p2rankReady: false,
      geminiReady: false, modelServerReady: false,
      serviceHealth: { ensembl: { healthy: false, latencyMs: 1, message: 'Unavailable', timestamp: new Date().toISOString(),
        fallback: { id: 'variant-validator', name: 'VariantValidator', healthy: true, verdict: 'ready', latencyMs: 1, message: 'Resolved probe', timestamp: new Date().toISOString() } } },
    } : endpoint.endsWith('capabilities') ? { engines: [] } : { version: 'preview' };
    await route.fulfill({ json: data });
  });
  await page.goto((process.env.EXPLANATION_PREVIEW_URL ?? 'http://127.0.0.1:5188/tools/explanation-preview/index.html') + '?telemetry');
  await page.setViewportSize({ width: 900, height: 900 });
  await page.getByText('Fallback Ready', { exact: true }).waitFor();
  for (const id of ['ensembl', 'alphagenome', 'gemini', 'foldx', 'p2rank']) {
    const row = page.locator(`[data-service-id="${id}"]`);
    const disclosure = row.locator('button[aria-expanded]');
    for (const key of ['Enter', 'Space']) {
      await disclosure.focus(); await page.keyboard.press(key);
      check(`${id}: ${key} opens its disclosure`, await disclosure.getAttribute('aria-expanded') === 'true');
      check(`${id}: ${key} does not configure the service`, await page.getByLabel('Configuration actions').textContent() === '0');
      await page.keyboard.press(key);
      check(`${id}: ${key} closes its disclosure`, await disclosure.getAttribute('aria-expanded') === 'false');
    }
    check(`${id}: action and disclosure are separate native buttons`, await row.locator('button').count() === 2 && await row.locator('[role="button"] button').count() === 0);
  }
  await page.getByRole('button', { name: 'Configure FoldX Engine settings', exact: true }).focus();
  await page.keyboard.press('Enter');
  check('Action button still configures with Enter', await page.getByLabel('Configuration actions').textContent() === '1');
  check('No browser errors', errors.length === 0);
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(`${checks.filter(c => c.pass).length}/${checks.length} browser checks passed. Artifacts: ${output}`);
  if (errors.length) console.error(errors);
  if (checks.some(c => !c.pass)) process.exitCode = 1;
} finally { await browser.close(); }
