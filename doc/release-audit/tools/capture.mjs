#!/usr/bin/env node
/**
 * capture.mjs — raw capture of every Evidence tab, subtab and top-level view for the release audit.
 *
 * For each variant in ../panel.json (or the ids given with --only):
 *   1. opens the running app and starts the analysis (the Analyse button), waiting for the Evidence row to read "Complete";
 *   2. records every /api/ response (method, URL, status, request body, response body);
 *   3. for each Evidence tab and subtab: waits for the network and spinners to settle, then saves the
 *      visible text of the screen and of the inspector, a full-page PNG, and axe-core violations;
 *   4. visits the other top-level sidebar views and saves the same material for them;
 *   5. writes meta.json (timings, timeouts, errors, console errors, failed requests).
 *
 * Every step is wrapped: one failing tab or subtab is recorded in meta.errors and the run goes on.
 * Files are written as the run goes (checkpoint after each capture), so a killed run keeps its work.
 *
 * Output: ../raw/<variant id>/{api/, tabs/, views/, axe.json, meta.json}
 *
 * Usage:
 *   node doc/release-audit/tools/capture.mjs --only TP53_R175H      # one variant
 *   node doc/release-audit/tools/capture.mjs                        # all panel variants, one browser
 *   sh doc/release-audit/tools/run-all.sh                           # all variants, one process each, skips status ok
 *
 * Environment (all optional):
 *   AUDIT_BASE_URL  default http://localhost:3200
 *   CHROME_EXE      default: Playwright's chrome-headless-shell 1248 on Windows
 *   AXE_JS          default: axe-core 4.10.2 installed under the session scratchpad
 *
 * Nothing here presses a compute button (FoldX, ThermoMPNN, AlphaGenome saturation, multimer,
 * mutant generation, pocket detection). Only the analysis button and sidebar navigation are clicked.
 */

import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = path.resolve(HERE, '..');
const RAW_DIR = path.join(AUDIT_DIR, 'raw');
const BASE_URL = process.env.AUDIT_BASE_URL ?? 'http://localhost:3200';
const CHROME_EXE = process.env.CHROME_EXE
  ?? 'C:/Users/HSA19/AppData/Local/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe';
const AXE_JS = process.env.AXE_JS
  ?? 'C:/Users/HSA19/AppData/Local/Temp/claude/39b691878de344df/4ee437a8-8c52-4fd8-91b6-7d5794823e8b/scratchpad/axe/node_modules/axe-core/axe.min.js';

const ANALYSIS_TIMEOUT_MS = 12 * 60_000;
/** Audit account for the accounts-mode server. Read at run time; the password is never logged. */
const AUTH_FILE = process.env.AUDIT_LOGIN_FILE
  ?? 'C:/Users/HSA19/AppData/Local/Temp/claude/39b691878de344df/4ee437a8-8c52-4fd8-91b6-7d5794823e8b/scratchpad/audit-login.json';
const IDLE_MAX_MS = 20_000;
const SPINNER_MAX_MS = 60_000;
const BODY_MAX_MS = 30_000;

/** Same ten tabs as src/shared/evidenceTabs.ts (the sidebar labels match these). */
const EVIDENCE_TABS = [
  ['clinical', 'Population data'],
  ['gene-disease', 'Gene–disease'],
  ['expression-models', 'Expression'],
  ['species-models', 'Species & models'],
  ['function', 'Functional domains'],
  ['predictors', 'In-silico predictors'],
  ['alphagenome', 'AlphaGenome'],
  ['splicing', 'RNA splicing'],
  ['structure', 'Residue shifts & pockets'],
  ['interfaces', 'Interfaces & PPI'],
];

/** Top-level sidebar views other than Variant query and Evidence. `data-view` is the sidebar row id. */
const TOP_VIEWS = [
  ['structure', '3D structure'],
  ['energetics', 'Energetics'],
  ['landscape', 'Landscape'],
  ['insights', 'Insights'],
  ['literature', 'Literature'],
  ['report', 'Report'],
  ['about', 'About'],
  ['console', 'Console'],
];

const EVIDENCE_SCOPES = ['[data-evidence-screen]', '[data-workspace-inspector]'];
const VIEW_SCOPES = ['main', '[data-workspace-inspector]'];
const SUBTAB_SELECTOR = '[data-evidence-screen] [role="tablist"] [role="tab"]';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const log = msg => console.log(`[${nowIso()}] ${msg}`);
const errText = err => String(err?.message ?? err).split('\n')[0];
const slugify = s => s.normalize('NFKD').replace(/[^\x00-\x7F]/g, c => ({ '–': '-', '—': '-' }[c] ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Runs one capture step. A failure is recorded in meta.errors and returns null, so the next step still runs.
 * The `catch` is deliberate: a single broken tab must not stop the other nine tabs and the views.
 */
async function step(meta, stage, fn) {
  try {
    return await fn();
  } catch (err) {
    meta.errors.push({ stage, message: errText(err), at: nowIso() });
    log(`${meta.id} ERROR at ${stage}: ${errText(err)}`);
    return null;
  }
}

/** Page-side check: returns short descriptions of anything still spinning or saying Loading/Running. */
function findLoadingHits(scopes) {
  const hits = [];
  const visible = el => el.getClientRects().length > 0;
  for (const scope of scopes) {
    for (const root of document.querySelectorAll(scope)) {
      for (const el of root.querySelectorAll('[aria-busy="true"], .animate-spin, [role="progressbar"], [aria-label="Loading"]')) {
        if (visible(el)) hits.push(`${scope}: <${el.tagName.toLowerCase()}> ${String(el.className).slice(0, 60)} ${el.getAttribute('aria-label') ?? ''}`.trim());
      }
      for (const line of root.innerText.split('\n')) {
        const t = line.trim();
        if (t.length <= 60 && /^(Loading|Running)\b/.test(t)) hits.push(`${scope}: "${t}"`);
      }
    }
  }
  return hits.slice(0, 8);
}

/** Page-side: visible text of the screen and of the inspector, labelled so the two are easy to split. */
function readPanelText(screenSelector) {
  const screen = document.querySelector(screenSelector);
  const inspector = document.querySelector('[data-workspace-inspector]');
  return {
    screen: screen ? screen.innerText : '(screen not found)',
    inspector: inspector ? inspector.innerText : '(no inspector rendered)',
  };
}

/** Page-side: axe-core violations for the whole document, trimmed to what the audit needs. */
async function runAxeInPage() {
  const result = await window.axe.run(document, { resultTypes: ['violations'] });
  return result.violations.map(v => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')),
  }));
}

/** Resolves once no request has been pending for 500 ms, or after IDLE_MAX_MS. */
async function waitNetworkIdle(net) {
  const t0 = Date.now();
  let quietSince = null;
  while (Date.now() - t0 < IDLE_MAX_MS) {
    if (net.inflight.size === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= 500) return { ms: Date.now() - t0, timedOut: false };
    } else {
      quietSince = null;
    }
    await sleep(100);
  }
  return { ms: Date.now() - t0, timedOut: true, pending: [...net.inflight].map(r => r.url()).slice(0, 5) };
}

async function waitNoSpinner(page, scopes) {
  const t0 = Date.now();
  for (;;) {
    const hits = await page.evaluate(findLoadingHits, scopes);
    if (hits.length === 0) return { ms: Date.now() - t0, stillLoading: false, hits: [] };
    if (Date.now() - t0 >= SPINNER_MAX_MS) return { ms: Date.now() - t0, stillLoading: true, hits };
    await sleep(500);
  }
}

/** Route slug for an /api/ URL: "/api/v1/evidence-context/TP53" -> "v1-evidence-context-TP53". */
function routeSlug(url) {
  const pathname = new URL(url).pathname.replace(/^\/api\//, '');
  return pathname.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'root';
}

/** Keeps the response's body promise; the body is read later, once the page has settled. */
function recordApiResponse(response, seq) {
  const req = response.request();
  return {
    seq,
    method: req.method(),
    url: response.url(),
    status: response.status(),
    requestBody: req.postData() ?? null,
    contentType: response.headers()['content-type'] ?? null,
    bodyPromise: response.body().then(buf => ({ buf }), err => ({ error: String(err) })),
  };
}

async function finishApiEntry(entry) {
  const settled = await Promise.race([entry.bodyPromise, sleep(BODY_MAX_MS).then(() => ({ timedOut: true }))]);
  const base = { seq: entry.seq, method: entry.method, url: entry.url, status: entry.status, requestBody: entry.requestBody, contentType: entry.contentType };
  if (settled.timedOut) return { ...base, bodyKind: 'missing', body: null, bodyError: `body not finished after ${BODY_MAX_MS} ms` };
  if (settled.error) return { ...base, bodyKind: 'missing', body: null, bodyError: settled.error };
  const type = entry.contentType ?? '';
  const text = settled.buf.toString('utf8');
  if (type.includes('json')) {
    try {
      return { ...base, bodyKind: 'json', body: JSON.parse(text) };
    } catch {
      return { ...base, bodyKind: 'text', body: text, bodyError: 'content-type says JSON but body did not parse' };
    }
  }
  if (/text|xml|javascript|event-stream/.test(type)) return { ...base, bodyKind: type.includes('event-stream') ? 'sse-text' : 'text', body: text };
  return { ...base, bodyKind: 'binary', body: null, bytes: settled.buf.length };
}

/** Writes the api/ files that are not written yet. A response is marked saved before it is read, so a slow body is not retried. */
async function flushApi(dir, entries, saved) {
  await mkdir(path.join(dir, 'api'), { recursive: true });
  for (const entry of entries) {
    if (saved.has(entry.seq)) continue;
    saved.add(entry.seq);
    const envelope = await finishApiEntry(entry);
    const name = `${String(entry.seq).padStart(3, '0')}_${routeSlug(entry.url)}.json`;
    await writeFile(path.join(dir, 'api', name), JSON.stringify(envelope, null, 2));
  }
}

/** Writes both the text (screen and inspector) and the PNG for the current page state. */
async function saveCapture(page, dir, { subfolder, name, screenSelector }) {
  const text = await page.evaluate(readPanelText, screenSelector);
  const body = [
    `=== SCREEN (innerText of ${screenSelector}) ===`,
    text.screen,
    '',
    '=== INSPECTOR / RAIL (innerText of [data-workspace-inspector]) ===',
    text.inspector,
    '',
  ].join('\n');
  await mkdir(path.join(dir, subfolder), { recursive: true });
  await writeFile(path.join(dir, subfolder, `${name}.txt`), body);
  await page.screenshot({ path: path.join(dir, subfolder, `${name}.png`), fullPage: true });
}

/** The app's CSP blocks inline scripts, so axe is served from a same-origin route and loaded by URL. */
const AXE_ROUTE = `${BASE_URL}/__audit-axe.js`;

async function runAxe(page) {
  if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) {
    await page.addScriptTag({ url: AXE_ROUTE });
  }
  return page.evaluate(runAxeInPage);
}

/**
 * Signs the browser context in with the audit account. The session cookie is then sent with every
 * page request. Only the outcome is recorded, never the credentials.
 */
async function signIn(context) {
  const creds = JSON.parse(await readFile(AUTH_FILE, 'utf8'));
  const login = await context.request.post(`${BASE_URL}/api/v1/auth/login`, { data: { email: creds.email, password: creds.password } });
  const session = await (await context.request.get(`${BASE_URL}/api/v1/auth/session`)).json();
  return { loginStatus: login.status(), mode: session.mode ?? null, signedIn: Boolean(session.user) };
}

/** Makes sure the app is in the light theme, because the screenshots and axe are read in light. */
async function ensureLightTheme(page) {
  const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  if (dark) await page.getByRole('button', { name: 'Switch theme' }).click();
}

/** Fills the variant field for genomic alleles, the same way the proof test does. Protein
 * notation is already filled from the URL. */
async function fillIfGenomic(page, variant) {
  if (!/^\d+-\d+-[ACGT]+-[ACGT]+$/.test(variant)) return 'url-seeded';
  await page.getByRole('textbox', { name: 'Variant' }).fill(variant);
  return 'filled-allele';
}

async function startAnalysis(page, v, meta) {
  const url = `${BASE_URL}/?gene=${encodeURIComponent(v.gene)}&variant=${encodeURIComponent(v.variant)}&uniprot=${encodeURIComponent(v.uniprot)}`;
  meta.url = url;
  await page.goto(url, { waitUntil: 'load' });
  await ensureLightTheme(page);
  meta.analysis.inputMode = await fillIfGenomic(page, v.variant);
  meta.analysis.clickedAt = nowIso();
  await page.getByRole('button', { name: 'Analyse variant' }).click({ timeout: 30_000 });
  const t0 = Date.now();
  const done = page.getByRole('button', { name: /^Evidence .*Complete/ });
  const complete = await done.waitFor({ state: 'visible', timeout: ANALYSIS_TIMEOUT_MS }).then(() => true, () => false);
  meta.analysis.complete = complete;
  meta.analysis.durationMs = Date.now() - t0;
  meta.analysis.evidenceRowText = await page.locator('[data-view="evidence"]').first().innerText().catch(() => null);
  if (!complete) meta.timeouts.push({ stage: 'analysis', afterMs: ANALYSIS_TIMEOUT_MS });
}

/** Captures one Evidence subtab after the subtab has been opened. */
/**
 * Opens a subtab by its name. Some tabs (the Adult RNA and Pediatric RNA groups) exist only in the
 * first subview, so when the named tab is missing, go back to the first subtab and try again.
 */
async function openSubtab(page, name, firstName) {
  let tab = page.locator(SUBTAB_SELECTOR, { hasText: name }).first();
  if ((await tab.count()) === 0) {
    await page.locator(SUBTAB_SELECTOR, { hasText: firstName }).first().click({ timeout: 15_000 });
    tab = page.locator(SUBTAB_SELECTOR, { hasText: name }).first();
  }
  await tab.click({ timeout: 15_000 }).catch(async err => {
    const state = await tab.evaluate(el => ({ disabled: el.disabled || el.getAttribute('aria-disabled') === 'true', html: el.outerHTML.slice(0, 200) })).catch(() => 'element gone');
    throw new Error(`${errText(err)} | element state ${JSON.stringify(state)}`);
  });
  return tab.evaluate(el => el.getAttribute('aria-selected') === 'true');
}

/** Captures one Evidence subtab. `firstName` is the tab's first subtab, used to get back to the start view. */
async function captureSubtab(page, net, dir, meta, axe, tabId, sub, firstName) {
  const hasSubtabs = firstName !== null;
  const subSlug = hasSubtabs ? slugify(sub) : 'no-subtabs';
  let selected = true;
  const t0 = Date.now();
  if (hasSubtabs) selected = await openSubtab(page, sub, firstName);
  const clickMs = Date.now() - t0;
  const idle = await waitNetworkIdle(net);
  const spinner = await waitNoSpinner(page, EVIDENCE_SCOPES);
  const name = `${tabId}__${subSlug}`;
  await saveCapture(page, dir, { subfolder: 'tabs', name, screenSelector: '[data-evidence-screen]' });
  axe[`${tabId}/${subSlug}`] = await runAxe(page);
  if (spinner.stillLoading) meta.timeouts.push({ stage: 'spinner', tab: tabId, sub, hits: spinner.hits });
  meta.tabs.push({ tab: tabId, label: sub, sub, file: `tabs/${name}`, subSelected: selected, clickMs, idle, spinner });
  log(`${meta.id} tab ${tabId} / ${sub}: saved (spinner ${spinner.stillLoading ? 'STILL LOADING' : 'clear'})`);
}

async function captureEvidenceTab(page, net, dir, meta, axe, checkpoint, [tabId, label]) {
  const row = page.locator('[aria-label="Evidence pages"]').getByRole('button', { name: label, exact: true });
  await row.click({ timeout: 30_000 });
  const screenVisible = await page.locator('[data-evidence-screen]').first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false);
  if (!screenVisible) meta.timeouts.push({ stage: 'screen-missing', tab: tabId });
  // The subtab list renders after the tab's data arrives, so wait for the load before reading it.
  await waitNetworkIdle(net);
  await waitNoSpinner(page, EVIDENCE_SCOPES);
  // Each tab's text is its name, then (for some tabs) a one-line description. Keep the name only.
  const tabNames = (await page.locator(SUBTAB_SELECTOR).allInnerTexts()).map(s => s.split('\n')[0].trim());
  log(`${meta.id} tab ${tabId}: ${tabNames.length} subtab(s) ${JSON.stringify(tabNames)}`);
  const subs = tabNames.length > 0 ? tabNames : ['(no subtabs)'];
  for (let i = 0; i < subs.length; i++) {
    await step(meta, `subtab:${tabId}/${subs[i]}`, () => captureSubtab(page, net, dir, meta, axe, tabId, subs[i], tabNames[0] ?? null));
    await checkpoint();
  }
  meta.tabStates = { ...meta.tabStates, [tabId]: await row.innerText().then(t => t.trim()).catch(() => null) };
}

async function captureTopView(page, net, dir, meta, axe, [viewId, label]) {
  const row = page.locator(`button.ms-nav-btn[data-view="${viewId}"]`).first();
  const t0 = Date.now();
  await row.click({ timeout: 30_000 });
  const clickMs = Date.now() - t0;
  const idle = await waitNetworkIdle(net);
  const spinner = await waitNoSpinner(page, VIEW_SCOPES);
  const name = `view__${slugify(label)}`;
  await saveCapture(page, dir, { subfolder: 'views', name, screenSelector: 'main' });
  axe[`view/${slugify(label)}`] = await runAxe(page);
  if (spinner.stillLoading) meta.timeouts.push({ stage: 'spinner', view: viewId, hits: spinner.hits });
  meta.views.push({ view: viewId, label, file: `views/${name}`, clickMs, idle, spinner });
  log(`${meta.id} view ${label}: saved`);
}

function attachPageListeners(page, context, net, meta, apiEntries) {
  page.on('request', req => { if (!req.url().startsWith('data:') && !req.url().startsWith('blob:')) net.inflight.add(req); });
  page.on('requestfinished', req => net.inflight.delete(req));
  page.on('requestfailed', req => {
    net.inflight.delete(req);
    meta.failedRequests.push({ url: req.url(), failure: req.failure()?.errorText ?? null });
  });
  page.on('response', response => {
    if (response.url().includes('/api/')) apiEntries.push(recordApiResponse(response, apiEntries.length + 1));
  });
  page.on('console', msg => { if (msg.type() === 'error') meta.consoleErrors.push({ text: msg.text(), location: msg.location()?.url ?? null }); });
  page.on('pageerror', err => meta.pageErrors.push(String(err.message ?? err)));
  page.on('crash', () => { meta.pageErrors.push('PAGE CRASHED (renderer gone)'); log(`${meta.id} PAGE CRASHED`); });
  context.on('close', () => log(`${meta.id} context closed`));
}

async function captureVariant(browser, v) {
  const dir = path.join(RAW_DIR, v.id);
  await mkdir(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('cs-onboarding-completed-v1', 'true');
    } catch {
      /* not the app's origin */
    }
  });
  await context.route(AXE_ROUTE, route => route.fulfill({ path: AXE_JS, contentType: 'application/javascript' }));
  const page = await context.newPage();
  /* In-flight requests; "network idle" means none pending for 500 ms. */
  const net = { inflight: new Set() };
  const apiEntries = [];
  const savedApi = new Set();
  const axe = {};
  const meta = {
    id: v.id, set: v.set, gene: v.gene, variant: v.variant, uniprot: v.uniprot,
    startedAt: nowIso(), status: 'running', auth: {}, analysis: {}, tabs: [], views: [], timeouts: [], errors: [],
    consoleErrors: [], pageErrors: [], failedRequests: [], apiErrors: [], tabStates: {},
  };
  attachPageListeners(page, context, net, meta, apiEntries);

  /* Writes meta.json, axe.json and the api/ files now, so a killed run keeps what it captured. */
  const checkpoint = async () => {
    meta.apiCount = apiEntries.length;
    meta.apiErrors = apiEntries.filter(e => e.status >= 400).map(e => ({ status: e.status, url: e.url }));
    meta.auth.numberingProofStatus = apiEntries.filter(e => e.url.includes('/numbering-proof')).map(e => e.status);
    meta.axeViolations = Object.fromEntries(Object.entries(axe).map(([k, list]) => [k, list.length]));
    meta.updatedAt = nowIso();
    await writeFile(path.join(dir, 'axe.json'), JSON.stringify(axe, null, 2));
    await writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    await flushApi(dir, apiEntries, savedApi);
  };

  try {
    meta.auth = (await step(meta, 'sign-in', () => signIn(context))) ?? { signedIn: false };
    await startAnalysis(page, v, meta).catch(err => {
      meta.errors.push({ stage: 'analysis', message: errText(err), at: nowIso() });
      log(`${meta.id} ERROR at analysis: ${errText(err)}`);
    });
    if (meta.analysis.complete === false) meta.status = 'timeout';
    await checkpoint();
    for (const tab of EVIDENCE_TABS) {
      await step(meta, `tab:${tab[0]}`, () => captureEvidenceTab(page, net, dir, meta, axe, checkpoint, tab));
      await checkpoint();
    }
    for (const view of TOP_VIEWS) {
      await step(meta, `view:${view[0]}`, () => captureTopView(page, net, dir, meta, axe, view));
      await checkpoint();
    }
  } finally {
    meta.status = finalStatus(meta);
    meta.finishedAt = nowIso();
    await checkpoint();
    await context.close();
  }
  return meta;
}

/** ok: analysis completed and every step ran. timeout: the analysis did not finish. error: some step failed. */
function finalStatus(meta) {
  if (meta.analysis.complete === false) return 'timeout';
  if (meta.errors.length > 0) return 'error';
  return 'ok';
}

async function main() {
  const onlyArg = process.argv.indexOf('--only');
  const only = onlyArg >= 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;
  const panel = JSON.parse(await readFile(path.join(AUDIT_DIR, 'panel.json'), 'utf8'));
  const variants = panel.variants.filter(v => !only || only.has(v.id));
  const browser = await chromium.launch({ executablePath: CHROME_EXE, args: ['--no-sandbox'], headless: true });
  browser.on('disconnected', () => log('BROWSER DISCONNECTED'));
  try {
    for (const v of variants) {
      log(`${v.id} start`);
      const meta = await captureVariant(browser, v);
      log(`${v.id}: ${meta.status} tabs=${meta.tabs.length} views=${meta.views.length} api=${meta.apiCount} errors=${meta.errors.length}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(`[${nowIso()}] FATAL ${errText(err)}`);
  console.error(err);
  process.exitCode = 1;
});
