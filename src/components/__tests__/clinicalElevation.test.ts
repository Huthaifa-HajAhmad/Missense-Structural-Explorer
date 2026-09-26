import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Guardrail: elevation in the two clinical panes comes from the token, not a Tailwind utility.
 *
 * WHY THIS EXISTS
 * ---------------
 * The ACMG consensus verdict card carried `shadow-sm` while every sibling panel in the same column
 * — the rule-based plausibility block, the AI plausibility block, the criteria list, the radar card
 * — carried none. Inside one card, one panel floated and the rest were flat, so the verdict read as
 * a different class of object from the evidence supporting it.
 *
 * The shadow was not "an inconsistency to be matched elsewhere". It was off-token: this design has
 * no card elevation at all —
 *
 *     --cs-shadow-card: none;      (variables.css, light AND dark)
 *     --cs-shadow-sm:   none;
 *
 * — because depth is carried by the fill ramp and a hairline border. The neutral ramp was just
 * repaired for exactly that reason (see `src/styles/__tests__/surfaceRamp.test.ts`). A raw
 * `shadow-*` utility bypasses the token and reintroduces the elevation the design removed, and
 * `print.css` strips it again on the printed report, so it is invisible in the artefact that gets
 * filed.
 *
 * SCOPE, AND WHY IT IS NOT REPO-WIDE
 * ----------------------------------
 * The same raw-shadow pattern appears in roughly a hundred places elsewhere in `src/` (perturbation
 * cards, modals, the Mol* overlay). Those are untouched here on purpose: several are genuine depth
 * cues over the 3D viewport, and a blind sweep is a different, larger change with no visual
 * verification available in this environment. They are recorded as an open finding in
 * `doc/INSPECTOR_UI_UX_AUDIT.md`.
 *
 * So this guard pins the two panes that were actually made flat, which is what stops the reported
 * defect from returning. Widening SURFACES is the intended way to extend it.
 */

const REPO_ROOT = process.cwd();

/** The panes this guard pins. Each entry is repo-relative with forward slashes. */
const SURFACES: ReadonlyArray<string> = [
  "src/components/ClinicalInsightsCard.tsx",
  "src/components/ClinicalReportBar.tsx",
  // The report inspector rail is rendered by the same Report view (`ViewInspector.tsx`) and carried a
  // live `shadow-sm` on its primary action while the report body beside it was flat. The first version
  // of this guard named "the Report panes" in its test title and did not scan this file.
  "src/components/inspector/ReportInspector.tsx",
];

/**
 * Tailwind's elevation utilities, including the spellings the first version missed.
 *
 * The original alternation required one of the named sizes, so it was evaded by three realistic ways of
 * reintroducing the same defect:
 *
 *   `shadow`                        the bare utility (Tailwind v4's default elevation)
 *   `shadow-[0_1px_2px_rgba(...)]`  an arbitrary value — the modern idiom for a custom shadow
 *   `2xl:shadow-md`                 the variant prefix could not match the `2` in `2xl`
 *
 * `shadow-none` is the sanctioned way to say "flat" and must NOT match: it is what the Insights view
 * passes in as its `card`, and flagging it would make the guard's own fix unfixable. The lookahead sits
 * BEFORE the size group rather than inside it — `shadow(?:-(?!none\b)...)?` let `shadow-none` match as
 * the bare `shadow` utility, because the optional group simply abstained and `shadow` alone is valid.
 */
const RAW_SHADOW = /(?:^|[\s"'`])(?:[\w-]+:)*!?shadow(?!-none\b)(?:-[^\s"'`]*)?/g;

interface Hit {
  file: string;
  line: number;
  text: string;
  match: string;
}

/**
 * Scan LINES rather than files, so the comment filter is testable.
 *
 * The first version inlined the read and the filter in one loop and then "self-tested" by calling the
 * regex directly — so the comment-skip logic, which is the only reason the guard passes at all (the
 * sole `shadow-*` strings left in the pinned files are comments explaining their removal), had no test.
 */
export function scanLinesForRawShadows(lines: ReadonlyArray<string>): Hit[] {
  const hits: Hit[] = [];

  lines.forEach((text, index) => {
    const trimmed = text.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return;

    RAW_SHADOW.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = RAW_SHADOW.exec(text)) !== null) {
      hits.push({ file: "", line: index + 1, text: trimmed.slice(0, 120), match: match[0].trim() });
    }
  });

  return hits;
}

function scanForRawShadows(): { hits: Hit[]; linesScanned: number } {
  const hits: Hit[] = [];
  let linesScanned = 0;

  for (const relative of SURFACES) {
    const absolute = path.join(REPO_ROOT, relative);
    expect(fs.existsSync(absolute), `${relative} must exist — the guard would pass vacuously`).toBe(true);

    const lines = fs.readFileSync(absolute, "utf-8").split(/\r?\n/);
    linesScanned += lines.length;
    hits.push(...scanLinesForRawShadows(lines).map(hit => ({ ...hit, file: relative })));
  }

  return { hits, linesScanned };
}

describe("clinical pane elevation", () => {
  it("pins a non-empty surface list and actually reads it", () => {
    /*
     * The "scanned an empty directory and reported 0 violations" shape this repository has been bitten
     * by before. With `SURFACES = []` the `existsSync` guard never ran, the scan returned no hits, and
     * the headline assertion below passed while checking nothing.
     */
    expect(SURFACES.length).toBeGreaterThan(0);
    const { linesScanned } = scanForRawShadows();
    expect(linesScanned, "the scan must have read real files").toBeGreaterThan(100);
  });

  it("uses no raw Tailwind shadow utility in the pinned clinical panes", () => {
    const { hits } = scanForRawShadows();
    const report = hits.map((h) => `  ${h.file}:${h.line}  ${h.match}\n      ${h.text}`).join("\n");

    expect(
      hits,
      hits.length === 0
        ? ""
        : `Raw shadow utilities found in a pane whose elevation token is \`none\`:\n${report}\n\n` +
          `Depth here is the fill ramp plus a hairline border. If a surface genuinely needs to read ` +
          `as raised, raise \`--cs-shadow-card\` in variables.css so both themes and the print pass ` +
          `move together — do not add a one-off utility.`
    ).toHaveLength(0);
  });

  /**
   * The self-tests, run against the REAL scan rather than the bare regex.
   *
   * Every earlier version tested `RAW_SHADOW.test(sample)` directly, which cannot fail on a broken
   * comment filter or a broken file loop — so neither had a test.
   */
  it("detects every realistic spelling of the utility it exists to forbid", () => {
    for (const sample of [
      `<div className="p-3.5 rounded-lg border shadow-sm" />`,
      `<div className="shadow" />`,
      `<div className="shadow-[0_1px_2px_rgba(0,0,0,0.08)]" />`,
      `<div className="hover:shadow-md" />`,
      `<div className="2xl:shadow-md" />`,
      `<div className="!shadow-xs" />`,
    ]) {
      expect(scanLinesForRawShadows([sample]), `${sample} must be flagged`).toHaveLength(1);
    }
  });

  it("does not fire on the sanctioned spellings", () => {
    for (const allowed of [
      `className="shadow-none"`,
      `className="drop-shadow-sm"`,
      `className="p-3 border"`,
      `boxShadow: "var(--cs-shadow-card, none)",`,
    ]) {
      expect(scanLinesForRawShadows([allowed]), `${allowed} must not be flagged`).toHaveLength(0);
    }
  });

  it("skips comment lines, which is how the pinned files explain their own removals", () => {
    // The pinned files' only remaining `shadow-*` strings are those comments. If the filter rots, the
    // headline assertion starts failing for the wrong reason and gets deleted rather than fixed.
    expect(scanLinesForRawShadows([" * shadow-sm was removed here because …"])).toHaveLength(0);
    expect(scanLinesForRawShadows(["// shadow-sm removed"])).toHaveLength(0);
    // ...and a live line is still caught, so the filter is not simply swallowing everything.
    expect(scanLinesForRawShadows(['  className="shadow-sm"'])).toHaveLength(1);
  });
});
