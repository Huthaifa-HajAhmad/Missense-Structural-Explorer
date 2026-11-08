import React, { useMemo } from "react";
import type { AnalysisResult } from "../../types";
import { buildVariantBreakdown, type BreakdownInput } from "./variantBreakdownModel";
import "../../styles/variant-breakdown.css";

interface VariantBreakdownProps extends BreakdownInput {
  result: AnalysisResult | null;
}

/**
 * The query card's reading of the variant once a run has started: gene, protein change, residue and its
 * position in the protein, UniProt accession, transcript and tier, build, genomic coordinate and numbering.
 *
 * Every cell has a fixed place from the first frame. A value that has not arrived says "Resolving…", and one
 * the finished run did not report says "Not reported", so the grid is as tall when the run starts as when it
 * ends. (The card itself may still gain the workspace-loaded line above it and any caveat notes below it.) A
 * value that carries a caveat (a lifted build, an unverified numbering, a retired gene symbol, how an rsID was
 * read) says so under the grid, in the same words the Population rail uses.
 */
export function VariantBreakdown({ typed, result, settled }: VariantBreakdownProps) {
  const { cells, notes, progress } = useMemo(() => buildVariantBreakdown({ typed, result, settled }), [typed, result, settled]);
  const status = !settled
    ? `Resolving · ${progress.known} of ${progress.total}`
    : progress.absent > 0
      ? `${progress.absent} not reported`
      : "Resolved";
  return (
    <section className="qe-breakdown" aria-labelledby="variant-breakdown-title" aria-busy={!settled} data-testid="variant-breakdown">
      <header className="qe-breakdown__head">
        <h3 id="variant-breakdown-title">Variant breakdown</h3>
        <span className="qe-breakdown__status" data-state={!settled ? "pending" : progress.absent > 0 ? "partial" : "done"}>{status}</span>
      </header>
      <dl className="qe-breakdown__grid">
        {cells.map(cell => (
          <div key={cell.id} className="qe-breakdown__cell" data-cell={cell.id} data-state={cell.state} title={cell.title ?? undefined}>
            <dt>
              {cell.label}
              {cell.tag && <span className="qe-breakdown__tag" data-tone={cell.tag.tone}>{cell.tag.label}</span>}
            </dt>
            <dd>
              <span className="qe-breakdown__value" data-state={cell.state}>
                {cell.value ?? (cell.state === "pending" ? "Resolving…" : "Not reported")}
              </span>
              {cell.sub && <span className="qe-breakdown__sub">{cell.sub}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {notes.length > 0 && (
        <ul className="qe-breakdown__notes">
          {notes.map(note => (
            <li key={note.id} data-tone={note.tone} data-note={note.id}>{note.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
