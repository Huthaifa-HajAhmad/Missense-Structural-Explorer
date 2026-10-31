/**
 * GATA4 p.Ser159Cys — the case that started the Structural perturbation review (2026-10).
 *
 * Hugging Face answered 402 (no inference credits) for the ESM-2 card, and VESM-150M served it in
 * place of ESM-2. The shape (stand-in provenance, coded billing refusal, a reason genuine ESM-2 did
 * not run) is the recorded one; the numbers are illustrative, so the preview labels them as such.
 */
const prefs = (entries: [string, number][]) => entries.map(([aa, prob]) => ({ aa, prob }));

const PREFS = prefs([
  ["S", 0.31], ["T", 0.14], ["A", 0.12], ["N", 0.08], ["G", 0.07], ["C", 0.06], ["D", 0.05], ["E", 0.04],
  ["P", 0.03], ["H", 0.025], ["Q", 0.02], ["K", 0.02], ["R", 0.015], ["V", 0.01], ["M", 0.01], ["L", 0.008],
  ["I", 0.007], ["Y", 0.005], ["F", 0.004], ["W", 0.001]
]);

const llr = (mutProb: number, wtProb: number) => Math.log(mutProb) - Math.log(wtProb);

export const GATA4_RESULT: any = {
  metadata: { gene: "GATA4", variant: "p.Ser159Cys", wildType: "Ser", mutant: "Cys", residueIndex: 159, uniprotId: "P43694" },
  saprotEval: {
    llr: llr(0.05, 0.38), wtProbability: 0.38, mutProbability: 0.05, mutRank: 4, positionalEntropy: 2.9, preferences: PREFS,
    localShiftMap: [], klDivergence: null, conformationState: "d", provenance: "SaProt (SaProt_35M_AF2 - Remote)",
    scoringMethod: "masked-marginal"
  },
  esm2Eval: {
    llr: llr(0.06, 0.31), wtProbability: 0.31, mutProbability: 0.06, mutRank: 6, positionalEntropy: 3.1, preferences: PREFS,
    embeddingShift: 7.9,
    localShiftMap: Array.from({ length: 21 }, (_, i) => ({ position: 149 + i, residue: "SGTAPLDEKQRNH"[i % 13], shift: Number((7.9 / (1 + Math.abs(i - 10) * 0.7)).toFixed(3)) })),
    provenance: "VESM-150M (Local Fallback)",
    checkpoint: "ntranoslab/vesm VESM_150M",
    scoringMethod: "masked-marginal",
    remoteEngineNote: "HTTP 402 - inference credits exhausted for the configured token",
    remoteFailure: { provider: "huggingface", code: "billing" },
    fallbackReason: "esm2_t33_650M_UR50D: OSError: weights unavailable"
  },
  esmcEval: {
    llr: llr(0.055, 0.36), wtProbability: 0.36, mutProbability: 0.055, mutRank: 5, positionalEntropy: 2.8, preferences: PREFS,
    embeddingShift: 31.2, localShiftMap: [], provenance: "ESMC-6B (Remote)", scoringMethod: "masked-marginal"
  },
  esm3Eval: null
};
