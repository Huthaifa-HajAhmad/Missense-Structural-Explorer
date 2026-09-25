#!/usr/bin/env node
/**
 * Every suppressed focus outline has a replacement.
 *
 * `focus:outline-none` on a focusable element removes the only keyboard affordance the browser
 * provides, and nothing else in this repository compensates for `g[role=button]` or for a bare
 * `<select>`. The first audit of this found five offenders by hand — three `DevConsolePanel` selects
 * and two modal close buttons — and a hand-kept list is exactly the kind of evidence that rots: the
 * next bare `outline-none` would be found by a user, not by a test.
 *
 * The rule is deliberately narrow, because `focus:outline-none` is *correct* when something else takes
 * over: a `focus:border-*`, `focus:ring-*`, `focus:bg-*` or `focus-visible:ring-*` on the same control
 * is a real indicator, and nine such uses exist (the literature search fields, the perturbation model
 * cards, the view-resize handle, the AlphaGenome search). So this flags a suppression only when no
 * replacement appears in the same string literal, and it says which string it looked at.
 *
 * Usage: node scripts/check-focus-indicators.mjs    (wired into `npm run lint`)
 * Exit:  0 = every suppression has a companion, 1 = at least one does not.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Derived from THIS FILE, not from the process cwd: a checker that scans nothing passes vacuously. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUPERCEDED = "focus:outline-none";
/** A replacement for the suppressed outline, in the same literal. */
const REPLACEMENT = /focus(?:-visible)?:(?:ring|border|bg|shadow|outline-hidden|outline-0)/;
const SKIP_DIRS = new Set(["node_modules", "dist", "scratch", ".git", ".gemini", "temp_jobs", "graphify-out"]);

function tsxFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...tsxFiles(path.join(dir, entry.name)));
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

/**
 * The `className` (or `class`) literal a match sits inside, so the companion can be found even when the
 * attribute is long. Extracted by scanning to the enclosing quotes rather than by parsing JSX — this is a
 * text audit, and pretending otherwise would be a worse check for the same reason.
 */
function enclosingLiteral(source, index) {
  const before = source.lastIndexOf('"', index);
  const beforeSingle = source.lastIndexOf("'", index);
  const beforeTick = source.lastIndexOf("`", index);
  const start = Math.max(before, beforeSingle, beforeTick);
  if (start === -1) return "";
  const quote = source[start];
  const end = source.indexOf(quote, index);
  return source.slice(start + 1, end === -1 ? source.length : end);
}

const files = fs.existsSync(path.join(ROOT, "src")) ? tsxFiles(path.join(ROOT, "src")) : [];
const violations = [];
let suppressions = 0;
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  let index = source.indexOf(SUPERCEDED);
  while (index !== -1) {
    suppressions += 1;
    const literal = enclosingLiteral(source, index);
    if (!REPLACEMENT.test(literal)) {
      const line = source.slice(0, index).split("\n").length;
      const excerpt = literal.replace(/\s+/g, " ").trim().slice(0, 90);
      violations.push({ file: path.relative(ROOT, file).replaceAll("\\", "/"), line, excerpt });
    }
    index = source.indexOf(SUPERCEDED, index + SUPERCEDED.length);
  }
}

if (files.length === 0) {
  console.error("check-focus-indicators: found no source files under src/ — refusing to report success.");
  process.exit(1);
}

if (violations.length > 0) {
  console.error(`check-focus-indicators: ${violations.length} suppressed outline(s) with no replacement:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.excerpt}`);
  }
  console.error(
    "\n  Use the house idiom instead: rounded focus-visible:outline-hidden focus-visible:ring-2" +
      " focus-visible:ring-cs-accent-clay/50"
  );
  process.exit(1);
}

console.log(
  `✔ Focus indicators: ${suppressions} outline suppression(s), every one with a focus or focus-visible replacement.`
);
