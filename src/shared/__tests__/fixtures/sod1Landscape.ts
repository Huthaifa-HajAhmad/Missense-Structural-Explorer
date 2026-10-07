/**
 * SOD1 P00441 p.Ala5Val — the Landscape tab's dense reference case, taken from the audit
 * screenshots (residues 1–31 of the real dbNSFP window). Residues 1 and 6 have no dbNSFP record;
 * residue 5 is the queried Ala: codon GCT admits exactly six SNV-reachable missense substitutions
 * (D, G, P, S, T, V), which is the rank denominator the finding states. Scores on residue 5 are the
 * real live reading (REVEL 0.853 / AlphaMissense 0.840 for A5V; residue means 0.831 / 0.743, ranges
 * 0.76–0.87 / 0.26–0.97, GERP++ 3.21, phyloP 6.73 over 2 nt); the other residues' means are the
 * window's real values, and their REVEL/conservation figures are fixture values standing in for
 * rows the screenshots do not show. Not a live payload: never present it as evidence.
 */
import type { LandscapeResidueItem } from "../../contracts";

/** AlphaMissense residue means over scored substitutions, residues 1–31 (from the audit window). */
const AM_MEANS: Array<number | null> = [
  null, 0.13, 0.12, 0.32, 0.74, null, 0.87, 0.58, 0.7, 0.28, 0.66, 0.16, 0.26, 0.1, 0.65, 0.19,
  0.95, 0.21, 0.65, 0.13, 0.82, 0.31, 0.71, 0.11, 0.1, 0.16, 0.1, 0.23, 0.11, 0.72, 0.15
];

const SOD1_1_31 = "MATKAVCVLKGDGPVQGIINFEQKESNGPVK";

/** The six SNV-reachable missense substitutions at residue 5 (GCT → D G P S T V), AM descending. */
export const SOD1_RESIDUE5_SUBS = [
  { alt: "G", am: 0.97, revel: 0.78 },
  { alt: "T", am: 0.9, revel: 0.87 },
  { alt: "S", am: 0.88, revel: 0.83 },
  { alt: "V", am: 0.8401, revel: 0.853 },
  { alt: "P", am: 0.6, revel: 0.8 },
  { alt: "D", am: 0.26, revel: 0.76 }
];

export const SOD1_RESIDUE5: LandscapeResidueItem = {
  residx: 5,
  aaref: "A",
  refMismatch: false,
  amMean: 0.743,
  amMin: 0.26,
  amMax: 0.97,
  amCount: 6,
  revelMean: 0.831,
  revelMin: 0.76,
  revelMax: 0.87,
  revelCount: 6,
  gerp: 3.21,
  phylop: 6.73,
  nucleotideCount: 2,
  substitutions: SOD1_RESIDUE5_SUBS
};

/** REVEL / conservation stand-ins for the residues the screenshots do not show scores for. */
const standIn = (amMean: number) => ({
  revelMean: Math.min(0.98, Math.max(0.02, amMean + 0.07)),
  gerp: Number((2 + amMean * 4).toFixed(2)),
  phylop: Number((1 + amMean * 6).toFixed(2))
});

export const SOD1_LANDSCAPE_ROWS: LandscapeResidueItem[] = AM_MEANS.flatMap((amMean, i): LandscapeResidueItem[] => {
  if (i === 4) return [SOD1_RESIDUE5];
  const residx = i + 1;
  if (amMean === null) {
    return [{
      residx,
      aaref: SOD1_1_31[i] ?? null,
      refMismatch: false,
      amMean: null, amMin: null, amMax: null, amCount: 0,
      revelMean: null, revelMin: null, revelMax: null, revelCount: 0,
      gerp: null, phylop: null, nucleotideCount: 0
    }];
  }
  const s = standIn(amMean);
  return [{
    residx,
    aaref: SOD1_1_31[i] ?? null,
    refMismatch: false,
    amMean,
    amMin: Number(Math.max(0.02, amMean - 0.35).toFixed(2)),
    amMax: Number(Math.min(0.99, amMean + 0.25).toFixed(2)),
    amCount: 5,
    revelMean: s.revelMean,
    revelMin: Number(Math.max(0.01, s.revelMean - 0.3).toFixed(2)),
    revelMax: Number(Math.min(0.98, s.revelMean + 0.1).toFixed(2)),
    revelCount: 6,
    gerp: s.gerp,
    phylop: s.phylop,
    nucleotideCount: 3
  }];
});

/** Gene-wide context for the window, matching the audit screenshots (ClinVar, gnomAD, no regions). */
export const SOD1_LANDSCAPE_CONTEXT = {
  clinvar: [
    { pos: 5, cls: "plp" as const, significance: "Pathogenic", stars: 2, hgvsp: "p.Ala5Ser" },
    { pos: 5, cls: "plp" as const, significance: "Pathogenic", stars: 2, hgvsp: "p.Ala5Thr" },
    { pos: 5, cls: "plp" as const, significance: "Pathogenic", stars: 3, hgvsp: "p.Ala5Val" }
  ],
  gnomad: [],
  regions: [],
  transcript: null,
  regionsBasis: "gnomAD v2",
  errors: []
};

export const SOD1_VARIANT_SCORES = { revel: 0.853, am: 0.8401 };
