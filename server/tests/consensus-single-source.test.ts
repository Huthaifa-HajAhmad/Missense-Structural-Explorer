import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

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
 * Removes comments while preserving line numbers.
 *
 * Necessary because these files *document* the defects they fixed — a bare regex over the raw source
 * matches the explanation, which is how the first version of this test failed on its own comment.
 */
function stripComments(source: string): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, match =>
    "\n".repeat(match.split("\n").length - 1)
  );
  return withoutBlock.replace(/\/\/.*$/gm, "");
}

function readCode(relative: string): string {
  return stripComments(fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8"));
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
      source.includes("computeCalibratedConsensus") || source.includes("computeConsensusVerdict"),
      `${relative} computes a consensus, but ${MUST_NOT_COMPUTE.find(([f]) => f === relative)?.[1]}`
    ).toBe(false);
  });

  it("keeps the authoritative computation where all six engines are visible", () => {
    const source = readCode(AUTHORITATIVE_SITE);
    const callIndex = source.indexOf("computeCalibratedConsensus(");
    expect(callIndex, `${AUTHORITATIVE_SITE} must call the consensus`).toBeGreaterThan(-1);

    /**
     * Inspect the ARGUMENT OBJECT of the call, not the file.
     *
     * Asserting `source.toContain(engine)` over a 700-line module was tautological: every engine name
     * appears many times elsewhere, so replacing the call with `{ foldxMean, rasp }` still "found"
     * all six — a guard written to protect the engine set that could not detect its loss.
     */
    const open = source.indexOf("{", callIndex);
    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i++) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const args = source.slice(open, end + 1);
    expect(args.length, "the extracted argument object looks wrong").toBeGreaterThan(20);

    for (const engine of [
      "foldxMean",
      "dynamut2",
      "ddmut",
      "rasp",
      "thermompnn",
      "stabilityoracle",
    ]) {
      expect(args, `${AUTHORITATIVE_SITE} must pass ${engine} to the consensus CALL`).toContain(engine);
    }
    // ...including both FoldX exclusion flags, which the poll routes omitted.
    expect(args).toContain("foldxRepairFailed");
    expect(args).toContain("foldxBinaryMissing");
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
});
