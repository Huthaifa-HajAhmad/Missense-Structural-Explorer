import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { stripCommentsForScan } from "../../src/shared/engineStatus.ts";

/**
 * The calibrated consensus is computed in exactly ONE server place.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * `enrichBiophysicalResult` sees all six engines and is the authoritative computation. The two remote
 * engine poll routes also computed it — but from a FIVE-engine subset (no ThermoMPNN, no
 * `foldxBinaryMissing`) — and returned that over the top of the enriched payload, which the client
 * merged into its cache. The result was a run whose exported verdict disagreed with the one on
 * screen: measured, "Insufficient Biophysical Data" in the payload for a run the tab presented as
 * "Elevated Misfolding Risk (Single-Tool Estimate)".
 *
 * Nothing failed when that was true. This test is what fails now.
 *
 * If a future change genuinely needs a second computation, it must pass the *same* engine set and
 * inputs — and it should almost certainly be a shared helper instead, so the two cannot drift.
 */

const REPO_ROOT = process.cwd();

/**
 * Delegates to the scanner's own string-aware stripper.
 *
 * This file kept its own regex copy, which truncated a line at the first `//` anywhere — including
 * inside a string — so the brace counter below walked corrupted text and could unbalance on source
 * that was perfectly valid. Sharing the implementation means the guards and the scanner they call
 * cannot disagree about what a comment is.
 */
const stripComments = stripCommentsForScan;

function readCode(relative: string): string {
  return stripComments(fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8"));
}

/** A CALL to the consensus, TOLERATING WHITESPACE before the parenthesis. */
const CONSENSUS_CALL = /\bcompute(?:Calibrated|Stability)?Consensus(?:Verdict)?\s*\(/g;
const CONSENSUS_CALL_ONE = /\bcompute(?:Calibrated|Stability)?Consensus(?:Verdict)?\s*\(/;
/**
 * A bare MENTION — no parenthesis required. The whole-server walk uses THIS one.
 *
 * The difference is the whole point, and a review measured it: the walk missed the very counterexample
 * the previous commit message cited, because an alias contains no call text at all —
 *
 *     const compute = computeCalibratedConsensus;   // no "(" on this line
 *     return compute({ foldxMean, rasp });          // no name on this one either
 *
 * A mention in a production file outside the authoritative site is a second call site or an alias to
 * one, so the walk flags the MENTION rather than the call. The authoritative file is exempt along with
 * its import, and test files are exempt because a test may compute a consensus to check it.
 */
const CONSENSUS_MENTION = /\bcompute(?:Calibrated|Stability)?Consensus(?:Verdict)?\b/g;

function isTestFile(relative: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(relative) || /(^|\/)(__tests__|tests)\//.test(relative);
}

/** Every server source file, walked rather than listed. */
function serverSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(REPO_ROOT, "server"));
  const rootServer = path.join(REPO_ROOT, "server.ts");
  if (fs.existsSync(rootServer)) out.push(rootServer);
  return out;
}

/**
 * Blanks string and template literals, PRESERVING LENGTH so every offset stays valid.
 *
 * The argument span used to be extracted from raw text, so a `}` INSIDE A STRING ended the object early:
 * `note: "}"` truncated the span and put a trailing `...overrides` spread outside the check that exists
 * to catch spreads. A review demonstrated exactly that. Simple templates are handled; a template
 * containing another template would not be, which is a limit worth knowing rather than trusting.
 */
function blankStringLiterals(code: string): string {
  return code.replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, m => " ".repeat(m.length));
}

/** Server files that must NOT compute a consensus, and why. */
const MUST_NOT_COMPUTE: Array<[string, string]> = [
  [
    "server/routes/biophysics/polling.ts",
    "a per-engine poll sees only the engines it knows about, so it cannot compute the run's verdict",
  ],
  [
    "server/routes/biophysics/generation.ts",
    "the generate route returns early; the verdict belongs to the enrichment step",
  ],
  ["server/routes/shared.ts", "shared route helpers must not carry a second verdict"],
];

/** The one file allowed to compute it. */
const AUTHORITATIVE_SITE = "server/services/stability/energy-models.ts";

describe("the consensus has a single server-side computation site", () => {
  it.each(MUST_NOT_COMPUTE)("%s does not compute a consensus", relative => {
    const source = readCode(relative);
    expect(
      source.includes("computeCalibratedConsensus") ||
        source.includes("computeStabilityConsensus") ||
        source.includes("computeConsensusVerdict"),
      `${relative} computes a consensus, but ${MUST_NOT_COMPUTE.find(([f]) => f === relative)?.[1]}`
    ).toBe(false);
  });

  it("keeps the authoritative computation where all six engines are visible", () => {
    const source = readCode(AUTHORITATIVE_SITE);

    /**
     * This test was tautological, and a review demonstrated three separate ways.
     *
     *   • it asserted `source.toContain(engine)` over a 700-line module in which every engine name
     *     appears many times elsewhere — so replacing the call with `{ foldxMean, rasp }` still
     *     "found" all six.
     *   • it matched NAMES, so `thermompnn: null` — the exact defect this guards, a five-engine
     *     consensus — passed, as did `rasp: 0` and `foldxRepairFailed: false`.
     *   • hoisting the object into a const defeated the brace matcher entirely: `indexOf("{")` then
     *     measured the next `return { … }` block, which contains every name as a substring, while the
     *     call itself passed a variable.
     *
     * Three changes make it describe the real call: exactly one call site; the argument must be an
     * INLINE object literal; and each engine must be bound to a real value, not a literal that
     * switches it off.
     */
    const callSites = (source.match(CONSENSUS_CALL) ?? []).length;
    expect(callSites, `${AUTHORITATIVE_SITE} must call the consensus exactly once`).toBe(1);

    // Braces are matched against a copy with STRING LITERALS BLANKED, so a `}` inside a string cannot
    // end the argument object early and hide a trailing spread.
    const blanked = blankStringLiterals(source);
    const call = CONSENSUS_CALL_ONE.exec(blanked);
    const afterParen = (call?.index ?? 0) + (call?.[0].length ?? 0);
    const tail = blanked.slice(afterParen);
    expect(
      tail.trimStart().startsWith("{"),
      `${AUTHORITATIVE_SITE} must pass an inline object literal, or the engine set cannot be checked`
    ).toBe(true);

    const open = afterParen + tail.indexOf("{");
    let depth = 0;
    let end = open;
    for (let i = open; i < blanked.length; i++) {
      if (blanked[i] === "{") depth += 1;
      else if (blanked[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const args = blanked.slice(open, end + 1);
    expect(args.length, "the extracted argument object looks wrong").toBeGreaterThan(20);

    /**
     * The spread check runs over the whole CALL, not the brace-matched span — deliberately.
     *
     * A review defeated the blanker with a regex literal carrying a quote
     * (`note: /"/.test(String(foldxMean)) ? "}" : "x"`), after which the span ended early, a trailing
     * `...overrides` fell outside it, and every assertion still passed with the spread present: the check
     * failed OPEN, and an admitted "limit worth knowing" silently disabled the guarantee.
     *
     * Comparing the blanked and raw brace readings to catch that does NOT work: they legitimately differ
     * whenever a string contains a brace, which is the case blanking exists for. So the region is
     * delimited by the call's own closing `});` instead of by braces — whatever a string, template or
     * regex literal does to the pairing, a spread inside the call cannot escape this.
     */
    const callCloser = /\n\s*\}\);/.exec(blanked.slice(afterParen));
    const checkedCall = callCloser
      ? blanked.slice(afterParen, afterParen + callCloser.index + callCloser[0].length)
      : blanked.slice(afterParen, afterParen + 4000);

    expect(
      checkedCall,
      "a spread in the consensus argument can override the engine set after it is written"
    ).not.toMatch(/\.\.\./);

    /**
     * A REAL value, not an expression that can disable the engine.
     *
     * The previous form captured only the FIRST identifier of the right-hand side, so it inspected
     * `void` from `void 0` and `Number` from `Number.NaN` — and a review demonstrated that both
     * spellings are consensus-identical to `null`, so the exact five-engine defect this guards went
     * straight through. A blacklist cannot enumerate the ways to write "nothing", so the check is a
     * whitelist on the whole expression: the value must be a plain local identifier, with no operator,
     * call, member access or literal.
     *
     * A legitimate refactor to a dotted path or a helper call will fail this and have to update the
     * guard. That friction is the point — it makes someone look at why an engine's value stopped being
     * a simple binding.
     */
    const PLAIN_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
    const DISABLING = /^(null|undefined|false|true|NaN|Infinity)$/;

    for (const engine of [
      "foldxMean",
      "dynamut2",
      "ddmut",
      "rasp",
      "thermompnn",
      "stabilityoracle",
      "foldxRepairFailed",
      "foldxBinaryMissing",
    ]) {
      // The WHOLE right-hand side, up to the next property or the closing brace — not just its first
      // token, which is what let `void 0` read as the identifier `void`.
      const explicit = args.match(new RegExp(`\\b${engine}\\s*:\\s*([^,\\n}]+)`));
      const value = (explicit?.[1] ?? "").trim();
      const shorthand = new RegExp(`(?:[{,\\s])${engine}\\s*(?:,|\\}|$)`);
      const bound = explicit
        ? PLAIN_IDENTIFIER.test(value) && !DISABLING.test(value)
        : shorthand.test(args);
      expect(
        bound,
        `${AUTHORITATIVE_SITE} must bind ${engine} to a plain local value, not to ${
          value ? `"${value}"` : "a non-identifier expression"
        }`
      ).toBe(true);
    }
  });

  it("keeps the wire verdict a closed-set value rather than free text", () => {
    // Provisionality used to be concatenated into the verdict string
    // ("… (Preliminary - pending: DynaMut2)"), which made the field unparseable and untypeable.
    // It is carried by `evidenceComplete` / `pendingTools` instead.
    const source = readCode(AUTHORITATIVE_SITE);
    expect(
      /Preliminary - pending/.test(source),
      "the verdict must not be suffixed with free text; use evidenceComplete/pendingTools"
    ).toBe(false);
  });

  it("has no second computation site ANYWHERE in the server, tests excepted", () => {
    /**
     * The count above is per FILE, and MUST_NOT_COMPUTE is three hardcoded paths — so a second
     * computation in a NEW server file was invisible to every assertion in this file. A review
     * demonstrated the shape: `const compute = computeCalibratedConsensus;` in a new module, then
     * `compute({ foldxMean, rasp })`, which contains no call text at all in the files being checked.
     *
     * This walks the whole server tree instead of trusting a list. Test files are exempt: a test that
     * computes a consensus to check the computation is not a second production site.
     */
    const offenders: string[] = [];

    for (const file of serverSourceFiles()) {
      const relative = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (relative === AUTHORITATIVE_SITE || isTestFile(relative)) continue;
      const found = (stripComments(fs.readFileSync(file, "utf-8")).match(CONSENSUS_MENTION) ?? []).length;
      if (found > 0) offenders.push(`  ${relative} (${found} mention(s))`);
    }

    expect(
      offenders,
      offenders.length
        ? `a consensus is computed outside ${AUTHORITATIVE_SITE}:\n${offenders.join("\n")}`
        : ""
    ).toEqual([]);
  });
});
