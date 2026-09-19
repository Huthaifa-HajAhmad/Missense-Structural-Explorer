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
import {
  CoordinateResolutionError,
  type ProviderAttempt,
  type ResolutionProviderOptions,
  type ResolvedConsequence,
} from "./types.ts";

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

/**
 * The protein accession whose numbering the predicted HGVSp follows
 * (`NP_060672.2:p.(Glu433Lys)` -> `NP_060672.2`).
 *
 * This provider reports no UniProt accession and no isoform ids, so a caller cannot verify that
 * this numbering matches the canonical UniProt sequence — but naming the protein it DOES follow
 * turns an otherwise opaque "unverified" state into something a clinician can check.
 */
export function extractNumberingProteinId(
  consequence: VariantValidatorPayload["hgvs_predicted_protein_consequence"]
): string | undefined {
  const raw = consequence?.tlr || consequence?.slr;
  if (!raw) return undefined;
  const colon = raw.indexOf(":");
  if (colon < 0) return undefined;
  const accession = raw.slice(0, colon).trim();
  return accession || undefined;
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
        // The protein whose residue numbering `hgvsp` uses. Surfaced so an answer that cannot be
        // verified against the canonical UniProt sequence can still say WHICH numbering it uses.
        numbering_protein_id: extractNumberingProteinId(payload.hgvs_predicted_protein_consequence),
        gene_symbol: payload.gene_symbol,
        // No UniProt accession is available from this provider; the client resolves
        // gene -> UniProt downstream, so an empty value is expected and already handled.
      },
    ],
  };
}

/**
 * The one place this provider's URL is built.
 *
 * Shared by the live resolution path and the readiness probe so the two cannot drift. They did
 * drift once: the probe requested JSON via a `content-type` query parameter that the live path
 * lacked, so the probe could report the fallback ready while every real query received XML and
 * failed at `response.json()`. A probe is only evidence if it makes the request it is
 * reporting on.
 *
 * `content-type` is sent as a parameter *and* as an Accept header, because without either this
 * endpoint answers XML with HTTP 200 — a status-code check would score that healthy.
 */
export function buildVariantValidatorUrl(assembly: GenomeAssembly, notation: string): string {
  return (
    `${VARIANT_VALIDATOR_BASE}/${assembly}/${encodeURIComponent(notation)}` +
    `/${VARIANT_VALIDATOR_SELECT_TRANSCRIPTS}` +
    `?content-type=application/json`
  );
}

/**
 * Transport settings, shared with the probe.
 *
 * VariantValidator can take several seconds on a cold query, so the budget is generous and
 * retries stay low: this is a fallback path, not the primary. The probe uses the SAME budget
 * deliberately — a probe on a tighter budget than the traffic it reports on scores a merely
 * slow provider as dead, and the rail then tells the clinician to abandon coordinate notation
 * for a provider that would have answered.
 */
const VARIANT_VALIDATOR_TIMEOUT_MS = 15000;
const VARIANT_VALIDATOR_ATTEMPTS = 2;
const VARIANT_VALIDATOR_RETRY_DELAY_MS = 800;

/**
 * Queries VariantValidator for a coordinate notation.
 *
 * Throws {@link CoordinateResolutionError} on transport failure or unusable payload so the
 * caller can distinguish "provider unreachable" from "provider had nothing".
 */
export async function fetchVariantValidatorConsequence(
  notation: string,
  assembly: GenomeAssembly,
  signal?: AbortSignal,
  options?: ResolutionProviderOptions
): Promise<{ consequence: ResolvedConsequence; attempt: ProviderAttempt }> {
  const startedAt = Date.now();
  const url = buildVariantValidatorUrl(assembly, notation);

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
    response = await fetchWithRetry(
      url,
      {
        headers: { Accept: "application/json" },
        // Capped by the ladder's window, so this provider's tolerance can never outlive the
        // time it was actually granted — and a cap the ladder imposed is exempt from the shared
        // breaker, because it says nothing about this provider's health.
        timeout: options?.timeoutMs ?? VARIANT_VALIDATOR_TIMEOUT_MS,
        signal,
        ...(options?.cappedByCaller ? { cappedByCaller: true } : {}),
      },
      VARIANT_VALIDATOR_ATTEMPTS,
      VARIANT_VALIDATOR_RETRY_DELAY_MS
    );
  } catch (err: any) {
    // A caller- or ladder-initiated abort must propagate UNTOUCHED, exactly as the primary
    // provider does: wrapping it turned an expired window into "VariantValidator unreachable"
    // and a caller abort into a 503 instead of the HTTP layer's 504.
    if (signal?.aborted) throw err;
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
  } catch (err: any) {
    // A body read killed by the ladder's deadline or window is a timeout, not a malformed body.
    if (signal?.aborted) throw err;
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

/**
 * Canonical coordinate used to establish whether this provider can take over.
 *
 * A liveness ping is NOT sufficient here, for two reasons. VariantValidator exposes no
 * `/info` or `/version` endpoint — both return 404, and the version is only reported inside
 * a resolution payload's `metadata` block — so there is nothing cheap to ping. More
 * importantly, this provider's documented failure mode is a **HTTP 200 carrying
 * `flag: "intergenic"` and no gene** (trap 1 at the top of this file), which a status-code
 * check would score as healthy.
 *
 * Readiness is therefore proven by resolving a real coordinate. This is the same locus the
 * file header cites as verified live, chosen because it exercises the whole parse path —
 * dynamic payload-key discovery, protein-consequence extraction, gene symbol — and not
 * merely the transport.
 *
 * `expectedGene` is REPORTING ONLY and must never gate readiness. An earlier version failed
 * the probe when the symbol differed, which tested upstream annotation stability rather than
 * liveness: this locus's gene was itself renamed (MACO1, HGNC:25572, formerly TMEM57), the
 * symbol is derived from HGNC, and the reference database rotates (vvdb/vvta/vvseqrepo are
 * all versioned). Any of those turns a perfectly healthy provider into a permanent "fallback
 * is down" in a clinical readout that never self-heals. The mapper already returns null for
 * the silent-intergenic case, which is the failure mode worth gating on.
 */
export const VARIANT_VALIDATOR_PROBE = {
  assembly: "GRCh38" as GenomeAssembly,
  notation: "NC_000001.11:g.25484258G>A",
  expectedGene: "MACO1",
} as const;

/**
 * How the fallback tier is doing.
 *
 * Three states, not two, because "I could not tell" and "I asked and it cannot" call for
 * different clinical advice. Collapsing them makes a slow or unreachable provider render as a
 * definite outage, and the rail then tells the user to abandon coordinate notation — which is
 * wrong when the probe merely timed out.
 */
export type FallbackVerdictKind = "ready" | "unavailable" | "unknown";

export interface VariantValidatorHealth {
  /** Retained for the wire contract and backwards compatibility: true only for `ready`. */
  healthy: boolean;
  verdict: FallbackVerdictKind;
  latencyMs: number;
  message: string;
  timestamp: string;
}

/**
 * Probes whether the fallback tier can actually resolve a coordinate right now.
 *
 * Readiness is defined as exactly what the live path needs: the shared mapper turning the
 * response into a usable protein consequence. Anything else about the payload is reported,
 * never gated on.
 *
 * Never throws: a fallback that cannot be reached must be reportable, not fatal, because
 * the caller is already rendering a degraded primary.
 *
 * `signal` should carry a hard deadline. The transport timeout bounds time-to-headers only —
 * `fetchWithRetry` clears its timer as soon as headers arrive — so an awaited `response.json()`
 * is otherwise unbounded, and a provider that sends headers then stalls the body would leave
 * this promise pending forever.
 */
export async function checkVariantValidatorHealth(signal?: AbortSignal): Promise<VariantValidatorHealth> {
  const startedAt = Date.now();
  const url = buildVariantValidatorUrl(VARIANT_VALIDATOR_PROBE.assembly, VARIANT_VALIDATOR_PROBE.notation);

  const result = (verdict: FallbackVerdictKind, message: string): VariantValidatorHealth => ({
    healthy: verdict === "ready",
    verdict,
    latencyMs: Math.round(Date.now() - startedAt),
    message,
    timestamp: new Date().toISOString(),
  });

  let response: Response;
  try {
    response = await fetchWithRetry(
      url,
      {
        headers: { Accept: "application/json" },
        timeout: VARIANT_VALIDATOR_TIMEOUT_MS,
        signal,
        // Monitoring must not be able to trip the breaker that guards real resolutions.
        probe: true,
      },
      VARIANT_VALIDATOR_ATTEMPTS,
      VARIANT_VALIDATOR_RETRY_DELAY_MS
    );
  } catch (err: any) {
    // Could not determine: a timeout, an abort or a transport error says nothing about whether
    // the provider would have answered a real query. Reported as `unknown`, never as an outage.
    return result("unknown", err?.message || "VariantValidator unreachable");
  }

  if (!response.ok) {
    // A 4xx is the provider answering about the request, so it is a definitive verdict; 5xx and
    // 429 exit through the catch above.
    return result("unavailable", `HTTP ${response.status}`);
  }

  let consequence: ResolvedConsequence | null;
  try {
    consequence = mapVariantValidatorResponse(await response.json(), VARIANT_VALIDATOR_PROBE.assembly);
  } catch (err: any) {
    // The provider answered, but unusably — that is a real, actionable failure.
    return result("unavailable", "VariantValidator returned malformed JSON");
  }

  if (!consequence) {
    return result("unavailable", "No consequence returned for the probe coordinate");
  }

  const hgvsp = consequence.transcript_consequences?.[0]?.hgvsp ?? "protein change";
  const gene = consequence.transcript_consequences?.[0]?.gene_symbol;
  return result("ready", gene ? `Resolved ${gene} ${hgvsp}` : `Resolved ${hgvsp}`);
}
