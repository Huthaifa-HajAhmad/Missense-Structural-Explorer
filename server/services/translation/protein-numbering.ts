/**
 * protein-numbering.ts — Turns a protein-level notation into CANONICAL numbering.
 *
 * WHY
 * ---
 * Lab/clinical pipelines report protein variants on the protein they actually used — usually the
 * MANE Select / RefSeq protein (`NP_001032248.1:p.Lys281Asn` for ACOT9). This platform models the
 * CANONICAL UniProt sequence, because AlphaFold DB and PDB structures are canonical. When MANE
 * follows a non-canonical isoform those numberings differ, and the same variant has two names.
 *
 * Before this module the app could only refuse such input (the accession was not even part of the
 * notation grammar), and a bare number could be silently mis-indexed — the letters coincide at
 * ~4% of positions for a 9-residue offset, so a wild-type check alone cannot tell them apart.
 *
 * WHAT IT DOES
 * ------------
 *   1. resolves the accession's place in UniProt's isoform model (RefSeq xrefs carry `isoformId`,
 *      so this is exact — no sequence comparison required);
 *   2. maps the position through `isoform-remap.ts`, which requires a UNIQUELY anchored window;
 *   3. when the notation names no protein, searches every isoform for the interpretation that is
 *      consistent, and reports AMBIGUOUS rather than choosing when two are equally valid.
 *
 * Provider failures surface as CoordinateResolutionError("upstream_unavailable") so the HTTP
 * layer answers 503 with the actionable guidance, exactly as the coordinate ladder does.
 */

import {
  fetchUniprotIsoforms,
  resolveRefSeqProtein,
  type UniprotIsoform,
} from "../external-api/uniprot.ts";
import {
  mapPositionAcrossSequences,
  parseSubstitution,
  renameSubstitution,
  resolveNumberingAcrossBases,
  type NumberingBasis,
  type NumberingCandidate,
} from "./isoform-remap.ts";
import { buildResolutionUnavailableMessage } from "./coordinate-resolver.ts";
import { CoordinateResolutionError } from "./types.ts";

export interface ProteinNumberingOutcome {
  status: "canonical" | "remapped" | "ambiguous" | "unresolved";
  /** HGNC symbol when UniProt reports one (from the RefSeq xref or the FASTA mnemonic). */
  geneSymbol?: string;
  /** Canonical UniProt accession the returned variant is numbered on. */
  canonicalAccession?: string;
  /** Canonical-numbered equivalent of the input notation. */
  canonicalVariant?: string;
  /** Protein whose numbering the INPUT used: `NP_001032248.1`'s isoform, `Q9Y305-4`, or `Q9Y305`. */
  basisId?: string;
  basisKind?: "canonical" | "isoform";
  /** The accession exactly as the caller supplied it. */
  basisAccession?: string;
  /** RefSeq transcript the basis protein is the product of, when known. */
  transcriptId?: string;
  candidates?: NumberingCandidate[];
  reason?: string;
}

/** `ACOT9_HUMAN` -> `ACOT9`. */
function geneSymbolFromEntryName(entryName: string | undefined): string | undefined {
  const symbol = entryName?.split("_")[0]?.trim();
  return symbol || undefined;
}

/** Builds the numbering bases (canonical first) from a UniProt isoform set. */
export function toNumberingBases(isoforms: UniprotIsoform[], canonicalAccession: string): NumberingBasis[] {
  const canonicalUpper = canonicalAccession.toUpperCase();
  return isoforms.map((iso) => ({
    id: iso.id,
    sequence: iso.sequence,
    kind: iso.id.toUpperCase() === canonicalUpper ? "canonical" : "isoform",
  }));
}

/**
 * Resolves a protein notation whose numbering basis is DECLARED by an accession
 * (`NP_001032248.1:p.Lys281Asn`, `Q9Y305-4:p.Lys281Asn`).
 *
 * The declaration removes the ambiguity that a bare number has, so this maps straight through the
 * declared protein — and only uses the other sequences to locate that protein within the
 * canonical one.
 */
export async function resolveAccessionedProteinNotation(
  parsed: { accession: string; proteinNotation: string },
  options?: { bypassSqlite?: boolean }
): Promise<ProteinNumberingOutcome> {
  const accession = parsed.accession.trim().toUpperCase();
  const substitution = parseSubstitution(parsed.proteinNotation);
  if (!substitution) {
    return { status: "unresolved", reason: `"${parsed.proteinNotation}" is not a single-amino-acid substitution` };
  }

  // ── Where does this accession sit in UniProt's isoform model? ────────────────
  let canonicalAccession: string;
  let basisId: string;
  let geneSymbol: string | undefined;
  let transcriptId: string | undefined;

  if (/^NP_\d/.test(accession)) {
    const mapping = await resolveRefSeqProtein(accession, options);
    if (!mapping) {
      return {
        status: "unresolved",
        reason: `UniProt has no reviewed human entry cross-referenced to ${accession}`,
      };
    }
    canonicalAccession = mapping.accession;
    basisId = mapping.isoformId ?? mapping.accession;
    geneSymbol = mapping.geneSymbol;
    transcriptId = mapping.transcriptId;
  } else {
    canonicalAccession = accession.split("-")[0];
    basisId = accession;
  }

  // ── Sequences (canonical + isoforms), one cached call ───────────────────────
  let isoforms: UniprotIsoform[];
  try {
    isoforms = await fetchUniprotIsoforms(canonicalAccession, options);
  } catch (err: any) {
    throw new CoordinateResolutionError(
      "upstream_unavailable",
      buildResolutionUnavailableMessage("upstream_unavailable"),
      []
    );
  }

  const bases = toNumberingBases(isoforms, canonicalAccession);
  const canonical = bases.find((b) => b.kind === "canonical");
  if (!canonical) {
    return {
      status: "unresolved",
      canonicalAccession,
      reason: `UniProt returned no canonical sequence for ${canonicalAccession}`,
    };
  }

  const declared = bases.find((b) => b.id.toUpperCase() === basisId.toUpperCase());
  if (!declared) {
    return {
      status: "unresolved",
      canonicalAccession,
      basisAccession: accession,
      geneSymbol,
      reason: `UniProt does not list an isoform ${basisId} for ${canonicalAccession}`,
    };
  }

  geneSymbol = geneSymbol ?? geneSymbolFromEntryName(isoforms.find((i) => i.id === declared.id)?.entryName);

  // The declared protein must actually carry the stated wild-type residue.
  if (declared.sequence[substitution.position - 1] !== substitution.wt1) {
    const actual = declared.sequence[substitution.position - 1] ?? "∅";
    return {
      status: "unresolved",
      canonicalAccession,
      basisAccession: accession,
      basisId: declared.id,
      basisKind: declared.kind,
      geneSymbol,
      reason: `${declared.id} has ${actual} at position ${substitution.position}, not ${substitution.wt1}`,
    };
  }

  if (declared.kind === "canonical") {
    return {
      status: "canonical",
      canonicalAccession,
      canonicalVariant: `p.${substitution.wt3}${substitution.position}${substitution.mut3}`,
      basisId: declared.id,
      basisKind: "canonical",
      basisAccession: accession,
      geneSymbol,
      transcriptId,
    };
  }

  const mapped = mapPositionAcrossSequences({
    basisSequence: declared.sequence,
    canonicalSequence: canonical.sequence,
    position: substitution.position,
  });
  if (mapped.status !== "mapped") {
    return {
      status: "unresolved",
      canonicalAccession,
      basisAccession: accession,
      basisId: declared.id,
      basisKind: declared.kind,
      geneSymbol,
      reason: mapped.reason,
    };
  }

  return {
    status: "remapped",
    canonicalAccession,
    canonicalVariant: renameSubstitution(parsed.proteinNotation, substitution, mapped.mapping.canonicalPosition),
    basisId: declared.id,
    basisKind: "isoform",
    basisAccession: accession,
    geneSymbol,
    transcriptId,
  };
}

/**
 * Resolves a BARE protein notation (no accession) for a gene, by asking which sequence of that
 * protein is consistent with the stated wild-type residue.
 *
 * Used where the caller supplies only a gene + substitution — the analysis path — so that a
 * MANE-numbered notation works instead of failing a wild-type check against the canonical
 * sequence, and so that a position which is equally consistent with two numberings is reported
 * as ambiguous instead of being modelled as whichever one happened to be checked.
 *
 * Best-effort by design: if UniProt cannot be reached the caller keeps its previous
 * canonical-only behaviour, because a provider outage must not make an otherwise valid protein
 * query fail.
 */
export async function resolveGeneProteinNumbering(params: {
  gene: string;
  notation: string;
  canonicalAccession: string;
  options?: { bypassSqlite?: boolean };
}): Promise<ProteinNumberingOutcome | null> {
  const { gene, notation, canonicalAccession, options } = params;
  const substitution = parseSubstitution(notation);
  if (!substitution) return null;

  try {
    const isoforms = await fetchUniprotIsoforms(canonicalAccession, options);
    const bases = toNumberingBases(isoforms, canonicalAccession);
    const resolution = resolveNumberingAcrossBases({ notation, bases });

    if (resolution.status === "unresolved") {
      return {
        status: "unresolved",
        canonicalAccession,
        geneSymbol: gene,
        reason: resolution.reason,
      };
    }
    if (resolution.status === "ambiguous") {
      return {
        status: "ambiguous",
        canonicalAccession,
        geneSymbol: gene,
        candidates: resolution.candidates,
      };
    }

    const { candidate } = resolution;
    return {
      status: resolution.status,
      canonicalAccession,
      canonicalVariant: candidate.variant,
      basisId: candidate.basisId,
      basisKind: candidate.basisKind,
      geneSymbol: gene,
    };
  } catch {
    // Provider problem: not a numbering verdict. The caller falls back to canonical behaviour.
    return null;
  }
}

/** User-facing disclosure when a notation was converted onto canonical numbering. */
export function buildProteinNumberingRemapWarning(
  outcome: ProteinNumberingOutcome,
  inputNotation: string
): string | undefined {
  if (outcome.status !== "remapped" || !outcome.canonicalVariant) return undefined;
  const basis = outcome.basisAccession && outcome.basisAccession !== outcome.basisId
    ? `${outcome.basisAccession} (isoform ${outcome.basisId})`
    : outcome.basisId ?? "a non-canonical isoform";
  const transcript = outcome.transcriptId ? `, ${outcome.transcriptId}` : "";
  return (
    `Protein numbering remapped for structural analysis: ${inputNotation} on ${basis}${transcript} → ` +
    `${outcome.canonicalVariant} on canonical ${outcome.canonicalAccession}. The reported protein is not ` +
    "the UniProt canonical sequence, and only the canonical sequence has a structure to model against — " +
    "the analysis below uses the canonical numbering."
  );
}
