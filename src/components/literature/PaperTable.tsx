import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Copy, ExternalLink, Pin } from "lucide-react";
import type { PaperReading, VariantForms } from "../../shared/literatureEvidence";
import { MarkedText } from "./MarkedText";

interface PaperTableProps {
  papers: readonly PaperReading[];
  gene: string;
  forms: VariantForms | null;
  onTogglePin: (paper: PaperReading) => void;
}

/**
 * The papers, as ONE table: year · paper · identifier · report.
 *
 * A row is the reviewer's scan line — title, who/where, and up to three chips that say what the text
 * check found. The abstract lives in a detail row that opens under its paper, so the table keeps its
 * rhythm and a long abstract never pushes the next title off screen. The previous list was a stack of
 * cards whose only control was a chevron; "Add to report" was hidden inside the expanded body.
 *
 * Chips state what the literal check found and nothing more ("Names p.Asp116Gly", "Gene not in
 * abstract"); they are not assertions about the paper's conclusions.
 */
export function PaperTable({ papers, gene, forms, onTogglePin }: PaperTableProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = (id: string) => {
    void navigator.clipboard?.writeText(id);
    setCopied(id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="lit-table-wrap">
      <table className="lit-table" data-testid="literature-table">
        <thead>
          <tr>
            <th scope="col" className="lit-col-year">Year</th>
            <th scope="col">Paper</th>
            <th scope="col" className="lit-col-id">Identifier</th>
            <th scope="col" className="lit-col-pin"><span className="sr-only">Add to the report</span></th>
          </tr>
        </thead>
        {papers.map(paper => {
          const { citation: c, mentions: m, identifier } = paper;
          const isOpen = !!open[c.id];
          const detailId = `lit-detail-${c.id.replace(/[^A-Za-z0-9_-]/g, "")}`;
          return (
            <tbody key={c.id} data-open={isOpen || undefined} data-level={m.level}>
              <tr className="lit-row" data-testid={`paper-${c.id}`}>
                <td className="lit-col-year lit-mono">{c.year ?? <span className="lit-dim">—</span>}</td>
                <td className="lit-paper">
                  <button
                    type="button"
                    className="lit-title"
                    aria-expanded={isOpen}
                    aria-controls={detailId}
                    onClick={() => setOpen(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                  >
                    <ChevronRight className="lit-title__chev" aria-hidden="true" />
                    <span><MarkedText text={c.title} gene={gene} forms={forms} /></span>
                  </button>
                  <span className="lit-meta">
                    <span className="lit-meta__authors" title={c.authors}>{c.authors || "Authors not listed"}</span>
                    <span className="lit-meta__journal" title={c.journal}>{c.journal || "Journal not listed"}</span>
                    <span className="lit-meta__id lit-mono">{identifier.label}</span>
                  </span>
                  <span className="lit-chips">
                    {m.level === "variant" && forms && (
                      <span
                        className="ev-tier"
                        data-tone="accent"
                        title={`${m.matchedForm} appears in the ${m.variantIn}. A literal text match, not a reading of the paper's findings.`}
                      >
                        Names {forms.label}
                      </span>
                    )}
                    {m.level === "gene" && (
                      <span className="ev-tier" data-tone="neutral" title={`${gene} appears in the ${m.geneIn.join(" and ")}, but the variant was not found in either.`}>
                        Names {gene} only
                      </span>
                    )}
                    {m.level === "elsewhere" && (
                      <span
                        className="ev-tier"
                        data-tone="muted"
                        title={`Europe PMC matched this record on its text, but ${gene} is not in the title or abstract.`}
                      >
                        {gene} not in abstract
                      </span>
                    )}
                    {!m.hasAbstract && (
                      <span className="ev-tier" data-tone="muted" title="No abstract was returned, so only the title was checked.">
                        Title only
                      </span>
                    )}
                  </span>
                </td>
                <td className="lit-col-id lit-mono">
                  <span title={identifier.label}>{identifier.label}</span>
                </td>
                <td className="lit-col-pin">
                  <button
                    type="button"
                    className="lit-icon-btn"
                    aria-pressed={paper.pinned}
                    aria-label={paper.pinned ? `Remove "${c.title}" from the report` : `Add "${c.title}" to the report`}
                    title={paper.pinned ? "In the report — click to remove" : "Add to the report"}
                    onClick={() => onTogglePin(paper)}
                  >
                    <Pin aria-hidden="true" />
                  </button>
                </td>
              </tr>
              {isOpen && (
                <tr className="lit-detail" id={detailId}>
                  <td />
                  <td colSpan={3}>
                    {m.snippet && (
                      <figure className="lit-quote">
                        <figcaption className="lit-quote__label">Sentence naming the variant</figcaption>
                        <blockquote><MarkedText text={m.snippet} gene={gene} forms={forms} /></blockquote>
                      </figure>
                    )}
                    <p className="lit-abstract">
                      {c.abstract.trim()
                        ? <MarkedText text={c.abstract} gene={gene} forms={forms} />
                        : <span className="lit-dim">Europe PMC returned no abstract for this record.</span>}
                    </p>
                    <div className="lit-actions">
                      <a className="lit-link" href={paper.href} target="_blank" rel="noopener noreferrer">
                        <ExternalLink aria-hidden="true" />
                        {paper.hrefLabel}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                      <button type="button" className="lit-link lit-link--btn" onClick={() => copy(c.id)} aria-live="polite">
                        {copied === c.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                        {copied === c.id ? "Copied" : identifier.kind === "pmid" ? "Copy PMID" : "Copy ID"}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
