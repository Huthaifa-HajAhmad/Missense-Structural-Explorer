#!/usr/bin/env node
/**
 * 3D residue-focus check.
 *
 * Builds tools/structure-focus, renders the real `MolstarViewer` against the real AlphaFold DB model for SOD1 in a
 * headless Chromium with WebGL, and reads back the assertions the page computed after Mol* finished drawing
 * (`--dump-dom`). Prints them and exits non-zero if any failed.
 *
 * Usage:  npm run test:geometry:focus
 * Env:    GEOMETRY_BROWSER=/path/to/chrome   override browser discovery
 *         FOCUS_SHOT=1                       also write structure-focus.png next to dist/
 *
 * Why a browser: the claim is that companion residues become drawn atoms. jsdom has no WebGL and no Mol* plugin, so
 * the strongest thing it can check is that a prop was passed — which is exactly the failure that went unnoticed.
 */
import { spawnSync } from "node:child_process";
import { localTmpEnv } from "../../scripts/with-local-tmp.mjs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const distIndex = path.join(here, "dist", "index.html");
const shot = path.join(here, "structure-focus.png");
/** Must match what main.tsx records: a shorter report means the run did not finish, not that it passed. */
const EXPECTED_ASSERTIONS = 17;

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
    "structure-focus-check: no Chromium-based browser found.\n" +
      "  Set GEOMETRY_BROWSER=/path/to/chrome (or CHROME_PATH) and re-run."
  );
  process.exit(2);
}

function run(command, args) {
  // localTmpEnv: esbuild's temp-file delete fails on Windows in the default temp directory.
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false, env: localTmpEnv() });
  if (result.error) {
    console.error(`structure-focus-check: failed to run ${command}: ${result.error.message}`);
    process.exit(2);
  }
  return result.status ?? 1;
}

// Resolve the browser BEFORE the build so a missing Chromium is an immediate environment error rather than a
// build-then-fail.
const browser = findBrowser();

console.log("structure-focus-check: building the harness…");
const buildStatus = run(process.execPath, [
  path.join(root, "node_modules", "vite", "bin", "vite.js"),
  "build",
  "--config",
  path.join(here, "vite.config.ts"),
]);
if (buildStatus !== 0) {
  // Exit 2, not 1: 1 is reserved for "assertions failed", and a build error reported as an assertion failure sends
  // the reader looking for a regression that does not exist.
  console.error(`structure-focus-check: build failed (exit ${buildStatus}).`);
  process.exit(2);
}
if (!existsSync(distIndex)) {
  console.error(`structure-focus-check: expected build output at ${distIndex}`);
  process.exit(2);
}

console.log(`structure-focus-check: rendering in ${path.basename(browser)}…`);
const args = [
  "--headless=new",
  // SwiftShader, not the GPU: this must run on a machine with no display. The earlier probe on this repo's machine
  // reported a WebGL2 context with --disable-gpu, and --enable-unsafe-swiftshader keeps that true where a driver is
  // absent. Mol* needs WebGL2; a silent fallback to no-WebGL would fail the first assertion rather than pass quietly.
  "--enable-unsafe-swiftshader",
  "--no-first-run",
  "--hide-scrollbars",
  "--allow-file-access-from-files",
  "--force-device-scale-factor=1",
  `--user-data-dir=${path.join(here, ".browser-profile")}`,
  "--window-size=1500,1000",
  // Mol* loads the structure, builds components and draws; 8 s was enough for layout-only harnesses, not for this.
  "--virtual-time-budget=60000",
  "--dump-dom",
];
if (process.env.FOCUS_SHOT) args.push(`--screenshot=${shot}`);
args.push(pathToFileURL(distIndex).href);

const dom = spawnSync(browser, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const raw = String(dom.stdout ?? "");
const match = raw.match(/id="geometry-result"[^>]*>([A-Za-z0-9+/=]+)</);
if (!match) {
  console.error("structure-focus-check: could not read #geometry-result from the rendered DOM.");
  if (dom.error) console.error(`  ${dom.error.message}`);
  process.exit(2);
}

let report;
try {
  report = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
} catch (error) {
  console.error(`structure-focus-check: could not decode the report: ${error.message}`);
  process.exit(2);
}

for (const check of report.checks) {
  console.log(`${check.pass ? "PASS" : "FAIL"}  ${check.name} — ${check.detail}`);
}
if (process.env.FOCUS_SHOT) console.log(`\nstructure-focus-check: screenshot → ${shot}`);

// A short report means a case never ran. Without this, `every()` over an empty array is true and the runner happily
// reports success having verified nothing.
if (!Array.isArray(report.checks) || report.checks.length !== EXPECTED_ASSERTIONS) {
  console.error(
    `\nstructure-focus-check: incomplete run — ${report.checks?.length ?? 0} assertions, expected ${EXPECTED_ASSERTIONS}.` +
      `\n  The harness did not verify everything it claims to; the report above is not a pass.`
  );
  process.exit(1);
}

const failed = report.checks.filter((c) => !c.pass);
if (failed.length > 0) {
  console.error(`\nstructure-focus-check: ${failed.length} of ${report.checks.length} assertions failed.`);
  process.exit(1);
}
console.log(`\nstructure-focus-check: all ${report.checks.length} assertions passed.`);
