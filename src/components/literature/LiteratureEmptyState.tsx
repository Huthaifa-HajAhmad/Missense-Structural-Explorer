import React from "react";
import type { GroupFilter, LiteratureScope, VariantForms } from "../../shared/literatureEvidence";
import type { ScreeningTagName } from "../../shared/literatureScreening";
import type { TierFilter } from "./screeningFilters";
import { groupLabel } from "./LiteratureControls";

interface LiteratureEmptyStateProps {
  loadingFirst: boolean;
  gene: string;
  forms: VariantForms | null;
  total: number;
  isNarrowingFilter: boolean;
  activeFilter: string;
  executedFilter: string;
  scope: LiteratureScope;
  tierFilter: TierFilter;
  tagFilters: readonly ScreeningTagName[];
  groupFilter: GroupFilter;
  onClearScreeningFilters: () => void;
}

/** Loading and explicit empty-state statements for the Reading desk. */
export function LiteratureEmptyState({
  loadingFirst,
  gene,
  forms,
  total,
  isNarrowingFilter,
  activeFilter,
  executedFilter,
  scope,
  tierFilter,
  tagFilters,
  groupFilter,
  onClearScreeningFilters,
}: LiteratureEmptyStateProps) {
  if (loadingFirst) {
    return (
      <div className="lit-empty" role="status" aria-busy="true">
        <p className="lit-empty__title">Searching Europe PMC…</p>
        <p className="lit-empty__body">Asking for the best matches on {gene}. A large gene can take up to 30 seconds.</p>
      </div>
    );
  }

  return (
    <div className="lit-empty" data-testid="literature-empty">
      {isNarrowingFilter ? (
        <>
          <p className="lit-empty__title">{total === 0 ? "No papers loaded" : "No matches in the loaded list"}</p>
          <p className="lit-empty__body">
            {total === 0 ? "No papers are loaded yet." : `None of the ${total} loaded papers match “${activeFilter}”.`} Press Enter to search Europe PMC for it.
          </p>
        </>
      ) : (tierFilter !== "all" || tagFilters.length > 0) && total > 0 ? (
        <>
          <p className="lit-empty__title">No loaded paper matches these screening filters</p>
          <p className="lit-empty__body">
            The {total} loaded papers do not combine the chosen tier and observations.{" "}
            <button type="button" className="lit-link lit-link--btn lit-link--inline" onClick={onClearScreeningFilters}>
              Clear screening filters
            </button>
          </p>
        </>
      ) : groupFilter !== "all" && total > 0 ? (
        <>
          <p className="lit-empty__title">None in this group</p>
          <p className="lit-empty__body">
            No loaded paper falls under “{groupLabel(groupFilter, gene, forms?.label ?? null)}”. Choose All to see the full list.
          </p>
        </>
      ) : (
        <>
          <p className="lit-empty__title">
            {scope === "variant" && forms ? "No papers for this search" : "No papers returned"}
          </p>
          <p className="lit-empty__body">
            {scope === "variant" && forms
              ? `Try All on ${gene}, or write your own query.`
              : executedFilter
                ? "Europe PMC returned no records for this query. Edit the search and press Enter."
                : `Europe PMC returned no records for the default ${gene} query. Try a keyword or a MeSH term.`}
          </p>
        </>
      )}
    </div>
  );
}
