/**
 * curated-literature.ts — Phase 1b curated variant → paper links.
 *
 * ONE JOB: given a gene, a protein substitution and a UniProt accession, read the database's own
 * curated citations for THAT variant and hydrate them into citations the rest of the app already
 * understands. A returned link is a RECORD RELATIONSHIP: the provider's entry for this exact variant
 * cites this paper. It is not proof that the abstract names the variant, not proof the paper supports a
 * finding, and it enters no ACMG criterion.
 *
 * SOURCE (verified live 2026-10-05 against UniProtKB Q13564 / NAE1):
 *   • `https://rest.uniprot.org/uniprotkb/{accession}.json` returns the entry's `features`. A
 *     `Natural variant` feature carries `location.start/end` (1-based, `modifier: "EXACT"` when the
 *     position is pinned), `alternativeSequence.originalSequence` / `alternativeSequences`, a
 *     `featureId` (`VAR_…`) and `evidences[]`. A PubMed citation is an evidence entry with
 *     `source: "PubMed"` and a numeric `id` — the same `id` field carries PDB/UniProt identifiers for
 *     other sources, which are NOT PMIDs and are not read here.
 *   • The `fields` parameter cannot request features (verified: `fields=accession,feature` answers 400),
 *     so the entry is fetched whole. One attempt under a caller-capped timeout: this is enrichment
 *     around an answer that already exists, and a retry envelope here would spend the request's budget.
 *   • An ISOFORM accession (`Q13564-2`) answers 200 but returns the isoform entry with no features
 *     (verified), so a canonical-numbered feature can never be matched against isoform numbering. It is
 *     refused explicitly instead of guessed.
 *
 * MATCHING RULE: accession exact, single-residue `EXACT` position equal to the query position, reference
 * residue equal, and the query's alternate present in the feature's alternatives. A same-position feature
 * for a DIFFERENT substitution is a separate relationship and is not promoted.
 *
 * HYDRATION: the curated PMIDs are fetched through the existing Europe PMC service with an exact
 * `EXT_ID:` query and `force=false`, then every returned record is checked against the curated id set —
 * a search that returns a neighbouring record can never smuggle it in. That lookup writes only its own
 * custom-query cache key; the gene's default search membership is untouched.
 *
 * FAILURE IS EXPLICIT and optional: this never throws to the caller, and a caller that ignores the
 * result loses nothing but the curated annotation. A `complete` answer includes the definitive "no
 * linked record" case; `unavailable` means the lookup could not be attempted; `error` means the provider
 * did not answer. Failures are never cached, so a transient outage does not stick for the TTL.
 *
 * ClinVar submission citations are deliberately NOT implemented. Verified live: a ClinVar VCV XML
 * (`efetch rettype=vcv`) nests `<Citation Type="general"><ID Source="PubMed">…</ID></Citation>` inside
 * each `<ClinicalAssertion>`. But the current ClinVar adapter reads only esummary JSON (which carries no
 * citations), its variant match is a fuzzy title comparison that does not retain a verified exact VCV for
 * a name search, and a submission's citation can be gene-level or condition-level rather than a citation
 * OF this variant. Promoting those would require interpreting submission semantics — exactly the
 * speculative mapping the phase forbids. Deferred until an exact VCV identity and variant-specific
 * citation semantics are both verified.
 */
import { LRUCache } from "lru-cache";
import { defaultCacheRegistry, getCachedOrFetch } from "../infra/cache.ts";
import { fetchWithRetry, normalizeGeneSymbol } from "../infra/http-client.ts";
import { UNIPROT_PATTERN } from "../../utils/validation.ts";
import { fetchCitationsByPmids } from "./literature-rag.ts";
import { parseVariantResidues, type Citation } from "../../../src/shared/literatureEvidence.ts";
import {
  dedupeCuratedLinks,
  type CuratedCoverageState,
  type CuratedVariantLink,
} from "../../../src/shared/curatedLiterature.ts";

export interface CuratedVariantCitations {
  /** Hydrated Europe PMC citations, each carrying its `curatedLinks` provenance. */
  citations: Citation[];
  state: CuratedCoverageState;
  /** Why the lookup did not complete. Absent for a `complete` answer, including zero links. */
  reason?: string;
}

/** Bound on how many curated PMIDs one hydration query asks Europe PMC for. */
export const MAX_CURATED_PMIDS = 25;

/** Records change rarely; a day keeps the annotation fresh without re-querying on every tab render. */
export const CURATED_CITATIONS_TTL_MS = 24 * 60 * 60 * 1000;

export const curatedVariantCitationsCache = new LRUCache<string, CuratedVariantCitations>({
  max: 500,
  ttl: CURATED_CITATIONS_TTL_MS,
});
defaultCacheRegistry.registerCache("curatedVariantCitationsCache", curatedVariantCitationsCache, {
  ttlDesc: "24h",
});

/** A numeric PubMed id as a provider records it. Other evidence sources carry non-PMID ids. */
function pubmedEvidenceId(evidence: unknown): string | null {
  const e = evidence as { source?: unknown; id?: unknown } | null;
  if (typeof e?.source !== "string" || e.source.trim().toLowerCase() !== "pubmed") return null;
  const id = typeof e.id === "string" || typeof e.id === "number" ? String(e.id).trim() : "";
  return /^\d{1,10}$/.test(id) ? id : null;
}

/** True only for a single, pinned 1-based residue position. */
function isExactPosition(point: unknown): point is { value: number; modifier?: string } {
  const p = point as { value?: unknown; modifier?: unknown } | null;
  if (!Number.isInteger(p?.value) || (p?.value as number) <= 0) return false;
  // An absent modifier is treated as exact; an explicit UNKNOWN/OUTSIDE is not.
  return String(p?.modifier ?? "EXACT").toUpperCase() === "EXACT";
}

function featureSourceUrl(accession: string, featureId: string | null): string {
  return featureId
    ? `https://www.uniprot.org/uniprotkb/${encodeURIComponent(accession)}/variant/${encodeURIComponent(featureId)}`
    : `https://www.uniprot.org/uniprotkb/${encodeURIComponent(accession)}/entry`;
}

/**
 * Every Natural-variant feature that matches the query variant exactly, reduced to its PubMed
 * relationships. Duplicate PMIDs across features collapse; the distinct features stay distinct.
 */
export function curatedLinksFromEntry(
  entry: unknown,
  accession: string,
  residues: { wildType: string; position: number; alternate: string },
): CuratedVariantLink[] {
  const data = entry as { features?: unknown } | null;
  const features = Array.isArray(data?.features) ? (data?.features as any[]) : [];
  const retrievedAt = new Date().toISOString();
  const links: CuratedVariantLink[] = [];

  for (const feature of features) {
    if (feature?.type !== "Natural variant") continue;
    const start = feature?.location?.start;
    const end = feature?.location?.end;
    if (!isExactPosition(start) || !isExactPosition(end)) continue;
    if (start.value !== end.value || start.value !== residues.position) continue;

    const reference = String(feature?.alternativeSequence?.originalSequence ?? "").trim().toUpperCase();
    if (reference !== residues.wildType) continue;
    const alternatives = (Array.isArray(feature?.alternativeSequence?.alternativeSequences)
      ? feature.alternativeSequence.alternativeSequences
      : []
    ).map((value: unknown) => String(value).trim().toUpperCase());
    if (!alternatives.includes(residues.alternate)) continue;

    const featureId = typeof feature?.featureId === "string" ? feature.featureId : null;
    const sourceUrl = featureSourceUrl(accession, featureId);
    for (const evidence of Array.isArray(feature?.evidences) ? feature.evidences : []) {
      const pmid = pubmedEvidenceId(evidence);
      if (!pmid) continue;
      links.push({
        provider: "uniprot",
        featureId,
        accession,
        variant: `${residues.wildType}${residues.position}${residues.alternate}`,
        variantDescription: typeof feature?.description === "string" ? feature.description : null,
        evidenceCode: typeof evidence?.evidenceCode === "string" ? evidence.evidenceCode : null,
        pmid,
        source: typeof evidence?.source === "string" ? evidence.source : null,
        sourceUrl,
        retrievedAt,
      });
    }
  }
  return dedupeCuratedLinks(links);
}

/** A short, control-character-free reason fragment safe to put in a response and a log line. */
function failureReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "unknown error");
  return message.replace(/[\r\n]+/g, " ").slice(0, 200);
}

/** Every gene symbol the entry lists (primary and synonyms), upper-cased. */
function entryGeneSymbols(entry: unknown): string[] {
  const genes = Array.isArray((entry as { genes?: unknown } | null)?.genes)
    ? ((entry as { genes: any[] }).genes)
    : [];
  const symbols = new Set<string>();
  for (const gene of genes) {
    if (typeof gene?.geneName?.value === "string") symbols.add(gene.geneName.value.trim().toUpperCase());
    for (const synonym of Array.isArray(gene?.synonyms) ? gene.synonyms : []) {
      if (typeof synonym?.value === "string") symbols.add(synonym.value.trim().toUpperCase());
    }
  }
  return [...symbols];
}

/** The entry must be human and must name the query gene, so a mismatched accession never attaches. */
function entryMatchesQuery(entry: unknown, gene: string, accession: string): true | string {
  const organism = (entry as { organism?: { taxonId?: unknown } } | null)?.organism;
  if (organism?.taxonId !== 9606) {
    const taxon = organism?.taxonId ?? "unknown";
    return `UniProt entry ${accession} is not human (taxon ${taxon}).`;
  }
  const symbols = entryGeneSymbols(entry);
  if (symbols.length === 0) {
    return `UniProt entry ${accession} lists no gene name, so it cannot be matched to ${gene}.`;
  }
  const target = gene.trim().toUpperCase();
  const normalizedTarget = normalizeGeneSymbol(gene).toUpperCase();
  const compatible = symbols.some(symbol => symbol === target || normalizeGeneSymbol(symbol).toUpperCase() === normalizedTarget);
  return compatible ? true : `UniProt entry ${accession} reports ${symbols.join(", ")}, not ${gene}.`;
}

async function fetchUniprotNaturalVariantLinks(
  gene: string,
  accession: string,
  residues: { wildType: string; position: number; alternate: string },
  signal?: AbortSignal,
): Promise<{ ok: true; links: CuratedVariantLink[] } | { ok: false; state: "unavailable" | "error"; reason: string }> {
  let response: Response;
  try {
    response = await fetchWithRetry(
      `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(accession)}.json`,
      {
        headers: { Accept: "application/json" },
        timeout: 12000,
        cappedByCaller: true,
        ...(signal ? { signal } : {}),
      },
      1,
      0,
    );
  } catch (err) {
    return { ok: false, state: "error", reason: `UniProt did not answer (${failureReason(err)}).` };
  }

  // The provider answered about the REQUEST: it has no such entry.
  if (response.status === 400 || response.status === 404) {
    return { ok: false, state: "unavailable", reason: `UniProt has no entry for ${accession}.` };
  }
  if (!response.ok) {
    return { ok: false, state: "error", reason: `UniProt answered ${response.status}.` };
  }

  let entry: unknown;
  try {
    entry = await response.json();
  } catch (err) {
    return { ok: false, state: "error", reason: `UniProt returned an unreadable entry (${failureReason(err)}).` };
  }

  // Re-check the response is for THIS accession: a differently-shaped payload must not attach a
  // neighbouring entry's features to this variant.
  const returned = String((entry as { primaryAccession?: unknown } | null)?.primaryAccession ?? "").trim().toUpperCase();
  if (returned !== accession) {
    return {
      ok: false,
      state: "unavailable",
      reason: `UniProt returned ${returned || "an entry without an accession"}, not ${accession}.`,
    };
  }

  const compatibility = entryMatchesQuery(entry, gene, accession);
  if (compatibility !== true) {
    return { ok: false, state: "unavailable", reason: compatibility };
  }
  return { ok: true, links: curatedLinksFromEntry(entry, accession, residues) };
}

/**
 * Fetch the citation records for curated PMIDs directly, without a gene filter or search-cache
 * membership, and keep only records whose identifier is in the curated set. Uses the parent-owned
 * `fetchCitationsByPmids`, which hydrates exact `EXT_ID` records: a gene-scoped query can miss
 * precisely the full-text-only citations this source exists for. A degraded or partial upstream answer
 * throws there, so this reports an explicit failure rather than an empty list that would read as
 * "no links".
 */
async function hydrateCuratedCitations(
  links: readonly CuratedVariantLink[],
  signal?: AbortSignal,
): Promise<{ citations: Citation[] }> {
  const byPmid = new Map<string, CuratedVariantLink[]>();
  for (const link of links) {
    const bucket = byPmid.get(link.pmid);
    if (bucket) bucket.push(link);
    else byPmid.set(link.pmid, [link]);
  }
  const pmids = [...byPmid.keys()];
  if (pmids.length > MAX_CURATED_PMIDS) {
    throw new Error(`Curated variant record cites more than ${MAX_CURATED_PMIDS} papers in one lookup.`);
  }
  const rows = await fetchCitationsByPmids(pmids, signal);

  const citations: Citation[] = [];
  for (const row of rows) {
    const curated = byPmid.get(row.id);
    if (!curated) continue; // every returned id must match a curated link
    citations.push({ ...row, curatedLinks: dedupeCuratedLinks(curated) });
  }
  return { citations };
}

async function resolveCuratedVariantCitations(
  gene: string,
  accession: string,
  residues: { wildType: string; position: number; alternate: string },
  signal?: AbortSignal,
): Promise<CuratedVariantCitations> {
  const resolved = await fetchUniprotNaturalVariantLinks(gene, accession, residues, signal);
  if (!resolved.ok) return { citations: [], state: resolved.state, reason: resolved.reason };
  if (resolved.links.length === 0) return { citations: [], state: "complete" };

  try {
    const hydrated = await hydrateCuratedCitations(resolved.links, signal);
    return { citations: hydrated.citations, state: "complete" };
  } catch (err) {
    return { citations: [], state: "error", reason: `The curated citation lookup failed (${failureReason(err)}).` };
  }
}

/**
 * Read the curated variant → paper links for one substitution. Never throws.
 *
 * Bounded: one UniProt entry fetch and at most one Europe PMC id query, both under the caller's signal.
 * Cached in memory (24 h) and single-flighted, so reopening the Literature tab or a second caller in the
 * same analysis does not repeat the work. Cancellation and provider failures are returned as states, not
 * rejections, so an ordinary literature read is never blocked by this optional enrichment.
 */
export async function getCuratedVariantCitations(
  gene: string,
  variant: string,
  uniprotId: string,
  signal?: AbortSignal,
): Promise<CuratedVariantCitations> {
  const cleanGene = (gene ?? "").trim().toUpperCase();
  if (!cleanGene) return { citations: [], state: "unavailable", reason: "No gene was supplied." };
  if (!variant || !variant.trim()) return { citations: [], state: "unavailable", reason: "No variant was supplied." };

  const residues = parseVariantResidues(variant);
  if (!residues) {
    return { citations: [], state: "unavailable", reason: "The variant has no protein substitution to match a curated record." };
  }

  const accession = (uniprotId ?? "").trim().toUpperCase();
  if (!accession) return { citations: [], state: "unavailable", reason: "No UniProt accession was supplied." };
  if (/-\d+$/.test(accession)) {
    return {
      citations: [],
      state: "unavailable",
      reason: "The accession is an isoform; canonical feature numbering does not apply.",
    };
  }
  if (!UNIPROT_PATTERN.test(accession)) {
    return { citations: [], state: "unavailable", reason: "The accession is not a valid UniProt accession." };
  }

  // The gene is part of the identity: resolution validates that the entry names it, so a result
  // resolved for one gene must never be served for another that happens to share the accession.
  const key = `curated-variant/v1::${cleanGene}::${accession}::${residues.wildType}${residues.position}${residues.alternate}`;
  return getCachedOrFetch<CuratedVariantCitations>({
    key,
    source: "UniProt curated variant citations",
    l1Cache: curatedVariantCitationsCache,
    bypassSqlite: true,
    // Never remember a transient failure: an `error` answer is retried on the next call.
    shouldCache: (result) => result.state !== "error",
    fetcher: () => resolveCuratedVariantCitations(cleanGene, accession, residues, signal),
  });
}
