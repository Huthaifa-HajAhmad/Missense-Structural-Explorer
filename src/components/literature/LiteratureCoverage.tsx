import React from "react";
import type { GroupFilter, VariantForms } from "../../shared/literatureEvidence";

interface CoverageRow {
  level: GroupFilter;
  count: number;
  total: number;
  percent: number;
}

interface LiteratureCoverageProps {
  gene: string;
  forms: VariantForms | null;
  total: number;
  curatedAdded: number;
  coverage: CoverageRow[];
  textCoverage: { total: number; withAbstract: number; withoutAbstract: number };
  isLoading: boolean;
  error: string | null;
  onSelectGroup: (level: GroupFilter) => void;
  onOpenReadingDesk: () => void;
}

/** Mention coverage view: literal title/abstract check denominators and abstract availability. */
export function LiteratureCoverage({
  gene,
  forms,
  total,
  curatedAdded,
  coverage,
  textCoverage,
  isLoading,
  error,
  onSelectGroup,
  onOpenReadingDesk,
}: LiteratureCoverageProps) {
  if (total === 0) {
    return (
      <section className="lit-empty">
        <h2>No loaded text to compare</h2>
        <p>
          {isLoading
            ? "The search is running."
            : error
              ? "The search failed. Retry from the reading desk."
              : "Search or load papers in the reading desk to inspect their mention coverage."}
        </p>
        <button type="button" className="review-action" onClick={onOpenReadingDesk}>
          Open reading desk
        </button>
      </section>
    );
  }

  return (
    <section className="lit-coverage" aria-labelledby="lit-coverage-title">
      <header>
        <h2 id="lit-coverage-title">What the loaded text names</h2>
        <p>
          {total} loaded papers{curatedAdded > 0 ? ` (including ${curatedAdded} curated additions)` : ""} · literal title and abstract checks · select a group to open matching papers
        </p>
      </header>
      <div className="lit-coverage__rows">
        {coverage.map(row => (
          <button type="button" key={row.level} onClick={() => onSelectGroup(row.level)}>
            <span>
              {row.level === "variant"
                ? `Names ${forms?.label}`
                : row.level === "gene"
                  ? `Names ${forms ? "only " : ""}${gene}`
                  : forms
                    ? "Neither in title/abstract"
                    : "Gene not in title/abstract"}
            </span>
            <span className="lit-coverage__track" aria-hidden="true"><i style={{ inlineSize: `${row.percent}%` }} /></span>
            <span className="lit-mono">{row.count}<small> / {row.total}</small></span>
          </button>
        ))}
      </div>
      <p className="lit-coverage__note">
        These are mentions, not evidence of a paper’s conclusion. Curated additions are included in this loaded set; unreturned search matches are not screened.
      </p>
      {!forms && (
        <p className="lit-coverage__note">Variant notation is unavailable; these groups check the gene only.</p>
      )}
      <div className="lit-text-coverage">
        <h3>How much text was available?</h3>
        <dl>
          <div><dt>With an abstract</dt><dd>{textCoverage.withAbstract}<small> / {textCoverage.total}</small></dd></div>
          <div><dt>Without an abstract</dt><dd>{textCoverage.withoutAbstract}<small> / {textCoverage.total}</small></dd></div>
        </dl>
        <p>
          A record without an abstract can only be screened against its title. A missing mention does not establish that the paper is irrelevant. Open the paper to assess its findings.
        </p>
      </div>
    </section>
  );
}
