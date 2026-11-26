import { useRef } from "react";
import { ExternalLink, Handshake, RefreshCw, Search, X } from "lucide-react";
import { STRING_CONFIDENCE_CUTS } from "../../../shared/thresholds";
import { filterPartnerGroups, type InterfacesEvidence } from "../../../shared/interfacesEvidence";
import { PartnerTable } from "./PartnerTable";
import { PartnerTiers, partnerShape } from "./PartnerTiers";
import { PPI_QUERY_MAX } from "./viewUrlState";
import { ActionButton, Statement } from "./ui";
import type { usePartnerView } from "./usePartnerView";

/** Partners: the shape in one sentence, tier chips and a search on one band, then one grid by tier. */
export function PartnersPanel({ ev, view, lookupError, onRetry }: { ev: InterfacesEvidence; view: ReturnType<typeof usePartnerView>; lookupError: string | null; onRetry: () => void }) {
  const searchRef = useRef<HTMLInputElement>(null);
  const { tier, query } = view;
  const failed = ev.status.lookups === "error";
  const loading = ev.status.lookups === "loading";
  const visible = filterPartnerGroups(ev.groups, { tier, query });
  const matched = visible.reduce((n, g) => n + g.rows.length + (g.folded?.rows.length ?? 0), 0);
  const tierTitle = tier ? ev.groups.find(g => g.id === tier)?.title ?? tier : null;
  const retry = failed ? <ActionButton onClick={onRetry} icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}>Try again</ActionButton> : undefined;
  return (
    <section className="ifc-section" aria-labelledby="ifc-partners-title" aria-busy={loading || undefined}>
      <h2 className="eyebrow" id="ifc-partners-title">
        <Handshake className="w-3.5 h-3.5" aria-hidden="true" />
        Partners
      </h2>
      <div className="ifc-card">
        {/* While the lookups run or after they fail, say so above whatever the assembly alone supplies. */}
        {ev.status.lookups !== "ready" && ev.partners.length > 0 && (
          <Statement title={loading ? "Reading partners" : "Partners not retrieved"} action={retry}>
            {loading
              ? `Asking UniProt, IntAct and STRING about ${ev.gene}. The rows below come from the assembly alone.`
              : `${lookupError ?? "The interaction lookups did not answer."} The rows below come from the assembly alone; this is not evidence that there are no other partners.`}
          </Statement>
        )}
        {ev.partners.length ? (
          <>
            <div className="ifc-partners__head">
              <p className="ifc-partners__shape">{partnerShape(ev.partnerSummary)}</p>
              <label className="ifc-search">
                <Search className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="sr-only">Find a partner by gene or accession</span>
                <input
                  type="search"
                  ref={searchRef}
                  value={query}
                  placeholder="Find a partner"
                  onChange={e => view.setQuery(e.target.value.slice(0, PPI_QUERY_MAX))}
                  onKeyDown={e => { if (e.key === "Escape") view.setQuery(""); }}
                  maxLength={PPI_QUERY_MAX}
                  aria-controls="ifc-partner-grid"
                />
                {query && (
                  // Keep focus in the field so the reader can type again immediately.
                  <button type="button" className="ifc-search__clear" aria-label="Clear search" title="Clear search" onMouseDown={e => e.preventDefault()} onClick={() => { view.setQuery(""); searchRef.current?.focus(); }}>
                    <X className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
              </label>
              <div className="ifc-partners__tiers">
                <PartnerTiers groups={ev.groups} summary={ev.partnerSummary} active={tier} onToggle={id => view.setTier(tier === id ? null : id)} />
                {(tier || query) && <button type="button" className="ifc-link" onClick={() => { view.setTier(null); view.setQuery(""); }}>Show all</button>}
              </div>
            </div>
            {/* The tier and the query change what the grid holds; the resulting count is announced, not only redrawn. */}
            <p className="sr-only" role="status" aria-live="polite" data-testid="partner-filter-status">
              {matched === 0 ? "No partner matches the current filter." : `Showing ${matched} partner${matched === 1 ? "" : "s"}${tierTitle ? ` in “${tierTitle}”` : ""}.`}
            </p>
            {visible.length ? (
              <PartnerTable ev={ev} groups={visible} openFolds={view.openFolds} onToggleFold={view.toggleFold} />
            ) : (
              <Statement title="No partner matches">
                {`No partner of ${ev.gene}${tierTitle ? ` in “${tierTitle}”` : ""} has a gene or accession containing “${query.trim()}”.`}
              </Statement>
            )}
          </>
        ) : (
          <Statement title={loading ? "Reading partners" : failed ? "Partners not retrieved" : "No partners listed"} action={retry}>
            {loading ? `Asking UniProt, IntAct and STRING about ${ev.gene}.` : [ev.sections.uniprot.reason, ev.sections.stringPhysical.reason].filter(Boolean).join(" ")}
          </Statement>
        )}
        <div className="ifc-foot">
          <span>
            STRING scores are association, not binding strength. Physical: evidence the two bind or share a complex; functional: any
            association (co-expression, text mining, pathways). Ticks at {STRING_CONFIDENCE_CUTS.map(c => c.min.toFixed(2)).reverse().join(", ")} are STRING&apos;s bands
            {ev.string.version ? `; STRING ${ev.string.version}` : ""}. A score links to the pair on STRING. Proteins from another species have no score in the human network.
            {ev.sections.intact.state === "failed" ? ` ${ev.sections.intact.reason}` : ""}
          </span>
          {ev.stringUrl && (
            <a className="ifc-link" href={ev.stringUrl} target="_blank" rel="noopener noreferrer">
              Open in STRING
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
