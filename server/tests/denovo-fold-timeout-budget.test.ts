import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { CONFIG } from "../config.ts";
import { CLIENT_DENOVO_FOLD_SUBMIT_BUDGET_MS } from "../../src/shared/timeouts.ts";
import {
  ESM_ATLAS_PUBLIC_MAX_AA,
  JAPANFOLD_ESMFOLD2_MAX_AA,
} from "../../src/shared/foldingLimits.ts";

/**
 * The de novo folding budgets must NEST, for the third time in this repository.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * `src/shared/timeouts.ts` already records the FoldX version of this defect twice: independent timers
 * of equal length where the outermost always fired first, so a *successful* long run was reported to
 * the user as a timeout. The de novo path had the same shape and nobody noticed, because nothing
 * failed when the numbers drifted:
 *
 *   `POST /api/v1/esmfold` was called with a hardcoded 45 s client budget (`src/api/structureApi.ts`)
 *   while the server was permitted 60 s on Tier-1 alone (`CONFIG.timeouts.japanfoldFoldingMs`). The
 *   client therefore aborted FIRST, every time a provider was slow — and the UI then explained the
 *   abort as "timed out due to high GPU cluster load", a claim an `AbortError` cannot support.
 *
 * The client is the one that gives up, so the client must outlast the server. If you need to break
 * that ordering, change the design — not this test.
 */

const SEC = 1000;

/**
 * Worst-case wall clock for ONE `/api/v1/esmfold` request.
 *
 * The route folds wild-type and mutant SEQUENTIALLY, and a single fold may try all three tiers before
 * throwing. Every term is read from CONFIG rather than restated, so a provider budget that grows
 * without the client budget growing with it fails here.
 */
const WORST_CASE_PER_FOLD_MS =
  CONFIG.timeouts.japanfoldFoldingMs + CONFIG.timeouts.esmfoldSidecarMs + CONFIG.timeouts.esmAtlasMs;

const WORST_CASE_PER_REQUEST_MS = 2 * WORST_CASE_PER_FOLD_MS;

describe("de novo folding budgets nest", () => {
  it("outlasts the server's worst case for one request", () => {
    expect(
      CLIENT_DENOVO_FOLD_SUBMIT_BUDGET_MS,
      `the client would abort a fold the server is still running: ` +
        `client ${CLIENT_DENOVO_FOLD_SUBMIT_BUDGET_MS / SEC}s vs worst case ` +
        `${WORST_CASE_PER_REQUEST_MS / SEC}s (2 folds x (Tier-1 ${CONFIG.timeouts.japanfoldFoldingMs / SEC}s ` +
        `+ sidecar ${CONFIG.timeouts.esmfoldSidecarMs / SEC}s + ESM Atlas ${CONFIG.timeouts.esmAtlasMs / SEC}s))`
    ).toBeGreaterThan(WORST_CASE_PER_REQUEST_MS);
  });

  it("outlasts a single Tier-1 attempt, which is the timer that used to win", () => {
    // The specific inversion: 45 s < 60 s. Asserted separately from the worst case so a regression
    // reports the defect it actually reintroduced.
    expect(
      CLIENT_DENOVO_FOLD_SUBMIT_BUDGET_MS,
      "the client budget is shorter than one Tier-1 fold attempt"
    ).toBeGreaterThan(CONFIG.timeouts.japanfoldFoldingMs);
  });

  it("still bounds the spinner", () => {
    // A nesting fix must not become an unbounded wait: the budget is a ceiling, not a promise.
    expect(CLIENT_DENOVO_FOLD_SUBMIT_BUDGET_MS).toBeLessThanOrEqual(5 * 60 * SEC);
  });
});

describe("the folding ceilings are declared once", () => {
  const REPO_ROOT = process.cwd();

  /**
   * The copy drifted from the enforcement because the numbers were written out twice. Importing the
   * shared module is what makes that impossible, so it is asserted rather than assumed — the same
   * approach `foldx-timeout-budget.test.ts` takes to hardcoded stage timeouts.
   */
  it("has every de novo consumer importing src/shared/foldingLimits", () => {
    for (const relative of [
      "server/services/structure/esmfold.ts",
      "server/services/structure/folding-engines.ts",
      "src/hooks/useStructuralFolding.ts",
      "src/components/inspector/StructureInspector.tsx",
      "src/components/MolstarViewer.tsx",
    ]) {
      const source = fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8");
      expect(source, `${relative} imports nothing from src/shared/foldingLimits`).toMatch(
        /shared\/foldingLimits/
      );
    }
  });

  it("leaves no bare folding-limit literal in the server folder path", () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "server", "services", "structure", "esmfold.ts"),
      "utf-8"
    );
    // `1024`/`400` may only appear inside the shared module now. A bare comparison here means the
    // ceiling has been restated next to a constant that also says it.
    expect(source, "esmfold.ts restates the Tier-1 ceiling numerically").not.toMatch(/>\s*1024\b/);
    expect(source, "esmfold.ts restates the public fallback ceiling numerically").not.toMatch(/>\s*400\b/);
    expect(source, "esmfold.ts hardcodes a tier timeout; use CONFIG.timeouts.*").not.toMatch(
      /AbortSignal\.timeout\(\s*\d/
    );

    expect(JAPANFOLD_ESMFOLD2_MAX_AA).toBe(1024);
    expect(ESM_ATLAS_PUBLIC_MAX_AA).toBe(400);
  });
});
