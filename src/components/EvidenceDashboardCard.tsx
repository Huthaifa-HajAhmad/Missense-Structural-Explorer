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
  computedPocket?: PocketResult | null;
  isPocketLoading?: boolean;
  pocketError?: string | null;
}

type TabType = "clinical" | "predictors" | "conservation" | "structure" | "function" | "energetics" | "interactions";

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
    const label = cls ? cls.replace(/_/g, " ") : `Score: ${pathogenicity?.toFixed(3)}`;
    const score = pathogenicity ?? 0;
    if (cls?.toLowerCase().includes("pathogenic") || score >= 0.7) {
      return { label, style: "bg-rose-500/15 text-rose-450 border border-rose-500/25 font-bold" };
    }
    if (cls?.toLowerCase().includes("benign") || score <= 0.3) {
      return { label, style: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold" };
    }
    return { label, style: "bg-amber-500/15 text-amber-450 border border-amber-500/20 font-bold" };
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

  const tabs: { id: TabType; label: string; icon: any }[] = [
    { id: "clinical", label: "Clinical", icon: Database },
    { id: "predictors", label: "Predictors", icon: Cpu },
    { id: "conservation", label: "Evolution", icon: Compass },
    { id: "structure", label: "Structure", icon: Layers },
    { id: "function", label: "Function", icon: TrendingUp },
    { id: "energetics", label: "Energetics", icon: Activity },
    { id: "interactions", label: "Interactions", icon: Share2 }
  ];

  const consurfVal = result.conservationData?.consurf;

  // Resolve 1-letter residue abbreviations for property calculations
  const wt1 = result.metadata.wildType.length === 3 ? AMINO_ACID_3_TO_1[result.metadata.wildType] : result.metadata.wildType;
  const mut1 = result.metadata.mutant.length === 3 ? AMINO_ACID_3_TO_1[result.metadata.mutant] : result.metadata.mutant;
  const wtProp = wt1 ? AMINO_ACID_PROPERTIES[wt1] : null;
  const mutProp = mut1 ? AMINO_ACID_PROPERTIES[mut1] : null;

  // Local calculations for consensus biophysical energetics table
  const energetics = foldingEnergetics || {
    foldx: foldingDdG,
    dynamut2: null,
    ddgun: null,
    maestro: null
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
            <h4 className="font-bold text-[10px] uppercase text-indigo-500 tracking-wider">ClinVar & gnomAD Population Genetics</h4>
            
            {result.clinvar ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={`p-3 rounded-lg border ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200 shadow-sm"}`}>
                  <span className="block text-[8px] uppercase text-slate-500 font-bold">ClinVar Interpretation</span>
                  <span className={`inline-block mt-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold ${
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
                  
                  <div className="mt-3.5 space-y-1 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-bold">Review Status:</span>
                      <span className={isDark ? "text-slate-300 font-semibold" : "text-slate-700 font-semibold"}>{result.clinvar.reviewStatus}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-bold">Trait:</span>
                      <span className={`font-semibold max-w-[150px] truncate ${isDark ? "text-slate-300" : "text-slate-700"}`} title={result.clinvar.trait}>{result.clinvar.trait || "N/A"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-bold">Last Evaluated:</span>
                      <span className={isDark ? "text-slate-300" : "text-slate-700"}>
                        {result.clinvar.lastEvaluated && !isNaN(new Date(result.clinvar.lastEvaluated).getTime()) ? new Date(result.clinvar.lastEvaluated).toLocaleDateString() : "N/A"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className={`p-3 rounded-lg border ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200 shadow-sm"}`}>
                  <span className="block text-[8px] uppercase text-slate-500 font-bold">gnomAD Allele Frequency</span>
                  
                  {result.clinvar.alleleFrequencies && result.clinvar.alleleFrequencies.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {result.clinvar.alleleFrequencies.map((freq, fIdx) => (
                        <div key={fIdx} className="flex justify-between items-center text-[10px]">
                          <span className="text-slate-550 font-bold">{freq.source}:</span>
                          <span className="text-indigo-400 font-bold">
                            {(() => {
                              const num = parseFloat(freq.value);
                              return isNaN(num) ? "N/A" : num.toExponential(3);
                            })()}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500 italic mt-2">No population frequency data available in this coordinate record.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-3 text-center text-slate-500 border border-dashed rounded-lg">
                No matching variant found in NCBI ClinVar database.
              </div>
            )}
          </div>
        )}

        {activeTab === "predictors" && (
          <div className="space-y-4">
            <h4 className="font-bold text-[10px] uppercase text-indigo-500 tracking-wider">In Silico Pathogenicity Predictors</h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* AlphaMissense */}
              <div className={`p-3 rounded-lg border flex flex-col justify-between ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200 shadow-sm"}`}>
                <div>
                  <span className="block text-[8px] uppercase text-slate-500 font-bold">AlphaMissense (EBI)</span>
                  <span className="text-[9px] text-slate-400 mt-0.5 block">AI deep learning structure score</span>
                </div>
                <div className="mt-3">
                  {result.predictorData?.available === false ? (
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded border bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold">
                      Data unavailable (upstream)
                    </span>
                  ) : (() => {
                    const badge = getAMBadge(result.predictorData?.amPathogenicity ?? null, result.predictorData?.amClass ?? null);
                    return (
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded border capitalize ${badge.style}`}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* CADD */}
              <div className={`p-3 rounded-lg border flex flex-col justify-between ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200 shadow-sm"}`}>
                <div>
                  <span className="block text-[8px] uppercase text-slate-500 font-bold">CADD PHRED</span>
                  <span className="text-[9px] text-slate-400 mt-0.5 block">Genomic annotation integration</span>
                </div>
                <div className="mt-3">
                  {result.predictorData?.available === false ? (
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded border bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold">
                      Data unavailable (upstream)
                    </span>
                  ) : (() => {
                    const badge = getCADDBadge(result.predictorData?.caddPhred ?? null);
                    return (
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded border ${badge.style}`}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* REVEL */}
              <div className={`p-3 rounded-lg border flex flex-col justify-between ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200 shadow-sm"}`}>
                <div>
                  <span className="block text-[8px] uppercase text-slate-500 font-bold">REVEL</span>
                  <span className="text-[9px] text-slate-400 mt-0.5 block">Ensemble missense pathogenicity</span>
                </div>
                <div className="mt-3">
                  {result.conservationData?.available === false ? (
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded border bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold">
                      Data unavailable (upstream)
                    </span>
                  ) : (() => {
                    const badge = getREVELBadge(result.conservationData?.revel ?? null);
                    return (
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded border ${badge.style}`}>
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
            <h4 className="font-bold text-[10px] uppercase text-indigo-500 tracking-wider">Evolutionary Sequence Conservation Scores</h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* GERP++ */}
              <div className={`p-3 rounded-lg border flex flex-col justify-between ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200 shadow-sm"}`}>
                <div>
                  <div className="flex justify-between items-start">
                    <span className="block text-[8px] uppercase text-slate-500 font-bold">GERP++ Score</span>
                    <span className="text-[8px] text-slate-500 font-bold">Range: -12.36 to 6.17</span>
                  </div>
                  <span className="text-[9px] text-slate-400 mt-0.5 block">Mammalian alignment substitution rate constraint. Higher means conserved.</span>
                </div>
                <div className="mt-4">
                  {result.conservationData?.available === false ? (
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded border bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold">
                      Data unavailable (upstream)
                    </span>
                  ) : (() => {
                    const badge = getGERPBadge(result.conservationData?.gerp ?? null);
                    return (
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded border ${badge.style}`}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* phyloP */}
              <div className={`p-3 rounded-lg border flex flex-col justify-between ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200 shadow-sm"}`}>
                <div>
                  <div className="flex justify-between items-start">
                    <span className="block text-[8px] uppercase text-slate-500 font-bold">phyloP Score (100 vertebrates)</span>
                    <span className="text-[8px] text-slate-500 font-bold">Range: -∞ to +∞</span>
                  </div>
                  <span className="text-[9px] text-slate-400 mt-0.5 block">Base-wise evolutionary constraint scores. Positive means conserved; negative means fast-evolving.</span>
                </div>
                <div className="mt-4">
                  {result.conservationData?.available === false ? (
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded border bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold">
                      Data unavailable (upstream)
                    </span>
                  ) : (() => {
                    const badge = getPhyloPBadge(result.conservationData?.phylop ?? null);
                    return (
                      <span className={`inline-block text-[10px] px-2 py-0.5 rounded border ${badge.style}`}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* ConSurf Highlights */}
            <div className="space-y-2 mt-4">
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold text-slate-500">Locally-Derived Conservation Index (GERP++/phyloP consensus):</span>
                <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                  result.conservationData?.available === false
                    ? "bg-slate-500/10 text-slate-400 border-slate-500/20"
                    : consurfVal ? (consurfVal >= 7 ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : consurfVal <= 3 ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" : "bg-slate-500/10 text-slate-400 border-slate-500/20") : "text-slate-500"
                }`}>
                  {result.conservationData?.available === false ? "Data unavailable (upstream)" : (consurfVal ? `${consurfVal} / 9 (${consurfVal >= 7 ? "Highly Conserved" : consurfVal <= 3 ? "Highly Variable" : "Average"})` : "N/A")}
                </span>
              </div>
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
              <div className="flex justify-between text-[8px] text-slate-500 font-bold uppercase mt-1">
                <span>Variable (1)</span>
                <span>Average (5)</span>
                <span>Conserved (9)</span>
              </div>
              <p className="text-[8px] text-slate-500 opacity-80 leading-normal mt-1.5 italic">
                * Locally-derived conservation index calculated via GERP++ and phyloP normalization (not fetched from ConSurf DB).
              </p>
            </div>
          </div>
        )}

        {activeTab === "structure" && (
          <div className="space-y-4">
            <h4 className="font-bold text-[10px] uppercase text-indigo-500 tracking-wider">Residue Biophysical Property Shifts</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className={`p-3 rounded-lg border ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200"}`}>
                <span className="block text-[8px] uppercase text-slate-500 font-bold">Wild-Type Residue</span>
                <span className="text-xs font-bold text-indigo-400 mt-1 block">
                  {result.metadata.wildType} ({wt1})
                </span>
                <p className="text-[10px] text-slate-500 mt-1.5 leading-normal">
                  {AMINO_ACID_NAMES_MAP[wt1 || ""] || "Unspecified amino acid"}
                </p>
              </div>
              <div className={`p-3 rounded-lg border ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200"}`}>
                <span className="block text-[8px] uppercase text-slate-500 font-bold">Mutant Substitution</span>
                <span className="text-xs font-bold text-rose-450 mt-1 block">
                  {result.metadata.mutant} ({mut1})
                </span>
                <p className="text-[10px] text-slate-500 mt-1.5 leading-normal">
                  {AMINO_ACID_NAMES_MAP[mut1 || ""] || "Unspecified amino acid"}
                </p>
              </div>
            </div>

            {wtProp && mutProp && (
              <div className={`p-4 rounded-lg border ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200"} space-y-3`}>
                <span className="block text-[8px] uppercase text-slate-500 font-bold">Biochemical Property Contrast (Scale: 0-100)</span>
                
                {/* Hydrophobicity */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-500">Hydrophobicity</span>
                    <span className="font-bold">{wtProp.hydrophobicity} → {mutProp.hydrophobicity}</span>
                  </div>
                  <div className="relative h-2 bg-slate-850 rounded-full overflow-hidden">
                    <div 
                      className="absolute h-full bg-indigo-500 rounded-full opacity-60" 
                      style={{ width: `${wtProp.hydrophobicity}%` }} 
                    />
                    <div 
                      className="absolute h-full bg-rose-500 rounded-full opacity-60" 
                      style={{ width: `${mutProp.hydrophobicity}%` }} 
                    />
                  </div>
                </div>

                {/* Size */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-500">Residue Volume / Size</span>
                    <span className="font-bold">{wtProp.size} → {mutProp.size}</span>
                  </div>
                  <div className="relative h-2 bg-slate-850 rounded-full overflow-hidden">
                    <div 
                      className="absolute h-full bg-indigo-500 rounded-full opacity-60" 
                      style={{ width: `${wtProp.size}%` }} 
                    />
                    <div 
                      className="absolute h-full bg-rose-500 rounded-full opacity-60" 
                      style={{ width: `${mutProp.size}%` }} 
                    />
                  </div>
                </div>

                {/* Polarity */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-500">Polarity</span>
                    <span className="font-bold">{wtProp.polarity} → {mutProp.polarity}</span>
                  </div>
                  <div className="relative h-2 bg-slate-850 rounded-full overflow-hidden">
                    <div 
                      className="absolute h-full bg-indigo-500 rounded-full opacity-60" 
                      style={{ width: `${wtProp.polarity}%` }} 
                    />
                    <div 
                      className="absolute h-full bg-rose-500 rounded-full opacity-60" 
                      style={{ width: `${mutProp.polarity}%` }} 
                    />
                  </div>
                </div>

                {/* Charge */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-500">Isoelectric Charge Index</span>
                    <span className="font-bold">{wtProp.charge} → {mutProp.charge}</span>
                  </div>
                  <div className="relative h-2 bg-slate-850 rounded-full overflow-hidden">
                    <div 
                      className="absolute h-full bg-indigo-500 rounded-full opacity-60" 
                      style={{ width: `${wtProp.charge}%` }} 
                    />
                    <div 
                      className="absolute h-full bg-rose-500 rounded-full opacity-60" 
                      style={{ width: `${mutProp.charge}%` }} 
                    />
                  </div>
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
            <h4 className="font-bold text-[10px] uppercase text-indigo-500 tracking-wider">Single-tool ΔΔG (FoldX)</h4>
            
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
                    const isFoldX = item.name === "FoldX";
                    const scoreText = isFoldX ? formatDdGValue(item.val, energyUnit) : "N/A (Not Integrated)";
                    const badge = isFoldX ? getDdGBadge(item.val) : { label: "N/A (Not Integrated)", category: "N/A (Not Integrated)", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
                    return (
                      <tr key={idx} className={isDark ? "hover:bg-slate-900/40" : "hover:bg-slate-50"}>
                        <td className="p-2.5 font-bold">{item.name}</td>
                        <td className="p-2.5 text-slate-500">{item.type}</td>
                        <td className="p-2.5 font-bold">{scoreText}</td>
                        <td className="p-2.5">
                          <span className={`text-[8px] px-1.5 py-0.5 rounded border ${badge.style}`}>
                            {isFoldX ? badge.category : "N/A (Not Integrated)"}
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

