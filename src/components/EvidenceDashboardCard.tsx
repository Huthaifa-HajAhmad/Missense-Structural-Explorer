import { useState } from "react";
import { 
  Database, 
  Cpu, 
  Compass, 
  Activity, 
  Share2, 
  ShieldAlert, 
  ArrowRight,
  TrendingUp,
  Percent,
  Layers
} from "lucide-react";
import { AnalysisState, PocketResult, EnergeticsData } from "../types";
import { AMINO_ACID_PROPERTIES, AMINO_ACID_NAMES_MAP } from "../useVariantAnalysis";
import { AMINO_ACID_3_TO_1 } from "../aminoAcids";
import { useSettings } from "../context/SettingsContext";

interface EvidenceDashboardCardProps {
  isDark: boolean;
  classCard: string;
  classCardHeader: string;
  classCardTitle: string;
  classBorderSec: string;
  classTextBody: string;
  classTextMute: string;
  analysisState: AnalysisState;
  foldingDdG: number | null;
  foldingStatus: "success" | "scwrl" | null;
  foldingEnergetics?: EnergeticsData | null;
  dynamut2Status?: "pending" | "unavailable" | "done" | null;
  computedPocket?: PocketResult | null;
  isPocketLoading?: boolean;
  pocketError?: string | null;
}

type TabType = "clinical" | "predictors" | "conservation" | "structure" | "function" | "energetics" | "interactions" | "guidelines";

export default function EvidenceDashboardCard({
  isDark,
  classCard,
  classCardHeader,
  classCardTitle,
  classBorderSec,
  classTextBody,
  classTextMute,
  analysisState,
  foldingDdG,
  foldingStatus,
  foldingEnergetics,
  dynamut2Status,
  computedPocket,
  isPocketLoading,
  pocketError
}: EvidenceDashboardCardProps) {
  const [activeTab, setActiveTab] = useState<TabType>("clinical");
  const { settings } = useSettings();
  const energyUnit = settings.energyUnit;

  const result = analysisState.result;

  const formatDdGValue = (val: number | null, unit: "kcal/mol" | "kJ/mol") => {
    if (val === null || val === undefined) return "N/A";
    const kcalVal = val;
    const kjVal = val * 4.184;
    if (unit === "kJ/mol") {
      return `${kjVal.toFixed(2)} kJ/mol [${kcalVal.toFixed(2)} kcal/mol]`;
    }
    return `${kcalVal.toFixed(2)} kcal/mol [${kjVal.toFixed(2)} kJ/mol]`;
  };

  if (!result) {
    return (
      <div className={`${classCard} p-6 flex flex-col items-center justify-center min-h-[200px] text-center`}>
        <Database className="w-8 h-8 text-slate-500 mb-2 stroke-[1.5]" />
        <p className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-600"}`}>
          Unified Evidence Dashboard
        </p>
        <p className="text-[10px] text-slate-500 mt-1 max-w-xs leading-relaxed">
          Submit a genetic variant search query to load multi-modal predictors, conservation, energetics, and interaction evidence.
        </p>
      </div>
    );
  }

  // Score badge helpers
  const getAMBadge = (pathogenicity: number | null, cls: string | null) => {
    if (pathogenicity === null && !cls) return { label: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    const scoreStr = pathogenicity !== null ? ` (${pathogenicity.toFixed(3)})` : "";
    const label = cls ? `${cls.replace(/_/g, " ")}${scoreStr}` : `Score: ${pathogenicity?.toFixed(3)}`;
    const score = pathogenicity ?? 0;
    if (cls?.toLowerCase().includes("pathogenic") || score >= 0.7) {
      return { label, style: "bg-rose-500/15 text-rose-455 border border-rose-500/25 font-bold" };
    }
    if (cls?.toLowerCase().includes("benign") || score <= 0.3) {
      return { label, style: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold" };
    }
    return { label, style: "bg-amber-500/15 text-amber-455 border border-amber-500/20 font-bold" };
  };

  const getCADDBadge = (phred: number | null) => {
    if (phred === null) return { label: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    if (phred >= 20) {
      return { label: `PHRED: ${phred.toFixed(1)} (Pathogenic)`, style: "bg-rose-500/15 text-rose-455 border border-rose-500/25 font-bold" };
    }
    if (phred >= 15) {
      return { label: `PHRED: ${phred.toFixed(1)} (Moderate)`, style: "bg-amber-500/15 text-amber-450 border border-amber-500/20 font-bold" };
    }
    return { label: `PHRED: ${phred.toFixed(1)} (Benign)`, style: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold" };
  };

  const getREVELBadge = (score: number | null) => {
    if (score === null) return { label: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    if (score >= 0.5) {
      return { label: `Score: ${score.toFixed(3)} (Pathogenic)`, style: "bg-rose-500/15 text-rose-455 border border-rose-500/25 font-bold" };
    }
    return { label: `Score: ${score.toFixed(3)} (Benign)`, style: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold" };
  };

  const getGERPBadge = (score: number | null) => {
    if (score === null) return { label: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    if (score >= 2.0) {
      return { label: `GERP++: ${score.toFixed(2)} (Conserved)`, style: "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 font-bold" };
    }
    return { label: `GERP++: ${score.toFixed(2)} (Neutral)`, style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
  };

  const getPhyloPBadge = (score: number | null) => {
    if (score === null) return { label: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    if (score >= 1.5) {
      return { label: `phyloP: ${score.toFixed(2)} (Conserved)`, style: "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 font-bold" };
    }
    return { label: `phyloP: ${score.toFixed(2)} (Variable)`, style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
  };

  const getDdGBadge = (val: number | null) => {
    if (val === null) return { label: "Not Computed", category: "Not Computed", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    const formatted = formatDdGValue(val, energyUnit);
    if (val > 1.5) {
      return { label: `+${formatted} (Highly Destabilizing)`, category: "Highly Destabilizing", style: "bg-rose-500/15 text-rose-455 border border-rose-500/25 font-bold" };
    }
    if (val > 0.5) {
      return { label: `+${formatted} (Moderately Destabilizing)`, category: "Moderately Destabilizing", style: "bg-orange-500/15 text-orange-450 border border-orange-500/20 font-bold" };
    }
    if (val < -0.5) {
      return { label: `${formatted} (Stabilizing)`, category: "Stabilizing", style: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold" };
    }
    return { label: `${formatted} (Neutral)`, category: "Neutral", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
  };

  const renderContrastBar = (wtVal: number, mutVal: number) => {
    const minVal = Math.min(wtVal, mutVal);
    const maxVal = Math.max(wtVal, mutVal);
    const isDecrease = wtVal > mutVal;
    const baseColor = "bg-[#ad5e6d]/90";
    const changeColor = isDecrease ? "bg-[#50c8a5]" : "bg-[#ff6f91]";
    return (
      <div className="relative h-2 bg-slate-200 dark:bg-slate-850 rounded-full overflow-hidden">
        <div 
          className={`absolute h-full left-0 ${baseColor}`} 
          style={{ width: `${minVal}%` }} 
        />
        <div 
          className={`absolute h-full ${changeColor}`} 
          style={{ left: `${minVal}%`, width: `${maxVal - minVal}%` }} 
        />
      </div>
    );
  };

  const tabs: { id: TabType; label: string; icon: any }[] = [
    { id: "clinical", label: "Databases", icon: Database },
    { id: "predictors", label: "Predictors", icon: Cpu },
    { id: "conservation", label: "Evolution", icon: Compass },
    { id: "structure", label: "Structure", icon: Layers },
    { id: "function", label: "Function", icon: TrendingUp },
    { id: "energetics", label: "Energetics", icon: Activity },
    { id: "interactions", label: "Interactions", icon: Share2 },
    { id: "guidelines", label: "Threshold Guide", icon: ShieldAlert }
  ];

  const consurfVal = result.conservationData?.consurf;

  // Resolve 1-letter residue abbreviations for property calculations
  const wt1 = result.metadata.wildType.length === 3 ? AMINO_ACID_3_TO_1[result.metadata.wildType] : result.metadata.wildType;
  const mut1 = result.metadata.mutant.length === 3 ? AMINO_ACID_3_TO_1[result.metadata.mutant] : result.metadata.mutant;
  const wtProp = wt1 ? AMINO_ACID_PROPERTIES[wt1] : null;
  const mutProp = mut1 ? AMINO_ACID_PROPERTIES[mut1] : null;

  // Local calculations for consensus biophysical energetics table
  const energetics = {
    foldx: foldingEnergetics?.foldx ?? foldingDdG,
    dynamut2: foldingEnergetics?.dynamut2 ?? result.dynamut2 ?? null,
    ddgun: foldingEnergetics?.ddgun ?? null,
    maestro: foldingEnergetics?.maestro ?? null
  };

  return (
    <div className={`${classCard} overflow-hidden flex flex-col transition-all`} id="evidence-dashboard-card">
      {/* Header */}
      <div className={`px-5 py-4 border-b flex items-center justify-between transition-colors ${classCardHeader}`}>
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-indigo-500" />
          <h3 className={`text-sm font-bold uppercase tracking-wider font-mono ${classCardTitle}`}>
            Multi-Modal Evidence Dashboard
          </h3>
        </div>
      </div>

      {result.isDemoData && (
        <div className={`mx-5 mt-4 p-2.5 rounded-xl border text-[11px] font-medium leading-relaxed transition-all flex items-center gap-2 ${
          isDark 
            ? "bg-amber-500/10 border-amber-500/20 text-amber-300" 
            : "bg-amber-50 border-amber-200 text-amber-700"
        }`}>
          <span>⚠ Demo data — example preset; not a live backend analysis</span>
        </div>
      )}

      {/* Tab Navigation */}
      <div className={`flex border-b overflow-x-auto ${isDark ? "bg-slate-900/40 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                isActive
                  ? "border-indigo-500 text-indigo-500 bg-indigo-500/5"
                  : isDark
                    ? "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content Panels */}
      <div className="p-5 flex-1 font-mono text-xs">
        {activeTab === "clinical" && (
          <div className="space-y-4">
            <h4 className="font-bold text-xs uppercase text-indigo-500 tracking-wider">ClinVar & gnomAD Population Genetics</h4>
            
            {result.clinvar ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={`p-4 rounded-xl border transition-all duration-300 ${isDark ? "bg-slate-900/40 border-slate-800/80 hover:border-slate-700/80" : "bg-white border-slate-200 hover:border-slate-300 shadow-sm"}`}>
                  <span className="block text-[10px] uppercase text-slate-450 dark:text-slate-500 font-semibold tracking-wider">ClinVar Interpretation</span>
                  <span className={`inline-block mt-2 px-2.5 py-1 rounded-lg text-xs font-bold ${
                    (() => {
                      const c = result.clinvar.classification.toLowerCase();
                      if (c.includes("likely pathogenic")) return "bg-orange-500/15 text-orange-450 border border-orange-500/20";
                      if (c.includes("pathogenic")) return "bg-rose-500/15 text-rose-455 border border-rose-500/20";
                      if (c.includes("likely benign")) return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
                      if (c.includes("benign")) return "bg-emerald-500/15 text-emerald-455 border border-emerald-500/20";
                      return "bg-amber-500/15 text-amber-455 border border-amber-500/20";
                    })()
                  }`}>
                    {result.clinvar.classification}
                  </span>
                  
                  <div className="mt-4 space-y-2 text-xs">
                    <div className="flex justify-between border-b border-slate-800/35 pb-1">
                      <span className="text-slate-500 font-bold">Review Status:</span>
                      <span className={isDark ? "text-slate-300 font-semibold" : "text-slate-700 font-semibold"}>{result.clinvar.reviewStatus}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800/35 pb-1">
                      <span className="text-slate-500 font-bold">Trait:</span>
                      <span className={`font-semibold max-w-[180px] truncate ${isDark ? "text-slate-300" : "text-slate-700"}`} title={result.clinvar.trait}>{result.clinvar.trait || "N/A"}</span>
                    </div>
                    <div className="flex justify-between pb-1">
                      <span className="text-slate-500 font-bold">Last Evaluated:</span>
                      <span className={isDark ? "text-slate-300" : "text-slate-700"}>
                        {result.clinvar.lastEvaluated && !isNaN(new Date(result.clinvar.lastEvaluated).getTime()) ? new Date(result.clinvar.lastEvaluated).toLocaleDateString() : "N/A"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className={`p-4 rounded-xl border transition-all duration-300 ${isDark ? "bg-slate-900/40 border-slate-800/80 hover:border-slate-700/80" : "bg-white border-slate-200 hover:border-slate-300 shadow-sm"}`}>
                  <span className="block text-[10px] uppercase text-slate-450 dark:text-slate-500 font-semibold tracking-wider">gnomAD Allele Frequency</span>
                  
                  {result.clinvar.alleleFrequencies && result.clinvar.alleleFrequencies.length > 0 ? (
                    <div className="mt-3 space-y-2.5">
                      {result.clinvar.alleleFrequencies.map((freq, fIdx) => (
                        <div key={fIdx} className="flex justify-between items-center text-xs border-b border-slate-800/35 pb-1 last:border-0 last:pb-0">
                          <span className="text-slate-455 font-bold">{freq.source}:</span>
                          <span className="text-indigo-400 font-bold font-mono">
                            {(() => {
                              const num = parseFloat(freq.value);
                              return isNaN(num) ? "N/A" : num.toExponential(3);
                            })()}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic mt-3">No population frequency data available in this coordinate record.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-3 text-center text-slate-500 border border-dashed rounded-lg text-xs">
                No matching variant found in NCBI ClinVar database.
              </div>
            )}
          </div>
        )}

        {activeTab === "predictors" && (
          <div className="space-y-4">
            <h4 className="font-bold text-xs uppercase text-indigo-500 tracking-wider">In Silico Pathogenicity Predictors</h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* AlphaMissense */}
              <div className={`p-4 rounded-xl border flex flex-col justify-between transition-all duration-300 ${isDark ? "bg-slate-900/40 border-slate-800/80 hover:border-slate-700/80" : "bg-white border-slate-200 hover:border-slate-300 shadow-sm"}`}>
                <div>
                  <span className="block text-[10px] uppercase text-slate-455 dark:text-slate-500 font-bold tracking-wider">AlphaMissense (EBI)</span>
                  <span className="text-[11px] text-slate-400 mt-1 block leading-relaxed">AI deep learning structure score</span>
                </div>
                <div className="mt-4">
                  {result.predictorData?.available === false ? (
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded border bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold">
                      Data unavailable (upstream)
                    </span>
                  ) : (() => {
                    const badge = getAMBadge(result.predictorData?.amPathogenicity ?? null, result.predictorData?.amClass ?? null);
                    return (
                      <span className={`inline-block text-xs px-2.5 py-1 rounded-lg border capitalize ${badge.style}`}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* CADD */}
              <div className={`p-4 rounded-xl border flex flex-col justify-between transition-all duration-300 ${isDark ? "bg-slate-900/40 border-slate-800/80 hover:border-slate-700/80" : "bg-white border-slate-200 hover:border-slate-300 shadow-sm"}`}>
                <div>
                  <span className="block text-[10px] uppercase text-slate-455 dark:text-slate-500 font-bold tracking-wider">CADD PHRED</span>
                  <span className="text-[11px] text-slate-400 mt-1 block leading-relaxed">Genomic annotation integration</span>
                </div>
                <div className="mt-4">
                  {result.predictorData?.available === false ? (
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded border bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold">
                      Data unavailable (upstream)
                    </span>
                  ) : (() => {
                    const badge = getCADDBadge(result.predictorData?.caddPhred ?? null);
                    return (
                      <span className={`inline-block text-xs px-2.5 py-1 rounded-lg border ${badge.style}`}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* REVEL */}
              <div className={`p-4 rounded-xl border flex flex-col justify-between transition-all duration-300 ${isDark ? "bg-slate-900/40 border-slate-800/80 hover:border-slate-700/80" : "bg-white border-slate-200 hover:border-slate-300 shadow-sm"}`}>
                <div>
                  <span className="block text-[10px] uppercase text-slate-455 dark:text-slate-500 font-bold tracking-wider">REVEL</span>
                  <span className="text-[11px] text-slate-400 mt-1 block leading-relaxed">Ensemble pathogenicity score</span>
                </div>
                <div className="mt-4">
                  {result.conservationData?.available === false ? (
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded border bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold">
                      Data unavailable (upstream)
                    </span>
                  ) : (() => {
                    const badge = getREVELBadge(result.conservationData?.revel ?? null);
                    return (
                      <span className={`inline-block text-xs px-2.5 py-1 rounded-lg border ${badge.style}`}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "conservation" && (
          <div className="space-y-4">
            <h4 className="font-bold text-xs uppercase text-indigo-500 tracking-wider">Evolutionary Sequence Conservation Scores</h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* GERP++ */}
              <div className={`p-4 rounded-xl border flex flex-col justify-between transition-all duration-300 ${isDark ? "bg-slate-900/40 border-slate-800/80 hover:border-slate-700/80" : "bg-white border-slate-200 hover:border-slate-300 shadow-sm"}`}>
                <div>
                  <div className="flex justify-between items-start border-b border-slate-800/35 pb-1">
                    <span className="block text-[10px] uppercase text-slate-455 dark:text-slate-500 font-bold tracking-wider">GERP++ Score</span>
                    <span className="text-[10px] text-slate-500 font-bold font-mono">Range: -12.36 to 6.17</span>
                  </div>
                  <span className="text-xs text-slate-400 mt-2 block leading-relaxed">Mammalian alignment substitution rate constraint. Higher scores represent stronger selective constraint.</span>
                </div>
                <div className="mt-4">
                  {result.conservationData?.available === false ? (
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded border bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold">
                      Data unavailable (upstream)
                    </span>
                  ) : (() => {
                    const badge = getGERPBadge(result.conservationData?.gerp ?? null);
                    return (
                      <span className={`inline-block text-xs px-2.5 py-1 rounded-lg border ${badge.style}`}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* phyloP */}
              <div className={`p-4 rounded-xl border flex flex-col justify-between transition-all duration-300 ${isDark ? "bg-slate-900/40 border-slate-800/80 hover:border-slate-700/80" : "bg-white border-slate-200 hover:border-slate-300 shadow-sm"}`}>
                <div>
                  <div className="flex justify-between items-start border-b border-slate-800/35 pb-1">
                    <span className="block text-[10px] uppercase text-slate-455 dark:text-slate-500 font-bold tracking-wider">phyloP Score (100 vertebrates)</span>
                    <span className="text-[10px] text-slate-500 font-bold font-mono">Range: -∞ to +∞</span>
                  </div>
                  <span className="text-xs text-slate-400 mt-2 block leading-relaxed">Base-wise evolutionary constraint scores. Positive means conserved; negative means fast-evolving.</span>
                </div>
                <div className="mt-4">
                  {result.conservationData?.available === false ? (
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded border bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold">
                      Data unavailable (upstream)
                    </span>
                  ) : (() => {
                    const badge = getPhyloPBadge(result.conservationData?.phylop ?? null);
                    return (
                      <span className={`inline-block text-xs px-2.5 py-1 rounded-lg border ${badge.style}`}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* ConSurf Highlights */}
            <div className={`space-y-2 mt-4 pt-3 border-t border-slate-800/35 transition-opacity ${!consurfVal ? "opacity-60" : ""}`}>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[11px] uppercase font-bold text-slate-455 dark:text-slate-500 tracking-wider">Locally-Derived Conservation Index (GERP++/phyloP consensus):</span>
                <span className={`text-xs px-2.5 py-1 rounded-lg font-bold border ${
                  result.conservationData?.available === false
                    ? "bg-slate-500/10 text-slate-400 border-slate-500/20"
                    : consurfVal ? (consurfVal >= 7 ? "bg-rose-500/10 text-rose-450 border-rose-500/20" : consurfVal <= 3 ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" : "bg-slate-500/10 text-slate-400 border-slate-500/20") : "text-slate-500 border-slate-700/30"
                }`}>
                  {result.conservationData?.available === false ? "Data unavailable (upstream)" : (consurfVal ? `${consurfVal} / 9 (${consurfVal >= 7 ? "Highly Conserved" : consurfVal <= 3 ? "Highly Variable" : "Average"})` : "N/A")}
                </span>
              </div>
              {consurfVal ? (
                <div className="grid grid-cols-9 gap-1 h-3 mt-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((val) => {
                    const isSelected = result.conservationData?.available !== false && consurfVal === val;
                    let colorClass = "bg-slate-200 dark:bg-slate-800";
                    if (result.conservationData?.available !== false && (isSelected || consurfVal === undefined || consurfVal === null)) {
                      if (val <= 3) colorClass = "bg-cyan-500";
                      else if (val <= 6) colorClass = "bg-amber-500";
                      else colorClass = "bg-rose-500";
                    }
                    return (
                      <div 
                        key={val} 
                        className={`h-full rounded-sm transition-all duration-300 ${colorClass} ${
                          isSelected ? "ring-2 ring-indigo-400 scale-y-110 shadow-lg" : "opacity-35"
                        }`}
                        title={`Conservation Index ${val}`}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="h-3 bg-slate-200 dark:bg-slate-800/40 rounded-sm w-full opacity-35" />
              )}
              <div className="flex justify-between text-[8px] text-slate-500 font-bold uppercase mt-1">
                <span>Variable (1)</span>
                <span>Average (5)</span>
                <span>Conserved (9)</span>
              </div>
              {!consurfVal && result.conservationData?.available !== false && (
                <div className={`p-2 mt-2 rounded border text-[9px] leading-normal ${
                  isDark ? "bg-amber-500/5 border-amber-500/10 text-amber-400/90" : "bg-amber-50 border-amber-200 text-amber-800"
                }`}>
                  ⚠️ **Consensus Index Unavailable**: Derived from normalized GERP++ (mammalian genomic constraint) and phyloP (vertebrate base-wise constraint). One of these scores is missing for this variant's genomic coordinate.
                </div>
              )}
              <p className="text-[8px] text-slate-500 opacity-80 leading-normal mt-1.5 italic">
                * Locally-derived conservation index calculated via GERP++ and phyloP normalization (not fetched from ConSurf DB).
              </p>
            </div>
          </div>
        )}

        {activeTab === "structure" && (
          <div className="space-y-4">
            <h4 className="font-bold text-xs uppercase text-indigo-500 tracking-wider">Residue Biophysical Property Shifts</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div className={`p-3 rounded-lg border ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200"} flex flex-col items-center justify-center`}>
                <span className="block text-[10px] uppercase text-slate-500 font-bold tracking-wider">Wild-Type Residue</span>
                <span className="text-3xl font-black text-emerald-500 mt-1">{result.metadata.wildType}</span>
                <p className="text-xs text-slate-500 mt-1.5 leading-normal">
                  {AMINO_ACID_NAMES_MAP[wt1] || wt1}
                </p>
              </div>

              <div className={`p-3 rounded-lg border ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200"} flex flex-col items-center justify-center`}>
                <span className="block text-[10px] uppercase text-slate-500 font-bold tracking-wider">Mutant Substitution</span>
                <span className="text-3xl font-black text-rose-500 mt-1">{result.metadata.mutant}</span>
                <p className="text-xs text-slate-500 mt-1.5 leading-normal">
                  {AMINO_ACID_NAMES_MAP[mut1] || mut1}
                </p>
              </div>
            </div>

            {wtProp && mutProp && (
              <div className={`p-4 rounded-lg border ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200"} space-y-3`}>
                <span className="block text-[10px] uppercase text-slate-500 font-bold tracking-wider">Biochemical Property Contrast (Scale: 0-100)</span>
                
                {/* Hydrophobicity */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Hydrophobicity</span>
                    <span className="font-bold">{wtProp.hydrophobicity} → {mutProp.hydrophobicity}</span>
                  </div>
                  {renderContrastBar(wtProp.hydrophobicity, mutProp.hydrophobicity)}
                </div>

                {/* Size */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Residue Volume / Size</span>
                    <span className="font-bold">{wtProp.size} → {mutProp.size}</span>
                  </div>
                  {renderContrastBar(wtProp.size, mutProp.size)}
                </div>

                {/* Polarity */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Polarity</span>
                    <span className="font-bold">{wtProp.polarity} → {mutProp.polarity}</span>
                  </div>
                  {renderContrastBar(wtProp.polarity, mutProp.polarity)}
                </div>

                {/* Charge */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Isoelectric Charge Index</span>
                    <span className="font-bold">{wtProp.charge} → {mutProp.charge}</span>
                  </div>
                  {renderContrastBar(wtProp.charge, mutProp.charge)}
                </div>
              </div>
            )}

            {result.insights?.biochemicalShift && (
              <div className={`p-3 rounded-lg border ${isDark ? "bg-indigo-950/20 border-indigo-900/30 text-indigo-300" : "bg-indigo-50 border-indigo-100 text-indigo-800"} text-[10px] leading-relaxed`}>
                <span className="font-bold block uppercase text-[8px] mb-1 tracking-wider text-indigo-400">Biochemical Shift Narrative:</span>
                {result.insights.biochemicalShift}
              </div>
            )}
          </div>
        )}

        {activeTab === "function" && (
          <div className="space-y-4">
            {isPocketLoading ? (
              <div className="flex flex-col items-center justify-center p-6 text-center">
                <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-2" />
                <span className="text-[10px] text-slate-500">Calculating ligand-binding pockets via P2Rank/Heuristic...</span>
              </div>
            ) : pocketError ? (
              <div className="p-3 text-center text-rose-455 border border-dashed border-rose-500/20 bg-rose-500/5 rounded-lg">
                <ShieldAlert className="w-5 h-5 mx-auto mb-1 text-rose-500" />
                <span>Failed to calculate pockets: {pocketError}</span>
              </div>
            ) : computedPocket ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="font-bold text-[10px] uppercase text-indigo-500 tracking-wider">P2Rank Ligand-Binding Pocket Distance</h4>
                  <span className={`text-[9px] px-2 py-0.5 rounded font-bold border ${
                    computedPocket.status === "success"
                      ? "bg-emerald-500/10 text-emerald-450 border-emerald-500/20"
                      : "bg-amber-500/10 text-amber-455 border-amber-500/20"
                  }`}>
                    {computedPocket.status === "success" ? "P2Rank Live (ML-computed)" : "P2Rank Offline (Heuristic Fallback)"}
                  </span>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className={`p-3 rounded-lg border ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200 shadow-sm"}`}>
                    <span className="block text-[8px] uppercase text-slate-500 font-bold">Pocket Distance</span>
                    <span className={`text-sm font-bold block mt-1 ${
                      computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined && computedPocket.pocketDistance < 10
                        ? "text-rose-455"
                        : isDark ? "text-slate-200" : "text-slate-800"
                    }`}>
                      {computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined 
                        ? `${computedPocket.pocketDistance.toFixed(2)} Å` 
                        : "N/A"}
                    </span>
                    <span className="text-[8px] text-slate-500 mt-1 block">Distance to pocket centroid</span>
                  </div>

                  <div className={`p-3 rounded-lg border ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200 shadow-sm"}`}>
                    <span className="block text-[8px] uppercase text-slate-500 font-bold">Binding Probability</span>
                    <span className="text-sm font-bold text-indigo-400 mt-1 block">
                      {computedPocket.status === "success" ? `${computedPocket.pocketScore}%` : "N/A"}
                    </span>
                    <span className="text-[8px] text-slate-500 mt-1 block">P2Rank affinity index</span>
                  </div>

                  <div className={`p-3 rounded-lg border ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200 shadow-sm"}`}>
                    <span className="block text-[8px] uppercase text-slate-500 font-bold">Pocket Volume</span>
                    <span className="text-sm font-bold text-indigo-400 mt-1 block">
                      {computedPocket.status === "success" ? `${computedPocket.pocketVolume} Å³` : "N/A"}
                    </span>
                    <span className="text-[8px] text-slate-500 mt-1 block">Spatial cavity volume</span>
                  </div>
                </div>

                {computedPocket.status !== "success" && (
                  <div className={`p-3 rounded-lg border text-[10px] leading-relaxed ${
                    isDark ? "bg-amber-950/20 border-amber-900/30 text-amber-300" : "bg-amber-50 border-amber-100 text-amber-800"
                  }`}>
                    <span className="font-bold block uppercase text-[8px] mb-1 tracking-wider text-amber-500">ML Model Offline:</span>
                    P2Rank machine learning service is currently offline. Pocket affinity scores and cavity volumes are unavailable. Utilizing sequence-based functional proximity heuristics.
                  </div>
                )}

                <div className={`p-3 rounded-lg border ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200"} space-y-2`}>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-500 font-bold">Likely Co-Factor / Target Ligand:</span>
                    <span className={`font-bold ${isDark ? "text-slate-200" : "text-slate-800"}`}>{computedPocket.likelyCofactor}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-500 font-bold">Spatial Classification:</span>
                    <span className={`font-bold ${
                      computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined && computedPocket.pocketDistance <= 8.0
                        ? "text-rose-455 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.2 rounded"
                        : "text-emerald-450 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 rounded"
                    }`}>
                      {computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined && computedPocket.pocketDistance <= 8.0
                        ? "ACTIVE_SITE_PROXIMATE (High Functional Disruption)"
                        : "DISTAL_SURFACE (Low Functional Disruption)"}
                    </span>
                  </div>
                </div>

                {computedPocket.pocketResidues && computedPocket.pocketResidues.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[8px] uppercase text-slate-500 font-bold">Pocket Lining Residues (Top 7)</span>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      {computedPocket.pocketResidues.slice(0, 7).map((res: any, idx: number) => (
                        <div key={idx} className={`p-2 rounded border ${isDark ? "bg-slate-950/40 border-slate-850" : "bg-slate-50 border-slate-200"} flex justify-between`}>
                          <span>{res.name}{res.index}</span>
                          <span className="text-slate-500">Dist: {res.distance} Å</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 text-center text-slate-500 border border-dashed rounded-lg">
                No active pocket computations found. Click 3D coordinates on the model to trigger solver.
              </div>
            )}
          </div>
        )}

        {activeTab === "energetics" && (
          <div className="space-y-4">
            <h4 className="font-bold text-xs uppercase text-indigo-500 tracking-wider">Single-tool ΔΔG (FoldX)</h4>
            
            {energetics.foldx === null && (
              <div className={`p-3.5 rounded-lg border ${isDark ? "bg-amber-550/10 border-amber-550/20 text-amber-300" : "bg-amber-50 border-amber-200 text-amber-700"} space-y-1`}>
                <div className="font-bold text-xs uppercase flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 shrink-0" style={{ strokeWidth: 2 }} />
                  <span>Biophysical Simulation Required</span>
                </div>
                <p className="text-xs leading-relaxed">
                  FoldX mutant energy minimization has not been triggered for this variant yet. Please switch the 3D Molecular Viewer mode to <strong>"Mutant"</strong> or <strong>"Side-by-Side"</strong> to run the local side-chain repacking simulation and compute free-energy changes (ΔΔG).
                </p>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-slate-850">
              <table className="w-full text-[10px] text-left border-collapse">
                <thead>
                  <tr className={`border-b ${isDark ? "bg-slate-900 border-slate-850 text-slate-400" : "bg-slate-100 border-slate-250 text-slate-650"}`}>
                    <th className="p-2.5 font-bold uppercase tracking-wider">Method</th>
                    <th className="p-2.5 font-bold uppercase tracking-wider">Type</th>
                    <th className="p-2.5 font-bold uppercase tracking-wider">ΔΔG Score</th>
                    <th className="p-2.5 font-bold uppercase tracking-wider">Risk Assessment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {[
                    { name: "FoldX", type: "Force Field Repacking", val: energetics.foldx },
                    { name: "DynaMut2", type: "Normal Mode Analysis / ML", val: energetics.dynamut2 },
                    { name: "DDGun", type: "Sequence/Evolution Integration", val: energetics.ddgun },
                    { name: "MAESTRO", type: "Statistical Potentials/ML", val: energetics.maestro }
                  ].map((item, idx) => {
                    const isIntegrated = item.name === "FoldX" || item.name === "DynaMut2";
                    let scoreText = "N/A (Not Integrated)";
                    let badge = { label: "N/A (Not Integrated)", category: "N/A (Not Integrated)", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };

                    if (isIntegrated) {
                      if (item.val !== null && item.val !== undefined) {
                        scoreText = formatDdGValue(item.val, energyUnit);
                        badge = getDdGBadge(item.val);
                      } else if (item.name === "DynaMut2" && dynamut2Status === "pending") {
                        scoreText = "Calculating...";
                        badge = { label: "Calculating", category: "Calculating", style: "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse font-bold" };
                      } else {
                        scoreText = "Unavailable";
                        badge = { label: "Unavailable", category: "Unavailable", style: "bg-slate-500/10 text-slate-400 border border-slate-500/20" };
                      }
                    }

                    return (
                      <tr key={idx} className={isDark ? "hover:bg-slate-900/40" : "hover:bg-slate-50"}>
                        <td className="p-2.5 font-bold">{item.name}</td>
                        <td className="p-2.5 text-slate-500">{item.type}</td>
                        <td className="p-2.5 font-bold">{scoreText}</td>
                        <td className="p-2.5">
                          <span className={`text-[8px] px-1.5 py-0.5 rounded border ${badge.style}`}>
                            {badge.category}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className={`p-3 rounded-lg border ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200"} space-y-2`}>
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-500 font-bold">Stability Prediction Verdict:</span>
                {(() => {
                  const val = energetics.foldx;
                  let styleClass = "text-slate-400 bg-slate-500/10 border border-slate-500/20 px-1.5 py-0.2 rounded";
                  let text = "UNAVAILABLE";
                  
                  if (val !== null && val !== undefined) {
                    if (val > 1.5) {
                      styleClass = "text-rose-455 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.2 rounded font-bold";
                      text = "HIGHLY_DESTABILIZING (Probable Misfolding)";
                    } else if (val > 0.5) {
                      styleClass = "text-amber-455 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 rounded font-bold";
                      text = "MODERATELY_DESTABILIZING (Conformational Shift)";
                    } else if (val < -0.5) {
                      styleClass = "text-emerald-455 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 rounded font-bold";
                      text = "STABILIZING";
                    } else {
                      styleClass = "text-slate-400 bg-slate-500/10 border border-slate-500/20 px-1.5 py-0.2 rounded font-bold";
                      text = "NEUTRAL (Conserved Fold)";
                    }
                  }
                  
                  return (
                    <span className={`font-bold ${styleClass}`}>
                      {text}
                    </span>
                  );
                })()}
              </div>
            </div>
            
            <div className={`text-[9px] p-2.5 rounded border ${
              isDark ? "bg-slate-950 border-slate-800/80 text-amber-400/80" : "bg-amber-50 border-amber-100 text-amber-800"
            } italic`}>
              * Consensus calculations are derived from FoldX energy grids and sequence-based evolutionary alignment dynamics.
            </div>
          </div>
        )}

        {activeTab === "interactions" && (
          <div className="space-y-4">
            <h4 className="font-bold text-[10px] uppercase text-indigo-500 tracking-wider">STRING Functional Protein-Protein Interaction Network</h4>
            
            {result.stringInteractions && result.stringInteractions.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-400 mb-1.5">
                  Top functional partners and network association confidence scores retrieved dynamically from STRING DB:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {result.stringInteractions.map((partner, pIdx) => {
                    const pct = (partner.score * 100).toFixed(0);
                    return (
                      <div 
                        key={pIdx}
                        className={`flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                          isDark 
                            ? "bg-slate-900 border-slate-800 hover:border-slate-700" 
                            : "bg-white border-slate-200 hover:border-slate-300 shadow-sm"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div>
                          <span className={`font-bold font-sans ${isDark ? "text-white" : "text-slate-800"}`}>{partner.partner}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Confidence:</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${
                            partner.score >= 0.7 
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                              : "bg-amber-500/10 text-amber-450 border border-amber-500/20"
                          }`}>
                            {pct}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-3 text-center text-slate-500 border border-dashed rounded-lg">
                No STRING DB interaction partners found for gene {result.metadata.gene}.
              </div>
            )}
          </div>
        )}

        {activeTab === "guidelines" && (
          <div className="space-y-4">
            <h4 className="font-bold text-[10px] uppercase text-indigo-500 tracking-wider">Research Interpretation & ACMG/AMP Threshold Guidelines</h4>
            
            {/* Dynamic Alert Banner */}
            {(() => {
              const revel = result.conservationData?.revel ?? null;
              const ddG = foldingDdG;
              
              let statusText = "Variant of Uncertain Significance (VUS)";
              let statusStyle = "bg-slate-500/10 text-slate-400 border-slate-500/20";
              let statusDesc = "The scores and stability changes fall into intermediate ranges or present conflicting evidence, requiring further functional validation.";
              
              if (revel !== null && revel >= 0.75 && ddG !== null && ddG > 1.5) {
                statusText = "HIGH-RISK PATHOGENIC CONSENSUS (Strong Biophysical Evidence)";
                statusStyle = "bg-rose-500/15 text-rose-455 border-rose-500/25";
                statusDesc = "Both sequence-based pathogenicity (REVEL >= 0.75) and structural energetics (FoldX ddG > 1.5 kcal/mol) suggest a severe loss-of-function risk with high likelihood of misfolding.";
              } else if ((revel !== null && revel >= 0.5) || (ddG !== null && ddG > 1.5)) {
                statusText = "MODERATE-RISK CONSENSUS (Pathogenic / Destabilizing Support)";
                statusStyle = "bg-orange-500/15 text-orange-450 border-orange-500/20";
                statusDesc = "At least one biophysical indicator (REVEL >= 0.5 or FoldX ddG > 0.5 kcal/mol) shows significant aberration, suggesting functional or structural impact.";
              } else if (revel !== null && revel < 0.15 && ddG !== null && ddG < 0.5 && ddG > -0.5) {
                statusText = "LOW-RISK CONSENSUS (Likely Benign / Tolerated)";
                statusStyle = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                statusDesc = "Consensus indicators fall within benign boundaries. The variant is structurally neutral and evolutionary conservation does not suggest strict constraint.";
              }
              
              return (
                <div className={`p-3 rounded-lg border leading-relaxed text-xs ${statusStyle}`}>
                  <div className="font-bold flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>{statusText}</span>
                  </div>
                  <p className="mt-1 text-[10px] opacity-90">{statusDesc}</p>
                </div>
              );
            })()}

            {/* Threshold Table */}
            <div className="overflow-x-auto">
              <table className={`w-full text-[10px] font-sans border-collapse rounded-lg overflow-hidden border ${isDark ? "border-slate-800" : "border-slate-200"}`}>
                <thead>
                  <tr className={isDark ? "bg-slate-900 text-slate-300" : "bg-slate-100 text-slate-700"}>
                    <th className="p-2 text-left border-b font-bold font-mono">Assay / Metric</th>
                    <th className="p-2 text-left border-b font-bold font-mono">Variant Score</th>
                    <th className="p-2 text-left border-b font-bold font-mono">Benign Threshold</th>
                    <th className="p-2 text-left border-b font-bold font-mono">Pathogenic Threshold</th>
                    <th className="p-2 text-center border-b font-bold font-mono">ACMG Code</th>
                    <th className="p-2 text-center border-b font-bold font-mono">Match</th>
                  </tr>
                </thead>
                <tbody className={isDark ? "text-slate-400" : "text-slate-650"}>
                  {/* REVEL Row */}
                  {(() => {
                    const val = result.conservationData?.revel ?? null;
                    const isBenign = val !== null && val < 0.15;
                    const isPath = val !== null && val >= 0.5;
                    const isStrong = val !== null && val >= 0.75;
                    return (
                      <tr className={isDark ? "border-b border-slate-850 hover:bg-slate-900/40" : "border-b border-slate-150 hover:bg-slate-50"}>
                        <td className="p-2 font-bold text-slate-300">REVEL Score</td>
                        <td className="p-2 font-mono font-bold">{val !== null ? val.toFixed(3) : "N/A"}</td>
                        <td className="p-2 text-slate-500 font-mono">&lt; 0.150</td>
                        <td className="p-2 text-slate-500 font-mono">&gt;= 0.500 (Strong: &gt;= 0.750)</td>
                        <td className="p-2 text-center font-bold font-mono text-xs">
                          {isStrong || isPath ? (
                            <span className="text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">PP3</span>
                          ) : isBenign ? (
                            <span className="text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">BP4</span>
                          ) : (
                            <span className="opacity-40">PP3 / BP4</span>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          {isStrong ? (
                            <span className="bg-rose-500/20 text-rose-455 px-1.5 py-0.5 rounded font-bold">Strong Path.</span>
                          ) : isPath ? (
                            <span className="bg-rose-500/10 text-rose-450 px-1.5 py-0.5 rounded font-bold">Pathogenic</span>
                          ) : isBenign ? (
                            <span className="bg-emerald-500/10 text-emerald-450 px-1.5 py-0.5 rounded font-bold">Benign</span>
                          ) : (
                            <span className="text-slate-500 font-bold">VUS</span>
                          )}
                        </td>
                      </tr>
                    );
                  })()}

                  {/* FoldX ddG Row */}
                  {(() => {
                    const val = foldingDdG;
                    const isBenign = val !== null && val >= -0.5 && val <= 0.5;
                    const isPath = val !== null && val > 0.5;
                    const isStrong = val !== null && val > 1.5;
                    const isStabilizing = val !== null && val < -0.5;
                    return (
                      <tr className={isDark ? "border-b border-slate-850 hover:bg-slate-900/40" : "border-b border-slate-150 hover:bg-slate-50"}>
                        <td className="p-2 font-bold text-slate-300">FoldX ddG</td>
                        <td className="p-2 font-mono font-bold">{val !== null ? `${val.toFixed(2)} kcal/mol` : "N/A"}</td>
                        <td className="p-2 text-slate-500 font-mono">-0.5 to +0.5</td>
                        <td className="p-2 text-slate-500 font-mono">&gt; 0.50 (Severe: &gt; 1.50)</td>
                        <td className="p-2 text-center font-bold font-mono text-xs">
                          {isStrong || isPath ? (
                            <span className="text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">PM1</span>
                          ) : isBenign || isStabilizing ? (
                            <span className="text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">BP3</span>
                          ) : (
                            <span className="opacity-40">PM1 / BP3</span>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          {isStrong ? (
                            <span className="bg-rose-500/20 text-rose-455 px-1.5 py-0.5 rounded font-bold">Severe Destab.</span>
                          ) : isPath ? (
                            <span className="bg-amber-500/10 text-amber-450 px-1.5 py-0.5 rounded font-bold">Destab.</span>
                          ) : isBenign ? (
                            <span className="bg-emerald-500/10 text-emerald-450 px-1.5 py-0.5 rounded font-bold">Neutral</span>
                          ) : val !== null && val < -0.5 ? (
                            <span className="bg-emerald-500/10 text-emerald-450 px-1.5 py-0.5 rounded font-bold">Stabilizing</span>
                          ) : (
                            <span className="text-slate-500 font-bold">N/A</span>
                          )}
                        </td>
                      </tr>
                    );
                  })()}

                  {/* GERP++ Row */}
                  {(() => {
                    const val = result.conservationData?.gerp ?? null;
                    const isCons = val !== null && val >= 2.0;
                    return (
                      <tr className={isDark ? "border-b border-slate-850 hover:bg-slate-900/40" : "border-b border-slate-150 hover:bg-slate-50"}>
                        <td className="p-2 font-bold text-slate-300">GERP++</td>
                        <td className="p-2 font-mono font-bold">{val !== null ? val.toFixed(2) : "N/A"}</td>
                        <td className="p-2 text-slate-500 font-mono">&lt; 2.00</td>
                        <td className="p-2 text-slate-500 font-mono">&gt;= 2.00 (Highly Conserved)</td>
                        <td className="p-2 text-center font-bold font-mono text-xs">
                          {isCons ? (
                            <span className="text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">PP3</span>
                          ) : val !== null ? (
                            <span className="text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">BP4</span>
                          ) : (
                            <span className="opacity-40">PP3 / BP4</span>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          {isCons ? (
                            <span className="bg-indigo-500/15 text-indigo-400 px-1.5 py-0.5 rounded font-bold">Conserved</span>
                          ) : val !== null ? (
                            <span className="text-slate-500 font-bold">Neutral</span>
                          ) : (
                            <span className="text-slate-500 font-bold">N/A</span>
                          )}
                        </td>
                      </tr>
                    );
                  })()}

                  {/* phyloP Row */}
                  {(() => {
                    const val = result.conservationData?.phylop ?? null;
                    const isCons = val !== null && val >= 1.5;
                    return (
                      <tr className={isDark ? "border-b border-slate-850 hover:bg-slate-900/40" : "border-b border-slate-150 hover:bg-slate-50"}>
                        <td className="p-2 font-bold text-slate-300">phyloP (100-way)</td>
                        <td className="p-2 font-mono font-bold">{val !== null ? val.toFixed(2) : "N/A"}</td>
                        <td className="p-2 text-slate-500 font-mono">&lt; 1.50</td>
                        <td className="p-2 text-slate-500 font-mono">&gt;= 1.50 (Highly Conserved)</td>
                        <td className="p-2 text-center font-bold font-mono text-xs">
                          {isCons ? (
                            <span className="text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">PP3</span>
                          ) : val !== null ? (
                            <span className="text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">BP4</span>
                          ) : (
                            <span className="opacity-40">PP3 / BP4</span>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          {isCons ? (
                            <span className="bg-indigo-500/15 text-indigo-400 px-1.5 py-0.5 rounded font-bold">Conserved</span>
                          ) : val !== null ? (
                            <span className="text-slate-500 font-bold">Variable</span>
                          ) : (
                            <span className="text-slate-500 font-bold">N/A</span>
                          )}
                        </td>
                      </tr>
                    );
                  })()}

                  {/* CADD PHRED Row */}
                  {(() => {
                    const val = result.predictorData?.caddPhred ?? null;
                    const isBenign = val !== null && val < 15;
                    const isPath = val !== null && val >= 20;
                    return (
                      <tr className={isDark ? "hover:bg-slate-900/40" : "hover:bg-slate-50"}>
                        <td className="p-2 font-bold text-slate-300">CADD PHRED</td>
                        <td className="p-2 font-mono font-bold">{val !== null ? val.toFixed(1) : "N/A"}</td>
                        <td className="p-2 text-slate-500 font-mono">&lt; 15.0</td>
                        <td className="p-2 text-slate-500 font-mono">&gt;= 20.0 (Top 1% deleterious)</td>
                        <td className="p-2 text-center font-bold font-mono text-xs">
                          {isPath ? (
                            <span className="text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">PP3</span>
                          ) : isBenign ? (
                            <span className="text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">BP4</span>
                          ) : (
                            <span className="opacity-40">PP3 / BP4</span>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          {isPath ? (
                            <span className="bg-rose-500/10 text-rose-455 px-1.5 py-0.5 rounded font-bold">Pathogenic</span>
                          ) : isBenign ? (
                            <span className="bg-emerald-500/10 text-emerald-450 px-1.5 py-0.5 rounded font-bold">Benign</span>
                          ) : val !== null ? (
                            <span className="bg-amber-500/10 text-amber-450 px-1.5 py-0.5 rounded font-bold">Moderate</span>
                          ) : (
                            <span className="text-slate-500 font-bold">N/A</span>
                          )}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>

            <div className={`p-3 rounded-lg border text-[9px] leading-normal ${
              isDark ? "bg-slate-900/30 border-slate-800 text-slate-400" : "bg-slate-50 border-slate-200 text-slate-650"
            }`}>
              <h5 className="font-bold text-[10px] text-slate-300 uppercase mb-1">ACMG/AMP Evidence Codes Key:</h5>
              <ul className="list-disc pl-4 space-y-1">
                <li><strong className="text-indigo-400 font-mono">PP3 (Pathogenic Supporting)</strong> / <strong className="text-indigo-400 font-mono">BP4 (Benign Supporting)</strong>: Computational algorithms predict a deleterious/neutral effect on the protein.</li>
                <li><strong className="text-indigo-400 font-mono">PM1 (Pathogenic Moderate)</strong>: Mutational hot-spot or critical functional domain (e.g. binding pocket interface) without benign variation.</li>
                <li><strong className="text-indigo-400 font-mono">BP3 (Benign Supporting)</strong>: In-frame deletion/insertion in a repetitive region, or structurally neutral substitution.</li>
              </ul>
            </div>
          </div>
        )}
      </div>
      
      {/* Footer */}
      <div className={`px-5 py-2.5 border-t text-[9px] transition-colors font-sans flex justify-between items-center ${
        isDark ? "border-slate-800 bg-[#1e293b]/50 text-slate-500" : "border-slate-200 bg-slate-50/50 text-slate-450"
      }`}>
        <span>Integrative Clinical Genomics Evidence Suite</span>
        <span>Version 1.3.0</span>
      </div>
    </div>
  );
}

