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
export interface ShareableQuery {
  gene?: string | null;
  variant?: string | null;
  uniprotId?: string | null;
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
  // The legacy alias is read on load too; drop it so the link never carries two accessions.
  url.searchParams.delete("uniprotId");
  return url.toString();
}

/** True when there is enough to reproduce a run from the link alone. */
export function isShareable(q: ShareableQuery): boolean {
  return Boolean(q.gene?.trim() && q.variant?.trim());
}
