import { describe, expect, it } from "vitest";
import { computeRuleBasedACMG, type ACMGEvidenceInput } from "./index.ts";
import { buildPredictorEvidence } from "../../../../src/shared/predictorEvidence.ts";
import { NAE1_RESULT } from "../../../../src/shared/__tests__/fixtures/nae1Result.ts";
import { GATA4_RESULT } from "../../../../src/shared/__tests__/fixtures/gata4Perturbation.ts";

/**
 * The runtime protein language models (ESM-2, SaProt, ESMC/VESM) were retired on 2026-11-18
 * (doc/PROTEIN_LANGUAGE_MODELS_DECISION.md). They never voted in PP3/BP4, so retiring them must not
 * change any in-silico code or its strength. Each case below pins the code the engine and the
 * Predictors tab gave before the retirement, and feeds a saved payload that still carries the old
 * model results, so a stored analysis cannot change its verdict either.
 */

/** Old model results as a saved analysis stores them: strongly "pathogenic" ΔLLRs on every model. */
const OLD_MODEL_RESULTS = {
  esm2: { llr: -12.4, verdict: "deleterious" },
  esm2Eval: { llr: -12.4, provenance: "ESM-2 650M (Local)" },
  esmcEval: { llr: -11.8, provenance: "ESMC-6B (Remote)" },
  saprotEval: { llr: -9.7, provenance: "SaProt (SaProt_35M_AF2 - Remote)" },
};

const BENIGN_VOTES = {
  predictorData: { caddPhred: 8.1, amPathogenicity: 0.08, amClass: "likely_benign" },
  conservationData: { revel: 0.05, bayesdel: -0.5, metarnn: 0.02, clinpred: 0.01 },
};

const TIED_VOTES = {
  predictorData: { caddPhred: 28.0, amPathogenicity: 0.08, amClass: "likely_benign" },
  conservationData: {},
};

const CASES: Array<{ name: string; result: any; code: "PP3" | "BP4" | null }> = [
  { name: "NAE1 p.Asp116Gly", result: { ...NAE1_RESULT, metadata: { gene: "NAE1", variant: "p.Asp116Gly", residueIndex: 116 } }, code: "PP3" },
  { name: "GATA4 p.Ser159Cys (model scores only)", result: GATA4_RESULT, code: null },
  { name: "benign votes beside pathogenic model scores", result: { metadata: { gene: "TEST", variant: "p.Ala10Val", residueIndex: 10 }, ...BENIGN_VOTES, ...OLD_MODEL_RESULTS }, code: "BP4" },
  { name: "a tie beside pathogenic model scores", result: { metadata: { gene: "TEST", variant: "p.Ala10Val", residueIndex: 10 }, ...TIED_VOTES, ...OLD_MODEL_RESULTS }, code: null },
];

/** The engine input a saved payload produces; the old model fields ride along as a stored analysis carries them. */
function engineInput(result: any): ACMGEvidenceInput {
  return {
    gene: result.metadata.gene,
    variant: result.metadata.variant,
    residueIndex: result.metadata.residueIndex,
    predictorData: result.predictorData ?? null,
    conservationData: result.conservationData ?? null,
    ...OLD_MODEL_RESULTS,
    ...(result.esmcEval ? { esmcEval: result.esmcEval } : {}),
  } as ACMGEvidenceInput;
}

const inSilicoCodes = (codes: string[]) => codes.filter(code => /^(PP3|BP4)/.test(code));

describe("PP3/BP4 after retiring the runtime language models", () => {
  it.each(CASES)("the engine gives $name the code it gave before", ({ result, code }) => {
    const insights = computeRuleBasedACMG(engineInput(result));
    expect(inSilicoCodes(insights.acmgCriteria.map(c => c.code))).toEqual(code ? [code] : []);
  });

  it.each(CASES)("the Predictors tab gives $name the code it gave before", ({ result, code }) => {
    expect(buildPredictorEvidence({ result }).vote.code).toBe(code);
  });

  it("strength stays Supporting: no in-silico code carries a raised strength", () => {
    for (const { result } of CASES) {
      const codes = computeRuleBasedACMG(engineInput(result)).acmgCriteria.map(c => c.code);
      expect(inSilicoCodes(codes).every(code => code === "PP3" || code === "BP4")).toBe(true);
    }
  });
});
