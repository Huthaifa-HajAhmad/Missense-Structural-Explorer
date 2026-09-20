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
 * only ever returns "â€¦ Misfolding Risk (â€¦)" or "Insufficient Biophysical Data", so that clause was
 * dead â€” and because it sat in an OR-chain that decides whether the *protein* arm carries
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
 *   â€¢ the module that DEFINES the verdict set, and
 *   â€¢ this guard itself, which must quote the invalid literal to explain the rule.
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
 * itself treated as a violation â€” the mistake this guard is about was in code, not prose.
 */
/**
 * Delegates to the scanner's own string-aware stripper.
 *
 * This file kept its own regex copy, so `f657120`'s promise â€” that the guards and the scanner they
 * call cannot disagree about what a comment is â€” held only for the label guard. Here, an impossible
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
    // case-sensitive, so it could never match â€” which is why nothing failed and why the branch
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
    // @ts-expect-error â€” "destabilizing" is not a member of the verdict union. If the union ever
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
   *   â€¢ too wide â€” it flagged ANY quoted literal sharing a line with the identifier, so an ordinary
   *     object literal such as `{ consensusVerdict: LIVE, pendingTools: ["DynaMut2"] }` produced
   *     violations for two strings that are not comparisons at all. A guard that accuses correct code
   *     is one people learn to route around.
   *   â€¢ too narrow â€” a renamed local, or a `switch` whose `case` lines carry the literals, is not
   *     seen. That hole is why the verdict is ALSO a literal union in `consensus.ts`: the type rejects
   *     an impossible comparison at compile time, which no line scan can guarantee.
   */
  /**
   * Literals that are COMPARED WITH the identifier â€” the operator is between them.
   *
   * Two earlier versions of this gate were both wrong, each in a different direction, and a review
   * measured exactly why:
   *
   *   â€¢ the bare `line.includes("consensusVerdict")` gate flagged any quoted literal sharing a line
   *     with the identifier, so `{ consensusVerdict: LIVE, pendingTools: ["DynaMut2"] }` produced
   *     violations for strings that are not comparisons.
   *   â€¢ narrowing it to "identifier AND some operator on the line" silenced that false positive but
   *     lost true positives (`Object.is(consensusVerdict, "destabilizing")`,
   *     `["destabilizing"].indexOf(consensusVerdict)`) â€” and, measured over the whole tree, its only
   *     effect was to keep the guard's OWN new test green. That is a guard being edited to suit a
   *     test rather than the reverse.
   *
   * THE PREDICATE IS FORM-INDEPENDENT ON PURPOSE. It used to require the operator to sit BETWEEN the
   * identifier and the literal, which meant every other way of writing the same comparison was
   * invisible: `"destabilizing" === consensusVerdict`, `consensusVerdict?.includes(â€¦)`, `(v as string)
   * === â€¦`, `String(v) === â€¦`, `v.trim() === â€¦`, `["destabilizing"].includes(v)`, `Object.is(v, â€¦)`, a
   * `switch`/`case`, and an operator split across lines all passed. Measured at the time: 0 violations
   * across 232 files while 11 of those 12 shapes went through. A guard that cannot fail is worse than
   * none, because it certifies the absence of the defect.
   *
   * So: if a statement mentions the identifier, contains a comparison or lookup token, AND contains a
   * string literal, every literal in it is checked. Order does not matter, the call form does not
   * matter, and the statement â€” not the line â€” is the unit, so a split operator and a `switch` body are
   * both covered. The literal is still the discriminator: a real fragment of a verdict is legitimate,
   * anything the consensus cannot produce is not.
   *
   * Residual, stated rather than implied: a comparison through a RENAMED local (`const v =
   * consensusVerdict; v === "x"`) is not detectable by any source scan, and neither is a `.includes()`
   * used for presentation rather than decision. Those are why the verdict is ALSO a literal union in
   * `consensus.ts`, which fails the build instead of printing a violation.
   */
  const COMPARISON_TOKEN = /(===|!==|==|!=|\.includes\(|\.startsWith\(|\.endsWith\(|\.indexOf\(|\.match\(|\.search\(|\.localeCompare\(|\.has\(|Object\.is\(|\bcase\b)/;
  const STRING_LITERAL = /(["'`])((?:[^"'`\\\n]|\\.)*)\1/g;
  /**
   * An expression CONTINUES onto the next line only when it stops on one of these.
   *
   * Deliberately not `{`: that opens a BLOCK. Treating a block as a continuation walked into the
   * function body of `if (consensusVerdict.includes("Insufficient")) {` and flagged the className
   * literals of its return value as verdict comparisons â€” eight false positives, which is how a guard
   * teaches people to ignore it.
   */
  const CONTINUES = /(===|!==|==|!=|&&|\|\||,|\?|:|\+|\(|\[|\\)\s*$/;

  /**
   * F15-1: a literal counts only when it is an OPERAND of the identifier.
   *
   * The previous version flagged every non-fragment literal in any statement that mentioned the
   * identifier and contained a comparison token. Green on the real tree, but a review showed that
   * minimal realistic edits to the tone logic produce false positives â€” a ternary's style strings, a
   * `switch` case label used for colour, a property value whose line sweeps into the next â€” and this
   * guard has been narrowed twice already for exactly that. A guard that accuses correct code is one
   * people route around, so the match is now on the literal's RELATIONSHIP to the identifier:
   *
   *   (a) either side of `===`, `!==`, `==`, `!=`, or inside `Object.is(...)`
   *   (b) the argument of a lookup whose RECEIVER expression mentions the identifier, or the array
   *       element of an array-membership test on it
   *   (c) a `case` label inside a `switch` on it
   *
   * The receiver rule is what removes the fourth false positive: `X.includes("DynaMut2")` on the line
   * after the identifier is not a claim about the verdict, because its receiver is `X`.
   */
  function comparedLiterals(statement: string): string[] {
    if (!statement.includes("consensusVerdict")) return [];

    const out: string[] = [];
    const literal = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
    let m: RegExpExecArray | null;
    literal.lastIndex = 0;

    while ((m = literal.exec(statement))) {
      const text = m[2];
      // An EMPTY literal is how code asks "is this set?" â€” `consensusVerdict !== ""` is not a claim
      // about which verdict it is, and flagging it is how a guard earns its suppression.
      if (text.length === 0) continue;

      const before = statement.slice(0, m.index);
      const after = statement.slice(m.index + m[0].length);
      const mentions = (side: string) => side.includes("consensusVerdict");

      const comparisonLeft = /(===|!==|==|!=)\s*$/.test(before);
      const comparisonRight = /^\s*(===|!==|==|!=)/.test(after);
      const insideObjectIs = /Object\.is\(/.test(before) && /\)/.test(after);
      const lookupLeft =
        /\.(includes|startsWith|endsWith|indexOf|match|search|localeCompare|has)\(\s*$/.test(before);
      const membershipRight = /^\s*\]\s*\.(includes|indexOf)\(/.test(after);
      const caseLabel = /(^|[;{}]\s*)case\s*$/.test(before) && /switch\s*\(/.test(statement);

      /** The receiver expression: from the nearest delimiter to the lookup call it belongs to. */
      const receiverMentions = (side: string) => {
        const r =
          /(?:^|[\[{,=:&|]|\breturn\b)\s*([^,;=:&|\[\{]*?)\??\.(?:includes|startsWith|endsWith|indexOf|match|search|localeCompare|has)\(\s*$/.exec(
            side
          );
        return Boolean(r && r[1].includes("consensusVerdict"));
      };

      const flagged =
        (comparisonLeft && mentions(before)) ||
        (comparisonRight && mentions(after)) ||
        (insideObjectIs && (mentions(before) || mentions(after))) ||
        (lookupLeft && receiverMentions(before)) ||
        (membershipRight && mentions(after)) ||
        (caseLabel && mentions(statement));

      if (flagged) out.push(text);
    }

    return out;
  }

  it("catches EVERY shape the comparison can be written in (self-test)", () => {
    /**
     * A source-scanning guard is only as strong as its positive cases, and this one has been wrong
     * twice: first too wide (it flagged object literals), then narrowed until it matched nothing. The
     * predicate is therefore exercised directly, on crafted sources, so it cannot go inert again
     * without this failing.
     */
    const MUST_FLAG = [
      `consensusVerdict === "destabilizing"`,
      `"destabilizing" === consensusVerdict`,
      `consensusVerdict?.includes("destabilizing")`,
      `(consensusVerdict as string) === "destabilizing"`,
      `String(consensusVerdict) === "destabilizing"`,
      `consensusVerdict.trim() === "destabilizing"`,
      `consensusVerdict.toUpperCase().includes("DESTABILIZING")`,
      `Object.is(consensusVerdict, "destabilizing")`,
      `["destabilizing"].includes(consensusVerdict)`,
      `switch (calConsensus.consensusVerdict) {\n  case "destabilizing":\n    break;\n}`,
      `consensusVerdict ===\n  "destabilizing"`,
    ];
    const MUST_NOT_FLAG = [
      `consensusVerdict !== ""`,
      `consensusVerdict.includes("Insufficient")`,
      `consensusVerdict.includes("High")`,
      // F15-1: the false positives a review produced from the repo's own tone logic.
      `const tone = calConsensus.consensusVerdict === "High" ? "text-danger" : "text-muted";`,
      `switch (calConsensus.consensusVerdict) {\n  case "High":\n    return "danger";\n}`,
      `derivedVerdict: "x",\n  X.includes("DynaMut2") ? "partial" : "complete"`,
      `<span title={calConsensus.consensusVerdict} className="text-red-500">x</span>`,
    ];

    for (const source of MUST_FLAG) {
      const flagged = comparedLiterals(source).filter(l => !isConsensusVerdictFragment(l));
      expect(flagged, `not caught: ${JSON.stringify(source)}`).not.toEqual([]);
    }

    for (const source of MUST_NOT_FLAG) {
      const flagged = comparedLiterals(source).filter(l => !isConsensusVerdictFragment(l));
      expect(flagged, `false positive: ${JSON.stringify(source)}`).toEqual([]);
    }
  });

  it("only ever compares it against a fragment of a real verdict", () => {
    const violations: string[] = [];

    for (const file of files) {
      const relative = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (EXCLUDED_FILES.has(relative)) continue;
      const lines = stripComments(fs.readFileSync(file, "utf-8")).split("\n");

      lines.forEach((line, index) => {
        if (!line.includes("consensusVerdict")) return;

        // The STATEMENT, not the line: an operator and its literal are routinely split, and a `switch`
        // puts the identifier and its `case` labels on different lines entirely.
        let statement = line;
        if (/switch\s*\(/.test(line)) {
          // A switch body IS a set of comparisons against that expression, so its cases belong to it.
          for (let i = index + 1; i < Math.min(lines.length, index + 12); i += 1) {
            statement += "\n" + lines[i];
            if (/^\s*\}/.test(lines[i])) break;
          }
        } else if (CONTINUES.test(line.trimEnd())) {
          for (let i = index + 1; i < Math.min(lines.length, index + 4); i += 1) {
            statement += "\n" + lines[i];
            if (!CONTINUES.test(statement.trimEnd())) break;
          }
        }

        for (const literal of comparedLiterals(statement)) {
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
