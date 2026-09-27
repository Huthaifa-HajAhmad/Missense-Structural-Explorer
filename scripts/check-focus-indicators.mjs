#!/usr/bin/env node
/**
 * Every suppressed focus outline has a replacement, or a stated reason why it has none.
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
 * WHY AN ANNOTATION EXISTS
 * ------------------------
 * "The replacement is in the same literal" is not the only way a suppression can be correct, and the two
 * remaining cases cannot satisfy it:
 *
 *   - `SettingsDrawer`'s search field is styled by CSS (`.settings-search input:focus` in
 *     `src/styles/settings.css` draws a clay border and a 3px ring). The indicator is real; it simply
 *     lives in another file, where a text audit of `className` cannot see it.
 *   - The tab panel is a programmatic focus target (`role="tabpanel" tabIndex={-1}`). It is not in the
 *     tab order, so a ring on it would be noise, not an affordance.
 *
 * Before this, both were reported as violations on every run, and the two ways out were both bad:
 * inline a redundant ring (which double-draws over the CSS one, or marks a target the user never
 * tabbed to), or delete the check. So a suppression may instead carry
 *
 *     // focus-guard-allow: <at least 24 characters saying why there is no visible ring here>
 *
 * on its own line or the line above it, inside the JSX tag (`{/* *\/}` is a syntax error in attribute
 * position; `//` is not). The reason is READ BACK in the output, because an exemption nobody sees is
 * indistinguishable from no check at all, and the marker is only honoured outside the literal it is
 * excusing — so it cannot be smuggled in as a class name.
 *
 * Usage: node scripts/check-focus-indicators.mjs    (wired into `npm run lint`)
 * Exit:  0 = every suppression has a companion or a stated reason, 1 = at least one does not.
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

/** The exemption marker, and the shortest reason this file will accept. */
export const ALLOW_MARKER = "focus-guard-allow:";
export const MIN_REASON_LENGTH = 24;

const ANNOTATION = /\/\/\s*focus-guard-allow:\s*(.*)$/;

export function collectSourceFiles(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...collectSourceFiles(path.join(dir, entry.name)));
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

/** `src/` as `relative-path -> source`; the input to `auditFocusIndicators`. */
export function readSources(root = ROOT) {
  const sources = new Map();
  for (const file of collectSourceFiles(path.join(root, "src"))) {
    sources.set(path.relative(root, file).replaceAll("\\", "/"), fs.readFileSync(file, "utf8"));
  }
  return sources;
}

/**
 * The quote-delimited literal a match sits inside, as a character range, so the companion can be found
 * even when the attribute is long. Found by scanning to the enclosing quotes rather than by parsing
 * JSX — this is a text audit, and pretending otherwise would be a worse check for the same reason.
 */
function literalRange(source, index) {
  const before = Math.max(
    source.lastIndexOf('"', index),
    source.lastIndexOf("'", index),
    source.lastIndexOf("`", index)
  );
  if (before === -1) return null;
  const quote = source[before];
  const end = source.indexOf(quote, index);
  return { start: before + 1, end: end === -1 ? source.length : end };
}

/**
 * The reason stated on `line`, if there is one OUTSIDE the excused literal.
 *
 * Returns `{ reason }` for a usable annotation, `{ reason: "" }` for a marker with too short a reason,
 * and `null` when the line carries no marker — the caller distinguishes "no exemption" from "an
 * exemption that does not say anything", because silently accepting the second is how an allow-list
 * becomes a rubber stamp.
 */
function annotationOn(line, lineStart, range) {
  const match = ANNOTATION.exec(line);
  if (!match) return null;
  const markerIndex = lineStart + match.index;
  if (range && markerIndex >= range.start && markerIndex <= range.end) return null;
  const reason = match[1].replace(/\*\/\s*$/, "").replace(/-->\s*$/, "").trim();
  return { reason };
}

/**
 * Audit a set of sources. Pure: takes `relative-path -> source`, returns findings.
 */
export function auditFocusIndicators(sources) {
  const allowed = [];
  const violations = [];
  let suppressions = 0;

  for (const [file, source] of sources) {
    const lines = source.split("\n");
    let index = source.indexOf(SUPERCEDED);

    while (index !== -1) {
      suppressions += 1;
      const line = source.slice(0, index).split("\n").length;
      const range = literalRange(source, index);
      const literal = range ? source.slice(range.start, range.end) : "";

      if (!REPLACEMENT.test(literal)) {
        const own = lines[line - 1] ?? "";
        const above = lines[line - 2] ?? "";
        const ownStart = source.lastIndexOf("\n", index - 1) + 1;
        const aboveStart = line >= 2 ? source.lastIndexOf("\n", ownStart - 2) + 1 : 0;
        const annotation = annotationOn(own, ownStart, range) ?? annotationOn(above, aboveStart, null);

        if (annotation && annotation.reason.length >= MIN_REASON_LENGTH) {
          allowed.push({ file, line, reason: annotation.reason });
        } else {
          violations.push({
            file,
            line,
            excerpt: literal.replace(/\s+/g, " ").trim().slice(0, 90),
            kind: annotation ? "WEAK_REASON" : "NO_REPLACEMENT",
            reason: annotation ? annotation.reason : "",
          });
        }
      }

      index = source.indexOf(SUPERCEDED, index + SUPERCEDED.length);
    }
  }

  return { suppressions, allowed, violations };
}

/** CLI. Guarded so the tests can import this module without it scanning the disk and exiting. */
function main() {
  const sources = readSources(ROOT);

  if (sources.size === 0) {
    console.error("check-focus-indicators: found no source files under src/ — refusing to report success.");
    process.exit(1);
  }

  const { suppressions, allowed, violations } = auditFocusIndicators(sources);

  if (violations.length > 0) {
    const weak = violations.filter((v) => v.kind === "WEAK_REASON");
    const bare = violations.filter((v) => v.kind === "NO_REPLACEMENT");

    if (bare.length > 0) {
      console.error(`check-focus-indicators: ${bare.length} suppressed outline(s) with no replacement:\n`);
      for (const v of bare) {
        console.error(`  ${v.file}:${v.line}`);
        console.error(`    ${v.excerpt}`);
      }
      console.error(
        "\n  Use the house idiom instead: rounded focus-visible:outline-hidden focus-visible:ring-2" +
          " focus-visible:ring-cs-accent-clay/50"
      );
    }

    if (weak.length > 0) {
      console.error(`\ncheck-focus-indicators: ${weak.length} exemption(s) with no usable reason:\n`);
      for (const v of weak) {
        console.error(`  ${v.file}:${v.line}`);
        console.error(`    ${SUPERCEDED} carries "${ALLOW_MARKER} ${v.reason}"`);
      }
      console.error(
        `\n  An exemption has to say why there is no visible ring, in at least ${MIN_REASON_LENGTH} ` +
          "characters — otherwise the marker is a way to switch the check off."
      );
    }

    process.exit(1);
  }

  // The historical wording is kept for an unannotated tree so the audit documents that quote it stay true.
  if (allowed.length === 0) {
    console.log(
      `✔ Focus indicators: ${suppressions} outline suppression(s), every one with a focus or focus-visible replacement.`
    );
    return;
  }

  console.log(
    `✔ Focus indicators: ${suppressions} outline suppression(s) — ` +
      `${suppressions - allowed.length} with a focus or focus-visible replacement, ` +
      `${allowed.length} with a stated reason:`
  );
  for (const a of allowed) console.log(`    ${a.file}:${a.line} — ${a.reason}`);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
