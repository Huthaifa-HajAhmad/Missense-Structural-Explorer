import React from "react";
import { TabComponentProps } from "./types";
import { countPredictorConcordance } from "../../shared/thresholds";
import { PredictorSpecialistPanels } from "../PredictorSpecialistPanels";

export function PredictorsTab({ analysisState, isBiophysicalLoading }: TabComponentProps) {
  const result = analysisState.result;
  if (!result) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="screen-title">Predictors</h1>
        <p className="screen-tab-description">In-silico pathogenicity predictors with ACMG/AMP-calibrated thresholds and concordance voting.</p>
      </div>
      
      {/* Unified In-Silico Consensus & Coverage Card */}
      {(() => {
        const cadd = result.predictorData?.caddPhred;
        const revel = result.conservationData?.revel;
        const amScore = result.predictorData?.amPathogenicity;
        const amClass = result.predictorData?.amClass;
        const bayesdel = result.conservationData?.bayesdel;
        const esmLlr = result.conservationData?.esm1b;

        const concordance = countPredictorConcordance(cadd, revel, amScore, amClass, bayesdel, esmLlr, {
          metarnn: result.conservationData?.metarnn,
          clinpred: result.conservationData?.clinpred,
          eigenPhred: result.conservationData?.eigenPhred,
          dann: result.conservationData?.dann,
          popeve: result.conservationData?.popeve,
          spliceProximity: result.conservationData?.spliceProximity,
          spliceai: result.conservationData?.spliceai,
          dbscsnv: result.conservationData?.dbscsnv
        });
        const total = concordance.available.length;
        if (total === 0) return null;

        let verdictTitle = "VUS / Conflicting Evidence";
        let verdictBadgeLabel = "VUS";
        let verdictBadgeStyle: React.CSSProperties = { color: "var(--cs-text-warning)", backgroundColor: "var(--cs-bg-warning)", borderColor: "rgba(217,119,6,0.3)" };
        
        const activeVotingTotal = concordance.pathogenicTools.filter(t => !t.isInformationalOnly).length +
                                 concordance.benignTools.filter(t => !t.isInformationalOnly).length +
                                 concordance.vusTools.filter(t => !t.isInformationalOnly).length;

        const votingPathogenicCount = concordance.pathogenicTools.filter(t => !t.isInformationalOnly).length;
        const infoPathogenicCount = concordance.pathogenicTools.filter(t => t.isInformationalOnly).length;

        const votingBenignCount = concordance.benignTools.filter(t => !t.isInformationalOnly).length;
        const infoBenignCount = concordance.benignTools.filter(t => t.isInformationalOnly).length;

        if (concordance.nPathogenic > activeVotingTotal / 2) {
          verdictTitle = `Concordant Pathogenic (${concordance.nPathogenic}/${activeVotingTotal} consensus tools)`;
          verdictBadgeLabel = "Pathogenic";
          verdictBadgeStyle = { color: "var(--cs-text-danger)", backgroundColor: "var(--cs-bg-danger)", borderColor: "rgba(220,38,38,0.3)" };
        } else if (concordance.nBenign > activeVotingTotal / 2) {
          verdictTitle = `Concordant Benign (${concordance.nBenign}/${activeVotingTotal} consensus tools)`;
          verdictBadgeLabel = "Benign";
          verdictBadgeStyle = { color: "var(--cs-text-success)", backgroundColor: "var(--cs-bg-success)", borderColor: "rgba(22,163,74,0.3)" };
        } else {
          verdictTitle = `Conflicting Evidence (${concordance.nPathogenic} pathogenic, ${concordance.nBenign} benign, ${concordance.nVus} VUS)`;
        }

        return (
          <div 
            className="p-4.5 rounded-xl border flex flex-col gap-4 mb-4 animate-fade-in shadow-sm"
            style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
          >
            <div className="flex justify-between items-start">
              <div>
                <span className="block text-[10px] uppercase font-bold tracking-wider font-mono opacity-70" style={{ color: "var(--cs-text-muted)" }}>
                  🧬 In-Silico Pathogenicity Consensus
                </span>
                <h4 className="text-sm font-bold mt-1" style={{ color: "var(--cs-text-primary)" }}>
                  {verdictTitle}
                </h4>
              </div>
              <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border shrink-0" style={verdictBadgeStyle}>
                {verdictBadgeLabel}
              </span>
            </div>

            {(isBiophysicalLoading || analysisState.isLoading) && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-indigo-500/20 bg-indigo-500/5 text-[11px] text-indigo-400 font-medium animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping shrink-0" />
                <span>Enriching frontier genomic models &amp; SpliceAI scores in background...</span>
              </div>
            )}

            {/* 3-Container Grid Layout (Pathogenic, Benign, VUS/Intermediate) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 py-3.5 border-y border-[var(--cs-border-subtle)] text-[11px]">
              {/* Container 1: Pathogenic Support */}
              <div className="p-3 rounded-lg border bg-rose-500/5 border-rose-500/20 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between font-black text-[10.5px] uppercase tracking-wide text-[var(--cs-text-primary)] mb-2" style={{ color: "var(--cs-text-primary)" }}>
                    <span>Pathogenic Support ({votingPathogenicCount}{infoPathogenicCount > 0 ? ` + ${infoPathogenicCount} info` : ""})</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 font-mono border border-rose-500/30 font-black text-[var(--cs-text-primary)]" style={{ color: "var(--cs-text-primary)" }}>Concordant</span>
                  </div>
                  {concordance.pathogenicTools.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {concordance.pathogenicTools.map((t) => (
                        <span key={t.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-mono font-black bg-rose-500/25 border border-rose-500/40 shadow-xs" style={{ color: "var(--cs-text-primary)" }}>
                          <span style={{ color: "var(--cs-text-primary)" }}>{t.name}</span>
                          {t.isInformationalOnly && (
                            <span className="text-[8px] px-1 py-0.2 rounded bg-rose-500/40 font-black uppercase tracking-tighter" style={{ color: "var(--cs-text-primary)" }}>Info</span>
                          )}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[10px] italic text-[var(--cs-text-muted)] block mt-1">No tools predicting pathogenic</span>
                  )}
                </div>
              </div>

              {/* Container 2: Benign Support */}
              <div className="p-3 rounded-lg border bg-emerald-500/5 border-emerald-500/20 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between font-black text-[10.5px] uppercase tracking-wide text-[var(--cs-text-primary)] mb-2" style={{ color: "var(--cs-text-primary)" }}>
                    <span>Benign Support ({votingBenignCount}{infoBenignCount > 0 ? ` + ${infoBenignCount} info` : ""})</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 font-mono border border-emerald-500/30 font-black text-[var(--cs-text-primary)]" style={{ color: "var(--cs-text-primary)" }}>Discordant</span>
                  </div>
                  {concordance.benignTools.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {concordance.benignTools.map((t) => (
                        <span key={t.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-mono font-black bg-emerald-500/25 border border-emerald-500/40 shadow-xs" style={{ color: "var(--cs-text-primary)" }}>
                          <span style={{ color: "var(--cs-text-primary)" }}>{t.name}</span>
                          {t.isInformationalOnly && (
                            <span className="text-[8px] px-1 py-0.2 rounded bg-emerald-500/40 font-black uppercase tracking-tighter" style={{ color: "var(--cs-text-primary)" }}>Info</span>
                          )}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[10px] italic text-[var(--cs-text-muted)] block mt-1">No tools predicting benign</span>
                  )}
                </div>
              </div>

              {/* Container 3: VUS / Intermediate */}
              <div className="p-3 rounded-lg border bg-amber-500/5 border-amber-500/20 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between font-black text-[10.5px] uppercase tracking-wide text-[var(--cs-text-primary)] mb-2" style={{ color: "var(--cs-text-primary)" }}>
                    <span>VUS / Intermediate ({concordance.vusTools.length})</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 font-mono border border-amber-500/30 font-black text-[var(--cs-text-primary)]" style={{ color: "var(--cs-text-primary)" }}>Indeterminate</span>
                  </div>
                  {concordance.vusTools.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {concordance.vusTools.map((t) => (
                        <span key={t.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-mono font-black bg-amber-500/25 border border-amber-500/40 shadow-xs" style={{ color: "var(--cs-text-primary)" }}>
                          <span style={{ color: "var(--cs-text-primary)" }}>{t.name}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[10px] italic text-[var(--cs-text-muted)] block mt-1">No intermediate tools</span>
                  )}
                </div>
              </div>
            </div>

            <div className="text-[11px] leading-relaxed space-y-1 text-[var(--cs-text-secondary)] pt-1">
              <p>
                Calculated from <span className="font-semibold text-[var(--cs-text-primary)]">{total} available in-silico predictors</span> ({activeVotingTotal} consensus voting tools + {concordance.available.length - activeVotingTotal} informational model).
                {concordance.unavailable.length > 0 && (
                  <span> Unavailable: <span className="font-mono text-[10px]">{concordance.unavailable.join(", ")}</span>.</span>
                )}
              </p>
            </div>
          </div>
        );
      })()}

      <PredictorSpecialistPanels 
        predictorData={result.predictorData}
        conservationData={result.conservationData}
        esm2Score={result.esm2?.llr}
        isLoading={analysisState.isLoading || isBiophysicalLoading}
      />
    </div>
  );
}
