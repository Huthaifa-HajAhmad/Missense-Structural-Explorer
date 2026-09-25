#!/usr/bin/env node
/**
 * Functional Domains sequence-track geometry check.
 *
 * Builds tools/function-track-geometry, renders it in a headless Chromium, reads the
 * assertions the page computed from live SVG geometry (`--dump-dom`), prints them and
 * exits non-zero if any failed.
 *
 * Usage:  npm run test:function-track
 * Env:    GEOMETRY_BROWSER=/path/to/chrome   override browser discovery
 *         TRACK_SHOT=1                        also write function-track.png next to dist/
 *
 * Why a browser: getBBox(), computed outline styles, :focus-visible, and the filter
 * pills' rendered effect are all live-layout facts. jsdom answers none of them.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const distIndex = path.join(here, "dist", "index.html");
const shot = path.join(here, "function-track.png");
/** Must match expectedCheckCount() in main.tsx: a shorter report means the run did not complete. */
const EXPECTED_ASSERTIONS = 213;

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
    "function-track-check: no Chromium-based browser found.\n" +
      "  Set GEOMETRY_BROWSER=/path/to/chrome (or CHROME_PATH) and re-run."
  );
  process.exit(2);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error) {
    console.error(`function-track-check: failed to run ${command}: ${result.error.message}`);
    process.exit(2);
  }
  return result.status ?? 1;
}

// Resolve the browser BEFORE the ~25s build so a missing Chromium is an immediate environment
// error rather than a build-then-fail.
const browser = findBrowser();

console.log("function-track-check: building the harness…");
const buildStatus = run(process.execPath, [
  path.join(root, "node_modules", "vite", "bin", "vite.js"),
  "build",
  "--config",
  path.join(here, "vite.config.ts"),
]);
if (buildStatus !== 0) {
  // Exit 2, not 1: 1 is reserved for "assertions failed", and a build error reported as an
  // assertion failure sends the reader looking for a regression that does not exist.
  console.error(`function-track-check: build failed (exit ${buildStatus}).`);
  process.exit(2);
}
if (!existsSync(distIndex)) {
  console.error(`function-track-check: expected build output at ${distIndex}`);
  process.exit(2);
}

console.log(`function-track-check: rendering in ${path.basename(browser)}…`);
const args = [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--hide-scrollbars",
  "--allow-file-access-from-files",
  "--force-device-scale-factor=1",
  `--user-data-dir=${path.join(here, ".browser-profile")}`,
  // Tall enough that TRACK_SHOT captures every case below the (long) assertion report.
  `--window-size=1060,${process.env.TRACK_SHOT ? 6400 : 3000}`,
  "--virtual-time-budget=8000",
  "--dump-dom",
];
if (process.env.TRACK_SHOT) args.push(`--screenshot=${shot}`);
args.push(pathToFileURL(distIndex).href);

const dom = spawnSync(browser, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const raw = String(dom.stdout ?? "");
const match = raw.match(/id="geometry-result"[^>]*>([A-Za-z0-9+/=]+)</);
if (!match) {
  console.error("function-track-check: could not read #geometry-result from the rendered DOM.");
  if (dom.error) console.error(`  ${dom.error.message}`);
  console.error("  (the harness prints its checks into #geometry-report as well)");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
} catch (error) {
  console.error(`function-track-check: could not decode the report: ${error.message}`);
  process.exit(2);
}

for (const check of report.checks) {
  console.log(`${check.pass ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}`);
}
if (process.env.TRACK_SHOT) console.log(`\nfunction-track-check: screenshot → ${shot}`);

// A short report means some case never rendered (or the virtual-time budget cut the run off).
// Without this, `every()` over an empty array is true and the runner happily reports success
// having verified nothing.
if (!Array.isArray(report.checks) || report.checks.length !== EXPECTED_ASSERTIONS) {
  console.error(
    `\nfunction-track-check: incomplete run — ${report.checks?.length ?? 0} assertions, expected ${EXPECTED_ASSERTIONS}.` +
      `\n  The harness did not verify everything it claims to; the report above is not a pass.`
  );
  process.exit(1);
}

const failed = report.checks.filter((c) => !c.pass);
if (failed.length > 0) {
  console.error(`\nfunction-track-check: ${failed.length} of ${report.checks.length} assertions failed.`);
  process.exit(1);
}
console.log(`\nfunction-track-check: all ${report.checks.length} assertions passed.`);
process.exit(0);
