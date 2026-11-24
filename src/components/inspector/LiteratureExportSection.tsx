import React from "react";
import { Download } from "lucide-react";
import type { LiteratureEvidence, PaperReading } from "../../shared/literatureEvidence";
import { LEXICON_VERSION } from "../../shared/literatureScreening";
import { downloadBlob } from "../../lib/download";
import { buildCitationExport, shortlistRecords } from "./literatureExport";

interface LiteratureExportSectionProps {
  gene: string;
  variant: string;
  searchQuery: string;
  evidence?: LiteratureEvidence | null;
  view: "map" | "records" | "summary" | "gaps";
  onOpenReadingDesk: () => void;
}

/** Export section for the Literature rail: serialises visible desk rows or loaded shortlist. */
export function LiteratureExportSection({
  gene,
  variant,
  searchQuery,
  evidence,
  view,
  onOpenReadingDesk,
}: LiteratureExportSectionProps) {
  const readings: readonly PaperReading[] = evidence?.visible ?? [];
  // The shortlist is defined by the shared attention rule, not by whichever tier/filter the reader
  // happens to have selected in the table. Otherwise the default Read first view could silently omit
  // every Read next record from an action explicitly labelled "Export shortlist".
  const shortlistReadings = evidence ? shortlistRecords(evidence.papers) : [];
  const citationCount = readings.length;
  const sentQuery = evidence?.response?.europePmcQuery ?? null;
  const isReadingDesk = view === "map";

  const handleExportCitations = (format: "bibtex" | "ris" | "csv", shortlistOnly = false) => {
    if (!isReadingDesk) return;
    const records = shortlistOnly ? shortlistReadings : readings;
    if (records.length === 0) return;

    const header = {
      query: (sentQuery ?? searchQuery) || "Gene-wide default",
      lexiconVersion: LEXICON_VERSION,
      date: new Date(evidence?.response?.fetchedAt ?? Date.now()).toISOString().slice(0, 10),
    };
    const { content, mime, ext } = buildCitationExport(format, records, {
      gene: gene || "",
      variant: variant || "",
      header,
    });

    downloadBlob(
      `${gene || "gene"}_literature_${shortlistOnly ? "shortlist" : "export"}.${ext}`,
      mime,
      content,
      4000
    );
  };

  return (
    <section className="rail-section" aria-labelledby="lit-rail-export">
      <h3 className="eyebrow" id="lit-rail-export">
        <Download className="w-3.5 h-3.5" />
        Export
      </h3>
      <p className="lit-rail__lead">
        {!isReadingDesk
          ? "Export saves the papers listed in the reading desk. Open it to choose and export them."
          : citationCount > 0
            ? `The ${citationCount} ${citationCount === 1 ? "paper" : "papers"} shown, with any filter applied.`
            : "No papers are shown, so there is nothing to export."}
      </p>
      <div className="lit-rail__export">
        {(["bibtex", "ris", "csv"] as const).map(fmt => (
          <button
            key={fmt}
            type="button"
            className="lit-btn lit-btn--quiet"
            onClick={() => handleExportCitations(fmt)}
            disabled={!isReadingDesk || citationCount === 0}
            title={!isReadingDesk ? "Open the reading desk to export papers" : citationCount === 0 ? "Load papers first" : `Download ${fmt.toUpperCase()} of the shown papers`}
          >
            <Download aria-hidden="true" />
            {fmt === "bibtex" ? "BibTeX" : fmt.toUpperCase()}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="lit-btn lit-btn--quiet lit-shortlist-export"
        onClick={() => handleExportCitations("csv", true)}
        disabled={!isReadingDesk || shortlistReadings.length === 0}
        title={!isReadingDesk ? "Open the reading desk to export papers" : "Download all loaded Read first and Read next papers as CSV, regardless of desk filters"}
      >
        <Download aria-hidden="true" /> Export shortlist
      </button>
      {!isReadingDesk && (
        <button
          type="button"
          className="lit-btn lit-btn--quiet lit-shortlist-export"
          onClick={onOpenReadingDesk}
        >
          Go to reading desk
        </button>
      )}
      {isReadingDesk && (
        <p className="rail-step__sub">Shortlist export includes all loaded Read first and Read next papers, including those outside the current filters.</p>
      )}
      {evidence && evidence.counts.pinned > 0 && (
        <p className="rail-step__sub">{evidence.counts.pinned} pinned for the Report — pins are kept per variant and appear in its literature block.</p>
      )}
    </section>
  );
}
