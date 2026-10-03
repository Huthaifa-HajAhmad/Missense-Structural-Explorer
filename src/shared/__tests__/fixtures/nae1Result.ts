/**
 * NAE1 p.Asp116Gly for the Predictors tab and its strength ladder — the values on the owner's 2026-09-29 screenshots.
 * oe_mis and pLI were not on screen; they are set so the PP2 rule has both inputs.
 */
export const NAE1_RESULT: any = {
  predictorData: { caddPhred: 26.3, amPathogenicity: 0.362, amClass: "ambiguous" },
  conservationData: {
    revel: 0.231, bayesdel: -0.122, metarnn: 0.529, clinpred: 0.977,
    eigenPhred: 3.4, dann: 0.993, gerp: 4.78, phylop: 7.64,
  },
  esmcEval: { llr: -5.83, provenance: "ESMC-6B" },
  gnomadConstraint: { missense_z: 1.09, oe_mis: 0.88, pli: 0.0, loeuf: 0.94, isPP2Constrained: false },
  ruleBasedInsights: { acmgCriteria: [{ code: "PP3", reason: "3/6 predictors agree on pathogenic impact." }] },
};

