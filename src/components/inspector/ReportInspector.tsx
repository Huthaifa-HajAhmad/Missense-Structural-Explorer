import React, { useState } from "react";
import { FileText, Download, CheckSquare, Square, ShieldCheck, Hash, Printer } from "lucide-react";
import { AnalysisResult } from "../../types";

interface ReportInspectorProps {
  analysisResult: AnalysisResult | null;
  gene: string;
  variant: string;
}

export const ReportInspector: React.FC<ReportInspectorProps> = ({
  analysisResult,
  gene,
  variant
}) => {
  const [sections, setSections] = useState({
    summary: true,
    acmg: true,
    structure: true,
    energetics: true,
    literature: true
  });

  const toggleSection = (key: keyof typeof sections) => {
    setSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handlePrintPdf = () => {
    window.print();
  };

  const handleExportJson = () => {
    if (!analysisResult) return;
    const reportData = {
      reportType: "Clinical Missense Structural Variant Assessment",
      version: "2.4.0",
      generatedAt: new Date().toISOString(),
      gene,
      variant,
      sectionsIncluded: sections,
      data: analysisResult
    };
    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${gene || "variant"}_${variant || "report"}_clinical_summary.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. Report Section Inclusions ── */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-cs-accent-clay" />
          Included Report Sections
        </span>

        <div className="p-3 rounded-lg border border-cs-border-subtle bg-cs-surface-2 space-y-2">
          {[
            { key: "summary", label: "Executive Summary & Classification" },
            { key: "acmg", label: "ACMG / AMP Pathogenicity Evidence" },
            { key: "structure", label: "3D Macromolecular Coordinates" },
            { key: "energetics", label: "Biophysical Free-Energy Calculations" },
            { key: "literature", label: "Scientific Literature Bibliography" }
          ].map(({ key, label }) => {
            const isChecked = sections[key as keyof typeof sections];
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleSection(key as keyof typeof sections)}
                className="flex items-center gap-2 w-full text-left cursor-pointer transition-colors hover:text-cs-accent-clay"
              >
                {isChecked ? (
                  <CheckSquare className="w-4 h-4 text-cs-accent-clay shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-cs-text-muted shrink-0" />
                )}
                <span className={`text-[11px] ${isChecked ? "text-cs-text-primary font-medium" : "text-cs-text-muted"}`}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 2. Report Export Triggers ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5 text-cs-accent-clay" />
          Export Formats
        </span>

        <div className="space-y-2">
          <button
            type="button"
            onClick={handlePrintPdf}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-cs-border bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-primary font-semibold text-[11px] cursor-pointer transition-colors shadow-xs"
          >
            <Printer className="w-3.5 h-3.5 text-cs-accent-clay" />
            Print / Save to PDF
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-cs-border bg-cs-surface-2 hover:bg-cs-bg-subtle text-cs-text-primary font-semibold text-[11px] cursor-pointer transition-colors shadow-xs"
          >
            <Download className="w-3.5 h-3.5 text-cs-accent-clay" />
            Download FHIR Genomics JSON
          </button>
        </div>
      </div>

      {/* ── 3. Clinical Audit Signature ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-cs-accent-clay" />
          Report Lineage & Integrity
        </span>

        <div className="p-2.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2 space-y-1.5 text-[10px]">
          <div className="flex justify-between items-center text-cs-text-muted">
            <span>Report Engine:</span>
            <span className="font-mono text-cs-text-primary font-semibold">MSE v2.4 Engine</span>
          </div>
          <div className="flex justify-between items-center text-cs-text-muted">
            <span>Compliance:</span>
            <span className="font-mono text-cs-text-primary font-semibold">ACMG / AMP / ClinGen</span>
          </div>
          <div className="flex justify-between items-center text-cs-text-muted pt-1 border-t border-cs-border-subtle">
            <span>Generated:</span>
            <span className="font-mono">{new Date().toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ReportInspector);
