import React from "react";
import { ChevronDown, Search } from "lucide-react";
import type {
  GroupFilter,
  LiteratureEvidence,
  LiteratureResponseMeta,
  VariantForms,
  VariantProbe,
} from "../../shared/literatureEvidence";
import type { ScreeningTagName } from "../../shared/literatureScreening";
import type { TierFilter } from "./screeningFilters";

/** Worded like the Mention coverage rows that open these filters, so one group has one name. */
export const groupLabel = (g: GroupFilter, gene: string, variantLabel: string | null): string =>
  g === "all" ? "Any" : g === "variant" ? `Names ${variantLabel ?? "the variant"}` : g === "gene" ? `Names only ${gene}` : "Neither in title/abstract";

const screeningFilters: Array<{ tag: ScreeningTagName; label: string }> = [
  { tag: "functional-assay", label: "Assay language" },
  { tag: "clinical-case", label: "Clinical study" },
  { tag: "same-residue", label: "Same residue" },
  { tag: "mechanism", label: "Mechanism language" },
  { tag: "review", label: "Review" },
  { tag: "preprint", label: "Preprint" },
];

interface LiteratureControlsProps {
  gene: string;
  forms: VariantForms | null;
  variantQuery: string | null;
  aliasQuery: string | null;
  evidence: LiteratureEvidence;
  response: LiteratureResponseMeta | null;
  probe: VariantProbe;
  geneHitCount: number | null;
  isLoading: boolean;
  internalQuery: string;
  executedFilter: string;
  onDraftChange: (value: string) => void;
  onRunSearch: (forceSync: boolean, queryOverride?: string) => void;
  tierFilter: TierFilter;
  onTierFilterChange: (tier: TierFilter) => void;
  tagFilters: ScreeningTagName[];
  onToggleTag: (tag: ScreeningTagName) => void;
  groupFilter: GroupFilter;
  onGroupFilterChange: (group: GroupFilter) => void;
  onClearFilters: () => void;
  filtersOpen: boolean;
  onToggleFiltersOpen: () => void;
  sortOrder: "attention" | "newest";
  onSortOrderChange: (order: "attention" | "newest") => void;
}

const fmt = (v: number | null) => (v === null ? null : v.toLocaleString("en-GB"));

/** Reading desk toolbar: upstream query/scope controls and loaded-set local filters/sort. */
export function LiteratureControls({
  gene,
  forms,
  variantQuery,
  aliasQuery,
  evidence,
  response,
  probe,
  geneHitCount,
  isLoading,
  internalQuery,
  executedFilter,
  onDraftChange,
  onRunSearch,
  tierFilter,
  onTierFilterChange,
  tagFilters,
  onToggleTag,
  groupFilter,
  onGroupFilterChange,
  onClearFilters,
  filtersOpen,
  onToggleFiltersOpen,
  sortOrder,
  onSortOrderChange,
}: LiteratureControlsProps) {
  const { counts } = evidence;
  const activeFilterCount = tagFilters.length + Number(groupFilter !== "all");
  // Focused searches offered beside the two scope buttons. Each one runs a Europe PMC query.
  const presets = [
    ...(aliasQuery ? [{ label: "Verified nucleotide aliases", query: aliasQuery }] : []),
    { label: "Clinical reports", query: `TITLE_ABS:${gene} AND (patient OR proband OR "case report" OR segregation)` },
    { label: "Functional studies", query: `TITLE_ABS:${gene} AND ("functional assay" OR "enzyme activity" OR "in vitro" OR rescue)` },
  ];
  const variantHit = evidence.scope === "variant" ? (response?.degraded ? null : response?.hitCount ?? null) : probe.state === "done" ? probe.hitCount : null;
  const geneCount = evidence.scope === "gene" ? (response?.degraded ? null : response?.hitCount ?? null) : geneHitCount;

  return (
    <div className="lit-controls">
      {/* What to ask Europe PMC. Every button here runs a search. */}
      <div className="lit-control-group" role="group" aria-label="Search Europe PMC">
        <div className="lit-control-row lit-control-row--search">
          <span className="lit-control-row__label" aria-hidden="true">Search</span>
          <form
            className="lit-search"
            role="search"
            onSubmit={e => {
              e.preventDefault();
              // Explicit search, not a cache read: the button promises "Search Europe PMC", so a
              // fresh cached set must not satisfy it without going upstream.
              onRunSearch(true);
            }}
          >
            <label className="sr-only" htmlFor="lit-search-input">Search literature</label>
            <Search className="lit-search__icon" aria-hidden="true" />
            <input
              id="lit-search-input"
              type="text"
              value={internalQuery}
              onChange={e => onDraftChange(e.target.value)}
              placeholder="Keyword, author or MeSH — typing narrows this list, Enter searches Europe PMC"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="lit-btn" disabled={isLoading}>
              Search Europe PMC
            </button>
          </form>
        </div>
        <div className="lit-control-row">
          <div className="lit-groups" role="group" aria-label="Which papers to search for">
            <button
              type="button"
              className="lit-seg"
              aria-pressed={evidence.scope === "gene"}
              disabled={isLoading && evidence.scope === "gene"}
              onClick={() => onRunSearch(false, "")}
            >
              All on {gene}
              {fmt(geneCount) && <span className="lit-seg__n">{fmt(geneCount)}</span>}
            </button>
            {forms && variantQuery && (
              <button
                type="button"
                className="lit-seg"
                aria-pressed={evidence.scope === "variant"}
                disabled={isLoading && evidence.scope === "variant"}
                onClick={() => onRunSearch(false, variantQuery)}
              >
                Naming {forms.label}
                {fmt(variantHit) && <span className="lit-seg__n">{fmt(variantHit)}</span>}
              </button>
            )}
            {presets.map(preset => (
              <button
                key={preset.label}
                type="button"
                className="lit-seg"
                aria-pressed={preset.query.toLowerCase() === executedFilter.toLowerCase()}
                disabled={isLoading}
                onClick={() => onRunSearch(false, preset.query)}
              >
                {preset.label}
              </button>
            ))}
            {evidence.scope === "custom" && !presets.some(preset => preset.query.toLowerCase() === executedFilter.toLowerCase()) && (
              <span className="ev-tier" data-tone="neutral" title="A query you typed or applied from the inspector">Custom query</span>
            )}
          </div>
        </div>
      </div>

      {/* What to show from the papers already loaded. Nothing here calls Europe PMC. */}
      {counts.total > 0 && (
        <div className="lit-control-group" role="group" aria-label="Show loaded papers">
          <div className="lit-control-row">
            <span className="lit-control-row__label" aria-hidden="true">Show</span>
            <div className="lit-groups">
              <div className="lit-groups" role="group" aria-label="Filter by reading tier">
                {(["readFirst", "readNext", "all"] as TierFilter[]).map(tier => {
                  const count = tier === "readFirst" ? evidence.shortlist.readFirst : tier === "readNext" ? evidence.shortlist.readNext : evidence.counts.total;
                  const label = tier === "readFirst" ? "Read first" : tier === "readNext" ? "Read next" : "All loaded";
                  return <button key={tier} type="button" className="lit-group" aria-label={tier === "all" ? "All loaded: show all tiers" : undefined} aria-pressed={tierFilter === tier} disabled={tier !== "all" && count === 0} onClick={() => onTierFilterChange(tier)}>{label}<span className="lit-group__n">{count}</span></button>;
                })}
              </div>
              <button type="button" className="lit-group lit-filter-toggle" aria-expanded={filtersOpen} aria-controls={filtersOpen ? "lit-filters" : undefined} onClick={onToggleFiltersOpen}>
                Filters
                {activeFilterCount > 0 && <span className="lit-group__n">{activeFilterCount} active</span>}
                <ChevronDown aria-hidden="true" />
              </button>
              <span className="lit-sort" role="group" aria-label="Sort papers">
                <span>Sort</span>
                <button type="button" className="lit-group" aria-pressed={sortOrder === "attention"} title="Orders papers by screening tier, 1 to 6. A reading order, not a quality score." onClick={() => onSortOrderChange("attention")}>Screening tier</button>
                <button type="button" className="lit-group" aria-pressed={sortOrder === "newest"} onClick={() => onSortOrderChange("newest")}>Newest</button>
              </span>
            </div>
          </div>
          {filtersOpen && (
            <div className="lit-control-group" id="lit-filters">
              <div className="lit-control-row">
                <span className="lit-control-row__label" aria-hidden="true">Observed</span>
                <div className="lit-groups" role="group" aria-label="Filter by screening observation">
                  {screeningFilters.map(({ tag, label }) => {
                    const count = evidence.shortlist.tags[tag];
                    const active = tagFilters.includes(tag);
                    return <button key={tag} type="button" className="lit-group" aria-pressed={active} disabled={count === 0} onClick={() => onToggleTag(tag)}>{label}<span className="lit-group__n">{count}</span></button>;
                  })}
                </div>
              </div>
              <div className="lit-control-row">
                <span className="lit-control-row__label" aria-hidden="true">Mentions</span>
                <div className="lit-groups" role="group" aria-label="Filter by what the text check found">
                  {(["all", ...(forms ? (["variant"] as const) : []), "gene", "elsewhere"] as GroupFilter[]).map(g => {
                    const n = g === "all" ? counts.total : counts[g];
                    return (
                      <button
                        key={g}
                        type="button"
                        className="lit-group"
                        aria-label={g === "all" ? "Any: show all text-check groups" : undefined}
                        aria-pressed={groupFilter === g}
                        disabled={g !== "all" && n === 0}
                        onClick={() => onGroupFilterChange(g)}
                      >
                        {groupLabel(g, gene, forms?.label ?? null)}
                        {g !== "all" && <span className="lit-group__n">{n}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="lit-control-row">
                <p className="lit-filter-note">
                  A paper must match every selected filter. Counts are for all loaded papers.
                  {activeFilterCount > 0 && <>{" "}<button type="button" className="lit-link" onClick={onClearFilters}>Clear filters</button></>}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
