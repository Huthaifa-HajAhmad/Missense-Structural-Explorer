/**
 * coordinate-resolver.ts — Provider ladder for genomic/cDNA -> protein resolution.
 *
 * PROBLEM ADDRESSED
 * -----------------
 * `rest.ensembl.org` was a single point of failure: when VEP was unreachable, every
 * coordinate query failed. Worse, a circuit-breaker trip surfaced to the clinician as a
 * generic 500 ("internal server error"), which both mis-signalled an internal bug and
 * offered no workaround.
 *
 * THE LADDER
 * ----------
 *   0. L2 persistent cache  — coordinate->protein mappings are IMMUTABLE, so a previously
 *                             resolved coordinate returns instantly and survives outages.
 *   1. Ensembl VEP          — primary; fast and rich (UniProt, MANE, canonical flags).
 *   2. VariantValidator     — independent infrastructure; survives a total VEP outage.
 *
 * Every tier is recorded in `attempts` so the answer stays auditable, and the route
 * reports which provider actually answered.
 *
 * WHAT "RESOLVED" MEANS HERE
 * --------------------------
 * A provider answering is not the same as the question being answered: this platform models
 * missense substitutions, so a payload whose transcripts carry no HGVSp (intronic, UTR,
 * non-coding) is a MISS for the ladder, not an answer — another provider's annotation release
 * may number the coordinate. The ladder therefore requires a protein-altering consequence of
 * every rung, and only returns a protein-free payload (with `proteinChangeFound: false`) once
 * every rung has been asked, so the caller can explain why instead of reporting "not found".
 *
 * The ladder also owns protein-NUMBERING reconciliation (`isoform-numbering.ts`), because the
 * cache decision depends on it: an answer whose numbering could not be tied to the canonical
 * UniProt isoform must never be stored as settled truth for a decade. See {@link isCacheable}.
 *
 * DELIBERATE SCOPE BOUNDARY
 * -------------------------
 * gnomAD / MyVariant-style databases were evaluated and REJECTED as fallbacks: they only
 * answer for variants already observed by their cohorts, whereas this platform's core use
 * case is rare/novel VUS (a routine missense SNV returned "Variant not found" from gnomAD).
 * Only reference-sequence translators can answer for a novel variant.
 */

import { z } from "zod";
import { LRUCache } from "lru-cache";
import { fetchWithRetry, isHostAvailable } from "../infra/http-client.ts";
import { defaultCacheRegistry, getCachedOrFetch } from "../infra/cache.ts";
import { buildCoordinateTranslationKey } from "../infra/cache-keys.ts";
import { anySignal, UNIPROT_PATTERN } from "../../utils.ts";
import {
  fetchUniprotEntryReferenceData,
  isUniprotEntryName,
  resolveUniprotEntryNameToAccession,
  type UniprotEntryReferenceData,
} from "../external-api/uniprot.ts";
import type { GenomeAssembly } from "../../../src/shared/variantNotation.ts";
import { fetchVariantValidatorConsequence } from "./variant-validator.ts";
import { isEgressRefusal } from "../infra/egress-governor.ts";
import {
  normalizeIsoformIds,
  reconcileIsoformNumbering,
  type NumberingVerdict,
} from "./isoform-numbering.ts";
import {
  CoordinateResolutionError,
  isReferenceMismatchMessage,
  type ProviderAttempt,
  type ProteinAlteringConsequence,
  type ResolutionFailureKind,
  type ResolutionOutcome,
  type ResolutionProviderOptions,
  type ResolvedConsequence,
  type ResolvedTranscriptConsequence,
  type TranslationProvider,
} from "./types.ts";

/**
 * Ensembl REST hosts are genome-build specific: the default host serves GRCh38 while
 * `grch37.rest.ensembl.org` serves GRCh37. Both were verified live to accept the full
 * query-parameter set used below (including `mane=1`).
 *
 * NOTE: Ensembl's regional mirrors (useast/asia) do NOT serve REST/VEP — they return
 * 403/503 — so they are deliberately absent here.
 */
export const ENSEMBL_HOSTS: Record<GenomeAssembly, string> = {
  GRCh38: "https://rest.ensembl.org",
  GRCh37: "https://grch37.rest.ensembl.org",
};

/** Ensembl's default host serves GRCh38, so unannotated notations keep their prior behavior. */
export const DEFAULT_ASSEMBLY: GenomeAssembly = "GRCh38";

/** Ensembl VEP's configured per-attempt tolerance. */
export const ENSEMBL_VEP_TIMEOUT_MS = 25_000;

const ensemblResponseSchema = z.array(
  z.object({
    seq_region_name: z.string().optional(),
    start: z.number().optional(),
    allele_string: z.string().optional(),
    strand: z.union([z.number(), z.string()]).optional(),
    transcript_consequences: z
      .array(
        z
          .object({
            transcript_id: z.string().optional(),
            // VEP sends `canonical` as 1/0 or true/false and has been seen sending the string
            // form. Accepting all three keeps a payload carrying the field reconciliation
            // depends on from being discarded wholesale.
            canonical: z.union([z.number(), z.boolean(), z.string()]).optional(),
            mane_select: z.any().optional(),
            mane_plus_clinical: z.any().optional(),
            hgvsp: z.string().optional(),
            hgvsc: z.string().optional(),
            amino_acids: z.string().optional(),
            // Isoform the consequence's protein numbering belongs to. Accepts the string form
            // for the same reason: rejecting it silently degraded a resolution to the
            // metadata-free fallback provider.
            uniprot_isoform: z.union([z.array(z.string()), z.string()]).optional(),
            gene_symbol: z.string().optional(),
            consequence_terms: z.array(z.string()).optional(),
            swissprot: z.array(z.string()).optional(),
          })
          .passthrough()
      )
      .optional(),
  })
);

/** Canonical UniProt accession reported for a consequence (`Q9Y305.179` -> `Q9Y305`). */
export function canonicalAccessionOf(
  consequence: ResolvedTranscriptConsequence
): string | undefined {
  const accession = consequence.swissprot?.[0]?.split(".")[0]?.trim();
  return accession || undefined;
}

/** Uppercased, version-stripped form of one VEP `swissprot` value, or "" when unusable. */
function swissprotToken(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().split(".")[0]?.trim().toUpperCase() ?? "";
}

/**
 * Rewrites UniProt ENTRY NAMES in a provider payload's `swissprot` arrays into ACCESSIONS.
 *
 * WHY (production regression, `Chr1(GRCh37):g.1256452C>A`)
 * -------------------------------------------------------
 * Ensembl's GRCh37 archive reports VEP's `swissprot` field as the entry NAME, not the accession:
 * verified live, that locus answers `swissprot: ["INT11_HUMAN"]` (gene symbol from the same
 * retired annotation: `CPSF3L`), while the GRCh38 host answers `["Q5TA45.162"]` for the equivalent
 * coordinate. `canonicalAccessionOf` forwards `swissprot[0]` verbatim, so the route's
 * `validateUniProt` rejected an otherwise fully resolved coordinate with
 * `422 Invalid UniProt accession ID format: "INT11_HUMAN"` — a metadata field dead-ending the
 * whole analysis.
 *
 * WHERE IT MUST RUN
 * -----------------
 * Before ANY derivation, because the accession decides the numbering verdict: `uniprot_isoform`
 * ids are compared against it, so a mnemonic there can only ever fail to match — turning a
 * canonically-numbered GRCh37 consequence into `unsupported` (a 422 telling the user their
 * numbering is wrong) instead of `canonical`/`unverified`. The verdict also decides what is
 * cacheable, so the payload stored in the cache must already carry accessions.
 *
 * DEGRADATION IS DELIBERATE
 * -------------------------
 * A value that is neither an accession nor a resolvable entry name is DROPPED, never forwarded:
 * an empty accession is a state the pipeline already handles honestly (the response says
 * `numberingBasis: "unverified"` and the client resolves gene -> UniProt), whereas a non-accession
 * is what broke the request. A UniProt outage therefore costs the accession, not the variant.
 */
export async function normalizeSwissprotAccessions(
  consequence: ResolvedConsequence,
  signal?: AbortSignal
): Promise<ResolvedConsequence> {
  const consequences = consequence.transcript_consequences ?? [];
  if (consequences.length === 0) return consequence;

  /** Distinct entry names, so one name costs one lookup however many transcripts report it. */
  const namesToResolve = new Set<string>();
  let needsRewrite = false;
  for (const tc of consequences) {
    for (const raw of tc.swissprot ?? []) {
      const token = swissprotToken(raw);
      if (token && UNIPROT_PATTERN.test(token)) continue;
      needsRewrite = true;
      if (isUniprotEntryName(token)) namesToResolve.add(token);
    }
  }
  if (!needsRewrite) return consequence;

  const resolvedAccessions = new Map<string, string>();
  await Promise.all(
    [...namesToResolve].map(async (entryName) => {
      try {
        const accession = await resolveUniprotEntryNameToAccession(entryName, { signal });
        if (accession) {
          resolvedAccessions.set(entryName, accession);
        } else {
          console.warn(
            `[Coord Translator] Provider reported the UniProt entry name "${entryName}", which ` +
              "UniProt does not resolve to an accession; continuing without an accession."
          );
        }
      } catch (err: any) {
        // A lookup failure must never fail the resolution: the coordinate, gene and protein
        // substitution are already established and are what the analysis is about.
        console.warn(
          `[Coord Translator] Could not convert the UniProt entry name "${entryName}" to an ` +
            `accession (${err?.message ?? err}); continuing without an accession.`
        );
      }
    })
  );

  return {
    ...consequence,
    transcript_consequences: consequences.map((tc) => {
      if (!tc.swissprot) return tc;
      const rewritten: string[] = [];
      for (const raw of tc.swissprot) {
        const token = swissprotToken(raw);
        if (!token) continue;
        const accession = UNIPROT_PATTERN.test(token) ? token : resolvedAccessions.get(token);
        if (accession && !rewritten.includes(accession)) rewritten.push(accession);
      }
      return { ...tc, swissprot: rewritten };
    }),
  };
}

/**
 * Repairs the metadata an old annotation release omits: per-transcript isoform ids, and the
 * current gene symbol.
 *
 * WHY (production regression, `Chr1(GRCh37):g.1256452C>A`)
 * -------------------------------------------------------
 * Ensembl's GRCh37 archive predates VEP's `uniprot_isoform` field and the HGNC rename, so its
 * payload says `gene_symbol: "CPSF3L"` (now `INTS11`) and nothing about isoforms. Two failures
 * followed, and the second is the dangerous one:
 *
 *   1. the route selected the archive's own canonical transcript `ENST00000540437`, numbered on
 *      isoform `Q5TA45-5` (`p.Arg23Leu`), and — with no basis to check against — could only report
 *      `unverified`. The analysis models canonical `Q5TA45`, where position 23 is `S`, so the
 *      pipeline refused the variant with a wild-type mismatch, and would have modelled the WRONG
 *      residue silently had the wild-type letters coincided (the hazard `isoform-numbering.ts`
 *      exists to prevent);
 *   2. every gene-keyed lookup downstream received the RETIRED symbol `CPSF3L`.
 *
 * UniProt states both facts authoritatively (Ensembl cross-references carry `isoformId` per
 * transcript; `genes[].geneName` is the current symbol and `synonyms` the retired ones), so they are
 * READ, never inferred from the gene symbol or from a position. Annotating the payload in place is
 * what makes the EXISTING reconciliation machinery do the right thing: with the basis stated, the
 * sibling on canonical isoform `Q5TA45-1` becomes a canonically-numbered sibling, and the verdict
 * is `remapped` → `p.Arg17Leu` — proven, disclosed and cacheable, exactly as on GRCh38.
 *
 * SCOPE GATE: runs only for a payload that declares NO isoform metadata anywhere. Where the provider
 * did supply it (every current Ensembl release, and the GRCh38 host), its own answer is
 * authoritative and this function is a no-op that costs no network call.
 *
 * DEGRADATION: a UniProt failure leaves the payload untouched (today's `unverified` disclosure,
 * never a fabricated basis), and the response is still returned.
 */
export async function enrichFromUniprotReferenceData(
  consequence: ResolvedConsequence,
  signal?: AbortSignal
): Promise<ResolvedConsequence> {
  const consequences = consequence.transcript_consequences ?? [];
  if (consequences.length === 0) return consequence;
  if (consequences.some((tc) => normalizeIsoformIds(tc.uniprot_isoform).length > 0)) {
    return consequence;
  }

  const selected = selectProteinConsequence(consequences);
  const canonicalAccession = selected ? canonicalAccessionOf(selected) : undefined;
  if (!selected || !canonicalAccession) return consequence;

  let referenceData: UniprotEntryReferenceData;
  try {
    referenceData = await fetchUniprotEntryReferenceData(canonicalAccession, { signal });
  } catch (err: any) {
    console.warn(
      `[Coord Translator] Could not read UniProt reference data for ${canonicalAccession} ` +
        `(${err?.message ?? err}); the numbering basis stays unverified.`
    );
    return consequence;
  }

  const isoformByTranscript = new Map<string, string>();
  const isoformByProtein = new Map<string, string>();
  for (const ref of referenceData.isoforms) {
    isoformByTranscript.set(ref.transcriptId, ref.isoformId);
    if (ref.proteinId) isoformByProtein.set(ref.proteinId, ref.isoformId);
  }

  const reportedSymbol = selected.gene_symbol?.trim();
  const currentSymbol = referenceData.geneSymbol?.trim();
  /**
   * Rename only a symbol UniProt LISTS for this entry (as the primary name or a synonym): that is
   * proof the provider is naming the same gene with a retired/alternate symbol. An unlisted symbol
   * is left alone — it may not be this entry's gene at all, and rewriting it would attribute the
   * payload to the wrong gene.
   */
  const renameSymbol = Boolean(
    reportedSymbol &&
      currentSymbol &&
      reportedSymbol.toUpperCase() !== currentSymbol.toUpperCase() &&
      referenceData.geneSymbols.some(
        (listed) => listed.toUpperCase() === reportedSymbol.toUpperCase()
      )
  );

  let annotatedIsoforms = 0;
  let renamedSymbols = 0;
  const transcript_consequences = consequences.map((tc) => {
    let next = tc;

    const isoformId = isoformIdForConsequence(tc, isoformByTranscript, isoformByProtein);
    if (isoformId) {
      next = { ...next, uniprot_isoform: [isoformId] };
      annotatedIsoforms++;
    }

    if (
      renameSymbol &&
      next.gene_symbol &&
      next.gene_symbol.toUpperCase() === reportedSymbol!.toUpperCase()
    ) {
      next = { ...next, gene_symbol: currentSymbol };
      renamedSymbols++;
    }

    return next;
  });

  if (annotatedIsoforms === 0 && renamedSymbols === 0) return consequence;

  if (renamedSymbols > 0) {
    console.log(
      `[Coord Translator] Provider reported the retired gene symbol "${reportedSymbol}"; ` +
        `using UniProt's current symbol "${currentSymbol}" for ${canonicalAccession}.`
    );
  }

  return {
    ...consequence,
    transcript_consequences,
    ...(renamedSymbols > 0
      ? { geneSymbolUpdated: { from: reportedSymbol!, to: currentSymbol! } }
      : {}),
  };
}

/** `ENST00000540437.5` -> `ENST00000540437`. */
function versionlessIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim().split(".")[0]?.trim().toUpperCase();
  return id || undefined;
}

/**
 * UniProt's isoform assignment for one consequence, by transcript id first and protein id second.
 *
 * Both are versionless because the provider and UniProt version them independently
 * (`ENST00000540437.1` in the GRCh37 payload versus `ENST00000540437.5` in UniProt's cross-reference).
 */
function isoformIdForConsequence(
  tc: ResolvedTranscriptConsequence,
  isoformByTranscript: Map<string, string>,
  isoformByProtein: Map<string, string>
): string | undefined {
  const transcriptId = versionlessIdentifier(tc.transcript_id);
  if (transcriptId) {
    const byTranscript = isoformByTranscript.get(transcriptId);
    if (byTranscript) return byTranscript;
  }

  const proteinId =
    versionlessIdentifier(tc.numbering_protein_id) ??
    versionlessIdentifier(typeof tc.hgvsp === "string" ? tc.hgvsp.split(":")[0] : undefined);
  return proteinId ? isoformByProtein.get(proteinId) : undefined;
}

/**
 * Both repairs a provider payload can need, in the order they must run.
 *
 * `swissprot` is converted first because the accession is what identifies the UniProt entry the
 * isoform and gene-symbol reference data is read from.
 */
export async function normalizeProviderConsequence(
  consequence: ResolvedConsequence,
  signal?: AbortSignal
): Promise<ResolvedConsequence> {
  const withAccessions = await normalizeSwissprotAccessions(consequence, signal);
  return enrichFromUniprotReferenceData(withAccessions, signal);
}

/** MANE Select, else Ensembl canonical, else any consequence that reports a protein change. */
export function selectProteinConsequence(
  consequences: ResolvedTranscriptConsequence[]
): ProteinAlteringConsequence | undefined {
  const mane = consequences.find(
    (t): t is ProteinAlteringConsequence => Boolean(t.mane_select && t.hgvsp)
  );
  const canonical = consequences.find(
    (t): t is ProteinAlteringConsequence =>
      Boolean((t.canonical === 1 || t.canonical === true || t.canonical === "1") && t.hgvsp)
  );
  const anyProtein = consequences.find(
    (t): t is ProteinAlteringConsequence => Boolean(t.hgvsp)
  );
  return mane ?? canonical ?? anyProtein;
}

/** Most informative consequence for explaining why no protein change exists. */
export function pickInformativeConsequence(
  consequences: ResolvedTranscriptConsequence[]
): ResolvedTranscriptConsequence | undefined {
  return (
    consequences.find((t) => t.mane_select) ??
    consequences.find((t) => t.canonical === 1 || t.canonical === true || t.canonical === "1") ??
    consequences[0]
  );
}

export interface ProteinTarget {
  proteinChangeFound: boolean;
  numbering?: NumberingVerdict;
}

/**
 * Turns a provider's consequence list into the reconciled protein target.
 *
 * Pure, so it can be re-run on a cached payload: entries written by earlier versions
 * (including protein-free ones) are interpreted correctly instead of being trusted
 * field-by-field, and the cache payload itself stays slim.
 */
export function resolveProteinTarget(
  consequences: ResolvedTranscriptConsequence[]
): ProteinTarget {
  const selected = selectProteinConsequence(consequences);
  if (!selected) return { proteinChangeFound: false };

  const canonicalAccession = canonicalAccessionOf(selected);
  return {
    proteinChangeFound: true,
    numbering: reconcileIsoformNumbering(selected, consequences, canonicalAccession),
  };
}

/**
 * Queries Ensembl VEP for a coordinate notation.
 * Throws {@link CoordinateResolutionError} on transport failure or unusable payload.
 */
export async function fetchEnsemblVepConsequence(
  notation: string,
  assembly: GenomeAssembly,
  signal?: AbortSignal,
  options?: ResolutionProviderOptions
): Promise<{ consequence: ResolvedConsequence; attempt: ProviderAttempt }> {
  const startedAt = Date.now();
  const url =
    `${ENSEMBL_HOSTS[assembly]}/vep/human/hgvs/${encodeURIComponent(notation)}` +
    `?content-type=application/json&hgvs=1&canonical=1&uniprot=1&mane=1`;

  const attempt = (
    ok: boolean,
    reason?: string,
    failureKind?: ProviderAttempt["failureKind"]
  ): ProviderAttempt => ({
    provider: "ensembl-vep",
    ok,
    durationMs: Math.max(1, Date.now() - startedAt),
    reason,
    failureKind,
  });

  let response: Response;
  try {
    response = await fetchWithRetry(url, {
      headers: { Accept: "application/json" },
      timeout: options?.timeoutMs ?? ENSEMBL_VEP_TIMEOUT_MS,
      signal,
      ...(options?.cappedByCaller ? { cappedByCaller: true } : {}),
      ...(options?.deadlineAt ? { deadlineAt: options.deadlineAt } : {}),
    });
  } catch (err: any) {
    // A caller-initiated abort must propagate untouched so the HTTP layer can answer 504.
    if (signal?.aborted) throw err;
    /**
     * Classify by the STATUS the transport attached, not only by the message.
     *
     * A refusal (429, or a fast 500) is deliberately NOT retried by the transport, so it arrives here
     * as a thrown error carrying `statusCode` — and calling that "unreachable" is what produced a
     * production message telling the user every provider was down while VariantValidator was
     * answering 429 (rate-limiting us) and Ensembl 500-for-everything.
     */
    // A call the server itself held back (fair-share wait, team-wide 429 pause; WP-I) is about OUR
    // request rate too, never an outage: it was not even sent.
    const kind: ProviderAttempt["failureKind"] =
      err?.statusCode === 429 || isEgressRefusal(err) ? "rate_limited" : "upstream_unavailable";
    throw new CoordinateResolutionError(kind, `Ensembl VEP: ${err?.message || "network error"}`, [
      attempt(false, err?.message || "network error", kind),
    ]);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    /**
     * A refusal that names the reference is about the COORDINATE, not about the provider's health.
     *
     * Classified before the status is consulted (except for a rate limit, which is a statement about
     * our request rate and outranks everything): the status only tells us the request was refused,
     * while the body says why, and "reference allele does not match" is the build-mismatch signature
     * this taxonomy previously buried under `invalid_response`.
     */
    const failureKind: ProviderAttempt["failureKind"] =
      response.status === 429
        ? "rate_limited"
        : isReferenceMismatchMessage(text)
          ? "reference_mismatch"
          : response.status >= 500
            ? "upstream_unavailable"
            : "invalid_response";
    throw new CoordinateResolutionError(
      failureKind,
      `Ensembl VEP API returned status ${response.status}: ${text.slice(0, 300)}`,
      [attempt(false, `status ${response.status}`, failureKind)]
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (err: any) {
    // A body read killed by our own deadline or window is a timeout, not a malformed payload.
    if (signal?.aborted) throw err;
    throw new CoordinateResolutionError("invalid_response", "Ensembl VEP returned malformed JSON.", [
      attempt(false, "malformed JSON", "invalid_response"),
    ]);
  }

  /**
   * A 200 carrying an `error` body is still a refusal, and a reference mismatch in that shape means
   * the same thing as the 4xx form. Checked before the schema: otherwise the schema reports the
   * envelope as an unusable payload and the build remedy never reaches the caller.
   */
  if (isReferenceMismatchMessage((raw as any)?.error)) {
    throw new CoordinateResolutionError(
      "reference_mismatch",
      `Ensembl VEP refused the coordinate: ${String((raw as any).error).slice(0, 300)}`,
      [attempt(false, "reference allele mismatch", "reference_mismatch")]
    );
  }

  const parsed = ensemblResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CoordinateResolutionError(
      "invalid_response",
      "Ensembl VEP API returned an invalid response structure.",
      [attempt(false, "invalid response structure", "invalid_response")]
    );
  }

  const data = parsed.data;
  if (data.length === 0 || !data[0].transcript_consequences) {
    throw new CoordinateResolutionError(
      "not_found",
      "No transcript consequences found for the provided variant.",
      [attempt(false, "no transcript consequences", "not_found")]
    );
  }

  const rawStrand = data[0].strand;
  const parsedStrand =
    typeof rawStrand === "number"
      ? rawStrand
      : typeof rawStrand === "string"
      ? parseInt(rawStrand, 10)
      : undefined;

  return {
    consequence: {
      provider: "ensembl-vep",
      seq_region_name: data[0].seq_region_name,
      start: data[0].start,
      allele_string: data[0].allele_string,
      strand: Number.isFinite(parsedStrand as number) ? (parsedStrand as number) : undefined,
      transcript_consequences:
        data[0].transcript_consequences as ResolvedConsequence["transcript_consequences"],
    },
    attempt: attempt(true),
  };
}

// ---------------------------------------------------------------------------
// Tier 0 — immutable persistent cache
// ---------------------------------------------------------------------------

/** Slim cache payload: only what is needed to rebuild a {@link ResolutionOutcome}. */
interface CachedResolution {
  consequence: ResolvedConsequence;
  assembly: GenomeAssembly;
  resolvedBy: TranslationProvider;
  /**
   * Whether the cached answer came from the fallback provider.
   *
   * Without this, `usedFallback` was recomputed as `!cacheHit && ...`, so once a
   * degraded fallback answer (typically missing transcript_id / UniProt) was cached
   * — for ~10 years — every subsequent read reported it as a first-choice answer and
   * the client had no way to tell it came from an outage.
   *
   * Optional so entries written by earlier versions still parse.
   */
  usedFallback?: boolean;
}

/**
 * L1 memory cache for resolved coordinates.
 *
 * Registered with the central cache registry so it appears in memory telemetry AND is
 * flushed by `clearAllCaches()` (which the test suite relies on for isolation).
 * The mapping is immutable reference data, so a very long TTL is used purely to keep LRU
 * memory bounded rather than to expire stale data.
 */
const coordinateTranslationCache = new LRUCache<string, CachedResolution>({
  max: 5000,
  ttl: 1000 * 60 * 60 * 24 * 365,
});
defaultCacheRegistry.registerCache("coordinateTranslationCache", coordinateTranslationCache, {
  ttlDesc: "365d (immutable)",
});

/** ~10 years in seconds — coordinate -> protein mappings are immutable reference data. */
const COORDINATE_TRANSLATION_TTL_SECONDS = 315_360_000;

/**
 * Whether a resolved payload may be stored as settled truth.
 *
 * EXCLUDES two shapes that must stay re-resolvable:
 *   - payloads with no protein change at all (another provider's annotation release may number
 *     the coordinate tomorrow), and
 *   - payloads whose numbering could not be verified against the canonical isoform — caching
 *     one pinned the ACOT9 mis-numbering for ten years, so it kept being served even after the
 *     primary provider (the one carrying the isoform metadata) had recovered.
 */
function isCacheable(outcome: { consequence: ResolvedConsequence }): boolean {
  if (!outcome?.consequence?.transcript_consequences?.length) return false;
  const target = resolveProteinTarget(outcome.consequence.transcript_consequences);
  if (!target.proteinChangeFound) return false;
  return target.numbering?.status === "canonical" || target.numbering?.status === "remapped";
}

/**
 * Total wall-clock budget for the whole provider ladder.
 *
 * A ladder of N providers must be able to give EACH rung one full attempt at its own
 * configured tolerance, or a rung is killed by arithmetic rather than by the provider being
 * slow. The previous 25s budget could not fit two 15s providers, and giving the primary the
 * whole budget starved the fallback entirely (see the window logic in {@link resolveCoordinate}).
 *
 * Raised to 40s after measuring Ensembl VEP under load: it answered in 7s, 13.5s, 20s, 29s and 34s in
 * successive samples, so a budget that left the primary 17s (32s minus the fallback's reserve) failed
 * requests that a larger window answers. 40s = the primary's 25s tolerance plus the fallback's 15s
 * reserve, and the window logic hands the whole budget to the primary whenever the fallback's breaker
 * is open. It stays inside the client's 60s budget for this call (`src/api/structureApi.ts`), so a
 * genuine outage still produces this route's honest 503 rather than a client-side abort.
 */
export const DEFAULT_RESOLUTION_BUDGET_MS = 40_000;

/** Ordered provider chain: primary first, then independent fallbacks. */
const PROVIDER_CHAIN: Array<{
  provider: TranslationProvider;
  /** This provider's configured per-attempt tolerance (before the ladder caps it). */
  timeoutMs: number;
  /** Host used to ask the breaker whether this rung can answer at all. */
  host: string;
  resolve: (
    notation: string,
    assembly: GenomeAssembly,
    signal?: AbortSignal,
    options?: ResolutionProviderOptions
  ) => Promise<{ consequence: ResolvedConsequence; attempt: ProviderAttempt }>;
}> = [
  {
    provider: "ensembl-vep",
    timeoutMs: ENSEMBL_VEP_TIMEOUT_MS,
    host: "https://rest.ensembl.org",
    resolve: fetchEnsemblVepConsequence,
  },
  {
    provider: "variant-validator",
    timeoutMs: 15_000,
    host: "https://rest.variantvalidator.org",
    resolve: fetchVariantValidatorConsequence,
  },
];

/**
 * Window for the current rung: every LATER rung that can actually answer keeps its tolerance
 * reserved, and the current one may borrow the rest (never less than an even share).
 *
 * Exported because the arithmetic IS the behaviour here: an even split looks fair, but it starved the
 * only working provider in production (see the comment at the call site).
 */
export function computeRungWindowMs(params: {
  remainingMs: number;
  providersLeft: number;
  reservedForLaterRungs: number;
}): number {
  const { remainingMs, providersLeft, reservedForLaterRungs } = params;
  return Math.max(
    Math.floor(remainingMs / providersLeft),
    remainingMs - reservedForLaterRungs
  );
}

/**
 * Collapses per-provider failures into a single machine-readable cause.
 *
 * Order matters, and the two top ranks are deliberate. A REFERENCE MISMATCH outranks a rate limit:
 * it is a statement about the REQUEST (the coordinate's alleles are not the reference's), it is what
 * tells the reader what to change, and every rung would answer the same way once we were allowed to
 * ask again — so reporting "wait a minute" first costs a round trip to learn a fact we already have.
 * A rate limit still outranks an outage: it is about OUR request rate, and calling it unreachable
 * sends the reader hunting for a provider problem while the remedy is to slow down. `invalid_response`
 * is checked BEFORE `not_found`: when one provider answers "nothing here" and another returns an
 * unusable payload, "no transcript consequence was found in any provider" is untrue.
 */
function classifyTotalFailure(attempts: ProviderAttempt[]): ResolutionFailureKind {
  const kinds = attempts.map((a) => a.failureKind).filter(Boolean) as ResolutionFailureKind[];
  if (kinds.includes("reference_mismatch")) return "reference_mismatch";
  if (kinds.includes("rate_limited")) return "rate_limited";
  if (kinds.length > 0 && kinds.every((k) => k === "upstream_unavailable")) {
    return "upstream_unavailable";
  }
  if (kinds.includes("invalid_response")) return "invalid_response";
  if (kinds.includes("not_found")) return "not_found";
  return "upstream_unavailable";
}

/**
 * User-facing explanation for a total resolution failure. Names the cause and tells the
 * clinician exactly what to do next, because the rest of the pipeline works from
 * protein-level notation alone.
 *
 * DELIBERATELY FREE OF INTERNAL DETAIL: raw provider reasons are NOT embedded here. Two
 * reasons: (a) `sendError` sanitizes every status >= 500 message, and a reason such as
 * "fetch failed" would trip that rewriter and silently replace this guidance with a generic
 * string; (b) provider jargon is noise for a clinician. The machine-readable trail is
 * returned in the response `details.attempts` instead.
 */
export function buildResolutionUnavailableMessage(
  kind: ResolutionFailureKind,
  attempts: ProviderAttempt[] = []
): string {
  if (kind === "not_found") {
    return (
      "No transcript consequence was found for this coordinate in any reference provider. " +
      "Verify the chromosome, position, alleles and genome build — or the coordinate may lie " +
      "outside the coding sequence of any transcript, in which case no protein variant (HGVSp) " +
      "exists and a missense analysis is not possible."
    );
  }
  if (kind === "reference_mismatch") {
    /**
     * The one failure whose remedy is a DIFFERENT COORDINATE, not another attempt.
     *
     * Written to be actionable without the `buildHint` field (an agent reading only the message still
     * learns what to change), and worded so that both causes are named: the coordinate may be stated
     * in another build, or its alleles may be mistyped. No provider name appears — which provider
     * refused is `details.attempts`.
     */
    return (
      "The reference allele does not match the reference sequence at that position on the genome " +
      "build the coordinate was read against, so no transcript consequence can be derived. The usual " +
      "cause is a genome-build mismatch: the same locus has a different reference base in GRCh37 and " +
      "GRCh38, so a coordinate from the other build looks exactly like this. State the build — for " +
      'example "Chr1(GRCh37):g.1256452C>A" — and it will be verified on the canonical build first, ' +
      "then annotated on whichever build it could be verified against. Check the REF/ALT alleles and " +
      "the position too: a mistyped allele reads the same way."
    );
  }
  if (kind === "invalid_response") {
    /**
     * Names the wrong-build case, because it is the common cause of an unusable answer and the
     * remedies are opposite: a degraded provider is fixed by retrying, whereas a coordinate whose
     * alleles do not match the reference sequence is fixed by stating its build. Ensembl answers a
     * build mismatch with a 4xx "reference allele … does not match", which this taxonomy reports
     * here — so without this sentence a user who pasted an hg19 coordinate was told to wait a
     * minute and try again, forever.
     */
    return (
      "Coordinate translation providers returned unusable responses (they are degraded right now). " +
      "A coordinate whose alleles do not match the reference sequence for the stated genome build " +
      "also reads this way: if the coordinate came from another build, annotate it — for example " +
      '"Chr1(GRCh37):g.1256452C>A" — and it will be verified on the canonical build first, then ' +
      "annotated on whichever build it could be verified against. " +
      "Otherwise retry in a minute, or enter the protein-level substitution directly (for example " +
      "p.Glu433Lys) to run the analysis without coordinate translation."
    );
  }
  if (kind === "rate_limited") {
    return (
      "The reference services are rate-limiting this deployment right now, or the server is pacing " +
      "the team's calls to them, so coordinate translation is paused rather than retried immediately. " +
      "Wait a minute and try again, or enter " +
      "the protein-level substitution directly (for example p.Glu433Lys) to run the analysis without " +
      "coordinate translation."
    );
  }
  /**
   * Distinguish "too slow to answer" from "unreachable".
   *
   * Measured in production: Ensembl VEP was REACHABLE and serving, but taking 20-34s per query, so
   * every rung exhausted its window. The old wording told the user (and the operator reading the
   * developer console) that all providers were unreachable, which points at the wrong problem and at
   * the wrong remedy — a slow service recovers by retrying, an unreachable one does not.
   *
   * Classified by INVERSION: only a reason that looks like a transport failure counts as
   * unreachability, and everything else (windows, budgets, deadlines, timeouts, unusable answers) is
   * reported as slowness. The first version looked for slowness keywords, so a new reason string that
   * merely mentioned the caller's deadline silently fell back to accusing the provider of being down —
   * the failure mode this message exists to prevent.
   */
  const transportFailure =
    /fetch failed|enotfound|econnrefused|econnreset|ehostunreach|enetunreach|network|dns|getaddrinfo|socket|tls|ssl|certificate/i;
  const unreachableOnly =
    attempts.length > 0 && attempts.every((attempt) => transportFailure.test(String(attempt.reason ?? "")));

  /**
   * Every rung skipped by our own circuit breaker.
   *
   * This is the state a user reaches after a provider has refused us repeatedly, and it is neither an
   * outage nor mere slowness: we are deliberately not asking. Saying so is what stops an operator from
   * hunting for a provider problem while the actual remedy is to wait out the cooldown.
   */
  const breakerOnly =
    attempts.length > 0 &&
    attempts.every((attempt) => /circuit breaker/i.test(String(attempt.reason ?? "")));
  if (breakerOnly) {
    return (
      "Coordinate translation is paused: the reference providers refused recent requests, so this " +
      "deployment is backing off for their cooldown. Wait a minute and try again, or enter the " +
      "protein-level substitution directly (for example p.Glu433Lys) to run the analysis without " +
      "coordinate translation."
    );
  }  if (!unreachableOnly) {
    return (
      "Coordinate translation is temporarily unavailable: the reference providers did not answer " +
      "within the time allowed (they are responding too slowly right now, not necessarily down). " +
      "Retry in a minute, or enter the protein-level substitution directly (for example " +
      "p.Glu433Lys) to run the analysis without coordinate translation."
    );
  }
  return (
    "Coordinate translation is temporarily unavailable because the reference providers could not be " +
    "reached. Retry in a minute, or enter the protein-level substitution directly (for example " +
    "p.Glu433Lys) to run the analysis without coordinate translation."
  );
}

/** Rebuilds the outcome fields that are DERIVED (not stored) from a resolved payload. */
function buildOutcome(
  consequence: ResolvedConsequence,
  base: Omit<ResolutionOutcome, "consequence" | "proteinChangeFound" | "numbering">
): ResolutionOutcome {
  const target = resolveProteinTarget(consequence.transcript_consequences ?? []);
  return {
    ...base,
    consequence,
    proteinChangeFound: target.proteinChangeFound,
    ...(target.numbering ? { numbering: target.numbering } : {}),
  };
}

/**
 * Resolves a genomic/cDNA coordinate notation to a protein-level consequence.
 *
 * Tier 0 (immutable cache) -> Tier 1 (Ensembl VEP) -> Tier 2 (VariantValidator).
 * Throws {@link CoordinateResolutionError} on total failure so the HTTP layer can answer
 * 503 / 404 / 502 honestly instead of a blanket 500.
 */
export async function resolveCoordinate(
  notation: string,
  assembly: GenomeAssembly,
  signal?: AbortSignal,
  options?: { budgetMs?: number }
): Promise<ResolutionOutcome> {
  const key = buildCoordinateTranslationKey(assembly, notation);
  const budgetMs = options?.budgetMs ?? DEFAULT_RESOLUTION_BUDGET_MS;

  // Enforce a single wall-clock deadline across every provider.
  //
  // ONE clock for both the deadline and the per-provider windows: the windows are computed from
  // `ladderStartedAt`, so measuring them from a later instant (after the L2 read) made them
  // overstate the budget and let the hard deadline cut a provider mid-answer.
  const deadline = new AbortController();
  const ladderStartedAt = Date.now();
  const timer = setTimeout(
    () => deadline.abort(new Error(`Coordinate resolution exceeded its ${budgetMs}ms budget`)),
    budgetMs
  );
  const ladderSignal = signal ? anySignal([signal, deadline.signal]) : deadline.signal;

  // Precise cache-hit detection: `singleFlight` guarantees the fetcher runs at most once,
  // so a flag flipped inside it reliably distinguishes a fresh fetch from an L2 hit.
  let fetchedFresh = false;
  // Cached payloads are deliberately slim, so the live attempt trail is captured here.
  let lastAttempts: ProviderAttempt[] = [];

  try {
    const cached = await getCachedOrFetch<CachedResolution>({
      key,
      source: "coordinate_translation",
      l1Cache: coordinateTranslationCache,
      ttlSeconds: COORDINATE_TRANSLATION_TTL_SECONDS,
      // Never persist failures, protein-free answers, or unverified numbering.
      shouldCache: isCacheable,
      // …and never SERVE one either. Translations are cached for ~10 years, so a payload written
      // before numbering was verified (or one written by another deployment) would otherwise keep
      // being returned un-reconciled even though a metadata-carrying provider is reachable again.
      isUsable: (cached) => isCacheable(cached),
      fetcher: async () => {
        fetchedFresh = true;
        const attempts: ProviderAttempt[] = [];
        // Kept so a fully protein-free outcome can still explain itself.
        let informative: ResolvedConsequence | null = null;
        let informativeProvider: TranslationProvider | null = null;

        for (let i = 0; i < PROVIDER_CHAIN.length; i++) {
          const { provider, timeoutMs, resolve } = PROVIDER_CHAIN[i];
          // A caller-initiated abort propagates untouched so the HTTP layer can answer 504.
          if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
          if (deadline.signal.aborted) {
            // The budget ran out before this rung was tried. Recorded rather than silently
            // dropped: without it the trail was empty and `classifyTotalFailure` reported an
            // outage that named no provider and no attempt.
            attempts.push({
              provider,
              ok: false,
              durationMs: 0,
              reason: `resolution budget of ${budgetMs}ms exhausted before this provider was tried`,
              failureKind: "upstream_unavailable",
            });
            break;
          }

          // ── Share of the remaining budget ───────────────────────────────────────────
          // Handing the primary the WHOLE budget let a slow Ensembl VEP (whose own retry
          // envelope is several attempts long) consume all of it, so the loop broke before
          // VariantValidator — the tier that exists for a degraded primary — was ever called,
          // and the clinician was told "all reference providers are unreachable" for a
          // primary-only problem.
          //
          // Each later rung now has its own tolerance RESERVED, and the current one may borrow
          // everything else. An even split looks fair but is not: VEP needs ~7s per attempt, and a
          // single transient 500 — which it returns routinely under load — costs a retry, so an even
          // 16s window aborted the one provider that was in fact answering and reported it as
          // unreachable. Reserving the fallback's 15s leaves the primary 17s: one attempt plus one
          // retry. When the primary answers or fails fast, nothing is consumed and the fallback
          // inherits nearly the whole budget, as before.
          const providersLeft = PROVIDER_CHAIN.length - i;
          const remainingMs = budgetMs - (Date.now() - ladderStartedAt);
          /**
           * Reserve only for later rungs that CAN answer.
           *
           * Holding budget for a tier whose breaker is open reserves time for a request that fails
           * instantly — measured in production: VariantValidator was down while 15s of every 32s
           * budget was held for it, leaving Ensembl VEP (answering in 13-34s) too little time to
           * succeed. A dead tier gets no reservation; a healthy one keeps its tolerance.
           */
          const reservedForLaterRungs = PROVIDER_CHAIN.slice(i + 1)
            .filter((rung) => isHostAvailable(rung.host))
            .reduce((total, rung) => total + rung.timeoutMs, 0);
          const windowMs = computeRungWindowMs({ remainingMs, providersLeft, reservedForLaterRungs });

          // A provider is skipped only when no positive window is left at all: while any budget
          // remains, every rung gets a chance to answer rather than being written off.
          if (windowMs <= 0) {
            attempts.push({
              provider,
              ok: false,
              durationMs: 0,
              reason: `skipped: only ${Math.max(0, remainingMs)}ms of the ${budgetMs}ms budget remained`,
              failureKind: "upstream_unavailable",
            });
            continue;
          }

          const windowController = new AbortController();
          const windowTimer = setTimeout(
            () =>
              windowController.abort(
                new Error(
                  `${provider} exceeded its ${windowMs}ms share of the ${budgetMs}ms resolution budget`
                )
              ),
            windowMs
          );
          const providerSignal = anySignal([ladderSignal, windowController.signal]);

          const providerStartedAt = Date.now();
          try {
            // The provider's own attempt timeout is CAPPED by the window, so its tolerance can
            // never exceed the time the ladder actually granted it: the provider reports a
            // clean timeout instead of being killed by our timer and then called "unreachable".
            //
            // `cappedByCaller` records WHEN that cap bound, so a timeout we imposed cannot be
            // booked against the provider's health: five capped attempts used to open the shared
            // per-host breaker for ~60s and push every later request onto the fallback tier.
            const effectiveTimeoutMs = Math.min(timeoutMs, windowMs);
            const { consequence, attempt } = await resolve(notation, assembly, providerSignal, {
              timeoutMs: effectiveTimeoutMs,
              cappedByCaller: effectiveTimeoutMs < timeoutMs,
              // The window is a DEADLINE, not just an abort: with it, the transport stops starting
              // retries that cannot finish and sizes each attempt to the time actually left, instead
              // of being killed mid-retry and reported as unreachable.
              deadlineAt: providerStartedAt + windowMs,
            });
            clearTimeout(windowTimer);

            // Provider payloads are normalised before anything is derived from them: the numbering
            // verdict (and with it the cache decision and the route's accession validation) compares
            // against `swissprot`/`uniprot_isoform`, and Ensembl's GRCh37 archive reports an entry
            // NAME there and omits the isoform field entirely. See normalizeProviderConsequence.
            const normalizedConsequence = await normalizeProviderConsequence(
              consequence,
              providerSignal
            );

            const target = resolveProteinTarget(normalizedConsequence.transcript_consequences ?? []);
            if (!target.proteinChangeFound) {
              // A provider that maps the coordinate only to non-coding consequences has not
              // answered this platform's question. Record the miss, keep the payload for the
              // explanation, and let the next rung try — its annotation release may differ.
              attempts.push({
                ...attempt,
                ok: false,
                reason: "no protein-altering consequence reported",
                failureKind: "not_found",
              });
              if (!informative) {
                informative = normalizedConsequence;
                informativeProvider = provider;
              }
              continue;
            }

            lastAttempts = [...attempts, attempt];
            // Persist fallback provenance with the payload so a later cache read does
            // not silently upgrade a degraded answer to a first-choice one.
            return {
              consequence: normalizedConsequence,
              assembly,
              resolvedBy: normalizedConsequence.provider,
              usedFallback: normalizedConsequence.provider !== PROVIDER_CHAIN[0].provider,
            };
          } catch (err: any) {
            clearTimeout(windowTimer);
            if (signal?.aborted) throw err;

            if (err instanceof CoordinateResolutionError) {
              attempts.push(...err.attempts);
              continue;
            }

            // Non-namespaced error: either this provider's window expired, the ladder's
            // deadline fired, or the provider threw something unexpected. Only the deadline
            // ends the ladder — an expired window moves on to the next rung with the budget
            // that is left, which is what keeps a slow primary from starving the fallback.
            attempts.push({
              provider,
              ok: false,
              durationMs: Math.max(1, Date.now() - providerStartedAt),
              reason: deadline.signal.aborted
                ? `resolution budget of ${budgetMs}ms exceeded`
                : windowController.signal.aborted
                  ? `${provider} did not answer within its ${windowMs}ms share of the resolution budget`
                  : err?.message || "unexpected provider error",
              failureKind: "upstream_unavailable",
            });

            if (deadline.signal.aborted) break;
            continue;
          }
        }

        // Every rung was asked and none reported a protein change. Return the payload anyway —
        // the caller can then explain what the coordinate actually is (422 carrying the gene,
        // consequence terms and HGVSc) instead of a bare "not found".
        if (informative) {
          lastAttempts = attempts;
          const provider = informativeProvider ?? PROVIDER_CHAIN[0].provider;
          return {
            consequence: informative,
            assembly,
            resolvedBy: provider,
            usedFallback: provider !== PROVIDER_CHAIN[0].provider,
          };
        }

        const kind = classifyTotalFailure(attempts);
        throw new CoordinateResolutionError(kind, buildResolutionUnavailableMessage(kind, attempts), attempts);
      },
    });

    const cacheHit = !fetchedFresh;
    const attempts: ProviderAttempt[] = cacheHit
      ? [{ provider: cached.resolvedBy, ok: true, durationMs: 0, reason: "cache_hit" }]
      : lastAttempts;

    /**
     * Normalize on READ as well as on fetch.
     *
     * The repair above runs inside the fetcher, so a cache HIT returned the stored payload verbatim —
     * and a coordinate translation is cached for ~10 years under a schema version that had not
     * changed. An entry written before the repair existed (or by another deployment) would therefore
     * still deliver `swissprot: ["INT11_HUMAN"]`, which the route passes to `validateUniProt` and
     * 422s a coordinate that resolves. Re-normalizing here is free on a repaired payload: both
     * normalizers return immediately when there is nothing to rewrite, and the enrichment is skipped
     * outright when the payload already declares its isoforms.
     */
    const served = cacheHit
      ? await normalizeProviderConsequence(cached.consequence)
      : cached.consequence;

    return buildOutcome(served, {
      assembly: cached.assembly,
      attempts,
      // Prefer the provenance stored with the payload; fall back to deriving it for
      // entries written before `usedFallback` was persisted.
      usedFallback:
        cached.usedFallback ??
        (!cacheHit && cached.resolvedBy !== PROVIDER_CHAIN[0].provider),
      cacheHit,
    });
  } finally {
    clearTimeout(timer);
  }
}
