/**
 * NAE1 p.Asp116Gly as the Residue Shifts tab received it (owner's screenshots, 2026-09-29):
 * experimental structure 1YOV, no accessibility measured, a stored "boundary" word from the
 * retired packing fallback (9 Cα neighbours), and the P2Rank pocket 23.14 Å from its cavity
 * centre (22.97 Å from the centroid of its residues) with probability 0.23 and 26 surface points.
 */
export const NAE1_RESULT = {
  metadata: {
    gene: "NAE1",
    variant: "p.Asp116Gly",
    wildType: "Asp",
    mutant: "Gly",
    residueIndex: 116,
    pdbId: "1YOV",
    pdbSource: "RCSB PDB",
    chain: "A"
  },
  insights: {
    biochemicalShift:
      "Charge and polarity loss: Negatively charged polar (Asp) to Neutral non-polar aliphatic (Gly). Size decrease. Elimination of side-chain charge and hydrogen-bonding capability."
  },
  disruptionPredictor: { level: "low", reason: "Default", plddt: null, burialStatus: "boundary", neighborCount: 9 }
} as any;

export const NAE1_POCKET = {
  status: "success",
  pocketDistance: 22.97,
  cavityCentreDistance: 23.14,
  pocketScore: 23,
  pocketVolume: 0,
  likelyCofactor: "None recorded in curated annotations",
  sasPoints: 26,
  surfaceAtoms: 20,
  // In the runner's old order (by a hand-set propensity weight), not by distance.
  pocketResidues: [
    { name: "ASP", index: 433, chain: "A", distance: 25.9 },
    { name: "GLU", index: 133, chain: "A", distance: 21.7 },
    { name: "TYR", index: 161, chain: "A", distance: 25.8 },
    { name: "TYR", index: 402, chain: "A", distance: 24.3 },
    { name: "ARG", index: 154, chain: "A", distance: 24.9 },
    { name: "ARG", index: 430, chain: "A", distance: 27.9 },
    { name: "LEU", index: 131, chain: "A", distance: 17.8 },
    { name: "ILE", index: 152, chain: "A", distance: 20.0 }
  ],
  provenance: { engine: "p2rank", scoreSource: "probability", volumeSource: "unavailable", profile: "alphafold" }
} as any;
