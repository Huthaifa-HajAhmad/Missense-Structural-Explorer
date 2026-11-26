/**
 * Shareable variant links: `?gene=CNNM2&variant=p.Ser489Cys&uniprot=Q9H8M5`.
 *
 * The store already READS these parameters on load and the app auto-runs the query, but nothing
 * ever WROTE them back — the only writer lived in `hooks/useVariantSearch.ts`, which nothing
 * imports. So the address bar kept whatever variant the tab was opened with, and copying it shared
 * the wrong analysis. This module is the single place the link is built, for both the address-bar
 * sync and the header's "Copy link" action.
 *
 * BOUNDARY CONTRACT: pure — no imports outside `src/shared/`.
 */

import { transcriptIdentity } from "./transcriptIdentity.ts";

export interface ShareableQuery {
  gene?: string | null;
  variant?: string | null;
  uniprotId?: string | null;
  /** Normalized genomic allele (`chrom-pos-ref-alt`), when resolved to a single nucleotide change. */
  allele?: string | null;
  /** Genome assembly for `allele` (`GRCh37` | `GRCh38`). */
  assembly?: string | null;
  /** Resolved transcript accession (with version when known), e.g. `NM_000142.5`. */
  transcript?: string | null;
}

/** Returns `href` with the variant parameters set (or removed when empty). Other params and the hash survive. */
export function withVariantParams(href: string, q: ShareableQuery): string {
  const url = new URL(href);
  const set = (key: string, value?: string | null) => {
    const v = (value ?? "").trim();
    if (v) url.searchParams.set(key, v);
    else url.searchParams.delete(key);
  };
  set("gene", q.gene);
  set("variant", q.variant);
  set("uniprot", q.uniprotId);
  set("allele", q.allele);
  set("assembly", q.allele ? q.assembly : null);
  set("transcript", q.allele ? q.transcript : null);
  // The legacy alias is read on load too; drop it so the link never carries two accessions.
  url.searchParams.delete("uniprotId");
  return url.toString();
}

/**
 * Extracts resolved genomic-allele identity from `analysisResult` when it matches the active
 * `gene` + `variant` and is not an unresolved multi-candidate protein-only run.
 */
export function shareableQueryFromResult(
  result: any,
  base: { gene?: string | null; variant?: string | null; uniprotId?: string | null },
): ShareableQuery {
  const gene = (base.gene ?? "").trim();
  const variant = (base.variant ?? "").trim();
  const uniprotId = (base.uniprotId ?? "").trim();
  if (!result || !gene || !variant) return { gene, variant, uniprotId };

  const metaGene = String(result.metadata?.gene ?? "").trim().toUpperCase();
  const metaVariant = String(result.metadata?.variant ?? "").trim();
  if ((metaGene && metaGene !== gene.toUpperCase()) || (metaVariant && metaVariant !== variant)) {
    return { gene, variant, uniprotId };
  }

  const failureKind = result.predictorData?.locusResolution?.failureKind;
  if (failureKind === "multiple-candidates" || failureKind === "ambiguous-allele") {
    return { gene, variant, uniprotId };
  }

  const gnomadId = typeof result.predictorData?.gnomadVariantId === "string"
    ? result.predictorData.gnomadVariantId.trim()
    : "";
  const liftedId = typeof result.liftedGenomicCoordinates === "string"
    ? result.liftedGenomicCoordinates.trim()
    : "";
  const submittedId = typeof result.coordinateLift?.submittedCoordinates === "string"
    ? result.coordinateLift.submittedCoordinates.trim()
    : "";

  let allele: string | null = null;
  let assembly: string | null = null;
  if (gnomadId) {
    allele = gnomadId;
    assembly = result.predictorData?.gnomadVariantAssembly || result.resolvedAssembly || result.assembly || "GRCh38";
  } else if (liftedId && result.resolvedAssembly) {
    allele = liftedId;
    assembly = result.resolvedAssembly;
  } else if (submittedId && (result.coordinateLift?.submittedAssembly || result.assembly)) {
    allele = submittedId;
    assembly = result.coordinateLift?.submittedAssembly || result.assembly;
  }

  const identity = transcriptIdentity(result, result.predictorData);
  const transcript = identity.maneRefSeqId || identity.transcriptId || null;

  return { gene, variant, uniprotId, allele, assembly, transcript };
}

/** Parses `?allele=...&assembly=...&transcript=...` from a share link into an unambiguous coordinate notation. */
export function readUrlAlleleNotation(search: string): {
  allele: string | null;
  assembly: string | null;
  transcript: string | null;
  notation: string | null;
} {
  if (!search) return { allele: null, assembly: null, transcript: null, notation: null };
  try {
    const p = new URLSearchParams(search);
    const allele = (p.get("allele") ?? "").trim() || null;
    const rawAssembly = (p.get("assembly") ?? "").trim();
    const assembly = rawAssembly === "GRCh37" || rawAssembly === "GRCh38" ? rawAssembly : (allele ? "GRCh38" : null);
    const transcript = (p.get("transcript") ?? "").trim() || null;
    if (!allele) return { allele: null, assembly: null, transcript, notation: null };
    const m = allele.match(/^(?:chr)?([0-9]+|X|Y|MT)-(\d+)-([ACGT]+)-([ACGT]+)$/i);
    const notation = m
      ? `Chr${m[1].toUpperCase()}(${assembly}):g.${m[2]}${m[3].toUpperCase()}>${m[4].toUpperCase()}`
      : allele;
    return { allele, assembly, transcript, notation };
  } catch {
    return { allele: null, assembly: null, transcript: null, notation: null };
  }
}

/** True when there is enough to reproduce a run from the link alone. */
export function isShareable(q: ShareableQuery): boolean {
  return Boolean(q.gene?.trim() && q.variant?.trim());
}
