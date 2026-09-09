import { z } from "zod";
import { AMINO_ACID_1_TO_3_TITLE, AMINO_ACID_3_TO_1 } from "../aminoAcids.ts";

export const VariantCoordinateSchema = z.object({
  gene: z.string().optional(),
  pos: z.number().int().positive(),
  insCode: z.string().max(1).optional(),
  wt1: z.string().length(1),
  wt3: z.string().length(3),
  mut1: z.string().length(1),
  mut3: z.string().length(3),
  foldxCode: z.string(),
  hgvsp1: z.string(),
  hgvsp3: z.string(),
  notation1: z.string(),
  notation3: z.string(),
  isSynonymous: z.boolean(),
  chain: z.string().default("A"),
  transcriptId: z.string().optional(),
  uniprotId: z.string().optional()
});

export type VariantCoordinate = z.infer<typeof VariantCoordinateSchema>;

/**
 * Normalizes any 3-letter AA code to Title Case (e.g., 'arg' -> 'Arg', 'ARG' -> 'Arg')
 */
export function normalizeAminoAcid3(code: string): string {
  if (code.length !== 3) return code;
  return code.charAt(0).toUpperCase() + code.slice(1).toLowerCase();
}

/**
 * Strips common prefixes and non-essential characters from variant notations.
 */
export function cleanVariantString(input: string): string {
  let clean = input.trim();
  clean = clean.replace(/^p\./i, "").replace(/[()]/g, "").trim();
  clean = clean.replace(/^[A-Z0-9_.]{4,25}:\s*/i, ""); // Strip transcript/uniprot prefix (e.g. ENST00000373031.7:, NM_000546.6:)
  clean = clean.replace(/^[A-Z]{2,10}\s+/i, "");      // Strip leading gene symbol
  clean = clean.replace(/_/g, "");                    // Strip underscores
  clean = clean.replace(/>(?=[A-Z])/i, "");           // Strip HGVS '>' arrows (e.g. R>H -> RH)
  return clean.trim();
}

/**
 * Parses and validates an amino acid substitution into a canonical VariantCoordinate object.
 * Supports:
 * - 3-letter HGVS (e.g., "p.Arg408Trp", "Arg408Trp", "arg408trp")
 * - 1-letter HGVS (e.g., "p.R408W", "R408W", "r408w")
 * - FoldX format with chain (e.g., "RA408W", "RB215H")
 */
export function parseVariantCoordinate(
  variantStr: string,
  options?: { gene?: string; chain?: string; transcriptId?: string; uniprotId?: string }
): VariantCoordinate {
  if (!variantStr || typeof variantStr !== "string") {
    throw new Error("Invalid variant notation: input must be a non-empty string.");
  }

  const clean = cleanVariantString(variantStr);
  const defaultChain = options?.chain?.toUpperCase() || "A";

  // 1. Try FoldX Format (e.g., "RA408W", "RB215H", or with insCode "RA408AW", "RB215BH")
  const foldxMatch = clean.match(/^([a-zA-Z])([a-zA-Z])(\d+)([a-zA-Z])?([a-zA-Z])$/);
  if (foldxMatch) {
    const wt1 = foldxMatch[1].toUpperCase();
    const chain = foldxMatch[2].toUpperCase();
    const pos = parseInt(foldxMatch[3], 10);
    const insCode = foldxMatch[4] ? foldxMatch[4].toUpperCase() : undefined;
    const mut1 = foldxMatch[5].toUpperCase();

    const wt3 = AMINO_ACID_1_TO_3_TITLE[wt1];
    const mut3 = AMINO_ACID_1_TO_3_TITLE[mut1];

    if (wt3 && mut3) {
      const posStr = insCode ? `${pos}${insCode}` : `${pos}`;
      return {
        gene: options?.gene?.trim().toUpperCase(),
        pos,
        insCode,
        wt1,
        wt3,
        mut1,
        mut3,
        foldxCode: `${wt1}${chain}${posStr}${mut1}`,
        hgvsp1: `p.${wt1}${posStr}${mut1}`,
        hgvsp3: `p.${wt3}${posStr}${mut3}`,
        notation1: `${wt1}${posStr}${mut1}`,
        notation3: `${wt3}${posStr}${mut3}`,
        isSynonymous: wt1 === mut1,
        chain,
        transcriptId: options?.transcriptId,
        uniprotId: options?.uniprotId
      };
    }
  }

  // 2. Try 3-letter AA format (e.g. "Arg408Trp", "arg408trp", or with insCode "Arg408ATrp")
  const match3 = clean.match(/^([a-zA-Z]{3})(\d+)([a-zA-Z])?([a-zA-Z]{3})$/);
  if (match3) {
    const rawWt3 = normalizeAminoAcid3(match3[1]);
    const pos = parseInt(match3[2], 10);
    const insCode = match3[3] ? match3[3].toUpperCase() : undefined;
    const rawMut3 = normalizeAminoAcid3(match3[4]);

    const wt1 = AMINO_ACID_3_TO_1[rawWt3];
    const mut1 = AMINO_ACID_3_TO_1[rawMut3];

    if (!wt1 || !mut1) {
      throw new Error(
        `Invalid HGVS missense format: Unrecognized 3-letter amino acid code '${!wt1 ? rawWt3 : rawMut3}'. ` +
        `Expected standard amino acid codes (e.g., Arg, Trp, Ala, etc.).`
      );
    }

    const wt3 = AMINO_ACID_1_TO_3_TITLE[wt1] || rawWt3;
    const mut3 = AMINO_ACID_1_TO_3_TITLE[mut1] || rawMut3;
    const posStr = insCode ? `${pos}${insCode}` : `${pos}`;

    return {
      gene: options?.gene?.trim().toUpperCase(),
      pos,
      insCode,
      wt1,
      wt3,
      mut1,
      mut3,
      foldxCode: `${wt1}${defaultChain}${posStr}${mut1}`,
      hgvsp1: `p.${wt1}${posStr}${mut1}`,
      hgvsp3: `p.${wt3}${posStr}${mut3}`,
      notation1: `${wt1}${posStr}${mut1}`,
      notation3: `${wt3}${posStr}${mut3}`,
      isSynonymous: wt1 === mut1,
      chain: defaultChain,
      transcriptId: options?.transcriptId,
      uniprotId: options?.uniprotId
    };
  }

  // 3. Try 1-letter AA format (e.g. "R408W", "r408w", or with insCode "R408AW")
  const match1 = clean.match(/^([a-zA-Z])(\d+)([a-zA-Z])?([a-zA-Z])$/);
  if (match1) {
    const wt1 = match1[1].toUpperCase();
    const pos = parseInt(match1[2], 10);
    const insCode = match1[3] ? match1[3].toUpperCase() : undefined;
    const mut1 = match1[4].toUpperCase();

    const wt3 = AMINO_ACID_1_TO_3_TITLE[wt1];
    const mut3 = AMINO_ACID_1_TO_3_TITLE[mut1];

    if (!wt3 || !mut3) {
      throw new Error(
        `Invalid HGVS missense format: Unrecognized 1-letter amino acid code '${!wt3 ? wt1 : mut1}'. ` +
        `Expected standard single-letter codes (A, R, N, D, C, Q, E, G, H, I, L, K, M, F, P, S, T, W, Y, V).`
      );
    }

    const posStr = insCode ? `${pos}${insCode}` : `${pos}`;

    return {
      gene: options?.gene?.trim().toUpperCase(),
      pos,
      insCode,
      wt1,
      wt3,
      mut1,
      mut3,
      foldxCode: `${wt1}${defaultChain}${posStr}${mut1}`,
      hgvsp1: `p.${wt1}${posStr}${mut1}`,
      hgvsp3: `p.${wt3}${posStr}${mut3}`,
      notation1: `${wt1}${posStr}${mut1}`,
      notation3: `${wt3}${posStr}${mut3}`,
      isSynonymous: wt1 === mut1,
      chain: defaultChain,
      transcriptId: options?.transcriptId,
      uniprotId: options?.uniprotId
    };
  }

  throw new Error(
    `Invalid HGVS missense format: "${variantStr}" does not represent a supported single amino acid substitution. ` +
    `Expected formats: p.Arg408Trp (3-letter), p.R408W (1-letter), or RA408W (FoldX).`
  );
}
