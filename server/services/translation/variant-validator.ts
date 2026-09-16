/**
 * variant-validator.ts — Independent coordinate-resolution provider.
 *
 * WHY IT EXISTS
 * -------------
 * `rest.ensembl.org` is a single point of failure for every genomic/cDNA query: when VEP
 * is down the whole coordinate pipeline is down. VariantValidator computes the same
 * genomic -> transcript -> protein mapping from reference sequences on separate
 * infrastructure, so it survives an Ensembl outage. Verified live to resolve novel
 * variants (e.g. NC_000001.11:g.25484258G>A -> MACO1 p.Glu433Lys, MANE Select).
 *
 * TRAPS / HARD-WON DETAILS (do not "simplify" these away)
 * -----------------------------------------------------
 *  1. ONLY the lowercase `mane` select_transcripts value works. `/MANE`, `/ensembl` and
 *     `/all` do NOT error — they silently return `flag: "intergenic"` with no gene. A naive
 *     mapper would report that as a legitimate "no consequence" answer, which would be a
 *     false negative in a clinical tool. {@link isUsablePayload} guards this.
 *  2. The response is keyed by the transcript notation itself
 *     (`{ "NM_018202.6:c.1297G>A": {...} }`), which varies per query, so the payload key
 *     must be discovered dynamically.
 *  3. The protein change lives in `hgvs_predicted_protein_consequence` wrapped in
 *     parentheses (`NP_060672.2:p.(Glu433Lys)`). Downstream `validateVariant` already
 *     strips parentheses, so it is passed through verbatim.
 *  4. VariantValidator returns NO UniProt accession and NO Ensembl transcript ID. The route
 *     already tolerates an empty `uniprotId` (the client resolves gene -> UniProt in its
 *     "Stage 1.5"), so this degrades gracefully instead of needing extra plumbing.
 */

import { z } from "zod";
import { fetchWithRetry } from "../infra/http-client.ts";
import type { GenomeAssembly } from "../../../src/shared/variantNotation.ts";
import { CoordinateResolutionError, type ProviderAttempt, type ResolvedConsequence } from "./types.ts";

const VARIANT_VALIDATOR_BASE =
  "https://rest.variantvalidator.org/VariantValidator/variantvalidator";

/** The only `select_transcripts` value that resolves correctly. See trap (1) above. */
const VARIANT_VALIDATOR_SELECT_TRANSCRIPTS = "mane";

/** Response flags that mean "nothing was resolved" rather than "no protein consequence". */
const NON_RESOLVING_FLAGS = new Set(["intergenic", "no_variant", "intergenic_variant", "failed"]);

const locusSchema = z
  .object({
    hgvs_genomic_description: z.string().optional(),
    vcf: z
      .object({
        alt: z.string().optional(),
        chr: z.string().optional(),
        pos: z.union([z.string(), z.number()]).optional(),
        ref: z.string().optional(),
      })
      .partial()
      .optional(),
  })
  .partial();

const payloadSchema = z
  .object({
    flag: z.string().optional(),
    gene_symbol: z.string().optional(),
    hgvs_transcript_variant: z.string().optional(),
    hgvs_predicted_protein_consequence: z
      .object({
        slr: z.string().optional(),
        tlr: z.string().optional(),
        lrg_slr: z.string().optional(),
        lrg_tlr: z.string().optional(),
      })
      .partial()
      .optional(),
    annotations: z
      .object({
        chromosome: z.string().optional(),
        mane_select: z.union([z.boolean(), z.string()]).optional(),
        mane_plus_clinical: z.union([z.boolean(), z.string()]).optional(),
        ensembl_select: z.union([z.boolean(), z.string()]).optional(),
      })
      .partial()
      .optional(),
    primary_assembly_loci: z.record(z.string(), locusSchema).optional(),
  })
  .passthrough();

export type VariantValidatorPayload = z.infer<typeof payloadSchema>;

/**
 * True only when VariantValidator genuinely resolved the variant.
 *
 * Returns false for the silent-failure shapes (`flag: "intergenic"`, empty `gene_symbol`,
 * no protein consequence) which callers MUST treat as "provider did not answer" rather
 * than as "no protein consequence exists".
 */
export function isUsablePayload(payload: VariantValidatorPayload | undefined): boolean {
  if (!payload) return false;
  if (payload.flag && NON_RESOLVING_FLAGS.has(payload.flag)) return false;
  if (!payload.gene_symbol) return false;
  const protein = payload.hgvs_predicted_protein_consequence;
  return Boolean(protein?.tlr || protein?.slr);
}

/** Strips a protein accession prefix: "NP_060672.2:p.(Glu433Lys)" -> "p.(Glu433Lys)". */
export function extractProteinChange(
  consequence: VariantValidatorPayload["hgvs_predicted_protein_consequence"]
): string | undefined {
  const raw = consequence?.tlr || consequence?.slr;
  if (!raw) return undefined;
  const colon = raw.indexOf(":");
  const protein = (colon >= 0 ? raw.slice(colon + 1) : raw).trim();
  return protein || undefined;
}

/** Finds the transcript-keyed payload inside a VariantValidator response envelope. */
export function extractPayload(
  body: unknown
): { payloadKey: string; payload: VariantValidatorPayload } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const payloadKey = Object.keys(record).find(
    (key) => key.includes(":") && record[key] && typeof record[key] === "object"
  );
  if (!payloadKey) return null;
  const parsed = payloadSchema.safeParse(record[payloadKey]);
  if (!parsed.success) return null;
  return { payloadKey, payload: parsed.data };
}

/**
 * Maps a VariantValidator response into the provider-neutral consequence shape.
 * Returns null when the payload is unusable (see {@link isUsablePayload}).
 */
export function mapVariantValidatorResponse(
  body: unknown,
  assembly: GenomeAssembly
): ResolvedConsequence | null {
  const extracted = extractPayload(body);
  if (!extracted) return null;
  const { payloadKey, payload } = extracted;
  if (!isUsablePayload(payload)) return null;

  const hgvsp = extractProteinChange(payload.hgvs_predicted_protein_consequence);
  if (!hgvsp) return null;

  const annotations = payload.annotations ?? {};
  const locus = payload.primary_assembly_loci?.[assembly.toLowerCase()]?.vcf;
  const start = locus?.pos === undefined ? undefined : Number(locus.pos);

  return {
    provider: "variant-validator",
    seq_region_name: annotations.chromosome ?? locus?.chr,
    start: Number.isFinite(start as number) ? (start as number) : undefined,
    allele_string: locus?.ref && locus?.alt ? `${locus.ref}/${locus.alt}` : undefined,
    transcript_consequences: [
      {
        transcript_id: payloadKey.split(":")[0] || undefined,
        // VariantValidator's "ensembl_select" is the closest analogue of VEP's `canonical`.
        canonical: annotations.ensembl_select ? 1 : undefined,
        // Truthy when VariantValidator reports MANE Select, so the route raises no
        // transcript warning (it genuinely is the MANE transcript).
        mane_select: annotations.mane_select ? true : undefined,
        mane_plus_clinical: annotations.mane_plus_clinical ? true : undefined,
        hgvsp,
        gene_symbol: payload.gene_symbol,
        // No UniProt accession is available from this provider; the client resolves
        // gene -> UniProt downstream, so an empty value is expected and already handled.
      },
    ],
  };
}

/**
 * Queries VariantValidator for a coordinate notation.
 *
 * Throws {@link CoordinateResolutionError} on transport failure or unusable payload so the
 * caller can distinguish "provider unreachable" from "provider had nothing".
 */
export async function fetchVariantValidatorConsequence(
  notation: string,
  assembly: GenomeAssembly,
  signal?: AbortSignal
): Promise<{ consequence: ResolvedConsequence; attempt: ProviderAttempt }> {
  const startedAt = Date.now();
  const url =
    `${VARIANT_VALIDATOR_BASE}/${assembly}/${encodeURIComponent(notation)}` +
    `/${VARIANT_VALIDATOR_SELECT_TRANSCRIPTS}`;

  const attempt = (
    ok: boolean,
    reason?: string,
    failureKind?: ProviderAttempt["failureKind"]
  ): ProviderAttempt => ({
    provider: "variant-validator",
    ok,
    durationMs: Math.max(1, Date.now() - startedAt),
    reason,
    failureKind,
  });

  let response: Response;
  try {
    // VariantValidator can take several seconds on a cold query, so allow a generous
    // timeout while keeping retries low: this is a fallback path, not the primary.
    response = await fetchWithRetry(
      url,
      { headers: { Accept: "application/json" }, timeout: 15000, signal },
      2,
      800
    );
  } catch (err: any) {
    throw new CoordinateResolutionError(
      "upstream_unavailable",
      `VariantValidator unreachable: ${err?.message || "network error"}`,
      [attempt(false, err?.message || "network error", "upstream_unavailable")]
    );
  }

  if (!response.ok) {
    const failureKind: ProviderAttempt["failureKind"] =
      response.status === 429 || response.status >= 500 ? "upstream_unavailable" : "invalid_response";
    const text = await response.text().catch(() => "");
    throw new CoordinateResolutionError(
      failureKind,
      `VariantValidator returned status ${response.status}: ${text.slice(0, 200)}`,
      [attempt(false, `status ${response.status}`, failureKind)]
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CoordinateResolutionError("invalid_response", "VariantValidator returned malformed JSON.", [
      attempt(false, "malformed JSON", "invalid_response"),
    ]);
  }

  const consequence = mapVariantValidatorResponse(body, assembly);
  if (!consequence) {
    // Includes the silent "intergenic" failure mode: reported as not_found, never as a
    // legitimate empty consequence.
    throw new CoordinateResolutionError(
      "not_found",
      "VariantValidator did not resolve this coordinate to a coding transcript consequence.",
      [attempt(false, "no usable payload", "not_found")]
    );
  }

  return { consequence, attempt: attempt(true) };
}
