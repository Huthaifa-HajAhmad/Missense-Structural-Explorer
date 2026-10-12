import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Copy, ExternalLink, Pin } from "lucide-react";
import type { PaperReading, VariantForms } from "../../shared/literatureEvidence";
import type { GeneConstraint } from "../../shared/literatureScreening";
import { MarkedText } from "./MarkedText";
import { MechanismPanel } from "./MechanismPanel";
import { ScreeningChips, screeningTagLabels } from "./ScreeningChips";
import { whyRead } from "../../shared/literatureScreening";
import { safeExternalHref } from '../../shared/externalLink';

interface PaperTableProps {
  papers: readonly PaperReading[];
  gene: string;
  forms: VariantForms | null;
  onTogglePin: (paper: PaperReading) => void;
  constraint: GeneConstraint | null;
  constraintUnavailableReason?: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  reveal?: number;
  onRevealed?: () => void;
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
export function PaperTable({ papers, gene, forms, onTogglePin, constraint, constraintUnavailableReason, selectedId, onSelect, reveal = 0, onRevealed }: PaperTableProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  useEffect(() => {
    if (!reveal) return;
    const target = document.getElementById(`lit-paper-${selectedId}`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: 'nearest' });
    onRevealed?.();
  }, [reveal, selectedId, papers]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async (id: string) => {
    setCopyError(null);
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(id);
      setCopied(id);
      if (timer.current) clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 2000);
    } catch { setCopyError('Could not copy the identifier. Select and copy it from the record.'); }
  };

  return (
    <div className="lit-table-wrap">
      {copyError && <p className="lit-callout" role="alert">{copyError}</p>}
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
          const detailId = `lit-detail-${encodeURIComponent(c.id)}`;
          return (
            <tbody key={c.id} data-open={isOpen || undefined} data-level={m.level} data-selected={selectedId === c.id || undefined}>
              <tr className="lit-row" data-testid={`paper-${c.id}`}>
                <td className="lit-col-year lit-mono">{c.year ?? <span className="lit-dim">—</span>}</td>
                <td className="lit-paper">
                  <button
                    type="button"
                    className="lit-title"
                    id={`lit-paper-${c.id}`}
                    aria-expanded={isOpen}
                    aria-controls={detailId}
                    onClick={() => { onSelect?.(c.id); setOpen(prev => ({ ...prev, [c.id]: !prev[c.id] })); }}
                  >
                    <ChevronRight className="lit-title__chev" aria-hidden="true" />
                    <span><MarkedText text={c.title} gene={gene} forms={forms} /></span>
                  </button>
                  <span className="lit-meta">
                    <span className="lit-meta__authors" title={c.authors}>{c.authors || "Authors not listed"}</span>
                    <span className="lit-meta__journal" title={c.journal}>{c.journal || "Journal not listed"}</span>
                    <span className="lit-meta__id lit-mono">{identifier.label}</span>
                  </span>
                  <a className="lit-link lit-open-paper" href={paper.href} target="_blank" rel="noopener noreferrer" aria-label={`Open paper: ${c.title}`}><ExternalLink aria-hidden="true" />Open paper<span className="sr-only"> (opens in a new tab)</span></a>
                  {onSelect && <button type="button" className="lit-link lit-inspect-paper" aria-pressed={selectedId === c.id} onClick={() => onSelect(c.id)}>Inspect source</button>}
                  {whyRead(paper.screening) && <p className="lit-why-read" title={whyRead(paper.screening) ?? undefined}>Why read this: {whyRead(paper.screening)}</p>}
                  <span className="lit-chips">
                    <ScreeningChips tags={paper.screening.tags} />
                    {m.level === "elsewhere" && <span className="ev-tier" data-tone="muted">Not in title/abstract</span>}
                    {/* A curated record relationship is provider provenance, not a screening tag and
                        not a quote. It gets its own link so the source can be opened. */}
                    {paper.screening.citedBy?.map(link => (
                      <a
                        key={`${link.pmid}-${link.sourceUrl}`}
                        className="lit-curated-chip"
                        href={safeExternalHref(link.sourceUrl) ?? undefined}
                        aria-disabled={!safeExternalHref(link.sourceUrl) || undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${link.label}${link.detail ? ` · ${link.detail}` : ""} · PMID ${link.pmid}`}
                      >
                        {link.label}
                        <span className="sr-only"> (opens the provider record in a new tab)</span>
                      </a>
                    ))}
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
                    {Array.from(new Map(paper.screening.tags.map(tag => [tag.quote, {
                      ...tag, label: paper.screening.tags.filter(item => item.quote === tag.quote).map(item => screeningTagLabels[item.tag]).join(" · ")
                    }])).values()).map(tag => (
                      <figure className="lit-quote" key={`${tag.tag}-${tag.source}`}>
                        <figcaption className="lit-quote__label">{tag.label} · {tag.source.replace(/-/g, " ")}</figcaption>
                        <blockquote><MarkedText text={tag.quote} gene={gene} forms={forms} /></blockquote>
                      </figure>
                    ))}
                    {paper.screening.citedBy?.map(link => (
                      <div className="lit-curated" key={`${link.pmid}-${link.sourceUrl}`}>
                        <p className="lit-curated__label">{link.label}</p>
                        <p className="lit-curated__detail">
                          {link.detail && <span>{link.detail}</span>}
                          <span className="lit-mono">PMID {link.pmid}</span>
                          <a className="lit-link" href={safeExternalHref(link.sourceUrl) ?? undefined} aria-disabled={!safeExternalHref(link.sourceUrl) || undefined} target="_blank" rel="noopener noreferrer">
                            <ExternalLink aria-hidden="true" />
                            Provider record
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                          <span className="lit-dim">retrieved {link.retrievedAt.slice(0, 10)}</span>
                        </p>
                      </div>
                    ))}
                    <p className="lit-abstract">
                      {c.abstract.trim()
                        ? <MarkedText text={c.abstract} gene={gene} forms={forms} />
                        : <span className="lit-dim">Europe PMC returned no abstract for this record.</span>}
                    </p>
                    {paper.screening.mechanismTerms.length > 0 && (
                      <MechanismPanel
                        terms={paper.screening.mechanismTerms}
                        constraint={constraint}
                        unavailableReason={constraintUnavailableReason}
                      />
                    )}
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
