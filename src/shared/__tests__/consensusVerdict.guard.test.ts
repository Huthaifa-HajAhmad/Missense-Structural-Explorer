import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  CONSENSUS_VERDICT_VALUES,
  computeConsensusVerdict,
  isConsensusVerdictFragment,
} from "../thresholds/consensus.ts";
import { stripCommentsForScan } from "../engineStatus.ts";

/**
 * Guardrail: no surface may compare the consensus verdict against a string the consensus cannot
 * produce.
 *
 * WHY THIS EXISTS
 * ---------------
 * `SplicingTab` contained `consensusVerdict === "destabilizing"`. `computeCalibratedConsensus`
 * only ever returns "… Misfolding Risk (…)" or "Insufficient Biophysical Data", so that clause was
 * dead — and because it sat in an OR-chain that decides whether the *protein* arm carries
 * destabilization evidence, a variant whose only evidence was a strongly destabilizing prediction
 * was rendered "Thermodynamically Tolerated". Nothing failed; the branch simply never ran.
 *
 * This is a recurring shape in this codebase: a stringly-typed verdict compared against an
 * invented literal. The verdict is now a closed set (`CONSENSUS_VERDICTS`), so the comparison can
 * be checked mechanically.
 */

const REPO_ROOT = process.cwd();

/** Source roots that render the consensus. */
const SCAN_ROOTS = ["src"];

/** Directories that hold fixtures/artefacts rather than rendered surfaces. */
const IGNORED_DIRS = new Set(["node_modules", "dist", "coverage", "graphify-out", "graft", ".git"]);

/**
 * Files excluded from the scan:
 *   • the module that DEFINES the verdict set, and
 *   • this guard itself, which must quote the invalid literal to explain the rule.
 */
const EXCLUDED_FILES = new Set([
  "src/shared/thresholds/consensus.ts",
  "src/shared/__tests__/consensusVerdict.guard.test.ts",
]);

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Removes comments while preserving line numbers, so a comment *describing* the old bug is not
 * itself treated as a violation — the mistake this guard is about was in code, not prose.
 */
/**
 * Delegates to the scanner's own string-aware stripper.
 *
 * This file kept its own regex copy, so `f657120`'s promise — that the guards and the scanner they
 * call cannot disagree about what a comment is — held only for the label guard. Here, an impossible
 * comparison placed after a URL on one line was invisible:
 *
 *   if (href === "https://doi.org/10/x" && consensusVerdict === "destabilizing")
 *
 * stripped to `if (href === "https:` and produced no violation, while the reverse word order was
 * caught. Whether the guard could see the defect depended on which string came first on the line.
 */
const stripComments = stripCommentsForScan;

/** Every single/double/backtick-quoted literal on a line. */
function quotedLiterals(line: string): string[] {
  const literals: string[] = [];
  const re = /(["'`])([^"'`]*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) literals.push(match[2]);
  return literals;
}

describe("consensus verdict is a closed set", () => {
  it("exposes every verdict the function can return", () => {
    expect(CONSENSUS_VERDICT_VALUES.length).toBeGreaterThanOrEqual(5);
    for (const verdict of CONSENSUS_VERDICT_VALUES) {
      expect(verdict.trim()).not.toBe("");
      // A verdict is self-describing, so a fragment check on it succeeds.
      expect(isConsensusVerdictFragment(verdict)).toBe(true);
    }
  });

  it("accepts the fragments surfaces legitimately use", () => {
    for (const fragment of ["High", "Moderate", "Elevated", "Insufficient", "Misfolding Risk", "Low"]) {
      expect(isConsensusVerdictFragment(fragment), fragment).toBe(true);
    }
  });

  it("rejects the exact string that made the original clause dead", () => {
    // The original bug used LOWERCASE "destabilizing". The verdict text says
    // "High Misfolding Risk (Destabilizing Consensus)" with a capital D, and the comparison was
    // case-sensitive, so it could never match — which is why nothing failed and why the branch
    // was never noticed.
    expect(isConsensusVerdictFragment("destabilizing")).toBe(false);
    expect(isConsensusVerdictFragment("destabilised")).toBe(false);
    expect(isConsensusVerdictFragment("Tolerated")).toBe(false);
    expect(isConsensusVerdictFragment("")).toBe(false);
  });

  it("makes the impossible comparison a COMPILE error, not just a scanning concern", () => {
    // The durable fix: the verdict is a literal union, so TypeScript rejects a comparison against a
    // string the consensus cannot return (TS2367, no overlap). A regex guard can be walked past by a
    // rename or a `switch`; the type cannot.
    const verdict = computeConsensusVerdict({ foldx: 2.0 });
    // @ts-expect-error — "destabilizing" is not a member of the verdict union. If the union ever
    // widens back to `string`, this directive becomes unused and `tsc --noEmit` fails.
    const impossible = verdict === "destabilizing";
    expect(impossible).toBe(false);
  });

  it("still accepts the capitalised fragment that a verdict really contains", () => {
    // `consensusVerdict.includes("Destabilizing")` is a legitimate inspection of the high verdict.
    expect(isConsensusVerdictFragment("Destabilizing")).toBe(true);
  });
});

describe("no surface compares the verdict to an impossible literal", () => {
  const files = SCAN_ROOTS.flatMap(root =>
    fs.existsSync(path.join(REPO_ROOT, root))
      ? collectSourceFiles(path.join(REPO_ROOT, root))
      : []
  );

  it("scans a non-trivial number of source files", () => {
    // Guards against the walker silently finding nothing to check.
    expect(files.length).toBeGreaterThan(50);
  });

  /**
   * A line is a candidate only when the identifier actually takes part in a comparison.
   *
   * The previous gate was a bare `line.includes("consensusVerdict")`, which is both too wide and too
   * narrow:
   *   • too wide — it flagged ANY quoted literal sharing a line with the identifier, so an ordinary
   *     object literal such as `{ consensusVerdict: LIVE, pendingTools: ["DynaMut2"] }` produced
   *     violations for two strings that are not comparisons at all. A guard that accuses correct code
   *     is one people learn to route around.
   *   • too narrow — a renamed local, or a `switch` whose `case` lines carry the literals, is not
   *     seen. That hole is why the verdict is ALSO a literal union in `consensus.ts`: the type rejects
   *     an impossible comparison at compile time, which no line scan can guarantee.
   */
  /**
   * Literals that are COMPARED WITH the identifier — the operator is between them.
   *
   * Two earlier versions of this gate were both wrong, each in a different direction, and a review
   * measured exactly why:
   *
   *   • the bare `line.includes("consensusVerdict")` gate flagged any quoted literal sharing a line
   *     with the identifier, so `{ consensusVerdict: LIVE, pendingTools: ["DynaMut2"] }` produced
   *     violations for strings that are not comparisons.
   *   • narrowing it to "identifier AND some operator on the line" silenced that false positive but
   *     lost true positives (`Object.is(consensusVerdict, "destabilizing")`,
   *     `["destabilizing"].indexOf(consensusVerdict)`) — and, measured over the whole tree, its only
   *     effect was to keep the guard's OWN new test green. That is a guard being edited to suit a
   *     test rather than the reverse.
   *
   * Requiring the operator to sit BETWEEN the identifier and the literal fixes both: no operator, no
   * match (object literals are ignored); and the literal must be the one being compared, so a
   * ternary's branch strings are not swept in.
   *
   * Known residual, stated rather than implied: a literal that is separated from the comparison by
   * more than the operator call — `["a","destabilizing"].includes(x)` — is not detected, and the
   * `switch`/`case` shape never puts the identifier on the `case` line. Those are why the verdict is
   * ALSO a literal union in `consensus.ts`, which fails the build instead of printing a violation.
   */
  const COMPARED_WITH_VERDICT = new RegExp(
    String.raw`consensusVerdict\s*(?:===|!==|==|!=|\.includes\(|\.startsWith\(|\.endsWith\(|\.indexOf\(|\.match\(|\.search\(|\.localeCompare\(|\.has\()\s*(["'\`])([^"'\`\n]*)\1`,
    "g"
  );

  function comparedLiterals(line: string): string[] {
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = COMPARED_WITH_VERDICT.exec(line))) out.push(m[2]);
    return out;
  }

  it("only ever compares it against a fragment of a real verdict", () => {
    const violations: string[] = [];

    for (const file of files) {
      const relative = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (EXCLUDED_FILES.has(relative)) continue;
      const lines = stripComments(fs.readFileSync(file, "utf-8")).split("\n");

      lines.forEach((line, index) => {
        if (!line.includes("consensusVerdict")) return;

        for (const literal of comparedLiterals(line)) {
          if (isConsensusVerdictFragment(literal)) continue;
          violations.push(`  ${relative}:${index + 1} compares consensusVerdict against "${literal}"`);
        }
      });
    }

    expect(
      violations,
      violations.length
        ? `Found ${violations.length} comparison(s) against a string the consensus cannot produce:\n` +
          violations.join("\n") +
          `\n\nValid verdicts: ${CONSENSUS_VERDICT_VALUES.join(" | ")}`
        : ""
    ).toEqual([]);
  });
});
