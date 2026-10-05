/**
 * curatedLiterature.ts — the shape of a curated database record → paper relationship.
 *
 * A curated link says ONE thing: a provider's record for this exact variant cites this paper. It is a
 * metadata relationship, not a pathogenicity assertion, not proof that the abstract names the variant,
 * and it enters no ACMG criterion. A full-text-only link may have no quotable sentence at all: the
 * relationship is rendered from provider provenance, never as a fabricated quote and never folded into
 * the quote-backed screening tags.
 */
import type { Citation } from "./literatureEvidence";

export type CuratedLinkProvider = "uniprot" | "clinvar";

/** Coverage of one curated source for the variant in view. `complete` may still hold zero links. */
export type CuratedCoverageState = "complete" | "unavailable" | "error";

export interface CuratedCoverage {
  state: CuratedCoverageState;
  /** Why the lookup could not complete; absent for a `complete` answer (including zero links). */
  reason?: string;
  /** How many hydrated curated citation records were merged into the list. */
  linked: number;
}

export interface CuratedVariantLink {
  provider: CuratedLinkProvider;
  /** Provider's stable identity for the record/feature that carries the citation, e.g. `VAR_088123`. */
  featureId: string | null;
  /** Accession the record belongs to, e.g. `Q13564`; null when the provider gives none. */
  accession: string | null;
  /** Variant identity as the provider states it, e.g. `L49F`. */
  variant: string;
  /** The provider's own feature/record description, verbatim, for cross-checking. */
  variantDescription: string | null;
  /** The provider's evidence code, e.g. `ECO:0000269`. */
  evidenceCode: string | null;
  /** Publication identifier as the provider records it (a PubMed id for UniProt). */
  pmid: string;
  /** Source string the provider used, e.g. `PubMed`. */
  source: string | null;
  /** Deep link to the provider's own record. */
  sourceUrl: string;
  /** ISO-8601 instant this relationship was retrieved. */
  retrievedAt: string;
}

/** The label a reader sees. Worded as a record relationship, never as support for a finding. */
export const CURATED_LINK_LABELS: Record<CuratedLinkProvider, string> = {
  uniprot: "Cited by UniProt variant record",
  clinvar: "Cited by ClinVar submission",
};

export function curatedLinkLabel(provider: CuratedLinkProvider): string {
  return CURATED_LINK_LABELS[provider];
}

/** The provider-side detail line shown beside the label; never a paper quote. */
export function curatedLinkDetail(link: CuratedVariantLink): string {
  return [link.accession, link.variant, link.featureId, link.evidenceCode]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" · ");
}

/** Identity of one provider relationship: the same paper cited by one feature, regardless of how many
 *  evidence codes point at it. Two features citing the same paper stay distinct. */
function curatedLinkKey(link: CuratedVariantLink): string {
  return [link.provider, link.pmid, link.accession ?? "", link.featureId ?? "", link.variant].join("::");
}

/** Same paper cited by several features (or re-fetched) collapses to distinct provider relationships. */
export function dedupeCuratedLinks(links: readonly CuratedVariantLink[]): CuratedVariantLink[] {
  const seen = new Set<string>();
  const out: CuratedVariantLink[] = [];
  for (const link of links) {
    if (!link?.pmid) continue;
    const key = curatedLinkKey(link);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

/**
 * Union every curated relationship onto the ordinary records they name, WITHOUT adding any record.
 * An ordinary record wins for base metadata (it is the Europe PMC page the list already shows).
 */
export function attachCuratedLinks(ordinary: readonly Citation[], curated: readonly Citation[]): Citation[] {
  if (curated.length === 0) return [...ordinary];
  const linksById = new Map<string, Citation["curatedLinks"]>();
  for (const citation of curated) {
    const merged = dedupeCuratedLinks([...(linksById.get(citation.id) ?? []), ...(citation.curatedLinks ?? [])]);
    if (merged.length) linksById.set(citation.id, merged);
  }
  return ordinary.map(citation => {
    const links = linksById.get(citation.id);
    if (!links) return citation;
    return { ...citation, curatedLinks: dedupeCuratedLinks([...(citation.curatedLinks ?? []), ...links]) };
  });
}

/**
 * Curated records the ordinary query never returned — the full-text-only case this source exists for.
 * Kept as a separate set so the caller can show them without counting them as query membership.
 */
export function curatedOnlyCitations(ordinary: readonly Citation[], curated: readonly Citation[]): Citation[] {
  const ordinaryIds = new Set(ordinary.map(citation => citation.id));
  const out: Citation[] = [];
  for (const citation of curated) {
    if (ordinaryIds.has(citation.id)) continue;
    const curatedLinks = dedupeCuratedLinks(citation.curatedLinks ?? []);
    out.push({ ...citation, ...(curatedLinks.length ? { curatedLinks } : {}) });
  }
  return out;
}

/**
 * Deduplicate hydrated curated citations into an ordinary citation list by identifier.
 *
 * The ordinary record wins for base metadata (it comes from the same Europe PMC page the list already
 * shows); every curated relationship attached to the identifier is unioned onto that row. A curated
 * record whose identifier is not in the ordinary list — the full-text-only case, which is the point of
 * the source — is appended rather than dropped.
 */
export function mergeCuratedCitations(ordinary: readonly Citation[], curated: readonly Citation[]): Citation[] {
  if (curated.length === 0) return [...ordinary];
  return [...attachCuratedLinks(ordinary, curated), ...curatedOnlyCitations(ordinary, curated)];
}
