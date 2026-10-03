/**
 * SLC12A4 p.Gln867His (NM_005072.5, 16-67946177-C-G, Q9UP95) — the 2026-10 Structural perturbation
 * reference variant, from the owner's screenshots.
 *
 * What it pins: two models (ESM-2, ESMC) that give native Gln nearly all their probability yet rank
 * His 5th and 3rd — the case the old rank-band hero read as "0 of 3 in the dispreferred half" and
 * "most preferred" — and a sequence-only SaProt whose distribution sits at 4.23 of 4.32 bits.
 *
 * SaProt's full distribution, ΔLLRs, ranks, entropy, ESM3 drift (0.004, peak at residue 4) and the
 * site pLDDT (87.4) are as shown. ESM-2's and ESMC's P(native)/P(variant) are not on the screenshots;
 * they are set so their ratio reproduces the shown ΔLLR (e^−5.95, e^−6.98), and their other residues
 * are filled to keep the shown ranks. No FoldX model was built.
 */
const prefs = (entries: [string, number][]) => entries.map(([aa, prob]) => ({ aa, prob }));

const SAPROT_PREFS = prefs([
  ["L", 0.0931], ["R", 0.0757], ["S", 0.0684], ["D", 0.068], ["A", 0.0608], ["E", 0.0583], ["G", 0.0563],
  ["V", 0.0506], ["K", 0.0503], ["H", 0.0496], ["Q", 0.0493], ["N", 0.0493], ["T", 0.0429], ["F", 0.0407],
  ["Y", 0.0402], ["P", 0.0386], ["I", 0.0344], ["M", 0.0313], ["C", 0.0229], ["W", 0.0194]
]);

// ESM-2: Gln 0.962, His 0.00250 (ratio e^−5.95), His 5th.
const ESM2_PREFS = prefs([
  ["Q", 0.962], ["E", 0.0141], ["K", 0.0077], ["R", 0.0049], ["H", 0.0025], ["N", 0.0022], ["L", 0.0012],
  ["S", 0.001], ["A", 0.0009], ["T", 0.0008], ["D", 0.0007], ["M", 0.0005], ["G", 0.0004], ["V", 0.0003],
  ["Y", 0.0002], ["I", 0.0002], ["P", 0.0001], ["F", 0.0001], ["C", 0.0001], ["W", 0.0001]
]);

// ESMC: Gln 0.985, His 0.000917 (ratio e^−6.98), His 3rd.
const ESMC_PREFS = prefs([
  ["Q", 0.985], ["E", 0.0101], ["H", 0.000917], ["K", 0.0008], ["R", 0.0007], ["N", 0.0006], ["L", 0.0004],
  ["S", 0.0003], ["A", 0.0003], ["T", 0.0002], ["D", 0.0002], ["M", 0.0001], ["G", 0.0001], ["V", 0.0001],
  ["Y", 0.0001], ["I", 0.0001], ["P", 0.00005], ["F", 0.00005], ["C", 0.00005], ["W", 0.00005]
]);

/** 1,083 residues, the drift peaking at residue 4 and 0.001 at the variant (867). */
const ESM3_SCORES = Array.from({ length: 1083 }, (_, i) => (i === 3 ? 0.004 : i === 866 ? 0.001 : 0.0005));

export const SLC12A4_RESULT: any = {
  metadata: { gene: "SLC12A4", variant: "p.Gln867His", wildType: "Gln", mutant: "His", residueIndex: 867 },
  saprotEval: {
    llr: 0.006, wtProbability: 0.0493, mutProbability: 0.0496, mutRank: 10, positionalEntropy: 4.23,
    preferences: SAPROT_PREFS, localShiftMap: [], klDivergence: null,
    conformationState: "#", provenance: "SaProt (SaProt_35M_AF2 - Remote)"
  },
  esm2Eval: {
    llr: -5.95, wtProbability: 0.962, mutProbability: 0.0025, mutRank: 5, positionalEntropy: 0.31,
    preferences: ESM2_PREFS, localShiftMap: [], provenance: "ESM-2 (esm2_t33_650M_UR50D - Remote)"
  },
  esmcEval: {
    llr: -6.98, wtProbability: 0.985, mutProbability: 0.000917, mutRank: 3, positionalEntropy: 0.14,
    preferences: ESMC_PREFS, localShiftMap: [], provenance: "ESMC-6B (Remote)"
  },
  esm3Eval: {
    perturbationScores: ESM3_SCORES, maxDriftResidue: 4, structuralChangeLevel: "none",
    microenvironments: ["Burial not measured", "Loop / Flexible Turn"],
    confidence: { level: "high", plddt: 87.4 }, provenance: "ESM3-Medium (Remote)"
  }
};

export const SLC12A4_RESIDUES = { wtCode: "Q", mutCode: "H", wtLabel: "Gln", mutLabel: "His" };
