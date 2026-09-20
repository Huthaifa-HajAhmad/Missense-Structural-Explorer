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
  fetchDisplayedIsoformId,
  fetchUniprotIsoforms,
  resolveRefSeqProtein,
  type RefSeqLookupResult,
  type UniprotIsoform,
} from "../external-api/uniprot.ts";
import { isCanonicalIsoformId } from "./isoform-numbering.ts";
import { getNumberingProfile, notationAtCanonicalPosition } from "./numbering-profile.ts";
import {
  mapPositionAcrossSequences,
  parseSubstitution,
  renameSubstitution,
  resolveNumberingAcrossBases,
  toNumberingBases,
  type NumberingBasis,
  type NumberingCandidate,
} from "./isoform-remap.ts";
import { buildResolutionUnavailableMessage } from "./coordinate-resolver.ts";
import { CoordinateResolutionError } from "./types.ts";

export interface ProteinNumberingOutcome {
  /**
   * `unverified` means the numbering basis could NOT be established, so no conversion is
   * possible: callers must refuse and point at the coordinate/cDNA route. It is deliberately
   * distinct from `unresolved` (a definitive "that protein/accession does not have this residue"),
   * because conflating the two is how a missing metadata field became a confident wrong answer.
   */
  status: "canonical" | "remapped" | "unverified" | "ambiguous" | "unresolved";
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
export { toNumberingBases };

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
    let lookup: RefSeqLookupResult;
    try {
      lookup = await resolveRefSeqProtein(accession, options);
    } catch {
      // A provider failure is NOT a fact about the accession: answer "try again" (503), never a
      // 422 that tells the user their accession does not exist.
      throw new CoordinateResolutionError(
        "upstream_unavailable",
        buildResolutionUnavailableMessage("upstream_unavailable"),
        []
      );
    }

    if (lookup.kind === "absent") {
      return {
        status: "unresolved",
        reason: `UniProt (reviewed, human) has no entry cross-referenced to ${accession}`,
      };
    }

    const mapping = lookup.mapping;
    canonicalAccession = mapping.accession;
    geneSymbol = mapping.geneSymbol;
    transcriptId = mapping.transcriptId;

    // A MISSING isoformId is not evidence of canonical numbering. Assuming it was, and returning
    // the canonical sequence unchanged, modelled a different residue whenever the letters
    // happened to coincide at the same index (RHOT1 `NP_001028739.2`: isoform 4, 491 aa, versus
    // 618 aa canonical). Refuse instead: the coordinate/cDNA route settles the numbering.
    if (!mapping.isoformId) {
      return {
        status: "unverified",
        canonicalAccession,
        basisAccession: accession,
        geneSymbol,
        transcriptId,
        reason: `UniProt does not state which isoform ${accession} is, so the numbering basis cannot be established`,
      };
    }
    basisId = mapping.isoformId;
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
      status: "unverified",
      canonicalAccession,
      basisAccession: accession,
      geneSymbol,
      reason: `UniProt returned no canonical sequence for ${canonicalAccession}`,
    };
  }

  /**
   * Isoform identity as UniProt MEANS it: `<acc>-1` and the bare accession are the same protein.
   *
   * The FASTA labels the canonical record with the bare accession, while RefSeq xrefs routinely
   * write `<acc>-1` (measured: 15 of 70 xrefs in a 25-entry sample, and 59 of 130 sampled MANE
   * proteins). Comparing those literally refused the *canonical-numbered* notation — the one case
   * needing no conversion — with the false claim that the isoform does not exist.
   */
  const basisKey = (id: string): string =>
    isCanonicalIsoformId(id, canonicalAccession) ? "CANONICAL" : id.toUpperCase();

  let declared = bases.find((b) => basisKey(b.id) === basisKey(basisId));
  let declaredLabel = declared?.id;

  if (!declared) {
    // UniProt labels the DISPLAYED isoform's sequence with the bare accession. When the declared
    // id is a different isoform number, reconcile through the entry's ALTERNATIVE PRODUCTS
    // comment before declaring it unknown.
    try {
      const displayedId = await fetchDisplayedIsoformId(canonicalAccession, options);
      if (displayedId && basisKey(displayedId) === basisKey(basisId)) {
        declared = canonical;
        declaredLabel = displayedId;
      }
    } catch {
      // Best effort: an unreachable entry endpoint must not turn into a numbering verdict.
    }
  }

  if (!declared) {
    return {
      status: "unverified",
      canonicalAccession,
      basisAccession: accession,
      basisId,
      geneSymbol,
      transcriptId,
      reason: `UniProt lists no isoform ${basisId} for ${canonicalAccession}, so the numbering basis cannot be established`,
    };
  }

  geneSymbol = geneSymbol ?? geneSymbolFromEntryName(isoforms.find((i) => i.id === declared!.id)?.entryName);

  // The declared protein must actually carry the stated wild-type residue.
  if (declared.sequence[substitution.position - 1] !== substitution.wt1) {
    const actual = declared.sequence[substitution.position - 1] ?? "∅";
    return {
      status: "unresolved",
      canonicalAccession,
      basisAccession: accession,
      basisId: declaredLabel,
      basisKind: declared.kind,
      geneSymbol,
      reason: `${declaredLabel} has ${actual} at position ${substitution.position}, not ${substitution.wt1}`,
    };
  }

  if (declared.kind === "canonical") {
    return {
      status: "canonical",
      canonicalAccession,
      canonicalVariant: `p.${substitution.wt3}${substitution.position}${substitution.mut3}`,
      basisId: declaredLabel,
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
      basisId: declaredLabel,
      basisKind: declared.kind,
      geneSymbol,
      transcriptId,
      reason: mapped.reason,
    };
  }

  return {
    status: "remapped",
    canonicalAccession,
    canonicalVariant: renameSubstitution(parsed.proteinNotation, substitution, mapped.mapping.canonicalPosition),
    basisId: declaredLabel,
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
 * query fail. Callers on a request path should also bound the wait with
 * {@link withNumberingBudget} — "best effort" must not mean "slow".
 */
export const NUMBERING_VERIFICATION_BUDGET_MS = 2_500;

/**
 * Resolves to the work's value, or to `null` when the budget expires first.
 *
 * A rejection propagates (callers treat that as "provider failed"). The underlying work is NOT
 * cancelled: it usually finishes into the cache, so the next request for the same protein is warm.
 *
 * Exists because an unbounded verification lookup cost up to ~110s BEFORE the analysis started
 * during a UniProt outage (the isoform fetch retries 3 × 20s, then the MANE fetch 3 × 15s) — which
 * is the opposite of the "an outage must not break a valid query" rule the check is built on.
 */
export function withNumberingBudget<T>(
  work: Promise<T>,
  budgetMs: number = NUMBERING_VERIFICATION_BUDGET_MS,
  /**
   * Called when the budget expires, so the caller can ABORT the work instead of leaving it running.
   * An orphaned verification kept retrying for up to its own ~65s envelope, holding a per-host
   * semaphore slot and booking breaker failures against a healthy provider.
   */
  onExpire?: () => void
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A non-positive budget must not silently DISABLE the check (a public option can be passed 0), and
  // "no bound" is exactly the failure this function exists to prevent. Fall back to the default.
  const effectiveBudgetMs =
    Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : NUMBERING_VERIFICATION_BUDGET_MS;
  const expiry = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      try {
        onExpire?.();
      } catch {
        // An abort that throws must not swallow the "unverified" outcome.
      }
      resolve(null);
    }, effectiveBudgetMs);
  });
  return Promise.race<T | null>([work, expiry]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function resolveGeneProteinNumbering(params: {
  gene: string;
  notation: string;
  canonicalAccession: string;
  /**
   * Which numberings a BARE notation could plausibly be reported on.
   *
   * `mane` restricts the comparison to canonical versus the MANE Select protein — the pair a bare
   * lab notation actually uses. Admitting every isoform roughly quadrupled the refusal set for
   * ACOT9 (14.8% of positions versus 3.4%) on the strength of isoforms no report would be numbered
   * on. Declared (accession-qualified) input uses `all`, because there the basis is named.
   */
  basisScope?: "all" | "mane";
  /**
   * Passed through to the underlying lookups so an abandoned verification can be CANCELLED, and so
   * a timeout we imposed is not booked against the provider's health.
   */
  options?: { bypassSqlite?: boolean; signal?: AbortSignal; cappedByCaller?: boolean };
}): Promise<ProteinNumberingOutcome | null> {
  const { gene, notation, canonicalAccession, basisScope = "all", options } = params;
  const substitution = parseSubstitution(notation);
  if (!substitution) return null;

  try {
    if (basisScope === "mane") {
      /**
       * Locally decidable from the gene's cached PROFILE — no per-request provider comparison.
       *
       * The pair that matters for a bare notation is canonical versus MANE, and both readings are
       * already enumerated in the profile, so a typed position is resolved by a set lookup:
       *   - MANE identical to canonical → unambiguous by construction;
       *   - position in `ambiguous` → two readings fit, refuse with BOTH (never pick one);
       *   - otherwise → only the canonical reading fits.
       * A provider failure returns null (the caller discloses "unverified"); an entry whose MANE
       * could not be identified falls through to the conservative all-isoform comparison.
       */
      const profile = await getNumberingProfile(canonicalAccession, options);
      if (!profile) return null;

      if (profile.maneIdentified) {
        const canonicalOutcome = (): ProteinNumberingOutcome => ({
          status: "canonical",
          canonicalAccession,
          canonicalVariant: `p.${substitution.wt3}${substitution.position}${substitution.mut3}`,
          basisId: canonicalAccession,
          basisKind: "canonical",
          geneSymbol: gene,
        });

        if (!profile.maneNumberingDiffers) return canonicalOutcome();

        /**
         * A position the profile could NOT check is not a position the profile cleared.
         *
         * Here the two proteins carry the same residue but the second reading could not be located
         * (it sits inside the region where they differ). Reporting "verified canonical" would assert a
         * check that never happened — the exact confusion that let a bare notation model the wrong
         * residue. Answer "unverified" so the caller discloses it, and never cache that.
         */
        if (profile.unverifiable.includes(substitution.position)) {
          return {
            status: "unverified",
            canonicalAccession,
            basisAccession: gene,
            geneSymbol: gene,
            reason:
              `position ${substitution.position} lies where the MANE protein and canonical ` +
              `${canonicalAccession} differ, so another numbering cannot be excluded`,
          };
        }

        const collision = profile.ambiguous.find((entry) => entry.position === substitution.position);
        if (collision) {
          return {
            status: "ambiguous",
            canonicalAccession,
            geneSymbol: gene,
            candidates: [
              {
                basisId: canonicalAccession,
                basisKind: "canonical",
                basisPosition: substitution.position,
                canonicalPosition: substitution.position,
                variant: `p.${substitution.wt3}${substitution.position}${substitution.mut3}`,
                anchorLength: 0,
              },
              {
                basisId: collision.basisIsoformId,
                basisKind: "isoform",
                basisPosition: substitution.position,
                canonicalPosition: collision.canonicalPosition,
                variant: notationAtCanonicalPosition(notation, collision.canonicalPosition),
                anchorLength: 0,
              },
            ],
          };
        }

        /**
         * A position the MANE pair agrees on, but ANOTHER isoform also reads.
         *
         * The scope for resolving a bare notation is canonical-vs-MANE (that is what a lab reports), so
         * this is not a refusal — but it is not a clean bill either: a report numbered on that isoform
         * would mean a different canonical residue. `numberingVerified: true` would assert a check of
         * something that was never checked, so the reading is accepted and DISCLOSED, naming the isoform
         * and the other residue it implies.
         */
        const contested = profile.contested.find((entry) => entry.position === substitution.position);
        if (contested) {
          return {
            status: "unverified",
            canonicalAccession,
            basisAccession: gene,
            geneSymbol: gene,
            reason:
              `isoform ${contested.basisIsoformId} also carries this residue at position ` +
              `${substitution.position}, which is canonical ${contested.canonicalPosition} — a report ` +
              `numbered on that isoform would mean a different residue`,
          };
        }

        return canonicalOutcome();
      }
    }

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
