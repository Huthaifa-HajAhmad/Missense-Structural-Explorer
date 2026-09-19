/**
 * isoform-numbering.ts — Keeps an HGVSp's protein numbering consistent with the UniProt
 * accession whose sequence and structure the rest of the pipeline uses.
 *
 * PROBLEM ADDRESSED
 * -----------------
 * Ensembl VEP numbers `hgvsp` on the transcript it selected, but reports the CANONICAL
 * UniProt accession in `swissprot`. When a gene's MANE Select transcript maps to a
 * NON-canonical UniProt isoform those two disagree, and the platform was pairing them.
 *
 * Observed production failure (ACOT9, `chrX:g.23705858C>A`, GRCh38):
 *
 *   MANE Select ENST00000379303 / NM_001037171.2 → p.Lys281Asn, uniprot_isoform Q9Y305-4
 *   Canonical UniProt Q9Y305  (Q9Y305-1), 439 aa → position 281 is L, position 272 is K
 *   NP_001032248.1 (= Q9Y305-4, 448 aa)           → position 281 is K  (= canonical 272)
 *
 * The MANE protein carries a 9-residue insertion after Glu39, so the SAME variant is
 * p.Lys281Asn in one numbering and p.Lys272Asn in the other. The route forwarded
 * `p.Lys281Asn` together with accession `Q9Y305`, and both fail-fast guards
 * (`variant-parser.ts`, FoldX `generation.ts`) correctly rejected the mismatch — producing
 * three FATAL console entries from one upstream numbering error.
 *
 * THE DANGEROUS CASE THIS ALSO CLOSES
 * -----------------------------------
 * A mismatch is only *loud* when the canonical residue at the queried index differs from
 * the query's wild-type letter. Had canonical position 281 happened to be K, every guard
 * would have passed and the platform would have silently modelled a DIFFERENT residue than
 * the one the user asked about, with a confident ΔΔG verdict attached to it.
 *
 * THE RULE
 * --------
 * The `variant` handed downstream must be numbered on the accession it is paired with.
 * VEP reports which isoform each consequence's numbering belongs to (`uniprot_isoform`),
 * and reports the same substitution on other transcripts side by side — including
 * canonically-numbered ones. So:
 *
 *   - numbering already canonical  → keep (no change in behaviour)
 *   - numbering on another isoform → swap in the same substitution as numbered on a
 *                                    canonical transcript, and disclose the remap
 *   - no such sibling available    → refuse, rather than hand over a numbering we cannot
 *                                    honour (a precise 422 beats a downstream crash)
 *   - isoform metadata absent      → keep; sourced from providers that carry no isoform
 *     (e.g. the VariantValidator fallback) and backed by the downstream guards, whose
 *     messages now name the isoform-numbering cause explicitly.
 */

import type { ProteinAlteringConsequence, ResolvedTranscriptConsequence } from "./types.ts";

/** UniProt's canonical isoform is identified by the bare accession or `<accession>-1`. */
export function isCanonicalIsoformId(isoformId: string, canonicalAccession: string): boolean {
  return isoformId === canonicalAccession || isoformId === `${canonicalAccession}-1`;
}

/**
 * Whether this consequence's protein numbering follows the canonical isoform.
 *
 * Returns `undefined` when the provider supplied no isoform metadata — "unknown" is not
 * "canonical", and must never be treated as evidence either way.
 */
export function isCanonicallyNumbered(
  tc: ResolvedTranscriptConsequence,
  canonicalAccession: string
): boolean | undefined {
  const isoforms = tc.uniprot_isoform;
  if (!Array.isArray(isoforms) || isoforms.length === 0) return undefined;
  return isoforms.some((isoformId) => isCanonicalIsoformId(isoformId, canonicalAccession));
}

/**
 * Identity of a substitution with the position removed: `p.Lys281Asn` and `p.Lys272Asn`
 * both yield `p.lysasn`. This is what makes a cross-isoform remap safe — the remapped
 * consequence must describe the same amino-acid change, only numbered differently.
 */
export function substitutionSignature(hgvsp: string | undefined): string | undefined {
  if (!hgvsp) return undefined;
  const protein = hgvsp.includes(":") ? hgvsp.slice(hgvsp.indexOf(":") + 1) : hgvsp;
  const signature = protein.replace(/[0-9]/g, "").replace(/[()]/g, "").trim().toLowerCase();
  return signature || undefined;
}

export type IsoformReconciliation =
  | { action: "keep"; consequence: ProteinAlteringConsequence }
  | {
      action: "remap";
      consequence: ProteinAlteringConsequence;
      fromIsoform?: string;
      toIsoform?: string;
    }
  | {
      action: "unresolved";
      consequence: ProteinAlteringConsequence;
      isoform?: string;
      reason: string;
    };

/**
 * Reconciles the selected consequence's protein numbering with `canonicalAccession`.
 *
 * `all` is every transcript consequence for the variant (VEP supplies them together), which
 * is what makes an automatic remap possible instead of a dead end.
 */
export function reconcileIsoformNumbering(
  selected: ProteinAlteringConsequence,
  all: ResolvedTranscriptConsequence[],
  canonicalAccession: string | undefined
): IsoformReconciliation {
  // No accession to reconcile against (VariantValidator returns neither UniProt nor isoform
  // metadata): keep current behaviour and let the downstream guards report honestly.
  if (!canonicalAccession) return { action: "keep", consequence: selected };

  if (isCanonicallyNumbered(selected, canonicalAccession) !== false) {
    return { action: "keep", consequence: selected };
  }

  const isoform = selected.uniprot_isoform?.[0];
  const signature = substitutionSignature(selected.hgvsp);
  if (!signature) {
    return {
      action: "unresolved",
      consequence: selected,
      isoform,
      reason: "the selected consequence carries no parseable protein change to match against",
    };
  }

  const candidates = all.filter(
    (tc): tc is ProteinAlteringConsequence =>
      tc !== selected &&
      !!tc.hgvsp &&
      isCanonicallyNumbered(tc, canonicalAccession) === true &&
      substitutionSignature(tc.hgvsp) === signature
  );

  // Prefer the Ensembl canonical transcript: its numbering is what a canonical structure
  // (AlphaFold DB / PDB) is built on, and AlphaFold DB models only canonical sequences.
  const replacement =
    candidates.find((tc) => tc.canonical === 1 || tc.canonical === true) ?? candidates[0];

  if (!replacement) {
    return {
      action: "unresolved",
      consequence: selected,
      isoform,
      reason: "no canonically-numbered transcript reports the same substitution for this variant",
    };
  }

  return {
    action: "remap",
    consequence: replacement,
    fromIsoform: isoform,
    toIsoform: replacement.uniprot_isoform?.[0],
  };
}

/**
 * User-facing disclosure for a remap. Unlike a generic "non-canonical transcript" warning,
 * this states both notations and why they differ, because the analysed variant is no longer
 * the one a MANE-based clinical report would name.
 */
export function buildIsoformRemapWarning(
  fromHgvsp: string,
  toHgvsp: string,
  fromIsoform: string | undefined,
  toIsoform: string | undefined,
  maneRefSeqId?: string
): string {
  const fromLabel = `${fromHgvsp}${fromIsoform ? ` (isoform ${fromIsoform})` : ""}${
    maneRefSeqId ? `, ${maneRefSeqId}` : ""
  }`;
  const toLabel = `${toHgvsp}${toIsoform ? ` (isoform ${toIsoform})` : ""}`;
  return (
    `Protein numbering remapped for structural analysis: ${fromLabel} → ${toLabel}. ` +
    "The MANE Select protein is not the UniProt canonical sequence, and only the canonical " +
    "sequence has a structure to model against — the analysis below uses the canonical numbering."
  );
}
