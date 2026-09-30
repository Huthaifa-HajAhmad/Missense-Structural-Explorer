#!/usr/bin/env node
/**
 * Variant-header geometry check.
 *
 * Builds tools/header-geometry, renders it in a headless Chromium, reads the
 * assertions the page computed from live layout (`--dump-dom`), prints them and
 * exits non-zero if any failed.
 *
 * Usage:  npm run test:geometry
 * Env:    GEOMETRY_BROWSER=/path/to/chrome   override browser discovery
 *
 * Why a browser: jsdom has no layout engine, no container-query evaluation and no
 * font metrics, so the header's alignment, clipping, marker/numeral collisions and
 * reflow behaviour cannot be asserted in the vitest suite at all.
 */
import { spawnSync } from "node:child_process";
import { localTmpEnv } from "../../scripts/with-local-tmp.mjs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const distIndex = path.join(here, "dist", "index.html");

const CANDIDATES = [
  process.env.GEOMETRY_BROWSER,
  process.env.CHROME_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function findBrowser() {
  for (const candidate of CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  console.error(
    "geometry-check: no Chromium-based browser found.\n" +
      "  Set GEOMETRY_BROWSER=/path/to/chrome (or CHROME_PATH) and re-run."
  );
  process.exit(2);
}

function run(command, args) {
  // localTmpEnv: esbuild's temp-file delete fails on Windows in the default temp directory.
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false, env: localTmpEnv() });
  if (result.error) {
    console.error(`geometry-check: failed to run ${command}: ${result.error.message}`);
    process.exit(2);
  }
  return result.status ?? 1;
}

console.log("geometry-check: building the harness…");
const buildStatus = run(process.execPath, [
  path.join(root, "node_modules", "vite", "bin", "vite.js"),
  "build",
  "--config",
  path.join(here, "vite.config.ts"),
]);
if (buildStatus !== 0) {
  console.error("geometry-check: build failed.");
  process.exit(buildStatus);
}
if (!existsSync(distIndex)) {
  console.error(`geometry-check: expected build output at ${distIndex}`);
  process.exit(2);
}

const browser = findBrowser();
console.log(`geometry-check: rendering in ${path.basename(browser)}…`);
const dom = spawnSync(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--force-device-scale-factor=1",
    `--user-data-dir=${path.join(here, ".browser-profile")}`,
    "--virtual-time-budget=8000",
    "--dump-dom",
    pathToFileURL(distIndex).href,
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
);

const raw = String(dom.stdout ?? "");
const match = raw.match(/id="geometry-result"[^>]*>([A-Za-z0-9+/=]+)</);
if (!match) {
  console.error("geometry-check: could not read #geometry-result from the rendered DOM.");
  if (dom.error) console.error(`  ${dom.error.message}`);
  console.error("  (the harness prints its checks into #geometry-report as well)");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
} catch (error) {
  console.error(`geometry-check: could not decode the report: ${error.message}`);
  process.exit(2);
}

for (const check of report.checks) {
  console.log(`${check.pass ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}`);
}
console.log("");
console.log("measured header heights:", JSON.stringify(report.heights));

const failed = report.checks.filter((c) => !c.pass);
if (failed.length > 0) {
  console.error(`\ngeometry-check: ${failed.length} of ${report.checks.length} assertions failed.`);
  process.exit(1);
}
console.log(`\ngeometry-check: all ${report.checks.length} assertions passed.`);
process.exit(0);
