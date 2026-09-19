import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  CONSENSUS_VERDICT_VALUES,
  isConsensusVerdictFragment,
} from "../thresholds/consensus.ts";

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
function stripComments(source: string): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, match =>
    "\n".repeat(match.split("\n").length - 1)
  );
  return withoutBlock.replace(/\/\/.*$/gm, "");
}

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

  it("only ever compares it against a fragment of a real verdict", () => {
    const violations: string[] = [];

    for (const file of files) {
      const relative = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (EXCLUDED_FILES.has(relative)) continue;
      const lines = stripComments(fs.readFileSync(file, "utf-8")).split("\n");

      lines.forEach((line, index) => {
        // Only lines that both mention the verdict and quote a literal can be a comparison.
        if (!line.includes("consensusVerdict")) return;

        for (const literal of quotedLiterals(line)) {
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
