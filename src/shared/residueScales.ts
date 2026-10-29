/**
 * residueScales.ts — the published amino-acid property values the Residue Shifts tab compares.
 *
 * Why this module exists
 * ----------------------
 * The tab used to read a hand-made 0–100 table (`AMINO_ACID_PROPERTIES`) whose rows were labelled
 * "Kyte & Doolittle hydropathy", "van der Waals volume" and, in the inspector, "IUPAC
 * classification". The numbers matched none of them: Trp scored 65 on "hydrophobicity" although
 * Kyte–Doolittle ranks it below Gly, Pro scored above Gly (the scale has Gly above Pro), Asp and Gly
 * were 45 and 10 on "volume", and IUPAC publishes no polarity or charge scale. The polarity column
 * called Gly nonpolar (15), which made "polarity −85" the headline move for Asp→Gly; on Grantham's
 * measured polarity the same move is 13.0 → 9.0, about half the scale.
 *
 * Every value below is transcribed from its paper, carries its native unit, and is normalised to
 * 0–100 by min–max over the 20 standard residues, so a renderer can draw both the native number and
 * a comparable track position from one source.
 *
 * INVARIANTS
 *   - One table per published scale; no hand-set value anywhere.
 *   - Normalisation is derived, never stored, so a corrected source value cannot leave a stale
 *     position behind.
 *   - Net charge is the formal side-chain charge at pH 7.4. His (pKa ≈ 6.0) is ~4% protonated
 *     there, so it is 0; this is stated on the axis rather than hidden in a fractional value.
 *
 * Sources
 *   Kyte J, Doolittle RF (1982) J Mol Biol 157:105–132. doi:10.1016/0022-2836(82)90515-0
 *   Grantham R (1974) Science 185:862–864. doi:10.1126/science.185.4154.862 — polarity (p),
 *     side-chain volume (v, Å³) and the Table 2 distance matrix, as transcribed in the `grantham`
 *     R package (data-raw/amino_acids_properties.csv, grantham_distance_matrix.csv).
 *
 * Pure data and pure functions: no React, no fetching.
 */

export type ResidueScaleKey = "charge" | "polarity" | "hydrophobicity" | "size";

/** One-letter code → value. */
type ResidueTable = Readonly<Record<string, number>>;

/** Kyte–Doolittle hydropathy index. */
export const KYTE_DOOLITTLE: ResidueTable = {
  A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5, Q: -3.5, E: -3.5, G: -0.4, H: -3.2, I: 4.5,
  L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6, S: -0.8, T: -0.7, W: -0.9, Y: -1.3, V: 4.2,
};

/** Grantham (1974) polarity, p. */
export const GRANTHAM_POLARITY: ResidueTable = {
  S: 9.2, R: 10.5, L: 4.9, P: 8.0, T: 8.6, A: 8.1, V: 5.9, G: 9.0, I: 5.2, F: 5.2,
  Y: 6.2, C: 5.5, H: 10.4, Q: 10.5, N: 11.6, K: 11.3, D: 13.0, E: 12.3, M: 5.7, W: 5.4,
};

/** Grantham (1974) side-chain volume, v, in Å³. */
export const GRANTHAM_VOLUME: ResidueTable = {
  S: 32, R: 124, L: 111, P: 32.5, T: 61, A: 31, V: 84, G: 3, I: 111, F: 132,
  Y: 136, C: 55, H: 96, Q: 85, N: 56, K: 119, D: 54, E: 83, M: 105, W: 170,
};

/** Formal side-chain charge at pH 7.4. */
export const NET_CHARGE_PH74: ResidueTable = {
  A: 0, R: 1, N: 0, D: -1, C: 0, Q: 0, E: -1, G: 0, H: 0, I: 0,
  L: 0, K: 1, M: 0, F: 0, P: 0, S: 0, T: 0, W: 0, Y: 0, V: 0,
};

export interface ResidueScaleSource {
  key: ResidueScaleKey;
  table: ResidueTable;
  /** Unit printed after a native value, or "" for a dimensionless index. */
  unit: string;
  /** Short citation for the row caption. */
  citation: string;
  doi: string | null;
  /** Native end points, for axis labels. */
  min: number;
  max: number;
  /** Decimal places a native value is printed with. */
  decimals: number;
}

function range(table: ResidueTable): { min: number; max: number } {
  const values = Object.values(table);
  return { min: Math.min(...values), max: Math.max(...values) };
}

const KD_DOI = "10.1016/0022-2836(82)90515-0";
const GRANTHAM_DOI = "10.1126/science.185.4154.862";

export const RESIDUE_SCALE_SOURCES: Readonly<Record<ResidueScaleKey, ResidueScaleSource>> = {
  charge: { key: "charge", table: NET_CHARGE_PH74, unit: "", citation: "Net charge at pH 7.4", doi: null, ...range(NET_CHARGE_PH74), decimals: 0 },
  polarity: { key: "polarity", table: GRANTHAM_POLARITY, unit: "", citation: "Grantham 1974", doi: GRANTHAM_DOI, ...range(GRANTHAM_POLARITY), decimals: 1 },
  hydrophobicity: { key: "hydrophobicity", table: KYTE_DOOLITTLE, unit: "", citation: "Kyte and Doolittle 1982", doi: KD_DOI, ...range(KYTE_DOOLITTLE), decimals: 1 },
  size: { key: "size", table: GRANTHAM_VOLUME, unit: "Å³", citation: "Grantham 1974", doi: GRANTHAM_DOI, ...range(GRANTHAM_VOLUME), decimals: 0 },
};

/**
 * One plain-language sentence per axis, for readers who do not know the biophysical vocabulary.
 * The comparison rows and the pinned reading both read this map, so a reworded axis cannot say
 * one thing beside the graph and another in the inspector. Typed by `ResidueScaleKey`: a new axis
 * fails to compile until it is explained.
 */
export const RESIDUE_SCALE_DEFINITIONS: Readonly<Record<ResidueScaleKey, string>> = {
  charge: "Electrical charge at pH 7.4.",
  polarity: "How unevenly the electrical charge is distributed.",
  hydrophobicity: "Preference for oily surroundings rather than water.",
  size: "Space occupied by the side chain.",
};

/** Native value for one residue, or null for a non-standard code. */
export function nativeResidueValue(key: ResidueScaleKey, code: string): number | null {
  const value = RESIDUE_SCALE_SOURCES[key].table[code.toUpperCase()];
  return typeof value === "number" ? value : null;
}

/** Position of a native value on its scale, 0–100, rounded to one decimal. */
export function normaliseResidueValue(key: ResidueScaleKey, value: number): number {
  const { min, max } = RESIDUE_SCALE_SOURCES[key];
  return Math.round(((value - min) / (max - min)) * 1000) / 10;
}

/** Native value formatted with its scale's precision and a true minus sign. */
export function formatNativeResidueValue(key: ResidueScaleKey, value: number): string {
  const { decimals } = RESIDUE_SCALE_SOURCES[key];
  const text = Math.abs(value).toFixed(decimals);
  if (value < 0) return `−${text}`;
  if (key === "charge" && value > 0) return `+${text}`;
  return text;
}

/**
 * The 0–100 positions of one residue on every scale, or null for a non-standard code.
 *
 * This is the shape the residue-shift model and the Insights radar already consume, so they
 * change source without changing type.
 */
export function residueScalePositions(code: string): Record<ResidueScaleKey, number> | null {
  const upper = code.toUpperCase();
  const out = {} as Record<ResidueScaleKey, number>;
  for (const key of Object.keys(RESIDUE_SCALE_SOURCES) as ResidueScaleKey[]) {
    const value = nativeResidueValue(key, upper);
    if (value === null) return null;
    out[key] = normaliseResidueValue(key, value);
  }
  return out;
}

/** Row and column order of `GRANTHAM_MATRIX`, as printed in the paper. */
const GRANTHAM_ORDER = "SRLPTAVGIFYCHQNKDEMW";

/**
 * Grantham (1974) Table 2, the published distance matrix (symmetric). Taken verbatim rather than
 * recomputed from the property table: the paper's rounding differs from the formula for a few
 * pairs (Cys–Trp is 215 in the table, 214 by the formula).
 */
const GRANTHAM_MATRIX: readonly (readonly number[])[] = [
  [  0, 110, 145,  74,  58,  99, 124,  56, 142, 155, 144, 112,  89,  68,  46, 121,  65,  80, 135, 177],
  [110,   0, 102, 103,  71, 112,  96, 125,  97,  97,  77, 180,  29,  43,  86,  26,  96,  54,  91, 101],
  [145, 102,   0,  98,  92,  96,  32, 138,   5,  22,  36, 198,  99, 113, 153, 107, 172, 138,  15,  61],
  [ 74, 103,  98,   0,  38,  27,  68,  42,  95, 114, 110, 169,  77,  76,  91, 103, 108,  93,  87, 147],
  [ 58,  71,  92,  38,   0,  58,  69,  59,  89, 103,  92, 149,  47,  42,  65,  78,  85,  65,  81, 128],
  [ 99, 112,  96,  27,  58,   0,  64,  60,  94, 113, 112, 195,  86,  91, 111, 106, 126, 107,  84, 148],
  [124,  96,  32,  68,  69,  64,   0, 109,  29,  50,  55, 192,  84,  96, 133,  97, 152, 121,  21,  88],
  [ 56, 125, 138,  42,  59,  60, 109,   0, 135, 153, 147, 159,  98,  87,  80, 127,  94,  98, 127, 184],
  [142,  97,   5,  95,  89,  94,  29, 135,   0,  21,  33, 198,  94, 109, 149, 102, 168, 134,  10,  61],
  [155,  97,  22, 114, 103, 113,  50, 153,  21,   0,  22, 205, 100, 116, 158, 102, 177, 140,  28,  40],
  [144,  77,  36, 110,  92, 112,  55, 147,  33,  22,   0, 194,  83,  99, 143,  85, 160, 122,  36,  37],
  [112, 180, 198, 169, 149, 195, 192, 159, 198, 205, 194,   0, 174, 154, 139, 202, 154, 170, 196, 215],
  [ 89,  29,  99,  77,  47,  86,  84,  98,  94, 100,  83, 174,   0,  24,  68,  32,  81,  40,  87, 115],
  [ 68,  43, 113,  76,  42,  91,  96,  87, 109, 116,  99, 154,  24,   0,  46,  53,  61,  29, 101, 130],
  [ 46,  86, 153,  91,  65, 111, 133,  80, 149, 158, 143, 139,  68,  46,   0,  94,  23,  42, 142, 174],
  [121,  26, 107, 103,  78, 106,  97, 127, 102, 102,  85, 202,  32,  53,  94,   0, 101,  56,  95, 110],
  [ 65,  96, 172, 108,  85, 126, 152,  94, 168, 177, 160, 154,  81,  61,  23, 101,   0,  45, 160, 181],
  [ 80,  54, 138,  93,  65, 107, 121,  98, 134, 140, 122, 170,  40,  29,  42,  56,  45,   0, 126, 152],
  [135,  91,  15,  87,  81,  84,  21, 127,  10,  28,  36, 196,  87, 101, 142,  95, 160, 126,   0,  67],
  [177, 101,  61, 147, 128, 148,  88, 184,  61,  40,  37, 215, 115, 130, 174, 110, 181, 152,  67,   0],
];

/** Grantham distance between two residues from the published matrix, or null for an identical
 *  pair or a non-standard code. Asp–Gly is 94, Asp–Glu 45. */
export function granthamDistance(a: string, b: string): number | null {
  const i = GRANTHAM_ORDER.indexOf(a.toUpperCase());
  const j = GRANTHAM_ORDER.indexOf(b.toUpperCase());
  if (i < 0 || j < 0 || i === j || a.length !== 1 || b.length !== 1) return null;
  return GRANTHAM_MATRIX[i][j];
}
