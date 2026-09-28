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
 * (`variant-parser.ts`, FoldX `generation.ts`) correctly rejected the mismatch — three
 * FATAL console entries from one upstream numbering error.
 *
 * THE DANGEROUS CASE
 * ------------------
 * A mismatch is only *loud* when the canonical residue at the queried index differs from the
 * query's wild-type letter. Had canonical position 281 happened to be K, every guard would
 * have passed and the platform would have silently modelled a DIFFERENT residue than the one
 * the user asked about, with a confident ΔΔG verdict attached to it. Anything that cannot be
 * PROVEN consistent must therefore be disclosed, never assumed.
 *
 * FOUR VERDICTS (a review of the first version showed "keep" was doing three different jobs)
 * -----------------------------------------------------------------------------------------
 *   canonical   — numbering proven to follow the canonical accession → use as-is.
 *   remapped    — numbering proven to follow ANOTHER isoform, and the same substitution is
 *                 reported by a canonically-numbered sibling → use the sibling's HGVSp.
 *   unverified  — the basis cannot be established (provider returned no accession, or no
 *                 isoform metadata and nothing to compare against). The answer is still
 *                 usable, but it is disclosed and must NOT be cached as settled truth.
 *   unsupported — the basis is known to be non-canonical and no safe sibling exists → refuse.
 *
 * WHAT COUNTS AS PROOF (the first version's digit-stripped signature did not)
 * --------------------------------------------------------------------------
 * `substitutionSignature` removes digits, so `p.Lys281Asn` and `p.Lys231Asn` share a
 * signature: it can never establish that a sibling describes the same residue. A remap now
 * additionally requires the same gene, the same amino-acid change (VEP's `amino_acids`,
 * falling back to the letters in `hgvsp`, normalised to one-letter form), a position inside
 * a biologically possible range, and unanimous agreement on the numbering offset across every
 * canonically-numbered sibling of that change. Any disagreement refuses the remap.
 */

import { AMINO_ACID_3_TO_1 } from "../../../src/shared/aminoAcids.ts";
import { MAX_PROTEIN_POSITION } from "../../../src/shared/variantNotation.ts";
import type { ProteinAlteringConsequence, ResolvedTranscriptConsequence } from "./types.ts";

export { MAX_PROTEIN_POSITION };

/** UniProt's canonical isoform is identified by the bare accession or `<accession>-1`. */
export function isCanonicalIsoformId(isoformId: string, canonicalAccession: string): boolean {
  const normalise = (value: string) => value.trim().toUpperCase().replace(/-0*(\d+)$/, "-$1");
  return normalise(isoformId) === normalise(canonicalAccession) ||
    normalise(isoformId) === `${normalise(canonicalAccession)}-1`;
}

/**
 * Normalises VEP's `uniprot_isoform` into a list of ids.
 *
 * Deliberately tolerant: VEP has been observed to send a bare string, and the resolver's Zod
 * schema accepted both shapes — a strict `.array()` here (or there) silently discarded the
 * whole payload and degraded a resolution to the metadata-free fallback provider.
 */
export function normalizeIsoformIds(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  }
  return [];
}

/** Normalises VEP's `canonical` flag (number, boolean, or the string form). */
export function normalizeCanonicalFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") return value.trim().toLowerCase() === "true" || value.trim() === "1";
  return false;
}

/**
 * Whether this consequence's protein numbering follows the canonical isoform.
 *
 * Returns `undefined` when the provider supplied no isoform metadata — "unknown" is not
 * "canonical", and treating it as such was the defect that kept the ACOT9 hazard alive on
 * every consequence VEP leaves unannotated (and on every VariantValidator answer).
 */
export function isCanonicallyNumbered(
  tc: ResolvedTranscriptConsequence,
  canonicalAccession: string
): boolean | undefined {
  const isoforms = normalizeIsoformIds(tc.uniprot_isoform);
  if (isoforms.length === 0) return undefined;
  return isoforms.some((isoformId) => isCanonicalIsoformId(isoformId, canonicalAccession));
}

/** The isoform id whose numbering this consequence follows, when the provider states it. */
export function numberingIsoformId(tc: ResolvedTranscriptConsequence): string | undefined {
  return normalizeIsoformIds(tc.uniprot_isoform)[0];
}

/** Extracts the residue position from an HGVSp (`ENSP…:p.Lys281Asn` → `281`). */
export function proteinPosition(hgvsp: string | undefined): number | undefined {
  if (!hgvsp) return undefined;
  const protein = hgvsp.includes(":") ? hgvsp.slice(hgvsp.indexOf(":") + 1) : hgvsp;
  const match = protein.match(/(\d{1,7})/);
  if (!match) return undefined;
  const position = Number.parseInt(match[1], 10);
  return Number.isFinite(position) ? position : undefined;
}

/**
 * Position-free signature, retained for coarse pre-filtering and diagnostics.
 *
 * NOT an identity proof: it deletes digits, so different positions share a signature. Use
 * {@link sameAminoAcidChange} for the identity decision.
 */
export function substitutionSignature(hgvsp: string | undefined): string | undefined {
  if (!hgvsp) return undefined;
  const protein = hgvsp.includes(":") ? hgvsp.slice(hgvsp.indexOf(":") + 1) : hgvsp;
  const signature = protein.replace(/[0-9]/g, "").replace(/[()]/g, "").trim().toLowerCase();
  return signature || undefined;
}

/** One-letter `WT>MUT` identity for a consequence, or undefined when it cannot be derived. */
export function aminoAcidChange(tc: ResolvedTranscriptConsequence): string | undefined {
  const declared = typeof tc.amino_acids === "string" ? tc.amino_acids.trim() : "";
  if (declared) {
    const [wt, mut] = declared.split("/");
    const wt1 = toOneLetter(wt);
    const mut1 = toOneLetter(mut);
    if (wt1 && mut1) return `${wt1}>${mut1}`;
  }

  const hgvsp = tc.hgvsp;
  if (!hgvsp) return undefined;
  const protein = (hgvsp.includes(":") ? hgvsp.slice(hgvsp.indexOf(":") + 1) : hgvsp)
    .replace(/[()]/g, "")
    .replace(/^p\./i, "");
  const match = protein.match(/^([A-Za-z]{1,3})\d{1,7}([A-Za-z]{1,3}|=|\*|Ter|X)/);
  if (!match) return undefined;
  if (match[2] === "=") return undefined; // "no change" is not a substitution identity
  const wt1 = toOneLetter(match[1]);
  const mut1 = toOneLetter(match[2]);
  return wt1 && mut1 ? `${wt1}>${mut1}` : undefined;
}

/** HGVS amino-acid token (1- or 3-letter, any case) to its one-letter code. */
export function oneLetterAminoAcid(token: string | undefined): string | undefined {
  return toOneLetter(token);
}

function toOneLetter(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const trimmed = token.trim();
  if (trimmed.length === 1) return /^[A-Za-z]$/.test(trimmed) ? trimmed.toUpperCase() : undefined;
  return AMINO_ACID_3_TO_1[trimmed.toUpperCase()] ??
    AMINO_ACID_3_TO_1[trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()];
}

/**
 * Same substitution, ignoring numbering: requires a derivable identity on BOTH sides, so two
 * consequences that merely *look* alike (`p.(=)`, `p.?`) never qualify.
 */
export function sameAminoAcidChange(
  a: ResolvedTranscriptConsequence,
  b: ResolvedTranscriptConsequence
): boolean {
  const changeA = aminoAcidChange(a);
  const changeB = aminoAcidChange(b);
  return Boolean(changeA && changeB && changeA === changeB);
}

export type NumberingStatus = "canonical" | "remapped" | "unverified" | "unsupported";

export interface NumberingVerdict {
  status: NumberingStatus;
  /** Consequence whose numbering the pipeline must use. */
  consequence: ProteinAlteringConsequence;
  /** Canonical accession the numbering was checked against, when one was supplied. */
  canonicalAccession?: string;
  /** Isoform id whose numbering `consequence` follows, when known. */
  numberingIsoform?: string;
  /**
   * Protein accession whose numbering the ORIGINAL selection followed, when the provider stated
   * one but no UniProt isoform (VariantValidator reports `NP_…`). Named so an unverifiable
   * numbering is still checkable by a human.
   */
  numberingProteinId?: string;
  /** The isoform the original selection followed (remap only). */
  fromIsoform?: string;
  /** Human-readable reason for `unverified` / `unsupported`. */
  reason?: string;
}

/** ` (numbered on NP_001032248.1)` when the provider named the numbering basis, else "". */
function numberingBasisSuffix(tc: ResolvedTranscriptConsequence): string {
  const proteinId = tc.numbering_protein_id;
  return proteinId ? ` (numbered on ${proteinId})` : "";
}

/**
 * Reconciles the selected consequence's protein numbering with `canonicalAccession`.
 *
 * `all` is every transcript consequence for the variant (VEP supplies them together), which is
 * what makes an automatic remap possible instead of a dead end.
 */
export function reconcileIsoformNumbering(
  selected: ProteinAlteringConsequence,
  all: ResolvedTranscriptConsequence[],
  canonicalAccession: string | undefined
): NumberingVerdict {
  // A provider that reports no accession (VariantValidator) gives us nothing to verify
  // against. The answer is still returned — refusing would take the fallback tier offline —
  // but it is marked unverified so the route can disclose it and keep it out of the cache.
  if (!canonicalAccession) {
    return {
      status: "unverified",
      consequence: selected,
      numberingIsoform: numberingIsoformId(selected),
      numberingProteinId: selected.numbering_protein_id,
      reason:
        "the provider did not report a UniProt accession to verify the numbering against" +
        numberingBasisSuffix(selected),
    };
  }

  const declared = isCanonicallyNumbered(selected, canonicalAccession);
  const canonicalSiblings = all.filter(
    (tc): tc is ProteinAlteringConsequence =>
      tc !== selected &&
      !!tc.hgvsp &&
      isCanonicallyNumbered(tc, canonicalAccession) === true &&
      sameGene(tc, selected) &&
      sameAminoAcidChange(tc, selected)
  );

  if (declared === true) {
    return {
      status: "canonical",
      consequence: selected,
      canonicalAccession,
      numberingIsoform: canonicalIsoformIdOf(selected, canonicalAccession),
    };
  }

  // No metadata on the selection itself: infer the basis by comparing positions with a
  // canonically-numbered sibling of the same change. Equal positions ⇒ equivalent numbering;
  // different positions ⇒ this consequence follows another isoform; no sibling ⇒ unverified.
  const selectedPosition = proteinPosition(selected.hgvsp);
  if (declared === undefined) {
    if (canonicalSiblings.length === 0) {
      return {
        status: "unverified",
        consequence: selected,
        canonicalAccession,
        numberingIsoform: numberingIsoformId(selected),
        numberingProteinId: selected.numbering_protein_id,
        reason:
          "the provider did not state which UniProt isoform this transcript's numbering follows" +
          numberingBasisSuffix(selected),
      };
    }
    const siblingPositions = canonicalSiblings
      .map((tc) => proteinPosition(tc.hgvsp))
      .filter((p): p is number => p !== undefined);
    if (selectedPosition !== undefined && siblingPositions.every((p) => p === selectedPosition)) {
      return {
        status: "canonical",
        consequence: selected,
        canonicalAccession,
        numberingIsoform: canonicalIsoformIdOf(selected, canonicalAccession),
      };
    }
  }

  // Non-canonical numbering (declared, or proven by a position difference): remap.
  const positions = canonicalSiblings
    .map((tc) => proteinPosition(tc.hgvsp))
    .filter((p): p is number => p !== undefined)
    .filter((p) => p >= 1 && p <= MAX_PROTEIN_POSITION);

  if (positions.length === 0) {
    return {
      status: "unsupported",
      consequence: selected,
      canonicalAccession,
      numberingIsoform: numberingIsoformId(selected),
      reason: "no canonically-numbered transcript reports the same substitution for this variant",
    };
  }

  // Every canonical sibling must agree on the numbering offset. Disagreement means the payload
  // cannot tell us which position is the canonical one, so no remap is safe.
  const offsets = new Set(
    selectedPosition === undefined ? positions : positions.map((p) => p - selectedPosition)
  );
  if (offsets.size > 1) {
    return {
      status: "unsupported",
      consequence: selected,
      canonicalAccession,
      numberingIsoform: numberingIsoformId(selected),
      reason:
        "canonically-numbered transcripts disagree on the residue position for this substitution",
    };
  }

  const replacement =
    canonicalSiblings.find((tc) => normalizeCanonicalFlag(tc.canonical)) ?? canonicalSiblings[0];

  return {
    status: "remapped",
    consequence: replacement,
    canonicalAccession,
    numberingIsoform: canonicalIsoformIdOf(replacement, canonicalAccession),
    fromIsoform: numberingIsoformId(selected),
  };
}

function sameGene(
  a: ResolvedTranscriptConsequence,
  b: ResolvedTranscriptConsequence
): boolean {
  if (!a.gene_symbol || !b.gene_symbol) return true; // nothing to contradict
  return a.gene_symbol.toUpperCase() === b.gene_symbol.toUpperCase();
}

/** The entry of `uniprot_isoform` that actually matches the canonical accession, if stated. */
function canonicalIsoformIdOf(
  tc: ResolvedTranscriptConsequence,
  canonicalAccession: string
): string | undefined {
  const ids = normalizeIsoformIds(tc.uniprot_isoform);
  return ids.find((id) => isCanonicalIsoformId(id, canonicalAccession)) ?? ids[0];
}

/**
 * User-facing disclosure for a remap. States both notations and why they differ, because the
 * analysed variant is no longer the one a MANE-based clinical report would name.
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
    // NOT "the MANE Select protein": the numbering basis that needed remapping is the protein the
    // reporting pipeline used — MANE Select on a current release, and the Ensembl canonical
    // transcript on Ensembl's GRCh37 archive, which predates MANE. Naming MANE here would be wrong
    // for the GRCh37 case, which is exactly when this note matters most.
    "The protein these numbers were reported on is not the UniProt canonical sequence, and only " +
    "the canonical sequence has a structure to model against — the analysis below uses the " +
    "canonical numbering."
  );
}

/**
 * Disclosure for an answer whose numbering could not be tied to the canonical isoform.
 *
 * Unlike a remap this is not a repair, so it must not read like one: the residue numbers may
 * not match the canonical sequence, which is exactly the condition that can make a prediction
 * describe a different residue.
 */
export function buildUnverifiedNumberingWarning(
  hgvsp: string,
  canonicalAccession: string | undefined,
  reason: string
): string {
  const target = canonicalAccession
    ? `the canonical UniProt sequence ${canonicalAccession}`
    : "the canonical UniProt sequence";
  return (
    `Protein numbering could not be verified against ${target}: ${reason}. ` +
    `${hgvsp} is used as reported by the reference translator — check the transcript/isoform ` +
    "before relying on residue numbers, or enter the substitution directly in canonical numbering."
  );
}
