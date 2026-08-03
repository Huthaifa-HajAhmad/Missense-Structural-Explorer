import React from "react";
import { TabComponentProps } from "./types";

export function ClinicalTab({ analysisState }: TabComponentProps) {
  const result = analysisState.result;
  if (!result) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="screen-title">Databases</h1>
        <p className="screen-tab-description">ClinVar clinical classifications, gnomAD v4.0 population allele counts, and All of Us cohort frequencies.</p>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Column 1: ClinVar Interpretation */}
        {result.clinvar && result.clinvar.classification && !result.clinvar.classification.toLowerCase().includes("not found") ? (
          <div 
            className="p-4 rounded-xl border transition-all duration-300 flex flex-col justify-between"
            style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
          >
            <div>
              <span className="block text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-text-secondary)" }}>ClinVar Interpretation</span>
              {(() => {
                const c = result.clinvar.classification.toLowerCase();
                let badgeStyle = {};
                if (c.includes("likely pathogenic")) {
                  badgeStyle = { color: "var(--cs-text-warning)", backgroundColor: "var(--cs-bg-warning)", borderColor: "var(--cs-text-warning)" };
                } else if (c.includes("pathogenic")) {
                  badgeStyle = { color: "var(--cs-text-danger)", backgroundColor: "var(--cs-bg-danger)", borderColor: "var(--cs-text-danger)" };
                } else if (c.includes("likely benign") || c.includes("benign")) {
                  badgeStyle = { color: "var(--cs-text-success)", backgroundColor: "var(--cs-bg-success)", borderColor: "var(--cs-text-success)" };
                } else {
                  badgeStyle = { color: "var(--cs-text-secondary)", backgroundColor: "var(--cs-surface-2)", borderColor: "var(--cs-border)" };
                }
                
                return (
                  <span 
                    className="inline-block mt-2 px-2.5 py-1 rounded-lg text-xs font-bold border"
                    style={badgeStyle}
                  >
                    {result.clinvar.classification}
                  </span>
                );
              })()}
            </div>
            
            <div className="mt-3 rounded-lg p-2.5 border font-sans text-xs space-y-2" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
              <div className="border-b pb-1.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
                <span className="block text-[9px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Review Status</span>
                <span className="text-[11px] font-semibold leading-relaxed" style={{ color: "var(--cs-text-primary)" }}>{result.clinvar.reviewStatus}</span>
              </div>
              <div className="border-b pb-1.5" style={{ borderColor: "var(--cs-border-subtle)" }}>
                <span className="block text-[9px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Associated Trait</span>
                <span className="text-[11px] font-semibold leading-relaxed block truncate" style={{ color: "var(--cs-text-primary)" }} title={result.clinvar.trait}>{result.clinvar.trait || "N/A"}</span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-[9px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Last Evaluated</span>
                <span className="font-mono font-medium" style={{ color: "var(--cs-text-primary)" }}>
                  {result.clinvar.lastEvaluated && !isNaN(new Date(result.clinvar.lastEvaluated).getTime()) ? new Date(result.clinvar.lastEvaluated).toLocaleDateString() : "N/A"}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div 
            className="p-4 rounded-xl border transition-all duration-300 flex flex-col justify-between"
            style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
          >
            <span className="block text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-text-secondary)" }}>
              ClinVar Interpretation
            </span>
            <div className="mt-3 rounded-lg p-2.5 border border-dashed font-sans text-xs italic flex items-center justify-center min-h-[70px] text-center" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)", color: "var(--cs-text-muted)" }}>
              Absent from NCBI ClinVar database (rare/novel variant).
            </div>
          </div>
        )}

        {/* Column 2: gnomAD Allele Count */}
        <div
          className="p-4 rounded-xl border transition-all duration-300"
          style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
        >
          <span className="block text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-text-secondary)" }}>gnomAD Allele Count</span>

          {result.gnomadFrequency && (
            (result.gnomadFrequency.genomeAC !== null && result.gnomadFrequency.genomeAC !== undefined) ||
            (result.gnomadFrequency.exomeAC !== null && result.gnomadFrequency.exomeAC !== undefined)
          ) ? (
            <div className="mt-3 space-y-2">
              {/* Genome AC/AN */}
              {result.gnomadFrequency.genomeAC !== null && result.gnomadFrequency.genomeAC !== undefined && (
                <div className="rounded-lg p-2.5 border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold" style={{ color: "var(--cs-text-secondary)" }}>Genomes (v4.0)</span>
                    <span className="font-bold font-mono" style={{ color: "var(--cs-accent-clay)" }}>
                      {result.gnomadFrequency.genomeAC.toLocaleString()}
                    </span>
                  </div>
                  {result.gnomadFrequency.genomeAN !== null && result.gnomadFrequency.genomeAN !== undefined && (
                    <div className="flex justify-between items-center text-[10px] mt-1">
                      <span style={{ color: "var(--cs-text-muted)" }}>Allele Number</span>
                      <span className="font-mono" style={{ color: "var(--cs-text-muted)" }}>
                        {result.gnomadFrequency.genomeAN.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {/* Exome AC/AN */}
              {result.gnomadFrequency.exomeAC !== null && result.gnomadFrequency.exomeAC !== undefined && (
                <div className="rounded-lg p-2.5 border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold" style={{ color: "var(--cs-text-secondary)" }}>Exomes (v4.0)</span>
                    <span className="font-bold font-mono" style={{ color: "var(--cs-accent-clay)" }}>
                      {result.gnomadFrequency.exomeAC.toLocaleString()}
                    </span>
                  </div>
                  {result.gnomadFrequency.exomeAN !== null && result.gnomadFrequency.exomeAN !== undefined && (
                    <div className="flex justify-between items-center text-[10px] mt-1">
                      <span style={{ color: "var(--cs-text-muted)" }}>Allele Number</span>
                      <span className="font-mono" style={{ color: "var(--cs-text-muted)" }}>
                        {result.gnomadFrequency.exomeAN.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {/* Homozygote count */}
              {result.gnomadFrequency.nHomozygous !== null && result.gnomadFrequency.nHomozygous !== undefined && result.gnomadFrequency.nHomozygous > 0 && (
                <div className="flex justify-between items-center text-[10px] pt-1">
                  <span style={{ color: "var(--cs-text-muted)" }}>Homozygotes observed</span>
                  <span className="font-mono font-bold" style={{ color: "var(--cs-danger)" }}>
                    {result.gnomadFrequency.nHomozygous}
                  </span>
                </div>
              )}
            </div>
          ) : result.clinvar && result.clinvar.alleleFrequencies && result.clinvar.alleleFrequencies.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {result.clinvar.alleleFrequencies.map((freq: any, fIdx: number) => (
                <div key={fIdx} className="flex justify-between items-center text-xs">
                  <span className="font-semibold" style={{ color: "var(--cs-text-secondary)" }}>{freq.source}:</span>
                  <span className="font-bold font-mono" style={{ color: "var(--cs-accent-clay)" }}>
                    {(() => {
                      const num = parseFloat(freq.value);
                      return isNaN(num) ? "N/A" : num.toExponential(3);
                    })()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state-box mt-3 text-xs">
              Absent from gnomAD population database (rare/novel variant).
            </div>
          )}
        </div>

        {/* Column 3: All of Us Allele Count */}
        <div
          className="p-4 rounded-xl border transition-all duration-300"
          style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
        >
          <span className="block text-[11px] font-medium uppercase tracking-wider font-sans" style={{ color: "var(--cs-text-secondary)" }}>All of Us Allele Count</span>
          {result.aouFrequency && (result.aouFrequency.aouAC !== null || result.aouFrequency.aouAN !== null) ? (
            <div className="mt-3 space-y-2">
              <div className="rounded-lg p-2.5 border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold" style={{ color: "var(--cs-text-secondary)" }}>Total Alleles (AC)</span>
                  <span className="font-bold font-mono" style={{ color: "var(--cs-accent-clay)" }}>
                    {result.aouFrequency.aouAC !== null && result.aouFrequency.aouAC !== undefined ? result.aouFrequency.aouAC.toLocaleString() : "0"}
                  </span>
                </div>
                {result.aouFrequency.aouAN !== null && result.aouFrequency.aouAN !== undefined && (
                  <div className="flex justify-between items-center text-[10px] mt-1">
                    <span style={{ color: "var(--cs-text-muted)" }}>Allele Number (AN)</span>
                    <span className="font-mono" style={{ color: "var(--cs-text-muted)" }}>
                      {result.aouFrequency.aouAN.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              <div className="rounded-lg p-2.5 border space-y-1.5" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold" style={{ color: "var(--cs-text-secondary)" }}>Heterozygotes (Het)</span>
                  <span className="font-bold font-mono" style={{ color: "var(--cs-text-primary)" }}>
                    {result.aouFrequency.aouHet !== null && result.aouFrequency.aouHet !== undefined ? result.aouFrequency.aouHet.toLocaleString() : "0"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold" style={{ color: "var(--cs-text-secondary)" }}>Homozygotes (Hom)</span>
                  <span className="font-bold font-mono" style={{ color: "var(--cs-text-primary)" }}>
                    {result.aouFrequency.aouHom !== null && result.aouFrequency.aouHom !== undefined ? result.aouFrequency.aouHom.toLocaleString() : "0"}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state-box mt-3 text-xs">
              Absent from All of Us population database (rare/novel variant).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
