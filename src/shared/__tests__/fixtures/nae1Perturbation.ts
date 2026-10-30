/**
 * NAE1 p.Asp116Gly (NM_003905.4, 16-66823281-A-G) — the Structural perturbation reference variant.
 *
 * Values are the ones on the owner's 2026-09-29 screenshots: SaProt served by the remote tier's
 * SaProt_35M_AF2 (not the 650M the settings named), ESM-2 650M remote with no embedding window,
 * ESMC-6B remote with a 2560-dim shift, FoldX five identical runs (SD 0.00). ESM-2 and ESMC ranks
 * are not on the screenshots and are set to plausible in-band values; nothing asserts them.
 */
const prefs = (entries: [string, number][]) => entries.map(([aa, prob]) => ({ aa, prob }));

const SAPROT_PREFS = prefs([
  ["D", 0.4417], ["E", 0.162], ["N", 0.1425], ["Q", 0.0511], ["S", 0.0333], ["H", 0.0315],
  ["Y", 0.0302], ["K", 0.0214], ["T", 0.019], ["R", 0.015], ["A", 0.013], ["C", 0.009],
  ["F", 0.008], ["M", 0.006], ["V", 0.0045], ["I", 0.0035], ["L", 0.003], ["W", 0.002],
  ["P", 0.0012], ["G", 0.0004]
]);

const windowAround = (center: number, peak: number) =>
  Array.from({ length: 21 }, (_, i) => {
    const position = center - 10 + i;
    const d = Math.abs(position - center);
    return { position, residue: "ADEKLRSTVGNQ"[i % 12], shift: Number((peak / (1 + d * 0.9)).toFixed(3)) };
  });

export const NAE1_RESULT: any = {
  metadata: { gene: "NAE1", variant: "p.Asp116Gly", wildType: "Asp", mutant: "Gly", residueIndex: 116 },
  saprotEval: {
    llr: -6.991, wtProbability: 0.4417, mutProbability: 0.0004, mutRank: 20, positionalEntropy: 2.734,
    preferences: SAPROT_PREFS, embeddingShift: undefined, localShiftMap: [], klDivergence: null,
    conformationState: "p", provenance: "SaProt (SaProt_35M_AF2 - Remote)"
  },
  esm2Eval: {
    llr: -7.153, wtProbability: 0.52, mutProbability: 0.00041, mutRank: 19, positionalEntropy: 2.41,
    preferences: SAPROT_PREFS, localShiftMap: [], provenance: "ESM-2 (esm2_t33_650M_UR50D - Remote)"
  },
  esmcEval: {
    llr: -5.832, wtProbability: 0.47, mutProbability: 0.0014, mutRank: 18, positionalEntropy: 2.62,
    preferences: SAPROT_PREFS, embeddingShift: 38.182, localShiftMap: windowAround(116, 38.182),
    provenance: "ESMC-6B (Remote)"
  },
  esm3Eval: {
    // One score per residue through the variant and past it (the route's contract), peaking at the
    // variant, with −1 (unmeasured) over residues 1–10 so the preview shows a gap.
    perturbationScores: Array.from({ length: 140 }, (_, i) =>
      i < 10 ? -1 : Math.round((0.004 + 0.05 * Math.exp(-(((i + 1 - 116) / 4) ** 2))) * 1e4) / 1e4
    ),
    maxDriftResidue: 116, structuralChangeLevel: "none",
    microenvironments: ["Burial not measured", "Alpha-Helix"],
    putativeStructuralChanges: ["Minor sidechain rotamer realignment without major backbone shift"],
    confidence: { level: "high", plddt: 94.5 }, provenance: "ESM3-Medium (Remote)"
  }
};

export const NAE1_ENERGETICS: any = {
  foldx: 0.9, foldxMean: 0.9, foldxSd: 0, vdw: 0.62, electrostatics: 0, localSidechainRmsd: 0.25,
  stericClashWarning: false, rawDdGs: [0.9, 0.9, 0.9, 0.9, 0.9]
};

/** FoldX BuildModel keeps the wild-type backbone, so the comparison against its paired wild type has RMSD 0. */
export const NAE1_STRUCTURAL_DIFF: any = {
  rmsd: 0, localRmsd: 0, windowDisplacements: [],
  clashes: { wtClashCount: 3, mutClashCount: 5, diff: 2 },
  mutantModel: "foldx-buildmodel"
};

export const NAE1_METRICS: any = { lostContacts: 2, gainedContacts: 1, deltaSasa: -12.4 };

/** The AlphaFold model's pLDDT at residue 116 (its B-factor column holds pLDDT). */
export const NAE1_SITE: any = { level: "low", reason: "", plddt: 94.5, bFactorKind: "plddt" };

export const NAE1_RESIDUES = { wtCode: "D", mutCode: "G", wtLabel: "Asp", mutLabel: "Gly" };
