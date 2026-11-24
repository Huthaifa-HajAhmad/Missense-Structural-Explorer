import { describe, expect, it } from "vitest";
import { computeRuleBasedACMG, type ACMGEvidenceInput } from "./index.ts";
import { buildPredictorEvidence } from "../../../../src/shared/predictorEvidence.ts";
import { NAE1_RESULT } from "../../../../src/shared/__tests__/fixtures/nae1Result.ts";
import { GATA4_RESULT } from "../../../../src/shared/__tests__/fixtures/gata4Perturbation.ts";

/**
 * The runtime protein language models (ESM-2, SaProt, ESMC) were retired on 2026-11-18
 * (doc/PROTEIN_LANGUAGE_MODELS_DECISION.md). They never enter PP3/BP4, so retiring them must not
 * change the primary calibrated outcome. Each case below pins the code the engine and the
 * Predictors tab give under the primary calibrated chain (REVEL -> BayesDel noAF -> AlphaMissense -> ESM1b),
 * feeding a saved payload that still carries the old model results.
 */

/** Old model results as a saved analysis stores them: strongly "pathogenic" ΔLLRs on every model. */
const OLD_MODEL_RESULTS = {
  esm2: { llr: -12.4, verdict: "deleterious" },
  esm2Eval: { llr: -12.4, provenance: "ESM-2 650M (Local)" },
  esmcEval: { llr: -11.8, provenance: "ESMC-6B (Remote)" },
  saprotEval: { llr: -9.7, provenance: "SaProt (SaProt_35M_AF2 - Remote)" },
};

const BENIGN_REVEL = {
  predictorData: { caddPhred: 8.1, amPathogenicity: 0.08, amClass: "likely_benign" },
  conservationData: { revel: 0.05, bayesdel: -0.5 },
};

const INDETERMINATE_PRIMARY = {
  predictorData: { caddPhred: 28.0, amPathogenicity: 0.95, amClass: "likely_pathogenic" },
  conservationData: { revel: 0.5 },
};

const CASES: Array<{ name: string; result: any; code: string | null }> = [
  // NAE1 p.Asp116Gly: REVEL 0.231 sits in Pejaver BP4 Supporting (<= 0.290); old vote gave PP3.
  { name: "NAE1 p.Asp116Gly", result: { ...NAE1_RESULT, metadata: { gene: "NAE1", variant: "p.Asp116Gly", residueIndex: 116 } }, code: "BP4" },
  { name: "GATA4 p.Ser159Cys (model scores only)", result: GATA4_RESULT, code: null },
  { name: "benign REVEL beside pathogenic model scores", result: { metadata: { gene: "TEST", variant: "p.Ala10Val", residueIndex: 10 }, ...BENIGN_REVEL, ...OLD_MODEL_RESULTS }, code: "BP4_Moderate" },
  { name: "indeterminate REVEL beside pathogenic model scores", result: { metadata: { gene: "TEST", variant: "p.Ala10Val", residueIndex: 10 }, ...INDETERMINATE_PRIMARY, ...OLD_MODEL_RESULTS }, code: null },
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
  it.each(CASES)("the engine gives $name the primary calibrated code ($code)", ({ result, code }) => {
    const insights = computeRuleBasedACMG(engineInput(result));
    expect(inSilicoCodes(insights.acmgCriteria.map(c => c.code))).toEqual(code ? [code] : []);
  });

  it.each(CASES)("the Predictors tab gives $name the same primary calibrated code ($code)", ({ result, code }) => {
    expect(buildPredictorEvidence({ result }).primary.code).toBe(code);
  });

  it("never picks up strength from retired runtime language models", () => {
    const res = computeRuleBasedACMG(engineInput(CASES[3].result));
    expect(inSilicoCodes(res.acmgCriteria.map(c => c.code))).toEqual([]);
  });
});
