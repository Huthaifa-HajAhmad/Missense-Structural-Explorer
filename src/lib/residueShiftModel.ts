/**
 * residueShiftModel.ts — client entry point to the residue-shift evidence model.
 *
 * Three surfaces describe the same two residues on the same four 0–100 axes:
 *
 *   1. the Residue Shifts & Pockets tab (property tracks, WT/MUT cards)
 *   2. the Evidence Inspector (derived interpretation, prose reconciliation)
 *   3. the Insights view (residue property radar)
 *
 * Each one used to resolve the residue pair and the scale labels for itself. They
 * did not agree: the tab and the inspector read `metadata.wildType`/`mutant`,
 * while the radar re-parsed the variant string and used its own axis names
 * ("Charge", "Molecular Size"). This module is the single resolver they all call.
 *
 * Resolution order is deliberate:
 *
 *   1. `metadata.wildType` / `metadata.mutant` — the pipeline's own record of the
 *      substitution, and the only source that survives non-standard variant
 *      notation (genomic, cDNA).
 *   2. `variant` notation — a fallback for payloads (and caches) that carry the
 *      variant string but no metadata residues. Both residues are taken from this
 *      source together, never mixed with a partial metadata result: a pair
 *      assembled from two different sources could describe a substitution that
 *      does not exist.
 *
 * Unresolved returns a null contrast, so every caller renders an explicit
 * "unavailable" state.
 *
 * Correcting an earlier note in this file: it claimed the radar used to "plot a
 * flat mid-scale profile out of a parse failure". That was wrong, and reviewing
 * the removed code proved it. `parseMutationResidues` delegates to
 * `parseVariantCoordinate`, which validates every residue code against the 20
 * standard amino acids and *throws* otherwise
 * (`src/shared/variantCoordinate.ts:121-126`, `:163-168`) — so
 * `AMINO_ACID_PROPERTIES[code] || { ...50 }` was unreachable, and the real prior
 * behaviour was that the whole radar section rendered nothing. The defect this
 * module fixes is a *blank* panel for notations the string parser rejects
 * (genomic, cDNA, deletion-insertions) even when metadata carries usable
 * residues — not fabricated data. Stating it the other way round overstated the
 * bug and would have misled anyone reading this as a rationale.
 */
import { AMINO_ACID_1_TO_3_TITLE, AMINO_ACID_3_TO_1 } from "../shared/aminoAcids";
import { buildBiochemicalContrast, type BiochemicalContrast } from "../shared/residueShiftEvidence";
import { AMINO_ACID_PROPERTIES, parseMutationResidues } from "../variantAnalysisUtils";

/** Where the displayed residue pair actually came from. */
export type ResiduePairSource = "metadata" | "variant-notation" | "unresolved";

export interface ResidueShiftModel {
  /** One-letter wild-type code, or "" when unresolved. */
  wildTypeCode: string;
  /** One-letter mutant code, or "" when unresolved. */
  mutantCode: string;
  /** Three-letter title-case label for display, e.g. "Glu". */
  wildTypeLabel: string;
  /** Three-letter title-case label for display, e.g. "Lys". */
  mutantLabel: string;
  /** Null when the pair could not be resolved to scale values. */
  contrast: BiochemicalContrast | null;
  source: ResiduePairSource;
}

/** Accepts one-letter, three-letter, or mixed-case residue codes. */
function toOneLetter(value?: string | null): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  const upper = trimmed.toUpperCase();
  if (AMINO_ACID_3_TO_1[upper]) return AMINO_ACID_3_TO_1[upper];

  const titled = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  if (AMINO_ACID_3_TO_1[titled]) return AMINO_ACID_3_TO_1[titled];

  if (trimmed.length === 1 && AMINO_ACID_1_TO_3_TITLE[upper]) return upper;

  return "";
}

export interface ResidueShiftModelInput {
  wildType?: string | null;
  mutant?: string | null;
  variant?: string | null;
}

export function resolveResidueShiftModel(input: ResidueShiftModelInput): ResidueShiftModel {
  let wildTypeCode = toOneLetter(input.wildType);
  let mutantCode = toOneLetter(input.mutant);
  let source: ResiduePairSource = wildTypeCode && mutantCode ? "metadata" : "unresolved";

  if ((!wildTypeCode || !mutantCode) && input.variant) {
    const parsed = safeParseVariant(input.variant);
    if (parsed) {
      wildTypeCode = parsed.wildTypeCode;
      mutantCode = parsed.mutantCode;
      source = "variant-notation";
    }
  }

  const wildTypeLabel = wildTypeCode ? AMINO_ACID_1_TO_3_TITLE[wildTypeCode] || wildTypeCode : "";
  const mutantLabel = mutantCode ? AMINO_ACID_1_TO_3_TITLE[mutantCode] || mutantCode : "";

  const contrast =
    wildTypeCode && mutantCode
      ? buildBiochemicalContrast({
          wildTypeCode,
          mutantCode,
          wildTypeLabel,
          mutantLabel,
          wildTypeValues: AMINO_ACID_PROPERTIES[wildTypeCode],
          mutantValues: AMINO_ACID_PROPERTIES[mutantCode]
        })
      : null;

  return {
    wildTypeCode,
    mutantCode,
    wildTypeLabel,
    mutantLabel,
    contrast,
    source: contrast ? source : "unresolved"
  };
}

/**
 * Variant notation is user input, so a malformed string must degrade to
 * "unresolved" rather than throw out of a render pass.
 */
function safeParseVariant(variant: string): { wildTypeCode: string; mutantCode: string } | null {
  try {
    const parsed = parseMutationResidues(variant);
    const wildTypeCode = toOneLetter(parsed?.wt);
    const mutantCode = toOneLetter(parsed?.mut);
    if (!wildTypeCode || !mutantCode) return null;
    return { wildTypeCode, mutantCode };
  } catch {
    return null;
  }
}
