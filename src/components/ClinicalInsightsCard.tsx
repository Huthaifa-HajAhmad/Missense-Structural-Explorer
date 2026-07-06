import React, { memo } from "react";
import { 
  FileText, 
  CheckCircle2, 
  Copy, 
  ShieldAlert, 
  Activity, 
  Layers, 
  Atom, 
  ExternalLink, 
  Database,
  Lightbulb
} from "lucide-react";
import { 
  Radar, 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis, 
  PolarRadiusAxis, 
  ResponsiveContainer, 
  Tooltip 
} from "recharts";
import Markdown from "react-markdown";
import { VARIANT_PRESETS, getNearestResidues } from "../data";
import { AnalysisState, UserSettings, NearestResidue } from "../types";
import { 
  AMINO_ACID_NAMES_MAP, 
  AMINO_ACID_PROPERTIES, 
  parseMutationResidues 
} from "../useVariantAnalysis";

interface ClinicalInsightsCardProps {
  isDark: boolean;
  classCard: string;
  classCardHeader: string;
  classCardTitle: string;
  analysisState: AnalysisState;
  handleCopyReport: () => void;
  copied: boolean;
  gene: string;
  variant: string;
  uniprotId: string;
  loadingStep: string;
  formatEnergyString: (val: string | null | undefined) => string;
  selectedResidueIndex: number | null;
  settings: UserSettings;
  classTextBody: string;
  classTextMute: string;
  classBorderSec: string;
  computedResiduesCache?: Record<string, NearestResidue[]>;
  isBiophysicalLoading?: boolean;
  isClinicalLoading?: boolean;
}

const ClinicalInsightsCard = memo(function ClinicalInsightsCard({
  isDark,
  classCard,
  classCardHeader,
  classCardTitle,
  analysisState,
  handleCopyReport,
  copied,
  gene,
  variant,
  uniprotId,
  loadingStep,
  formatEnergyString,
  selectedResidueIndex,
  settings,
  classTextBody,
  classTextMute,
  classBorderSec,
  computedResiduesCache,
  isBiophysicalLoading: propIsBiophysicalLoading,
  isClinicalLoading: propIsClinicalLoading
}: ClinicalInsightsCardProps) {
  const isPresetData = VARIANT_PRESETS.some(
    (p) => p.gene.toUpperCase() === gene.toUpperCase() && p.variant.toLowerCase() === variant.toLowerCase()
  );
  const isBiophysicalLoading = propIsBiophysicalLoading !== undefined
    ? propIsBiophysicalLoading
    : !!(analysisState.result && (!analysisState.result.insights || (!analysisState.result.insights.biochemicalShift && !analysisState.result.insights.structuralImpact)));
  const isClinicalLoading = propIsClinicalLoading !== undefined
    ? propIsClinicalLoading
    : !!(analysisState.result && !analysisState.result.analysis);
  const isNarrativeLoading = isClinicalLoading;

  return (
    <div className={`${classCard} overflow-hidden flex flex-col min-h-[400px] transition-all`} id="clinical-insights-report-card">
      {/* Card Header */}
      <div className={`px-5 py-4 border-b flex items-center justify-between transition-colors ${classCardHeader}`}>
        <div className="flex flex-col">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="w-4 h-4" style={{ color: "var(--cs-accent-clay)" }} />
            <h3 className={`text-sm font-bold uppercase tracking-wider font-mono ${classCardTitle}`}>
              Variant Insights Report
            </h3>
            {analysisState.result && analysisState.result.isDemoData && isPresetData && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border cs-badge cs-badge-clay">
                Preset Profile
              </span>
            )}
          </div>
          <span className="text-[10px] font-medium tracking-wide mt-0.5" style={{ color: "var(--cs-warn)" }}>
            ⚠️ AI narrative suggestions only; not a clinical determination. Professional evaluation required.
          </span>
        </div>
        
        {/* Copy Report button */}
        {analysisState.result && (
          <button
            onClick={handleCopyReport}
            className="transition flex items-center gap-1 text-[10px] border rounded px-2.5 py-1 select-none cursor-pointer shadow-sm"
            style={{
              borderColor: "var(--cs-border)",
              background: "var(--cs-surface-2)",
              color: "var(--cs-text-secondary)"
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "var(--cs-bg-subtle)";
              (e.currentTarget as HTMLElement).style.color = "var(--cs-accent-clay)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "var(--cs-surface-2)";
              (e.currentTarget as HTMLElement).style.color = "var(--cs-text-secondary)";
            }}
            title="Copy markdown report to clipboard"
          >
            {copied ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--cs-accent-clay)" }} />
                <span className="font-semibold" style={{ color: "var(--cs-accent-clay)" }}>Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Report</span>
              </>
            )}
          </button>
        )}
      </div>

      {analysisState.result?.isDemoData && (
        <div className="mx-4 mt-3 mb-1 p-2.5 rounded-xl border text-[11px] font-medium leading-relaxed transition-all flex items-center gap-2"
          style={{ background: "rgba(196,104,73,0.05)", borderColor: "var(--cs-border)", color: "var(--cs-accent-clay)" }}>
          <span>⚠ Demo data — example preset; not a live backend analysis</span>
        </div>
      )}


      {/* Card Body */}
      <div className="p-5 flex-1 flex flex-col justify-center">
        {analysisState.isLoading ? (
          /* Multi step loader inside insights card */
          <div className="flex flex-col items-center justify-center py-12 text-center" style={{ color: "var(--cs-text-muted)" }}>
            <div className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin mb-4" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }}></div>
            <p className="text-sm font-semibold font-mono mb-2" style={{ color: "var(--cs-text-primary)" }}>Calculating mutation pathogenicity...</p>
            <p className="text-xs max-w-xs font-mono h-5 animate-pulse" style={{ color: "var(--cs-accent-clay)" }}>{loadingStep}</p>
          </div>
        ) : analysisState.error ? (
          /* Error view inside insights card */
          <div className="flex flex-col items-center justify-center p-4 rounded-lg my-6 max-w-md mx-auto text-center text-xs border bg-rose-50 border-rose-200 text-rose-700">
            <ShieldAlert className="w-8 h-8 mb-2 shrink-0 text-rose-500" />
            <p className="font-bold mb-1 text-slate-900">Calculation Aborted</p>
            <p className="leading-relaxed max-h-[120px] overflow-auto">{analysisState.error}</p>
          </div>
        ) : analysisState.result ? (
          /* Analysis result presenting structured key metrics and narrative report */
          <div className="flex flex-col gap-5 w-full text-slate-300">
            {/* Structured Dynamic Insights Panel */}
            {isNarrativeLoading ? (
              <div className="rounded-xl border p-4 space-y-4 transition-all" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                <div className="flex items-center gap-2 font-bold font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>
                  <div className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }}></div>
                  <span className="animate-pulse">Analyzing biophysical properties with Gemini AI...</span>
                </div>
                <div className="space-y-2 pl-5 pt-1">
                  <div className="h-3 rounded animate-pulse w-3/4" style={{ background: "var(--cs-bg-subtle)" }}></div>
                  <div className="h-3 rounded animate-pulse w-5/6" style={{ background: "var(--cs-bg-subtle)" }}></div>
                  <div className="h-3 rounded animate-pulse w-1/2" style={{ background: "var(--cs-bg-subtle)" }}></div>
                </div>
              </div>
            ) : analysisState.result.insights ? (
              <div className="rounded-xl border p-4 space-y-4 transition-all" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                {/* Biochemical Shift & Structural Impact (Biophysical Report) */}
                {isBiophysicalLoading ? (
                  <div className="flex items-center gap-2 font-bold font-mono text-[10px] uppercase tracking-wider py-4 pl-5" style={{ color: "var(--cs-accent-clay)" }}>
                    <div className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }}></div>
                    <span className="animate-pulse">Predicting biophysical shifts...</span>
                  </div>
                ) : (
                  <>
                    {/* Biochemical Shift Section */}
                    <div>
                      <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--cs-accent-clay)" }}>
                        <Activity className="w-3.5 h-3.5" />
                        <span>Biochemical Shift</span>
                      </div>
                      <p className={`text-[12px] leading-relaxed font-sans pl-5 transition-colors ${classTextBody}`}>
                        {analysisState.result.insights?.biochemicalShift}
                      </p>
                    </div>

                    {/* Structural Impact Section */}
                    <div className={`pt-3 border-t ${classBorderSec}`}>
                      <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--cs-accent-clay)" }}>
                        <Layers className="w-3.5 h-3.5" />
                        <span>Structural Impact (ΔΔG Implications)</span>
                      </div>
                      <p className={`text-[12px] leading-relaxed font-sans pl-5 transition-colors ${classTextBody}`}>
                        {formatEnergyString(analysisState.result.insights?.structuralImpact)}
                      </p>
                    </div>
                  </>
                )}

                {/* Chemical Property Similarity Radar Chart */}
                <div className={`pt-3 border-t ${classBorderSec}`}>
                  <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--cs-accent-clay)" }}>
                    <Activity className="w-3.5 h-3.5" />
                    <span>Residue Property Comparison (Radar Profile)</span>
                  </div>
                  <div className="pl-5 pt-1">
                    {(() => {
                      try {
                        const parsed = parseMutationResidues(variant);
                        const wtData = AMINO_ACID_PROPERTIES[parsed.wt] || { hydrophobicity: 50, charge: 50, size: 50, polarity: 50 };
                        const mutData = AMINO_ACID_PROPERTIES[parsed.mut] || { hydrophobicity: 50, charge: 50, size: 50, polarity: 50 };
                        
                        const radarData = [
                          { subject: "Hydrophobicity", WT: wtData.hydrophobicity, MUT: mutData.hydrophobicity },
                          { subject: "Charge", WT: wtData.charge, MUT: mutData.charge },
                          { subject: "Molecular Size", WT: wtData.size, MUT: mutData.size },
                          { subject: "Polarity", WT: wtData.polarity, MUT: mutData.polarity }
                        ];

                        const wtColor = "#10b981"; // Emerald
                        const mutColor = "#f43f5e"; // Rose

                        return (
                          <div className="flex flex-col sm:flex-row items-center gap-4 justify-between p-3 rounded-lg border transition-colors"
                            style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                            <div className="w-full sm:w-[50%] h-[155px]">
                              <ResponsiveContainer width="100%" height="100%">
                                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                                  <PolarGrid stroke={isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.08)"} />
                                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fill: "var(--cs-text-secondary)" }} />
                                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 8, fill: "var(--cs-text-muted)" }} />
                                  <Radar name="Wild-Type" dataKey="WT" stroke={wtColor} fill={wtColor} fillOpacity={0.12} />
                                  <Radar name="Mutant" dataKey="MUT" stroke={mutColor} fill={mutColor} fillOpacity={0.12} />
                                  <Tooltip contentStyle={{ fontSize: 10, background: "var(--cs-surface)", borderColor: "var(--cs-border)", color: "var(--cs-text-primary)" }} />
                                </RadarChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="w-full sm:w-[45%] flex flex-col gap-1.5 text-[10.5px]">
                              <div className="flex items-center gap-2 pb-1 border-b border-dashed" style={{ borderColor: "var(--cs-border-subtle)" }}>
                                <span className="w-2.5 h-2.5 rounded" style={{ background: wtColor }}></span>
                                <span style={{ color: "var(--cs-text-primary)" }}>Wild-Type ({parsed.wt})</span>
                              </div>
                              <div className="flex items-center gap-2 pb-2">
                                <span className="w-2.5 h-2.5 rounded" style={{ background: mutColor }}></span>
                                <span style={{ color: "var(--cs-text-primary)" }}>Mutant ({parsed.mut})</span>
                              </div>
                              <p className="leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
                                Plots isoelectric properties. Overlapping profiles indicate conservative substitutions, whereas deviations support disruptive pathology.
                              </p>
                            </div>
                          </div>
                        );
                      } catch {
                        return null;
                      }
                    })()}
                  </div>
                </div>

                {/* Local Microenvironment (5 Nearest Neighboring Residues) */}
                {(() => {
                  const presetResidues = getNearestResidues(uniprotId, variant, selectedResidueIndex);
                  const cacheKey = `${uniprotId}_${selectedResidueIndex}`;
                  const computedResidues = computedResiduesCache?.[cacheKey] || [];
                  const nearestResidues = presetResidues.length > 0 ? presetResidues : computedResidues;

                  return (
                    <div className={`pt-3 border-t ${classBorderSec}`}>
                      <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--cs-accent-clay)" }}>
                        <Atom className="w-3.5 h-3.5" />
                        <span>Local Microenvironment (5 Nearest Residues)</span>
                      </div>
                      <p className={`text-[10px] leading-relaxed mb-2 pl-5 ${isDark ? "text-slate-455" : "text-slate-555"}`}>
                        These 3D spatial neighbors mediate local stability, folding dynamics, salt bridges, or ligand interactions. Disruption of these proximal interactions directly supports the structural pathogenic evidence scale.
                      </p>
                      {nearestResidues.length > 0 ? (
                        <div className="space-y-2 pl-5">
                          {nearestResidues.map((res, index) => (
                            <div 
                              key={index} 
                              className="rounded-lg p-2.5 transition-all border shadow-sm"
                              style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
                            >
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded border transition-colors"
                                  style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)", color: "var(--cs-text-primary)" }}>
                                  {res.name}
                                </span>
                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border"
                                  style={{ background: "rgba(196,104,73,0.05)", borderColor: "var(--cs-border)", color: "var(--cs-accent-clay)" }}>
                                  {res.distance}
                                </span>
                                <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full border ${res.classBadge}`}>
                                  {res.properties}
                                </span>
                                {res.source === "curated" && (
                                  <span className="text-[8px] font-mono uppercase bg-amber-500/10 text-amber-500 border border-amber-500/20 px-1 rounded">
                                    curated annotation
                                  </span>
                                )}
                                {res.source === "computed" && (
                                  <span className="text-[8px] font-mono uppercase bg-emerald-500/10 text-emerald-455 border border-emerald-500/20 px-1 rounded">
                                    computed from coordinates
                                  </span>
                                )}
                              </div>
                              <p className={`text-[11px] leading-relaxed transition-colors ${classTextMute}`}>
                                {res.role}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={`pl-5 text-[11px] font-mono italic ${classTextMute}`}>
                          Structural neighbors computed on live 3D analysis
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ACMG Criteria Badge list */}
                {/* Plausibility Statements and ACMG Evidence Suggester */}
                {((analysisState.result.insights && (analysisState.result.insights.acmgCriteria.length > 0 || analysisState.result.insights.plausibility)) ||
                  (analysisState.result.ruleBasedInsights && (analysisState.result.ruleBasedInsights.acmgCriteria.length > 0 || analysisState.result.ruleBasedInsights.plausibility))) && (
                  <div className={`pt-3 border-t ${classBorderSec} space-y-4`}>
                    <div className="flex items-center flex-wrap gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--cs-accent-clay)" }}>
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>ACMG / AMP Pathogenicity Evidence Suggester</span>
                    </div>
                    <div className="space-y-4 pl-5">
                      {/* Unified ACMG Consensus Verdict Badge */}
                      {(() => {
                        const verdict = analysisState.result.insights?.acmgVerdict || analysisState.result.ruleBasedInsights?.acmgVerdict || "Variant of Uncertain Significance (VUS)";
                        const criteria = analysisState.result.insights?.acmgCriteria || analysisState.result.ruleBasedInsights?.acmgCriteria || [];
                        const codesMet = criteria.map(c => c.code).join(", ");
                        
                        let badgeStyle = "bg-slate-500/10 text-slate-400 border border-slate-500/20";
                        if (verdict.includes("Likely Pathogenic")) {
                          badgeStyle = "bg-orange-500/15 text-orange-450 border border-orange-500/20 font-bold";
                        } else if (verdict.includes("Pathogenic")) {
                          badgeStyle = "bg-rose-500/15 text-rose-455 border border-rose-500/25 font-bold";
                        } else if (verdict.includes("Likely Benign")) {
                          badgeStyle = "bg-emerald-500/10 text-emerald-450 border border-emerald-500/20 font-bold";
                        } else if (verdict.includes("Benign")) {
                          badgeStyle = "bg-emerald-500/15 text-emerald-455 border border-emerald-500/25 font-bold";
                        }
                        
                        return (
                          <div className="p-3.5 rounded-lg border flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm"
                            style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                            <div>
                              <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                                ACMG Pathogenicity Verdict (Consensus)
                              </span>
                              <span className={`inline-block text-[10px] px-2.5 py-1 rounded-lg border uppercase mt-1 ${badgeStyle}`}>
                                {verdict}
                              </span>
                            </div>
                            <div className="text-right md:text-left">
                              <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                                Combinatorial Rule
                              </span>
                              <span className="text-xs font-mono leading-relaxed font-bold" style={{ color: "var(--cs-text-primary)" }}>
                                {codesMet ? `Criteria met: ${codesMet}` : "No evidence codes met"}
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Plausibility Panels */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {analysisState.result.ruleBasedInsights?.plausibility && (
                          <div className="rounded-lg p-3 border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                            <span className="block text-[9px] font-mono font-bold uppercase tracking-wider mb-1" style={{ color: "var(--cs-accent-clay)" }}>
                              Rule-Based Suggester Plausibility
                            </span>
                            <p className="text-[10.5px] leading-relaxed font-sans" style={{ color: "var(--cs-text-primary)" }}>
                              {analysisState.result.ruleBasedInsights.plausibility}
                            </p>
                          </div>
                        )}
                        
                        {isClinicalLoading ? (
                          <div className="rounded-lg p-3 border flex items-center justify-center min-h-[60px]" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                            <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }}></div>
                          </div>
                        ) : analysisState.result.insights?.plausibility ? (
                          <div className="rounded-lg p-3 border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                            <span className="block text-[9px] font-mono font-bold uppercase tracking-wider mb-1" style={{ color: "var(--cs-warn)" }}>
                              AI-Generated Plausibility Reasoning
                            </span>
                            <p className="text-[10.5px] leading-relaxed font-sans" style={{ color: "var(--cs-text-primary)" }}>
                              {analysisState.result.insights.plausibility}
                            </p>
                          </div>
                        ) : null}
                      </div>

                      {/* Unified Suggested Criteria list */}
                      <div className="flex flex-col gap-2 pt-1">
                        <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500 mb-1">
                          Unified Suggested Criteria Codes
                        </span>
                        {(() => {
                          const mergedList = analysisState.result.insights?.acmgCriteria || 
                            analysisState.result.ruleBasedInsights?.acmgCriteria?.map(c => ({ ...c, source: "database_verified" as const })) || [];

                          return (
                            <div className="space-y-2">
                              {mergedList.map((item, idx) => {
                                const isDbVerified = item.source === "database_verified";
                                
                                const containerStyle = isDbVerified
                                  ? "rgba(196,104,73,0.04)"
                                  : "rgba(217,70,170,0.04)";

                                const borderStyle = isDbVerified
                                  ? "rgba(196,104,73,0.15)"
                                  : "rgba(217,70,170,0.15)";

                                const badgeBg = isDbVerified ? "var(--cs-accent-clay)" : "var(--cs-accent-mag)";
                                
                                const textStyle = isDbVerified
                                  ? "var(--cs-text-primary)"
                                  : "var(--cs-text-primary)";

                                const sourceBadge = isDbVerified
                                  ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                                  : "bg-rose-500/10 text-rose-500 border border-rose-500/20";

                                return (
                                  <div 
                                    key={idx} 
                                    className="rounded-lg p-2.5 transition flex flex-col gap-1 border"
                                    style={{ background: containerStyle, borderColor: borderStyle }}
                                  >
                                    <div className="flex items-center justify-between gap-2 w-full">
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono font-bold text-[9px] px-1.5 py-0.5 rounded text-white shadow-sm shrink-0" style={{ background: badgeBg }}>
                                          {item.code}
                                        </span>
                                        <span className="text-[9px] font-mono font-bold uppercase tracking-wider" style={{ color: textStyle }}>
                                          Suggested Criteria Evidence
                                        </span>
                                      </div>
                                      <span className={`text-[7px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${sourceBadge}`}>
                                        {isDbVerified ? "Database-Verified" : "AI-Suggested"}
                                      </span>
                                    </div>
                                    <p className="text-[10px] leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
                                      {item.reason}
                                    </p>
                                  </div>
                                );
                              })}

                              {isClinicalLoading && (
                                <div className="flex items-center gap-2 font-bold font-mono text-[9px] uppercase tracking-wider py-2 pt-1" style={{ color: "var(--cs-accent-clay)" }}>
                                  <div className="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }}></div>
                                  <span className="animate-pulse">Computing AI-suggested ACMG criteria...</span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )}

                {/* ClinVar & gnomAD Database Grounding (S-1) */}
                {analysisState.result.clinvar && (
                  <div className={`pt-3 border-t ${classBorderSec}`}>
                    <div className="flex items-center gap-1.5 font-bold font-mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--cs-accent-clay)" }}>
                      <Database className="w-3.5 h-3.5" />
                      <span>ClinVar & gnomAD Evidence Database Grounding</span>
                    </div>
                    <div className="pl-5 space-y-3">
                      {analysisState.result.clinvar.uid ? (
                        <div className="rounded-xl p-4 border transition-all duration-300 shadow-sm"
                          style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                          {/* Grid of ClinVar metrics */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs mb-3">
                            <div>
                              <span className="block text-[10px] font-mono uppercase font-semibold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>ClinVar Significance</span>
                              <span className={`inline-block mt-1 px-2.5 py-0.5 rounded text-[11px] font-bold ${
                                (() => {
                                  const c = analysisState.result.clinvar.classification.toLowerCase();
                                  if (c.includes("likely pathogenic")) return "bg-orange-500/15 text-orange-450 border border-orange-500/20";
                                  if (c.includes("pathogenic")) return "bg-rose-500/15 text-rose-455 border border-rose-500/25";
                                  if (c.includes("likely benign")) return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
                                  if (c.includes("benign")) return "bg-emerald-500/15 text-emerald-455 border border-emerald-500/25";
                                  return "bg-amber-500/15 text-amber-455 border border-amber-500/20";
                                })()
                              }`}>
                                {analysisState.result.clinvar.classification}
                              </span>
                            </div>
                            <div>
                              <span className="block text-[10px] font-mono uppercase font-semibold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Review Status</span>
                              <span className="block mt-1 text-xs font-semibold" style={{ color: "var(--cs-text-primary)" }}>
                                {analysisState.result.clinvar.reviewStatus || "Not specified"}
                              </span>
                            </div>
                            <div>
                              <span className="block text-[10px] font-mono uppercase font-semibold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Associated Trait</span>
                              <span className="block mt-1 text-xs font-semibold truncate max-w-[240px]" style={{ color: "var(--cs-text-primary)" }} title={analysisState.result.clinvar.trait}>
                                {analysisState.result.clinvar.trait || "None listed"}
                              </span>
                            </div>
                            <div>
                              <span className="block text-[10px] font-mono uppercase font-semibold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Last Evaluated</span>
                              <span className="block mt-1 text-xs" style={{ color: "var(--cs-text-secondary)" }}>
                                {analysisState.result.clinvar.lastEvaluated && !isNaN(new Date(analysisState.result.clinvar.lastEvaluated).getTime()) ? new Date(analysisState.result.clinvar.lastEvaluated).toLocaleDateString() : "Not specified"}
                              </span>
                            </div>
                          </div>
                          
                          {/* gnomAD frequencies */}
                          {analysisState.result.clinvar.alleleFrequencies && analysisState.result.clinvar.alleleFrequencies.length > 0 && (
                            <div className="mt-3 pt-3 border-t text-xs" style={{ borderColor: "var(--cs-border-subtle)" }}>
                              <span className="block text-[10px] font-mono uppercase font-semibold tracking-wider mb-2" style={{ color: "var(--cs-text-muted)" }}>gnomAD / Population Allele Frequencies</span>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {analysisState.result.clinvar.alleleFrequencies.map((freq: any, fIdx: number) => (
                                  <div key={fIdx} className="flex justify-between items-center pr-4 text-xs">
                                    <span className="opacity-75 font-semibold text-slate-450 dark:text-slate-450">{/gnomad/i.test(freq.source) ? "gnomAD" : freq.source}:</span>
                                    <span className="font-bold font-mono" style={{ color: "var(--cs-accent-clay)" }}>
                                      {(() => {
                                        const num = parseFloat(freq.value);
                                        return isNaN(num) ? "N/A" : num.toExponential(3);
                                      })()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {/* ClinVar Portal Link */}
                          <div className="mt-3 pt-2.5 border-t flex justify-end text-[10px]" style={{ borderColor: "var(--cs-border-subtle)" }}>
                            <a 
                              href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${analysisState.result.clinvar.uid}/`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:opacity-85 font-bold flex items-center gap-1 text-[var(--cs-accent-clay)]"
                            >
                              NCBI ClinVar Link #{analysisState.result.clinvar.uid} <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg p-3 border text-center text-xs font-mono" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-muted)" }}>
                          No matching variant found in NCBI ClinVar database.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {!analysisState.result.insights && (
              <div className="p-3 rounded-lg border text-xs leading-relaxed" style={{ background: "var(--cs-accent-mag-soft)", borderColor: "var(--cs-accent-mag)", color: "var(--cs-text-primary)" }}>
                <span className="font-bold block uppercase text-[10px] mb-1 tracking-wider text-amber-500">Structured Report Unavailable</span>
                The AI-generated structured analysis (biochemical shifts, structural impacts, and ACMG criteria classification) could not be parsed or generated. Only the raw clinical narrative is available.
              </div>
            )}

            {/* Detailed Narrative Report Section */}
            <div className={`border-t pt-4 ${classBorderSec}`}>
              <div className="text-[10px] font-mono uppercase mb-2 font-bold tracking-widest flex items-center gap-1" style={{ color: "var(--cs-text-muted)" }}>
                <FileText className="w-3.5 h-3.5" />
                Detailed Clinical Narrative
              </div>
              {isNarrativeLoading ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3 border border-dashed rounded-lg" style={{ background: "rgba(196,104,73,0.03)", borderColor: "rgba(196,104,73,0.15)" }}>
                  <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }}></div>
                  <span className="text-[10px] font-mono animate-pulse uppercase tracking-wider" style={{ color: "var(--cs-text-muted)" }}>
                    Generating clinical narrative explanation...
                  </span>
                </div>
              ) : (
                <div className="prose prose-xs leading-relaxed space-y-4 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin transition-colors"
                  style={{ color: "var(--cs-text-primary)" }}>
                  <Markdown>{formatEnergyString(analysisState.result.analysis)}</Markdown>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Startup or placeholder state */
          <div className="text-center py-12 text-slate-500">
            <Lightbulb className="w-10 h-10 mx-auto text-indigo-500 stroke-[1.5] mb-2 animate-pulse" />
            <p className="text-sm font-semibold font-mono uppercase tracking-wider text-indigo-500" style={{ color: "var(--cs-accent-clay)" }}>Variant Insights Report Ready</p>
            <div className="w-16 h-[1px] bg-slate-800/10 dark:bg-slate-800/60 mx-auto my-3"></div>
            <p className="text-xs max-w-sm mx-auto mt-1 leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
              Submit a variant search query to generate an automated clinical insights narrative, ACMG criteria classifications, biochemical property comparisons, and structural plausibility reasoning.
            </p>
          </div>
        )}
      </div>

      {/* Card Footer informative links */}
      <div className={`px-5 py-3 border-t text-[11px] flex items-center justify-between transition-colors ${
        isDark ? "border-[#322F2A] bg-[#23211E] text-slate-400" : "border-[#ECEAE4] bg-[#F9F8F6] text-slate-500"
      }`}>
        <span className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5" style={{ color: "var(--cs-accent-clay)" }} />
          {analysisState.result?.clinvar?.uid 
            ? "Cross-referenced with ClinVar & gnomAD" 
            : "Sequence & Structural Analysis"}
        </span>
      </div>
    </div>
  );
});

export default ClinicalInsightsCard;
