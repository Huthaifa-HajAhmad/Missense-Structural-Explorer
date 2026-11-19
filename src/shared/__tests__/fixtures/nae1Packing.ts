/**
 * NAE1 p.Asp116Gly (NM_003905.4, 16-66823281-A-G) — the Packing & geometry reference variant.
 *
 * FoldX values are the ones on the owner's 2026-09-29 screenshots: five identical BuildModel runs
 * (SD 0.00) on the AlphaFold model, whose pLDDT at residue 116 is 94.5.
 */
export const NAE1_RESULT: any = {
  metadata: { gene: "NAE1", variant: "p.Asp116Gly", wildType: "Asp", mutant: "Gly", residueIndex: 116 }
};

export const NAE1_ENERGETICS: any = {
  foldx: 0.9, foldxMean: 0.9, foldxSd: 0, vdw: 0.62, electrostatics: 0, localSidechainRmsd: 0.25,
  stericClashWarning: false, rawDdGs: [0.9, 0.9, 0.9, 0.9, 0.9],
  structureProvenance: { source: "alphafold", afdbVersion: "v6" }
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
