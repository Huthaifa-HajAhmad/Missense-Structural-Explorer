import { PARTNER_GROUP_LABEL, type PartnerGroup } from "../../../shared/interfacesEvidence";

/**
 * The Interfaces & PPI partner view as URL parameters, so a curator can send the exact list they read:
 * `?ppit=screen` (one evidence tier) and `?ppiq=bcl` (a name query). Pure, so the tab only reads and writes.
 *
 * The parameters are this tab's alone: written while the tab is mounted, removed when it unmounts. The
 * variant identity (gene, variant, UniProt) stays `useVariantUrlSync`'s.
 */

export const PPI_TIER_PARAM = "ppit";
export const PPI_QUERY_PARAM = "ppiq";
/** A gene symbol or accession, not prose: the field and the URL share one visible limit. */
export const PPI_QUERY_MAX = 40;

export function parsePpiTier(raw: string | null): PartnerGroup | null {
  return raw && Object.prototype.hasOwnProperty.call(PARTNER_GROUP_LABEL, raw) ? (raw as PartnerGroup) : null;
}

export function parsePpiQuery(raw: string | null): string {
  return (raw ?? "").slice(0, PPI_QUERY_MAX);
}

/** The URL with this tab's parameters set (or removed when empty). Returns the input when nothing changes. */
export function withPpiParams(href: string, tier: PartnerGroup | null, query: string): string {
  const url = new URL(href);
  const apply = (name: string, value: string | null) => {
    if (!value) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  };
  apply(PPI_TIER_PARAM, tier);
  apply(PPI_QUERY_PARAM, query.trim() || null);
  const next = url.toString();
  return next === new URL(href).toString() ? href : next;
}
