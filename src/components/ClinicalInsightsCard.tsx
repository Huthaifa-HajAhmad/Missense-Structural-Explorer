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

export default function ClinicalInsightsCard({
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
            <FileText className="w-4 h-4 text-indigo-500" />
            <h3 className={`text-sm font-bold uppercase tracking-wider font-mono ${classCardTitle}`}>
              Variant Insights Report
            </h3>
            {analysisState.result && analysisState.result.isDemoData && isPresetData && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/25 text-indigo-400 border border-indigo-500/30">
                Preset Profile
              </span>
            )}
          </div>
          <span className={`text-[10px] font-medium tracking-wide mt-0.5 ${isDark ? "text-amber-400/90" : "text-amber-600"}`}>
            ⚠️ AI narrative suggestions only; not a clinical determination. Professional evaluation required.
          </span>
        </div>
        
        {/* Copy Report button */}
        {analysisState.result && (
          <button
            onClick={handleCopyReport}
            className={`transition flex items-center gap-1 text-[10px] border rounded px-2.5 py-1 select-none cursor-pointer ${
              isDark 
                ? "text-slate-400 bg-slate-900 border-slate-700/80 hover:bg-slate-800 hover:text-white" 
                : "text-slate-600 bg-slate-50 border-slate-200 hover:bg-slate-100 hover:text-slate-900 shadow-sm"
            }`}
            title="Copy markdown report to clipboard"
          >
            {copied ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500" />
                <span className="text-indigo-500 font-semibold">Copied!</span>
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
        <div className={`mx-4 mt-3 mb-1 p-2.5 rounded-xl border text-[11px] font-medium leading-relaxed transition-all flex items-center gap-2 ${
          isDark 
            ? "bg-amber-500/10 border-amber-500/20 text-amber-300" 
            : "bg-amber-50 border-amber-200 text-amber-700"
        }`}>
          <span>⚠ Demo data — example preset; not a live backend analysis</span>
        </div>
      )}


      {/* Card Body */}
      <div className="p-5 flex-1 flex flex-col justify-center">
        {analysisState.isLoading ? (
          /* Multi step loader inside insights card */
          <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
            <div className="w-10 h-10 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className={`text-sm font-semibold font-mono mb-2 ${isDark ? "text-slate-200" : "text-slate-800"}`}>Calculating mutation pathogenicity...</p>
            <p className={`text-xs max-w-xs font-mono h-5 ${isDark ? "text-indigo-400" : "text-indigo-600 animate-pulse"}`}>{loadingStep}</p>
          </div>
        ) : analysisState.error ? (
          /* Error view inside insights card */
          <div className={`flex flex-col items-center justify-center p-4 rounded-lg my-6 max-w-md mx-auto text-center text-xs border ${
            isDark ? "text-rose-450 border-rose-950 bg-rose-950/20" : "text-rose-700 bg-rose-50 border-rose-200"
          }`}>
            <ShieldAlert className="w-8 h-8 mb-2 shrink-0 text-rose-500" />
            <p className={`font-bold mb-1 ${isDark ? "text-slate-200" : "text-slate-900"}`}>Calculation Aborted</p>
            <p className="leading-relaxed max-h-[120px] overflow-auto">{analysisState.error}</p>
          </div>
        ) : analysisState.result ? (
          /* Analysis result presenting structured key metrics and narrative report */
          <div className="flex flex-col gap-5 w-full text-slate-300">
            {/* Structured Dynamic Insights Panel */}
            {isNarrativeLoading ? (
              <div className={`rounded-xl border p-4 space-y-4 transition-all ${
                isDark ? "bg-slate-900 border-slate-800" : "bg-slate-50 border-slate-200"
              }`}>
                <div className="flex items-center gap-2 text-indigo-500 font-bold font-mono text-[10px] uppercase tracking-wider">
                  <div className="w-3.5 h-3.5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  <span className="animate-pulse">Analyzing biophysical properties with Gemini AI...</span>
                </div>
                <div className="space-y-2 pl-5 pt-1">
                  <div className={`h-3 rounded animate-pulse w-3/4 ${isDark ? "bg-slate-800" : "bg-slate-200"}`}></div>
                  <div className={`h-3 rounded animate-pulse w-5/6 ${isDark ? "bg-slate-800" : "bg-slate-200"}`}></div>
                  <div className={`h-3 rounded animate-pulse w-1/2 ${isDark ? "bg-slate-800" : "bg-slate-200"}`}></div>
                </div>
              </div>
            ) : analysisState.result.insights ? (
              <div className={`rounded-xl border p-4 space-y-4 transition-all ${
                isDark ? "bg-slate-900 border-slate-800" : "bg-slate-50 border-slate-200"
              }`}>
                {/* Biochemical Shift & Structural Impact (Biophysical Report) */}
                {isBiophysicalLoading ? (
                  <div className="flex items-center gap-2 text-indigo-500 font-bold font-mono text-[10px] uppercase tracking-wider py-4 pl-5">
                    <div className="w-3.5 h-3.5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="animate-pulse">Predicting biophysical shifts...</span>
                  </div>
                ) : (
                  <>
                    {/* Biochemical Shift Section */}
                    <div>
                      <div className="flex items-center gap-1.5 text-indigo-500 font-bold font-mono text-[10px] uppercase tracking-wider mb-1">
                        <Activity className="w-3.5 h-3.5" />
                        <span>Biochemical Shift</span>
                      </div>
                      <p className={`text-[12px] leading-relaxed font-sans pl-5 transition-colors ${classTextBody}`}>
                        {analysisState.result.insights?.biochemicalShift}
                      </p>
                    </div>

                    {/* Structural Impact Section */}
                    <div className={`pt-3 border-t ${classBorderSec}`}>
                      <div className="flex items-center gap-1.5 text-indigo-500 font-bold font-mono text-[10px] uppercase tracking-wider mb-1">
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
                  <div className="flex items-center gap-1.5 text-indigo-500 font-bold font-mono text-[10px] uppercase tracking-wider mb-2">
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
                          <div className={`flex flex-col sm:flex-row items-center gap-4 justify-between p-3 rounded-lg border transition-colors ${
                            isDark 
                              ? "bg-slate-950/45 border-slate-800" 
                              : "bg-white border-slate-200 shadow-xs"
                          }`}>
                            <div className="w-full sm:w-[50%] h-[155px]">
                              <ResponsiveContainer width="100%" height="100%">
                                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                                  <PolarGrid stroke={isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.08)"} />
                                  <PolarAngleAxis 
                                    dataKey="subject" 
                                    tick={{ fill: isDark ? "#94a3b8" : "#475569", fontSize: 8, fontFamily: "monospace", fontWeight: "bold" }} 
                                  />
                                  <PolarRadiusAxis 
                                    angle={30} 
                                    domain={[0, 100]} 
                                    tick={{ fill: isDark ? "#64748b" : "#94a3b8", fontSize: 7 }} 
                                    axisLine={false}
                                  />
                                  <Radar 
                                    name="WT" 
                                    dataKey="WT" 
                                    stroke={wtColor} 
                                    fill={wtColor} 
                                    fillOpacity={0.15} 
                                  />
                                  <Radar 
                                    name="MUT" 
                                    dataKey="MUT" 
                                    stroke={mutColor} 
                                    fill={mutColor} 
                                    fillOpacity={0.15} 
                                  />
                                  <Tooltip 
                                    contentStyle={{
                                      backgroundColor: isDark ? "#0f172a" : "#ffffff",
                                      borderColor: isDark ? "#334155" : "#cbd5e1",
                                      fontSize: "9px",
                                      fontFamily: "monospace",
                                      borderRadius: "0.25rem",
                                      color: isDark ? "#ffffff" : "#0f172a"
                                    }}
                                  />
                                </RadarChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="flex flex-col gap-2 justify-center text-[10px] font-mono w-full sm:w-[48%] shrink-0">
                              <div className={`space-y-1 rounded border p-2 transition-colors ${
                                isDark ? "bg-slate-900 border-slate-800/80" : "bg-slate-50 border-slate-100"
                              }`}>
                                <div className="flex items-center gap-1.5 font-bold text-emerald-500">
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse" style={{ backgroundColor: wtColor }} />
                                  <span className="truncate">Wild Type: {parsed.wt}</span>
                                </div>
                                <p className={`text-[9px] ${isDark ? "text-slate-400" : "text-slate-500"} truncate`}>
                                  {AMINO_ACID_NAMES_MAP[parsed.wt] || parsed.wt}
                                </p>
                                <div className={`pl-1.5 text-[9px] pt-1 border-t space-y-0.5 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                                  <div className="flex justify-between">
                                    <span className={isDark ? "text-slate-500" : "text-slate-400"}>Hydrophobicity:</span>
                                    <span className={`font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>{wtData.hydrophobicity}%</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className={isDark ? "text-slate-500" : "text-slate-400"}>Charge Index:</span>
                                    <span className={`font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>{wtData.charge}%</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className={isDark ? "text-slate-500" : "text-slate-400"}>Side-chain Vol:</span>
                                    <span className={`font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>{wtData.size}%</span>
                                  </div>
                                </div>
                              </div>
                              <div className={`space-y-1 rounded border p-2 transition-colors ${
                                isDark ? "bg-slate-900 border-slate-800/80" : "bg-slate-50 border-slate-100"
                              }`}>
                                <div className="flex items-center gap-1.5 font-bold text-rose-500">
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse" style={{ backgroundColor: mutColor }} />
                                  <span className="truncate">Mutant: {parsed.mut}</span>
                                </div>
                                <p className={`text-[9px] ${isDark ? "text-slate-400" : "text-slate-500"} truncate`}>
                                  {AMINO_ACID_NAMES_MAP[parsed.mut] || parsed.mut}
                                </p>
                                <div className={`pl-1.5 text-[9px] pt-1 border-t space-y-0.5 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                                  <div className="flex justify-between">
                                    <span className={isDark ? "text-slate-500" : "text-slate-400"}>Hydrophobicity:</span>
                                    <span className={`font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>{mutData.hydrophobicity}%</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className={isDark ? "text-slate-500" : "text-slate-400"}>Charge Index:</span>
                                    <span className={`font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>{mutData.charge}%</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className={isDark ? "text-slate-500" : "text-slate-400"}>Side-chain Vol:</span>
                                    <span className={`font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>{mutData.size}%</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      } catch (err: any) {
                        return (
                          <div className={`p-4 rounded-xl border text-[12px] font-medium leading-normal transition-colors ${
                            isDark ? "bg-slate-950/45 border-rose-950/40 text-rose-450/90" : "bg-rose-50 border-rose-100 text-rose-700"
                          }`}>
                            Biochemical properties radar map not available: {err.message || "Invalid mutation format"}
                          </div>
                        );
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
                      <div className="flex items-center gap-1.5 text-indigo-500 font-bold font-mono text-[10px] uppercase tracking-wider mb-1">
                        <Atom className="w-3.5 h-3.5" />
                        <span>Local Microenvironment (5 Nearest Residues)</span>
                      </div>
                      <p className={`text-[10px] leading-relaxed mb-2 pl-5 ${isDark ? "text-slate-450" : "text-slate-555"}`}>
                        These 3D spatial neighbors mediate local stability, folding dynamics, salt bridges, or ligand interactions. Disruption of these proximal interactions directly supports the structural pathogenic evidence scale.
                      </p>
                      {nearestResidues.length > 0 ? (
                        <div className="space-y-2 pl-5">
                          {nearestResidues.map((res, index) => (
                            <div 
                              key={index} 
                              className={`rounded-lg p-2.5 transition-all border ${
                                isDark 
                                  ? "bg-slate-950/40 border-slate-800 hover:border-slate-700" 
                                  : "bg-white border-slate-200 hover:border-slate-300 shadow-sm"
                              }`}
                            >
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className={`font-mono font-bold text-[11px] px-1.5 py-0.5 rounded border transition-colors ${
                                  isDark ? "text-white bg-slate-800 border-slate-700/60" : "text-slate-800 bg-slate-100 border-slate-200"
                                }`}>
                                  {res.name}
                                </span>
                                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                                  isDark ? "text-indigo-400 bg-indigo-500/5 border-indigo-500/10" : "text-indigo-600 bg-indigo-50 border-indigo-100/80"
                                }`}>
                                  {res.distance}
                                </span>
                                <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full border ${res.classBadge}`}>
                                  {res.properties}
                                </span>
                                {res.source === "curated" && (
                                  <span className="text-[8px] font-mono uppercase bg-indigo-500/10 text-indigo-455 border border-indigo-500/20 px-1 rounded">
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
                    <div className="flex items-center flex-wrap gap-1.5 text-indigo-500 font-bold font-mono text-[10px] uppercase tracking-wider mb-2">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>ACMG / AMP Pathogenicity Evidence Suggester</span>
                    </div>

                    {/* Plausibility Panels */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-5">
                      {analysisState.result.ruleBasedInsights?.plausibility && (
                        <div className={`rounded-lg p-3 border ${
                          isDark ? "bg-slate-900 border-slate-800" : "bg-slate-50 border-slate-200"
                        }`}>
                          <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-indigo-500 mb-1">
                            Rule-Based Suggester Plausibility
                          </span>
                          <p className={`text-[11px] leading-relaxed font-sans ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                            {analysisState.result.ruleBasedInsights.plausibility}
                          </p>
                        </div>
                      )}
                      
                      {isClinicalLoading ? (
                        <div className={`rounded-lg p-3 border ${
                          isDark ? "bg-slate-900 border-slate-800" : "bg-slate-50 border-slate-200"
                        } flex items-center justify-center min-h-[60px]`}>
                          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                      ) : analysisState.result.insights?.plausibility ? (
                        <div className={`rounded-lg p-3 border ${
                          isDark ? "bg-slate-900 border-slate-800" : "bg-slate-50 border-slate-200"
                        }`}>
                          <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-amber-500 mb-1">
                            AI-Generated Plausibility Reasoning
                          </span>
                          <p className={`text-[11px] leading-relaxed font-sans ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                            {analysisState.result.insights.plausibility}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    {/* ACMG Criteria Badge list */}
                    <div className="flex flex-col gap-2 pl-5 pt-2">
                      <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Suggested Criteria Codes
                      </span>

                      {/* Rule-Based Suggested Criteria */}
                      {analysisState.result.ruleBasedInsights?.acmgCriteria && analysisState.result.ruleBasedInsights.acmgCriteria.length > 0 && (
                        <div className="space-y-2">
                          {analysisState.result.ruleBasedInsights.acmgCriteria.map((item, idx) => (
                            <div 
                              key={`rule-${idx}`} 
                              className={`rounded-lg p-2.5 transition flex flex-col gap-1 border ${
                                isDark 
                                  ? "bg-indigo-500/5 hover:bg-indigo-500/10 border-indigo-500/20" 
                                  : "bg-indigo-50/50 hover:bg-indigo-100/55 border-indigo-200"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 w-full">
                                <div className="flex items-center gap-2">
                                  <span className="bg-indigo-600 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded text-white shadow-sm shrink-0">
                                    {item.code}
                                  </span>
                                  <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${isDark ? "text-indigo-300" : "text-indigo-750"}`}>
                                    Suggested Criteria Evidence
                                  </span>
                                </div>
                                <span className="text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                                  Rule-Based
                                </span>
                              </div>
                              <p className={`text-[11px] leading-relaxed ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                                {item.reason}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* AI-Suggested Criteria */}
                      {isClinicalLoading ? (
                        <div className="flex items-center gap-2 text-rose-500 font-bold font-mono text-[10px] uppercase tracking-wider py-2 pt-1">
                          <div className="w-3.5 h-3.5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin"></div>
                          <span className="animate-pulse">Computing AI-suggested ACMG criteria...</span>
                        </div>
                      ) : analysisState.result.insights?.acmgCriteria && analysisState.result.insights.acmgCriteria.length > 0 ? (
                        <div className="space-y-2">
                          {analysisState.result.insights.acmgCriteria.map((item, idx) => (
                            <div 
                              key={`ai-${idx}`} 
                              className={`rounded-lg p-2.5 transition flex flex-col gap-1 border ${
                                isDark 
                                  ? "bg-rose-500/5 hover:bg-rose-500/10 border-rose-500/20" 
                                  : "bg-rose-50/50 hover:bg-rose-100/55 border-rose-200"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 w-full">
                                <div className="flex items-center gap-2">
                                  <span className="bg-rose-600 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded text-white shadow-sm shrink-0">
                                    {item.code}
                                  </span>
                                  <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${isDark ? "text-rose-300" : "text-rose-700"}`}>
                                    Suggested Criteria Evidence
                                  </span>
                                </div>
                                <span className="text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                  AI-Generated
                                </span>
                              </div>
                              <p className={`text-[11px] leading-relaxed ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                                {item.reason}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}

                {/* ClinVar & gnomAD Database Grounding (S-1) */}
                {analysisState.result.clinvar && (
                  <div className={`pt-3 border-t ${classBorderSec}`}>
                    <div className="flex items-center gap-1.5 text-indigo-500 font-bold font-mono text-[10px] uppercase tracking-wider mb-2">
                      <Database className="w-3.5 h-3.5" />
                      <span>ClinVar & gnomAD Evidence Database Grounding</span>
                    </div>
                    <div className="pl-5 space-y-3">
                      {analysisState.result.clinvar.uid ? (
                        <div className={`rounded-xl p-4 border transition-all duration-300 ${
                          isDark ? "bg-slate-950 border-slate-800/80" : "bg-white border-slate-200 shadow-sm"
                        }`}>
                          {/* Grid of ClinVar metrics */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs mb-3">
                            <div>
                              <span className="block text-[10px] font-mono uppercase text-slate-500 font-semibold tracking-wider">ClinVar Significance</span>
                              <span className={`inline-block mt-1 px-2.5 py-0.5 rounded text-[11px] font-bold ${
                                (() => {
                                  const c = analysisState.result.clinvar.classification.toLowerCase();
                                  if (c.includes("likely pathogenic")) return "bg-orange-500/15 text-orange-450 border border-orange-500/20";
                                  if (c.includes("pathogenic")) return "bg-rose-500/15 text-rose-450 border border-rose-500/20";
                                  if (c.includes("likely benign")) return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
                                  if (c.includes("benign")) return "bg-emerald-500/15 text-emerald-455 border border-emerald-500/20";
                                  return "bg-amber-500/15 text-amber-455 border border-amber-500/20";
                                })()
                              }`}>
                                {analysisState.result.clinvar.classification}
                              </span>
                            </div>
                            <div>
                              <span className="block text-[10px] font-mono uppercase text-slate-500 font-semibold tracking-wider">Review Status</span>
                              <span className={`block mt-1 text-xs font-semibold ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                                {analysisState.result.clinvar.reviewStatus || "Not specified"}
                              </span>
                            </div>
                            <div>
                              <span className="block text-[10px] font-mono uppercase text-slate-500 font-semibold tracking-wider">Associated Trait</span>
                              <span className={`block mt-1 text-xs font-semibold truncate max-w-[240px] ${isDark ? "text-slate-300" : "text-slate-700"}`} title={analysisState.result.clinvar.trait}>
                                {analysisState.result.clinvar.trait || "None listed"}
                              </span>
                            </div>
                            <div>
                              <span className="block text-[10px] font-mono uppercase text-slate-500 font-semibold tracking-wider">Last Evaluated</span>
                              <span className={`block mt-1 text-xs ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                                {analysisState.result.clinvar.lastEvaluated && !isNaN(new Date(analysisState.result.clinvar.lastEvaluated).getTime()) ? new Date(analysisState.result.clinvar.lastEvaluated).toLocaleDateString() : "Not specified"}
                              </span>
                            </div>
                          </div>
                          
                          {/* gnomAD frequencies */}
                          {analysisState.result.clinvar.alleleFrequencies && analysisState.result.clinvar.alleleFrequencies.length > 0 && (
                            <div className={`mt-3 pt-3 border-t text-xs ${isDark ? "border-slate-800" : "border-slate-100"}`}>
                              <span className="block text-[10px] font-mono uppercase text-slate-500 font-semibold tracking-wider mb-2">gnomAD / Population Allele Frequencies</span>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {analysisState.result.clinvar.alleleFrequencies.map((freq: any, fIdx: number) => (
                                  <div key={fIdx} className="flex justify-between items-center pr-4 text-xs">
                                    <span className="opacity-75 font-semibold text-slate-450 dark:text-slate-450">{/gnomad/i.test(freq.source) ? "gnomAD" : freq.source}:</span>
                                    <span className="font-bold text-indigo-400 font-mono">
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
                          <div className={`mt-3 pt-2.5 border-t flex justify-end text-[10px] ${isDark ? "border-slate-800" : "border-slate-100"}`}>
                            <a 
                              href={`https://www.ncbi.nlm.nih.gov/clinvar/variation/${analysisState.result.clinvar.uid}/`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1"
                            >
                              NCBI ClinVar Link #{analysisState.result.clinvar.uid} <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className={`rounded-lg p-3 border text-center text-xs font-mono ${
                          isDark ? "bg-slate-900/20 border-slate-800 text-slate-500" : "bg-slate-50 border-slate-200 text-slate-600"
                        }`}>
                          No matching variant found in NCBI ClinVar database.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {!analysisState.result.insights && (
              <div className={`p-3 rounded-lg border text-xs leading-relaxed ${
                isDark ? "bg-amber-950/20 border-amber-900/30 text-amber-300" : "bg-amber-50 border-amber-100 text-amber-800"
              }`}>
                <span className="font-bold block uppercase text-[10px] mb-1 tracking-wider text-amber-500">Structured Report Unavailable</span>
                The AI-generated structured analysis (biochemical shifts, structural impacts, and ACMG criteria classification) could not be parsed or generated. Only the raw clinical narrative is available.
              </div>
            )}

            {/* Detailed Narrative Report Section */}
            <div className={`border-t pt-4 ${classBorderSec}`}>
              <div className={`text-[10px] font-mono uppercase mb-2 font-bold tracking-widest flex items-center gap-1 ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                <FileText className="w-3.5 h-3.5" />
                Detailed Clinical Narrative
              </div>
              {isNarrativeLoading ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3 border border-dashed border-indigo-500/20 rounded-lg bg-indigo-500/5">
                  <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-[10px] text-slate-400 font-mono animate-pulse uppercase tracking-wider">
                    Generating clinical narrative explanation...
                  </span>
                </div>
              ) : (
                <div className={`prose prose-xs leading-relaxed space-y-4 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin transition-colors ${
                  isDark 
                    ? "prose-invert text-slate-300 [&_strong]:text-indigo-300 [&_strong]:font-semibold [&_h1]:text-white [&_h1]:font-bold [&_h1]:text-base [&_h2]:text-white [&_h2]:font-semibold [&_h2]:text-sm [&_h3]:text-white [&_h3]:font-semibold [&_a]:text-indigo-400 [&_a]:underline text-white" 
                    : "text-slate-700 [&_strong]:text-indigo-600 [&_strong]:font-bold [&_h1]:text-slate-900 [&_h1]:font-bold [&_h1]:text-base [&_h2]:text-slate-900 [&_h2]:font-semibold [&_h2]:text-sm [&_h3]:text-slate-800 [&_h3]:font-semibold [&_a]:text-indigo-700 [&_a]:underline"
                } [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4`}>
                  <Markdown>{formatEnergyString(analysisState.result.analysis)}</Markdown>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Startup or placeholder state */
          <div className="text-center py-12 text-slate-500">
            <Lightbulb className="w-10 h-10 mx-auto text-amber-500 stroke-[1.5] mb-2" />
            <p className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>Mutation Explorer Ready</p>
            <p className={`text-xs max-w-xs mx-auto mt-1 leading-relaxed ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Select a core genetic variant or type a custom gene above, then press <strong className="text-indigo-500 font-semibold">Analyze Mutation Effect</strong> to obtain detailed biophysical simulation insights.
            </p>
          </div>
        )}
      </div>

      {/* Card Footer informative links */}
      <div className={`px-5 py-3 border-t text-[11px] flex items-center justify-between transition-colors ${
        isDark ? "border-slate-800 bg-[#1e293b]/50 text-slate-400" : "border-slate-200 bg-slate-50/50 text-slate-500"
      }`}>
        <span className="flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-indigo-500" />
          {analysisState.result?.clinvar?.uid 
            ? "Cross-referenced with ClinVar & gnomAD" 
            : "Sequence & Structural Analysis"}
        </span>
        <a 
          href={`https://www.uniprot.org/uniprotkb/${uniprotId}`} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1.5 font-semibold"
        >
          UniProt Portal <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}
