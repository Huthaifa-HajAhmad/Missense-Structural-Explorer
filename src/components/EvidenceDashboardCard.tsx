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
  Layers,
  Info
} from "lucide-react";
import { AnalysisState, PocketResult, EnergeticsData } from "../types";
import { AMINO_ACID_PROPERTIES, AMINO_ACID_NAMES_MAP } from "../useVariantAnalysis";
import { AMINO_ACID_3_TO_1 } from "../aminoAcids";
import { useSettings } from "../context/SettingsContext";
import { THRESHOLDS } from "../thresholds";

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
  disruptionPredictor?: { level: "high" | "low"; reason: string; plddt: number } | null;
  isFolding?: boolean;
  foldingError?: string | null;
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
  pocketError,
  disruptionPredictor,
  isFolding = false,
  foldingError = null
}: EvidenceDashboardCardProps) {
  const [activeTab, setActiveTab] = useState<TabType>("clinical");
  const { settings } = useSettings();
  const energyUnit = settings.energyUnit;

  const result = analysisState.result;

  const formatDdGValue = (val: number | null, unit: "kcal/mol" | "kJ/mol") => {
    if (val === null || val === undefined) return "N/A";
    if (unit === "kJ/mol") {
      return `${(val * 4.184).toFixed(2)} kJ/mol`;
    }
    return `${val.toFixed(2)} kcal/mol`;
  };

  if (!result) {
    return (
      <div className={`${classCard} overflow-hidden flex flex-col transition-all`} id="evidence-dashboard-card">
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between transition-colors ${classCardHeader}`}>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4" style={{ color: "var(--cs-accent-clay)" }} />
            <h3 className={`text-sm font-bold uppercase tracking-wider font-mono ${classCardTitle}`}>
              Multi-Modal Evidence Dashboard
            </h3>
          </div>
        </div>
        
        {/* Body Onboarding */}
        <div className="p-5 flex-1 flex flex-col justify-center text-center py-12 text-slate-500">
          <Database className="w-10 h-10 mx-auto text-indigo-500 stroke-[1.5] mb-2 animate-pulse" />
          <p className="text-sm font-semibold font-mono uppercase tracking-wider text-indigo-500" style={{ color: "var(--cs-accent-clay)" }}>Evidence Dashboard Ready</p>
          <div className="w-16 h-[1px] bg-slate-800/10 dark:bg-slate-800/60 mx-auto my-3"></div>
          <p className="text-xs max-w-sm mx-auto mt-1 leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
            Submit a genetic variant search query to load multi-modal predictors, conservation, energetics, and structural pocket evidence.
          </p>
        </div>
      </div>
    );
  }

  // Score badge helpers
  const getAMBadge = (pathogenicity: number | null, cls: string | null) => {
    if (pathogenicity === null && !cls) return { label: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    const scoreStr = pathogenicity !== null ? ` (${pathogenicity.toFixed(3)})` : "";
    const label = cls ? `${cls.replace(/_/g, " ")}${scoreStr}` : `Score: ${pathogenicity?.toFixed(3)}`;
    const score = pathogenicity ?? 0;
    
    const isPathogenic = cls?.toLowerCase().includes(THRESHOLDS.alphaMissense.pathogenicClass) ||
      (pathogenicity !== null && pathogenicity >= THRESHOLDS.alphaMissense.pathogenicSupporting);
    const isBenign = cls?.toLowerCase().includes(THRESHOLDS.alphaMissense.benignClass) ||
      (pathogenicity !== null && pathogenicity <= THRESHOLDS.alphaMissense.benign);

    if (isPathogenic) {
      return { label, style: "bg-rose-500/15 text-rose-455 border border-rose-500/25 font-bold" };
    }
    if (isBenign) {
      return { label, style: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold" };
    }
    return { label, style: "bg-amber-500/15 text-amber-455 border border-amber-500/20 font-bold" };
  };

  const getCADDBadge = (phred: number | null) => {
    if (phred === null) return { label: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    if (phred >= THRESHOLDS.cadd.pathogenicStrong) {
      return { label: `PHRED: ${phred.toFixed(1)} (Strong Path.)`, style: "bg-rose-500/15 text-rose-455 border border-rose-500/25 font-bold" };
    }
    if (phred >= THRESHOLDS.cadd.pathogenicSupporting) {
      return { label: `PHRED: ${phred.toFixed(1)} (Path. Supp.)`, style: "bg-amber-500/15 text-amber-455 border border-amber-500/20 font-bold" };
    }
    if (phred >= THRESHOLDS.cadd.moderate) {
      return { label: `PHRED: ${phred.toFixed(1)} (Moderate)`, style: "bg-amber-500/15 text-amber-450 border border-amber-500/20 font-bold" };
    }
    if (phred <= THRESHOLDS.cadd.benign) {
      return { label: `PHRED: ${phred.toFixed(1)} (Benign)`, style: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold" };
    }
    return { label: `PHRED: ${phred.toFixed(1)} (Intermediate)`, style: "bg-slate-500/10 text-slate-400 border border-slate-500/20 font-bold" };
  };

  const getREVELBadge = (score: number | null) => {
    if (score === null) return { label: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    if (score >= THRESHOLDS.revel.pathogenicStrong) {
      return { label: `Score: ${score.toFixed(3)} (Strong Path.)`, style: "bg-rose-500/15 text-rose-455 border border-rose-500/25 font-bold" };
    }
    if (score >= THRESHOLDS.revel.pathogenicSupporting) {
      return { label: `Score: ${score.toFixed(3)} (Path. Supp.)`, style: "bg-amber-500/15 text-amber-455 border border-amber-500/20 font-bold" };
    }
    if (score <= THRESHOLDS.revel.benign) {
      return { label: `Score: ${score.toFixed(3)} (Benign)`, style: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold" };
    }
    return { label: `Score: ${score.toFixed(3)} (VUS)`, style: "bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold" };
  };

  const getEVEBadge = (score: number | null | undefined, cls: string | null | undefined) => {
    if (score === null || score === undefined) return { label: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    const classStr = cls ? ` (${cls})` : "";
    const label = `Score: ${score.toFixed(3)}${classStr}`;

    const isPathogenic = cls?.toLowerCase().includes(THRESHOLDS.eve.pathogenicClass) || score >= THRESHOLDS.eve.pathogenic;
    const isBenign = cls?.toLowerCase().includes(THRESHOLDS.eve.benignClass) || score <= THRESHOLDS.eve.benign;

    if (isPathogenic) {
      return { label, style: "bg-rose-500/15 text-rose-455 border border-rose-500/25 font-bold" };
    }
    if (isBenign) {
      return { label, style: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold" };
    }
    return { label, style: "bg-amber-500/15 text-amber-455 border border-amber-500/20 font-bold" };
  };

  const getESM2Badge = (llr: number | null | undefined, verdict: string | null | undefined) => {
    if (llr === null || llr === undefined) return { label: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    const verdictStr = verdict ? ` (${verdict})` : "";
    const label = `LLR: ${llr.toFixed(2)}${verdictStr}`;

    const isPathogenic = verdict?.toLowerCase().includes("pathogenic") || verdict?.toLowerCase().includes("damaged") || llr < -6.0;
    const isBenign = verdict?.toLowerCase().includes("benign") || verdict?.toLowerCase().includes("neutral") || llr > -3.0;

    if (isPathogenic) {
      return { label, style: "bg-rose-500/15 text-rose-455 border border-rose-500/25 font-bold" };
    }
    if (isBenign) {
      return { label, style: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold" };
    }
    return { label, style: "bg-amber-500/15 text-amber-455 border border-amber-500/20 font-bold" };
  };

  const getGERPBadge = (score: number | null) => {
    if (score === null) return { label: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    if (score >= THRESHOLDS.gerp.conserved) {
      return { label: `GERP++: ${score.toFixed(2)} (Conserved)`, style: "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 font-bold" };
    }
    return { label: `GERP++: ${score.toFixed(2)} (Neutral)`, style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
  };

  const getPhyloPBadge = (score: number | null) => {
    if (score === null) return { label: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    if (score >= THRESHOLDS.phylop.conserved) {
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

  // Resolve 1-letter residue abbreviations for property calculations (normalize casing to TitleCase first)
  const normalWt = result.metadata.wildType.charAt(0).toUpperCase() + result.metadata.wildType.slice(1).toLowerCase();
  const normalMut = result.metadata.mutant.charAt(0).toUpperCase() + result.metadata.mutant.slice(1).toLowerCase();
  const wt1 = normalWt.length === 3 ? AMINO_ACID_3_TO_1[normalWt] : normalWt;
  const mut1 = normalMut.length === 3 ? AMINO_ACID_3_TO_1[normalMut] : normalMut;
  const wtProp = wt1 ? AMINO_ACID_PROPERTIES[wt1] : null;
  const mutProp = mut1 ? AMINO_ACID_PROPERTIES[mut1] : null;

  // Local calculations for consensus biophysical energetics table
  const energetics = {
    foldx: foldingEnergetics?.foldx ?? foldingDdG,
    foldxMean: foldingEnergetics?.foldxMean ?? foldingDdG,
    foldxSd: foldingEnergetics?.foldxSd ?? 0,
    vdw: foldingEnergetics?.vdw ?? 0,
    electrostatics: foldingEnergetics?.electrostatics ?? 0,
    stericClashWarning: foldingEnergetics?.stericClashWarning ?? false,
    localSidechainRmsd: foldingEnergetics?.localSidechainRmsd ?? 0.0,
    dynamut2: foldingEnergetics?.dynamut2 ?? result.dynamut2 ?? null,
    ddgun: foldingEnergetics?.ddgun ?? null,
    consensusVerdict: foldingEnergetics?.consensusVerdict ?? null
  };

  return (
    <div className={`${classCard} overflow-hidden flex flex-col transition-all`} id="evidence-dashboard-card">
      {/* Header */}
      <div className={`px-5 py-4 border-b flex items-center justify-between transition-colors ${classCardHeader}`}>
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4" style={{ color: "var(--cs-accent-clay)" }} />
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
      <div
        className="flex border-b overflow-x-auto"
        style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap"
              style={isActive ? {
                borderColor: "var(--cs-accent-clay)",
                color: "var(--cs-accent-clay)",
                background: "rgba(196,104,73,0.05)"
              } : {
                borderColor: "transparent",
                color: "var(--cs-text-muted)"
              }}
              onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = "var(--cs-text-primary)"; } }}
              onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = "var(--cs-text-muted)"; } }}
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
            <h4 className="font-bold text-xs uppercase tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>ClinVar & gnomAD Population Genetics</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Column 1: ClinVar Interpretation */}
              {result.clinvar && result.clinvar.classification && !result.clinvar.classification.toLowerCase().includes("not found") ? (
                <div 
                  className="p-4 rounded-xl border transition-all duration-300 flex flex-col justify-between"
                  style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
                >
                  <div>
                    <span className="block text-[10px] uppercase font-semibold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>ClinVar Interpretation</span>
                    {(() => {
                      const c = result.clinvar.classification.toLowerCase();
                      let badgeStyle = "bg-amber-500/15 text-amber-455 border border-amber-500/20";
                      if (c.includes("likely pathogenic")) badgeStyle = "bg-orange-500/15 text-orange-450 border border-orange-500/20";
                      else if (c.includes("pathogenic")) badgeStyle = "bg-rose-500/15 text-rose-455 border border-rose-500/25";
                      else if (c.includes("likely benign")) badgeStyle = "bg-emerald-500/10 text-emerald-450 border border-emerald-500/20";
                      else if (c.includes("benign")) badgeStyle = "bg-emerald-500/15 text-emerald-455 border border-emerald-500/25";
                      
                      return (
                        <span className={`inline-block mt-2 px-2.5 py-1 rounded-lg text-xs font-bold ${badgeStyle}`}>
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
                  className="p-4 rounded-xl border border-dashed transition-all duration-300 flex flex-col justify-center items-center text-center min-h-[160px]"
                  style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)", color: "var(--cs-text-secondary)" }}
                >
                  <span className="block text-[10px] uppercase font-bold tracking-wider mb-2" style={{ color: "var(--cs-text-muted)" }}>ClinVar Interpretation</span>
                  <p className="text-xs italic font-sans" style={{ color: "var(--cs-text-muted)" }}>No matching variant found in NCBI ClinVar database.</p>
                </div>
              )}

              {/* Column 2: gnomAD Allele Count */}
              <div
                className="p-4 rounded-xl border transition-all duration-300"
                style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
              >
                <span className="block text-[10px] uppercase font-semibold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>gnomAD Allele Count</span>

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
                  <p className="text-xs italic mt-3" style={{ color: "var(--cs-text-muted)" }}>Absent from gnomAD population database (rare/novel variant).</p>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "predictors" && (
          <div className="space-y-4">
            <h4 className="font-bold text-xs uppercase tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>In Silico Pathogenicity Predictors</h4>
            
            {/* Transcript Context & Warning (TRANSCRIPT-BANNER) */}
            {result.transcriptId && (
              <div className={`p-3 rounded-lg border text-xs leading-relaxed ${
                result.isCanonical
                  ? "bg-slate-500/5 text-slate-400 border-slate-500/10"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/20"
              }`}>
                <div className="font-bold flex items-center gap-1.5 uppercase tracking-wider text-[9px] font-mono">
                  <span>Transcript Info</span>
                </div>
                <p className="mt-1 text-[10px] opacity-90">
                  Mapped using transcript ID: <span className="font-mono font-bold">{result.transcriptId}</span>
                  {result.isCanonical ? " (canonical MANE / Ensembl select isoform)." : " (non-canonical fallback)."}
                </p>
                {result.transcriptWarning && (
                  <p className="mt-1 text-[10px] text-amber-500 font-semibold">{result.transcriptWarning}</p>
                )}
              </div>
            )}

            {/* Predictor Partial Evidence Banner (PARTIAL-BANNER) */}
            {(() => {
              const ruleBased = result.ruleBasedInsights;
              const unavailable = ruleBased?.partialEvidence?.unavailable ?? [];
              if (unavailable.length === 0) return null;
              const k = 4 - unavailable.length;
              return (
                <div className="p-3 rounded-lg border bg-amber-500/10 text-amber-400 border-amber-500/20 leading-relaxed text-xs">
                  <div className="font-bold flex items-center gap-1.5 uppercase tracking-wider text-[9px] font-mono text-amber-500">
                    <span>⚠ Evidence Partial</span>
                  </div>
                  <p className="mt-1 text-[10px] opacity-90 text-amber-400/90">
                    Only {k} of 4 in-silico predictors are available for this variant.
                    Missing tools: <span className="font-bold">{unavailable.join(", ")}</span>.
                    Use caution when interpreting consensus classifications.
                  </p>
                </div>
              );
            })()}

            <div className="overflow-x-auto border rounded-lg animate-fade-in" style={{ borderColor: "var(--cs-border)" }}>
              <table className="w-full text-[11px] font-sans border-collapse">
                <thead>
                  <tr style={{ background: "var(--cs-surface-2)", color: "var(--cs-text-primary)" }}>
                    <th className="p-2.5 text-left border-b font-bold font-mono" style={{ borderColor: "var(--cs-border)", width: "20%" }}>Predictor / Model</th>
                    <th className="p-2.5 text-left border-b font-bold font-mono" style={{ borderColor: "var(--cs-border)", width: "35%" }}>Description</th>
                    <th className="p-2.5 text-center border-b font-bold font-mono" style={{ borderColor: "var(--cs-border)", width: "12%" }}>Range</th>
                    <th className="p-2.5 text-center border-b font-bold font-mono" style={{ borderColor: "var(--cs-border)", width: "13%" }}>Score</th>
                    <th className="p-2.5 text-center border-b font-bold font-mono" style={{ borderColor: "var(--cs-border)", width: "20%" }}>Interpretation Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {/* AlphaMissense Row */}
                  <tr className="hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-primary)", borderBottom: "1px solid var(--cs-border-subtle)" }}>
                    <td className="p-2.5 font-bold" style={{ color: "var(--cs-text-primary)" }}>AlphaMissense (EBI)</td>
                    <td className="p-2.5 opacity-80" style={{ color: "var(--cs-text-secondary)" }}>AI deep learning structure score</td>
                    <td className="p-2.5 text-center font-mono" style={{ color: "var(--cs-text-muted)" }}>0 – 1</td>
                    <td className="p-2.5 text-center font-mono font-bold">
                      {result.predictorData?.available === false || result.predictorData?.amPathogenicity === null || result.predictorData?.amPathogenicity === undefined
                        ? "N/A"
                        : result.predictorData.amPathogenicity.toFixed(3)}
                    </td>
                    <td className="p-2.5 text-center">
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
                    </td>
                  </tr>

                  {/* CADD Row */}
                  <tr className="hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-primary)", borderBottom: "1px solid var(--cs-border-subtle)" }}>
                    <td className="p-2.5 font-bold" style={{ color: "var(--cs-text-primary)" }}>CADD PHRED</td>
                    <td className="p-2.5 opacity-80" style={{ color: "var(--cs-text-secondary)" }}>Genomic annotation integration</td>
                    <td className="p-2.5 text-center font-mono" style={{ color: "var(--cs-text-muted)" }}>0 – 99</td>
                    <td className="p-2.5 text-center font-mono font-bold">
                      {result.predictorData?.available === false || result.predictorData?.caddPhred === null || result.predictorData?.caddPhred === undefined
                        ? "N/A"
                        : result.predictorData.caddPhred.toFixed(1)}
                    </td>
                    <td className="p-2.5 text-center">
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
                    </td>
                  </tr>

                  {/* REVEL Row */}
                  <tr className="hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-primary)", borderBottom: "1px solid var(--cs-border-subtle)" }}>
                    <td className="p-2.5 font-bold" style={{ color: "var(--cs-text-primary)" }}>REVEL</td>
                    <td className="p-2.5 opacity-80" style={{ color: "var(--cs-text-secondary)" }}>Ensemble pathogenicity score</td>
                    <td className="p-2.5 text-center font-mono" style={{ color: "var(--cs-text-muted)" }}>0 – 1</td>
                    <td className="p-2.5 text-center font-mono font-bold">
                      {result.conservationData?.available === false || result.conservationData?.revel === null || result.conservationData?.revel === undefined
                        ? "N/A"
                        : result.conservationData.revel.toFixed(3)}
                    </td>
                    <td className="p-2.5 text-center">
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
                    </td>
                  </tr>

                  {/* EVE Row */}
                  <tr className="hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-primary)", borderBottom: "1px solid var(--cs-border-subtle)" }}>
                    <td className="p-2.5 font-bold" style={{ color: "var(--cs-text-primary)" }}>EVE Model (Frazer 2021)</td>
                    <td className="p-2.5 opacity-80" style={{ color: "var(--cs-text-secondary)" }}>Evolutionary model of variant effect</td>
                    <td className="p-2.5 text-center font-mono" style={{ color: "var(--cs-text-muted)" }}>0 – 1</td>
                    <td className="p-2.5 text-center font-mono font-bold">
                      {result.predictorData?.eveScore === undefined || result.predictorData?.eveScore === null
                        ? "N/A"
                        : result.predictorData.eveScore.toFixed(3)}
                    </td>
                    <td className="p-2.5 text-center">
                      {result.predictorData?.eveScore === undefined || result.predictorData?.eveScore === null ? (
                        <span className="inline-block text-[10px] px-2 py-0.5 rounded border bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold">
                          Data unavailable (upstream)
                        </span>
                      ) : (() => {
                        const badge = getEVEBadge(result.predictorData.eveScore, result.predictorData.eveClass);
                        return (
                          <span className={`inline-block text-xs px-2.5 py-1 rounded-lg border ${badge.style}`}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>

                  {/* ESM2 Row */}
                  <tr className="hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-primary)" }}>
                    <td className="p-2.5 font-bold" style={{ color: "var(--cs-text-primary)" }}>ESMv2 Zero-Shot (Meta)</td>
                    <td className="p-2.5 opacity-80" style={{ color: "var(--cs-text-secondary)" }}>Transformer language model LLR</td>
                    <td className="p-2.5 text-center font-mono" style={{ color: "var(--cs-text-muted)" }}>−20 to +5</td>
                    <td className="p-2.5 text-center font-mono font-bold">
                      {result.esm2 === undefined || result.esm2 === null || result.esm2.llr === null
                        ? "N/A"
                        : result.esm2.llr.toFixed(2)}
                    </td>
                    <td className="p-2.5 text-center">
                      {result.esm2 === undefined || result.esm2 === null || result.esm2.llr === null ? (
                        <span className="inline-block text-[10px] px-2 py-0.5 rounded border bg-slate-500/10 text-slate-400 border-slate-500/20 font-bold">
                          Data unavailable (upstream)
                        </span>
                      ) : (() => {
                        const badge = getESM2Badge(result.esm2.llr, result.esm2.verdict);
                        return (
                          <span className={`inline-block text-xs px-2.5 py-1 rounded-lg border ${badge.style}`}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "conservation" && (
          <div className="space-y-4">
            <h4 className="font-bold text-xs uppercase tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>Evolutionary Sequence Conservation Scores</h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* GERP++ */}
              <div className="p-4 rounded-xl border flex flex-col justify-between transition-all duration-300" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
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
              <div className="p-4 rounded-xl border flex flex-col justify-between transition-all duration-300" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                <div>
                  <div className="flex justify-between items-start border-b pb-1" style={{ borderColor: "var(--cs-border-subtle)" }}>
                    <span className="block text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-secondary)" }}>phyloP Score (100 vertebrates)</span>
                    <span className="text-[10px] font-bold font-mono" style={{ color: "var(--cs-text-muted)" }}>Range: -20 to +10</span>
                  </div>
                  <span className="text-xs mt-2 block leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>Base-wise evolutionary constraint scores. Positive means conserved; negative means fast-evolving.</span>
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
            <div className={`space-y-2 mt-4 pt-3 border-t transition-opacity ${!consurfVal ? "opacity-60" : ""}`} style={{ borderColor: "var(--cs-border-subtle)" }}>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[11px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-secondary)" }}>Locally-Derived Conservation Index (GERP++/phyloP consensus):</span>
                <span className={`text-xs px-2.5 py-1 rounded-lg font-bold border ${
                  result.conservationData?.available === false
                    ? "bg-slate-500/10 text-slate-400 border-slate-500/20"
                    : consurfVal ? (consurfVal >= 7 ? "bg-rose-500/10 text-rose-450 border-rose-500/20" : consurfVal <= 3 ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" : "bg-slate-500/10 text-slate-400 border-slate-500/20") : "text-slate-550 border-slate-700/30"
                }`}>
                  {(() => {
                    if (result.conservationData?.available === false) {
                      return "Data unavailable (upstream)";
                    }
                    if (!consurfVal) return "N/A";
                    const status = consurfVal >= 7 ? "Highly Conserved" : consurfVal <= 3 ? "Highly Variable" : "Average";
                    return `${consurfVal} / 9 (${status})`;
                  })()}
                </span>
              </div>
              {consurfVal ? (
                <div className="grid grid-cols-9 gap-1 h-3 mt-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((val) => {
                    const isSelected = result.conservationData?.available !== false && consurfVal === val;
                    let colorClass = "";
                    if (val <= 3) colorClass = "bg-cyan-500";
                    else if (val <= 6) colorClass = "bg-amber-500";
                    else colorClass = "bg-rose-500";

                    const isAvailable = result.conservationData?.available !== false;
                    const opacityVal = !isAvailable ? "opacity-10" : (isSelected ? "opacity-100 ring-2 ring-[var(--cs-accent-clay)] scale-y-125 shadow-md" : "opacity-25");

                    return (
                      <div 
                        key={val} 
                        className={`h-full rounded-sm transition-all duration-300 ${colorClass} ${opacityVal}`}
                        title={`Conservation Index ${val}`}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="h-3 rounded-sm w-full opacity-35" style={{ background: "var(--cs-bg-subtle)" }} />
              )}
              <div className="flex justify-between text-[8px] font-bold uppercase mt-1" style={{ color: "var(--cs-text-muted)" }}>
                <span>Variable (1)</span>
                <span>Average (5)</span>
                <span>Conserved (9)</span>
              </div>
              {!consurfVal && result.conservationData?.available !== false && (
                <div className="p-2 mt-2 rounded border text-[9px] leading-normal" style={{ background: "var(--cs-accent-mag-soft)", borderColor: "var(--cs-accent-mag)", color: "var(--cs-text-primary)" }}>
                  ⚠️ **Consensus Index Unavailable**: Derived from normalized GERP++ (mammalian genomic constraint) and phyloP (vertebrate base-wise constraint). One of these scores is missing for this variant's genomic coordinate.
                </div>
              )}
              <p className="text-[8px] opacity-80 leading-normal mt-1.5 italic" style={{ color: "var(--cs-text-muted)" }}>
                * Locally-derived conservation index calculated via GERP++ and phyloP normalization (not fetched from ConSurf DB).
              </p>
            </div>
          </div>
        )}

        {activeTab === "structure" && (
          <div className="space-y-4">
            <h4 className="font-bold text-xs uppercase tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>Residue Biophysical Property Shifts</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg border flex flex-col items-center justify-center" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                <span className="block text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Wild-Type Residue</span>
                <span className="text-3xl font-black text-emerald-500 mt-1">{normalWt}</span>
                <p className="text-xs mt-1.5 leading-normal" style={{ color: "var(--cs-text-muted)" }}>
                  {AMINO_ACID_NAMES_MAP[wt1] || wt1}
                </p>
              </div>

              <div className="p-3 rounded-lg border flex flex-col items-center justify-center" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                <span className="block text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Mutant Substitution</span>
                <span className="text-3xl font-black text-rose-500 mt-1">{normalMut}</span>
                <p className="text-xs mt-1.5 leading-normal" style={{ color: "var(--cs-text-muted)" }}>
                  {AMINO_ACID_NAMES_MAP[mut1] || mut1}
                </p>
              </div>
            </div>

            {wtProp && mutProp && (
              <div className="p-4 rounded-lg border space-y-3" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                <span className="block text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-secondary)" }}>Biochemical Property Contrast (Scale: 0-100)</span>
                
                {/* Hydrophobicity */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "var(--cs-text-secondary)" }}>Hydrophobicity</span>
                    <span className="font-bold">{wtProp.hydrophobicity} → {mutProp.hydrophobicity}</span>
                  </div>
                  {renderContrastBar(wtProp.hydrophobicity, mutProp.hydrophobicity)}
                </div>

                {/* Size */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "var(--cs-text-secondary)" }}>Residue Volume / Size</span>
                    <span className="font-bold">{wtProp.size} → {mutProp.size}</span>
                  </div>
                  {renderContrastBar(wtProp.size, mutProp.size)}
                </div>

                {/* Polarity */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "var(--cs-text-secondary)" }}>Polarity</span>
                    <span className="font-bold">{wtProp.polarity} → {mutProp.polarity}</span>
                  </div>
                  {renderContrastBar(wtProp.polarity, mutProp.polarity)}
                </div>

                {/* Charge */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: "var(--cs-text-secondary)" }}>Isoelectric Charge Index</span>
                    <span className="font-bold">{wtProp.charge} → {mutProp.charge}</span>
                  </div>
                  {renderContrastBar(wtProp.charge, mutProp.charge)}
                </div>
              </div>
            )}

            {result.insights?.biochemicalShift && (
              <div className="p-3 rounded-lg border text-[10px] leading-relaxed" style={{ background: "rgba(196,104,73,0.05)", borderColor: "var(--cs-border)", color: "var(--cs-text-primary)" }}>
                <span className="font-bold block uppercase text-[8px] mb-1 tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>Biochemical Shift Narrative:</span>
                {result.insights.biochemicalShift}
              </div>
            )}

            {/* Burial Status & Neighbor Density */}
            {result.disruptionPredictor && (
              <div className="p-4 rounded-lg border grid grid-cols-1 sm:grid-cols-2 gap-4" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                <div className="space-y-1">
                  <span className="block text-[8px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Burial / Exposure Status</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                      result.disruptionPredictor.burialStatus === "core"
                        ? "bg-rose-500/15 text-rose-455 border border-rose-500/25"
                        : result.disruptionPredictor.burialStatus === "boundary"
                        ? "bg-amber-500/15 text-amber-455 border border-amber-500/20"
                        : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    }`}>
                      {result.disruptionPredictor.burialStatus ?? "Unknown"}
                    </span>
                  </div>
                  <p className="text-[10px] leading-normal" style={{ color: "var(--cs-text-secondary)" }}>
                    {result.disruptionPredictor.burialStatus === "core"
                      ? "Deeply buried core residue. High structural stability role; mutations highly likely to cause misfolding."
                      : result.disruptionPredictor.burialStatus === "boundary"
                      ? "Boundary/intermediate exposure. Moderate tolerance to hydrophobic-to-polar shifts."
                      : "Surface-exposed residue. High tolerance to substitution unless in active sites or binding interfaces."}
                  </p>
                </div>

                <div className="space-y-1">
                  <span className="block text-[8px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Cα Contact Density</span>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-lg font-black" style={{ color: "var(--cs-accent-clay)" }}>
                      {result.disruptionPredictor.neighborCount ?? "N/A"}
                    </span>
                    <span className="text-[10px] font-medium" style={{ color: "var(--cs-text-muted)" }}>neighbors (&lt;10Å)</span>
                  </div>
                  <p className="text-[10px] leading-normal" style={{ color: "var(--cs-text-secondary)" }}>
                    Quantifies local packing density. Core is defined as &ge; 15 neighbors, boundary as 8-14, and surface as &lt; 8.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "function" && (
          <div className="space-y-4">
            {isPocketLoading ? (
              <div className="flex flex-col items-center justify-center p-6 text-center">
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin mb-2" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }} />
                <span className="text-[10px]" style={{ color: "var(--cs-text-muted)" }}>Calculating ligand-binding pockets via P2Rank/Heuristic...</span>
              </div>
            ) : pocketError ? (
              <div className="p-3 text-center text-rose-455 border border-dashed border-rose-500/20 bg-rose-500/5 rounded-lg">
                <ShieldAlert className="w-5 h-5 mx-auto mb-1 text-rose-500" />
                <span>Failed to calculate pockets: {pocketError}</span>
              </div>
            ) : (
              <div className="space-y-4">
                {computedPocket ? (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="font-bold text-[10px] uppercase tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>P2Rank Ligand-Binding Pocket Distance</h4>
                      <span className={`text-[9px] px-2 py-0.5 rounded font-bold border ${
                        computedPocket.status === "success"
                          ? "bg-emerald-500/10 text-emerald-455 border-emerald-500/20"
                          : "bg-amber-500/10 text-amber-455 border-amber-500/20"
                      }`}>
                        {computedPocket.status === "success" ? "P2Rank Live (ML-computed)" : "P2Rank Offline (Heuristic Fallback)"}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-3 rounded-lg border shadow-sm transition-all" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                        <span className="block text-[10px] uppercase font-mono tracking-wider font-semibold" style={{ color: "var(--cs-text-muted)" }}>Pocket Distance</span>
                        <span className={`text-base font-bold font-mono block mt-1 ${
                          computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined && computedPocket.pocketDistance < 10
                            ? "text-rose-455"
                            : "text-[var(--cs-text-primary)]"
                        }`}>
                          {computedPocket.pocketDistance !== null && computedPocket.pocketDistance !== undefined 
                            ? `${computedPocket.pocketDistance.toFixed(2)} Å` 
                            : "N/A"}
                        </span>
                        <span className="text-[10px] font-sans mt-0.5 block" style={{ color: "var(--cs-text-muted)" }}>Distance to pocket centroid</span>
                      </div>

                      <div className="p-3 rounded-lg border shadow-sm transition-all" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                        <span className="block text-[10px] uppercase font-mono tracking-wider font-semibold" style={{ color: "var(--cs-text-muted)" }}>Binding Probability</span>
                        <span className="text-base font-bold font-mono mt-1 block" style={{ color: "var(--cs-accent-clay)" }}>
                          {computedPocket.status === "success" ? `${computedPocket.pocketScore}%` : "N/A"}
                        </span>
                        <span className="text-[10px] font-sans mt-0.5 block" style={{ color: "var(--cs-text-muted)" }}>P2Rank affinity index</span>
                      </div>

                      <div className="p-3 rounded-lg border shadow-sm transition-all" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                        <span className="block text-[10px] uppercase font-mono tracking-wider font-semibold" style={{ color: "var(--cs-text-muted)" }}>Pocket Volume</span>
                        <span className="text-base font-bold font-mono mt-1 block" style={{ color: "var(--cs-accent-clay)" }}>
                          {computedPocket.pocketVolume ? `${computedPocket.pocketVolume} Å³` : "N/A"}
                        </span>
                        <span className="text-[10px] font-sans mt-0.5 block" style={{ color: "var(--cs-text-muted)" }}>Spatial cavity volume</span>
                      </div>
                    </div>

                    {computedPocket.status !== "success" && (
                      <div className="p-3 rounded-lg border text-[11px] leading-relaxed" style={{ background: "var(--cs-accent-mag-soft)", borderColor: "var(--cs-accent-mag)", color: "var(--cs-text-primary)" }}>
                        <span className="font-bold block uppercase text-[9px] mb-1 tracking-wider" style={{ color: "var(--cs-accent-mag)" }}>ML Model Offline:</span>
                        P2Rank machine learning service is currently offline. Pocket affinity scores and cavity volumes are unavailable. Utilizing sequence-based functional proximity heuristics.
                      </div>
                    )}

                    <div className="p-3 rounded-lg border space-y-2" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                      <div className="flex justify-between text-xs">
                        <span className="font-bold font-sans" style={{ color: "var(--cs-text-secondary)" }}>Likely Co-Factor / Target Ligand:</span>
                        <span className="font-bold font-mono" style={{ color: "var(--cs-text-primary)" }}>{computedPocket.likelyCofactor}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="font-bold font-sans" style={{ color: "var(--cs-text-secondary)" }}>Spatial Classification:</span>
                        <span className={`font-bold font-mono ${
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
                      <div className="space-y-1.5 mt-3">
                        <span className="text-[10px] uppercase font-mono tracking-wider font-semibold animate-pulse" style={{ color: "var(--cs-text-muted)" }}>Pocket Lining Residues (Top 7)</span>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {computedPocket.pocketResidues.slice(0, 7).map((res: any, idx: number) => (
                            <div key={idx} className="p-2 rounded border flex justify-between shadow-sm transition-all" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                              <span className="font-bold font-mono" style={{ color: "var(--cs-text-primary)" }}>{res.name}{res.index}</span>
                              <span className="font-mono" style={{ color: "var(--cs-text-secondary)" }}>Dist: {res.distance} Å</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 text-center border border-dashed rounded-lg text-xs" style={{ color: "var(--cs-text-muted)", borderColor: "var(--cs-border)" }}>
                    No active pocket computations found. Click 3D coordinates on the model to trigger solver.
                  </div>
                )}

                {/* UniProt Curated Features */}
                {(() => {
                  const features = result.uniprotFeatures?.features ?? [];
                  const pos = result.metadata.residueIndex;
                  if (pos === null) return null;

                  const matchingFeatures = features.filter(
                    (f) => pos >= f.start && pos <= f.end
                  );

                  return (
                    <div className="space-y-3 pt-3 border-t" style={{ borderColor: "var(--cs-border-subtle)" }}>
                      <h4 className="font-bold text-[10px] uppercase tracking-wider font-mono" style={{ color: "var(--cs-accent-clay)" }}>
                        UniProt Curated Site & Interface Annotations
                      </h4>

                      {matchingFeatures.length > 0 ? (
                        <div className="space-y-2">
                          {matchingFeatures.map((f, idx) => {
                            let badgeColor = "bg-slate-500/10 text-slate-450 border border-slate-500/20";
                            if (f.type.toLowerCase().includes("active") || f.type.toLowerCase().includes("metal")) {
                              badgeColor = "bg-rose-500/10 text-rose-455 border border-rose-500/20";
                            } else if (f.type.toLowerCase().includes("binding")) {
                              badgeColor = "bg-[rgba(196,104,73,0.08)] text-[var(--cs-accent-clay)] border border-[rgba(196,104,73,0.2)]";
                            }

                            return (
                              <div
                                key={idx}
                                className="p-3 rounded-lg border leading-relaxed text-xs shadow-sm transition-all"
                                style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}
                              >
                                <div className="flex items-center justify-between">
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold font-mono uppercase ${badgeColor}`}>
                                    {f.type}
                                  </span>
                                  <span className="text-[10px] font-mono font-bold" style={{ color: "var(--cs-text-muted)" }}>
                                    Residue {f.start === f.end ? f.start : `${f.start}-${f.end}`}
                                  </span>
                                </div>
                                <p className="mt-1.5 text-xs font-sans" style={{ color: "var(--cs-text-secondary)" }}>
                                  {f.description || "Curated functional feature at this site."}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-3 text-center border border-dashed rounded-lg text-xs" style={{ color: "var(--cs-text-muted)", borderColor: "var(--cs-border)" }}>
                          No curated UniProt functional features (active sites, metal bindings, interface regions) recorded at residue {pos}.
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {activeTab === "energetics" && (
          <div className="space-y-4">
            <h4 className="font-bold text-xs uppercase tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>Consensus Biophysical Stability (ΔΔG)</h4>
            
            {disruptionPredictor?.plddt !== undefined && disruptionPredictor.plddt < 70 && (
              <div className="p-3 rounded-lg border flex flex-col gap-1" style={{ background: "var(--cs-accent-mag-soft)", borderColor: "var(--cs-accent-mag)", color: "var(--cs-text-primary)" }}>
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>Low-Confidence Template Alert (pLDDT: {disruptionPredictor.plddt.toFixed(1)})</span>
                </div>
                <p className="text-[10px] leading-relaxed">
                  The local template structure at this residue has low confidence (pLDDT &lt; 70). Predictions generated from rigid-backbone models or biophysical force fields (e.g. FoldX, DynaMut2) are highly speculative in disordered or low-confidence regions.
                </p>
              </div>
            )}
            {energetics.dynamut2 === null && dynamut2Status === "unavailable" && (
              <div className="p-3 rounded-lg border flex flex-col gap-1" style={{ background: "var(--cs-accent-mag-soft)", borderColor: "var(--cs-accent-mag)", color: "var(--cs-text-primary)" }}>
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>ΔΔG Evidence Partial (DynaMut2 Unavailable)</span>
                </div>
                <p className="text-[10px] leading-relaxed">
                  DynaMut2 calculation service is currently offline or failed. Displaying force-field based FoldX and sequence-based DDGun-Seq predictions only.
                </p>
              </div>
            )}

            {isFolding && (
              <div className="p-3.5 rounded-lg border space-y-1" style={{ background: "rgba(196,104,73,0.05)", borderColor: "var(--cs-border)", color: "var(--cs-text-primary)" }}>
                <div className="font-bold text-xs uppercase flex items-center gap-2">
                  <Activity className="w-4 h-4 shrink-0 animate-spin" style={{ color: "var(--cs-accent-clay)" }} />
                  <span>Biophysical Simulation In Progress</span>
                </div>
                <p className="text-xs leading-relaxed opacity-90">
                  FoldX mutant minimization and DynaMut2 simulations are currently calculating in the background. Generating mutated structures and running atomic force fields. Please wait...
                </p>
              </div>
            )}

            {!isFolding && foldingError && (
              <div className="p-3.5 rounded-lg border space-y-1 bg-rose-50 border-rose-100 text-rose-800">
                <div className="font-bold text-xs uppercase flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 shrink-0 text-rose-500" />
                  <span>Biophysical Simulation Failed</span>
                </div>
                <p className="text-xs leading-relaxed opacity-90">
                  Simulation failed: <strong>{foldingError}</strong>. Displaying sequence-based (DDGun-Seq) fallback energetics only.
                </p>
              </div>
            )}

            {!isFolding && !foldingError && foldingStatus === null && (
              <div className="p-3.5 rounded-lg border space-y-1 bg-amber-50 border-amber-200 text-amber-700">
                <div className="font-bold text-xs uppercase flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 shrink-0" style={{ strokeWidth: 2 }} />
                  <span>Biophysical Simulation Required</span>
                </div>
                <p className="text-xs leading-relaxed">
                  FoldX mutant energy minimization has not been triggered for this variant yet. Please switch the 3D Molecular Viewer mode to <strong>"Mutant"</strong> or <strong>"Side-by-Side"</strong> to run local side-chain repacking simulation and compute free-energy changes (ΔΔG).
                </p>
              </div>
            )}

            {!isFolding && !foldingError && foldingStatus !== null && (!foldingEnergetics || foldingEnergetics.foldx === null) && (
              <div className="p-3.5 rounded-lg border space-y-1 bg-amber-50 border-amber-250 text-amber-800">
                <div className="font-bold text-xs uppercase flex items-center gap-1.5">
                  <Info className="w-4 h-4 shrink-0 text-amber-500" />
                  <span>FoldX Modeling Unavailable</span>
                </div>
                <p className="text-xs leading-relaxed opacity-90">
                  The local FoldX structural calculation engine is currently unavailable or failed in this environment. Displaying sequence-based (DDGun-Seq) and normal mode analysis (DynaMut2) fallback energetics only.
                </p>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--cs-border)" }}>
              <table className="w-full text-[10px] text-left border-collapse">
                <thead>
                  <tr className="border-b" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-secondary)" }}>
                    <th className="p-2.5 font-bold uppercase tracking-wider">Method</th>
                    <th className="p-2.5 font-bold uppercase tracking-wider">Type</th>
                    <th className="p-2.5 font-bold uppercase tracking-wider">ΔΔG Score</th>
                    <th className="p-2.5 font-bold uppercase tracking-wider">Risk Assessment</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "FoldX (Mean ± SD)", type: "Force Field Repacking (3 runs)", val: energetics.foldxMean },
                    { name: "DynaMut2", type: "Normal Mode Analysis / ML", val: energetics.dynamut2 },
                    { name: "DDGun-Seq", type: "Sequence/Evolution Integration", val: energetics.ddgun }
                  ].map((item, idx) => {
                    let scoreText = "N/A";
                    let badge = { label: "N/A", category: "N/A", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };

                    if (item.val !== null && item.val !== undefined) {
                      if (item.name.includes("FoldX") && energetics.foldxSd !== null && energetics.foldxSd !== undefined) {
                        const mean = energetics.foldxMean ?? energetics.foldx ?? 0;
                        const sd = energetics.foldxSd;
                        if (energyUnit === "kJ/mol") {
                          scoreText = `${(mean * 4.184).toFixed(2)} ± ${(sd * 4.184).toFixed(2)} kJ/mol`;
                        } else {
                          scoreText = `${mean.toFixed(2)} ± ${sd.toFixed(2)} kcal/mol`;
                        }
                      } else {
                        scoreText = formatDdGValue(item.val, energyUnit);
                      }
                      badge = getDdGBadge(item.val);
                      if (disruptionPredictor?.plddt !== undefined && disruptionPredictor.plddt < 70) {
                        badge = {
                          ...badge,
                          category: `${badge.category} (Speculative)`,
                          style: "bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold"
                        };
                      }
                    } else if (item.name === "DynaMut2" && dynamut2Status === "pending") {
                      scoreText = "Calculating...";
                      badge = { label: "Calculating", category: "Calculating", style: "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse font-bold" };
                    } else {
                      scoreText = "Unavailable";
                      badge = { label: "Unavailable", category: "Unavailable", style: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
                    }

                    return (
                      <tr key={idx} className="hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-primary)", borderBottom: idx < 2 ? "1px solid var(--cs-border-subtle)" : "none" }}>
                        <td className="p-2.5 font-bold">{item.name}</td>
                        <td className="p-2.5" style={{ color: "var(--cs-text-secondary)" }}>{item.type}</td>
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

            {/* Extended Biophysical Details & Consensus Verdict */}
            {energetics.foldxMean !== null && (
              <div className="p-3.5 rounded-lg border space-y-3.5" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
                {(() => {
                  const foldxMean = energetics.foldxMean ?? energetics.foldx;
                  const ddgun = energetics.ddgun;
                  const dynamut2 = energetics.dynamut2;

                  const foldxDestab = foldxMean !== null && foldxMean >= 1.5;
                  const ddgunDestab = ddgun !== null && ddgun >= 1.0;
                  const dynamutDestab = dynamut2 !== null && dynamut2 >= 1.0;

                  const votes = [
                    { name: "FoldX", destab: foldxDestab, val: foldxMean },
                    { name: "DynaMut2", destab: dynamutDestab, val: dynamut2 },
                    { name: "DDGun-Seq", destab: ddgunDestab, val: ddgun }
                  ];

                  const activeVotes = votes.filter(v => v.val !== null);
                  const positiveVotes = activeVotes.filter(v => v.destab).length;
                  const totalVotes = activeVotes.length;

                  return (
                    <div className="flex flex-col gap-1.5 border-b pb-3" style={{ borderColor: "var(--cs-border-subtle)" }}>
                      <span className="text-[10px] font-bold uppercase tracking-wider font-mono" style={{ color: "var(--cs-text-muted)" }}>
                        {totalVotes === 3 
                          ? "3-Method Majority Consensus Stability Verdict" 
                          : totalVotes > 0 
                            ? `${totalVotes}-Method Consensus Stability Verdict` 
                            : "Consensus Stability Verdict"}:
                      </span>
                    </div>
                  );
                })()}
                
                <div className="space-y-4 pl-5">
                  {(() => {
                    const foldxMean = energetics.foldxMean ?? energetics.foldx;
                    const ddgun = energetics.ddgun;
                    const dynamut2 = energetics.dynamut2;

                    const foldxDestab = foldxMean !== null && foldxMean >= 1.5;
                    const ddgunDestab = ddgun !== null && ddgun >= 1.0;
                    const dynamutDestab = dynamut2 !== null && dynamut2 >= 1.0;

                    const votes = [
                      { name: "FoldX", destab: foldxDestab, val: foldxMean },
                      { name: "DynaMut2", destab: dynamutDestab, val: dynamut2 },
                      { name: "DDGun-Seq", destab: ddgunDestab, val: ddgun }
                    ];

                    const activeVotes = votes.filter(v => v.val !== null);
                    const positiveVotes = activeVotes.filter(v => v.destab).length;
                    const totalVotes = activeVotes.length;

                    let label = "Low-Risk (Neutral Consensus)";
                    let styleClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                    let detailText = "All active methods agree on fold stability.";

                    if (positiveVotes >= 2) {
                      label = "High-Risk Pathogenic (Consensus)";
                      styleClass = "bg-rose-500/10 text-rose-455 border-rose-500/20 font-bold";
                      detailText = `${positiveVotes}/${totalVotes} methods predict significant destabilization (ΔΔG ≥ 1.0 kcal/mol or FoldX ≥ 1.5).`;
                    } else if (positiveVotes === 1) {
                      label = "Moderate-Risk Conflicting Support";
                      styleClass = "bg-amber-500/10 text-amber-450 border-amber-500/20 font-bold";
                      detailText = "Conflicting evidence: 1 method predicts destabilization while others suggest neutrality.";
                    } else if (totalVotes === 0) {
                      label = "UNAVAILABLE";
                      styleClass = "bg-slate-500/10 text-slate-400 border-slate-500/20";
                      detailText = "Energetics data is currently processing or unavailable.";
                    }

                    if (disruptionPredictor?.plddt !== undefined && disruptionPredictor.plddt < 70 && totalVotes > 0) {
                      label = `${label} (Speculative - Low pLDDT)`;
                      styleClass = "bg-amber-500/10 text-amber-455 border border-amber-500/20 font-bold";
                      detailText = `${detailText} WARNING: Template structure has low confidence (pLDDT < 70) at this residue position. Biophysical predictions are speculative and should be interpreted with caution.`;
                    }

                    return (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] px-2 py-0.5 rounded border ${styleClass}`}>
                            {label}
                          </span>
                          <span className="text-[9px] font-mono font-bold" style={{ color: "var(--cs-text-muted)" }}>
                            Votes: {positiveVotes}/{totalVotes} Destabilizing
                          </span>
                        </div>
                        <p className="text-[10px] leading-relaxed mt-1" style={{ color: "var(--cs-text-secondary)" }}>
                          {detailText}
                        </p>
                      </div>
                    );
                  })()}
                </div>

                {/* Additional Biophysical Metrics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[10.5px] pt-1">
                  {/* Local sidechain packing RMSD */}
                  <div className="p-2.5 rounded-lg border flex flex-col justify-between font-mono" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                    <span className="block text-[8.5px] uppercase font-bold text-slate-500 tracking-wider">Sidechain RMSD</span>
                    <strong className={`text-[12px] font-bold block mt-1 ${
                      energetics.localSidechainRmsd !== null && energetics.localSidechainRmsd > 1.5 
                        ? "text-rose-455" 
                        : energetics.localSidechainRmsd !== null && energetics.localSidechainRmsd > 0.8
                          ? "text-amber-500"
                          : "text-emerald-450"
                    }`}>
                      {energetics.localSidechainRmsd !== null 
                        ? `${energetics.localSidechainRmsd.toFixed(2)} Å` 
                        : "N/A"}
                    </strong>
                  </div>

                  {/* VdW Clash warnings */}
                  <div className="p-2.5 rounded-lg border flex flex-col justify-between font-mono" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                    <span className="block text-[8.5px] uppercase font-bold text-slate-500 tracking-wider">VdW Clash Delta</span>
                    <div className="flex items-center gap-1.5 mt-1">
                      <strong className={`text-[12px] font-bold ${
                        energetics.stericClashWarning ? "text-rose-455" : "text-emerald-450"
                      }`}>
                        {energetics.vdw !== null ? `${energetics.vdw.toFixed(2)} ${settings.energyUnit === "kJ/mol" ? "kJ/mol" : "kcal/mol"}` : "N/A"}
                      </strong>
                      {energetics.stericClashWarning && (
                        <span className="text-[7px] bg-rose-500/10 border border-rose-500/20 text-rose-455 px-1 py-0.2 rounded font-bold uppercase shrink-0">
                          Clash
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Electrostatic Interaction Delta */}
                  <div className="p-2.5 rounded-lg border flex flex-col justify-between font-mono" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
                    <span className="block text-[8.5px] uppercase font-bold text-slate-500 tracking-wider">Electrostatic Delta</span>
                    <strong className="text-[12px] font-bold block mt-1" style={{ color: "var(--cs-text-primary)" }}>
                      {energetics.electrostatics !== null ? `${energetics.electrostatics.toFixed(2)} ${settings.energyUnit === "kJ/mol" ? "kJ/mol" : "kcal/mol"}` : "N/A"}
                    </strong>
                  </div>
                </div>
              </div>
            )}
            
            <div className="text-[9px] p-2.5 rounded border italic" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-muted)" }}>
              * Consensus calculations are derived from FoldX energy grids and sequence-based evolutionary alignment dynamics.
            </div>
          </div>
        )}

        {activeTab === "interactions" && (
          <div className="space-y-4">
            <h4 className="font-bold text-[10px] uppercase tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>STRING Functional Protein-Protein Interaction Network</h4>
            
            {(() => {
              const interactions = result.stringInteractions;
              if (interactions && interactions.length > 0) {
                return (
                  <div className="space-y-3">
                    <p className="text-[10px]" style={{ color: "var(--cs-text-muted)" }}>
                      Top functional partners and network association confidence scores retrieved dynamically from STRING DB:
                    </p>
                    <div className="overflow-x-auto border rounded-lg" style={{ borderColor: "var(--cs-border)" }}>
                      <table className="w-full text-[11px] font-sans border-collapse">
                        <thead>
                          <tr style={{ background: "var(--cs-surface-2)", color: "var(--cs-text-primary)" }}>
                            <th className="p-2.5 text-left border-b font-bold font-mono" style={{ borderColor: "var(--cs-border)" }}>Associated Partner (Gene)</th>
                            <th className="p-2.5 text-center border-b font-bold font-mono" style={{ borderColor: "var(--cs-border)" }}>Confidence Score</th>
                            <th className="p-2.5 text-center border-b font-bold font-mono" style={{ borderColor: "var(--cs-border)" }}>Classification / Verdict</th>
                          </tr>
                        </thead>
                        <tbody>
                          {interactions.map((partner, pIdx) => {
                            const pct = (partner.score * 100).toFixed(0);
                            const isHigh = partner.score >= 0.7;
                            return (
                              <tr key={pIdx} className="hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-primary)", borderBottom: pIdx < interactions.length - 1 ? "1px solid var(--cs-border-subtle)" : "none" }}>
                                <td className="p-2.5 font-bold flex items-center gap-2">
                                  <span className={`w-1.5 h-1.5 rounded-full ${isHigh ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
                                  <span style={{ color: "var(--cs-text-primary)" }}>{partner.partner}</span>
                                </td>
                                <td className="p-2.5 text-center font-mono font-bold">{partner.score.toFixed(3)}</td>
                                <td className="p-2.5 text-center">
                                  <span className={`inline-block text-[10px] px-2 py-0.5 rounded font-bold border ${
                                    isHigh 
                                      ? "bg-emerald-500/10 text-emerald-455 border border-emerald-500/20" 
                                      : "bg-amber-500/10 text-amber-455 border border-amber-500/20"
                                  }`}>
                                    {pct}% ({isHigh ? "High Confidence" : "Medium Confidence"})
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              }
              return (
                <div className="p-3 text-center border border-dashed rounded-lg" style={{ color: "var(--cs-text-muted)", borderColor: "var(--cs-border)" }}>
                  No STRING DB interaction partners found for gene {result.metadata.gene}.
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === "guidelines" && (
          <div className="space-y-4">
            <h4 className="font-bold text-[10px] uppercase tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>Research Interpretation & ACMG/AMP Threshold Guidelines</h4>
            
            {/* Dynamic Alert Banner */}
            {(() => {
              const revel = result.conservationData?.revel ?? null;
              const ddG = foldingDdG;
              
              let statusText = "Variant of Uncertain Significance (VUS)";
              let statusStyle = "bg-slate-500/10 text-slate-400 border-slate-500/20";
              let statusDesc = "The scores and stability changes fall into intermediate ranges or present conflicting evidence, requiring further functional validation.";
              
              if (revel !== null && revel >= 0.75 && ddG !== null && ddG > 1.5) {
                statusText = "Destabilization + Conservation Concordant (High Risk)";
                statusStyle = "bg-rose-500/15 text-rose-455 border-rose-500/25";
                statusDesc = "Both sequence-based conservation (REVEL >= 0.75) and structural energetics (FoldX ddG > 1.5 kcal/mol) suggest severe risk of loss-of-function due to misfolding. NOTE: Destabilization ≠ Pathogenicity; some pathogenic variants (e.g. gain-of-function or neomorphic) do not cause structural destabilization.";
              } else if ((revel !== null && revel >= 0.5) || (ddG !== null && ddG > 1.5)) {
                statusText = "MODERATE-RISK CONCORDANCE (Pathogenic / Destabilizing Support)";
                statusStyle = "bg-orange-500/15 text-orange-450 border-orange-500/20";
                statusDesc = "At least one biophysical indicator (REVEL >= 0.5 or FoldX ddG > 0.5 kcal/mol) shows significant aberration, suggesting functional or structural impact.";
              } else if (revel !== null && revel < 0.15 && ddG !== null && ddG < 0.5 && ddG > -0.5) {
                statusText = "LOW-RISK CONCORDANCE (Likely Benign / Tolerated)";
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
            <div className="overflow-x-auto border rounded-lg" style={{ borderColor: "var(--cs-border)" }}>
              <table className="w-full text-[10px] font-sans border-collapse">
                <thead>
                  <tr style={{ background: "var(--cs-surface-2)", color: "var(--cs-text-primary)" }}>
                    <th className="p-2 text-left border-b font-bold font-mono" style={{ borderColor: "var(--cs-border)" }}>Assay / Metric</th>
                    <th className="p-2 text-left border-b font-bold font-mono" style={{ borderColor: "var(--cs-border)" }}>Variant Score</th>
                    <th className="p-2 text-left border-b font-bold font-mono" style={{ borderColor: "var(--cs-border)" }}>Benign Threshold</th>
                    <th className="p-2 text-left border-b font-bold font-mono" style={{ borderColor: "var(--cs-border)" }}>Pathogenic Threshold</th>
                    <th className="p-2 text-center border-b font-bold font-mono" style={{ borderColor: "var(--cs-border)" }}>ACMG Code</th>
                    <th className="p-2 text-center border-b font-bold font-mono" style={{ borderColor: "var(--cs-border)" }}>Match</th>
                  </tr>
                </thead>
                <tbody>
                  {/* REVEL Row */}
                  {(() => {
                    const val = result.conservationData?.revel ?? null;
                    const isBenign = val !== null && val < 0.15;
                    const isPath = val !== null && val >= 0.5;
                    const isStrong = val !== null && val >= 0.75;
                    return (
                      <tr className="hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-primary)", borderBottom: "1px solid var(--cs-border-subtle)" }}>
                        <td className="p-2 font-bold" style={{ color: "var(--cs-text-primary)" }}>REVEL Score</td>
                        <td className="p-2 font-mono font-bold">{val !== null ? val.toFixed(3) : "N/A"}</td>
                        <td className="p-2 font-mono" style={{ color: "var(--cs-text-secondary)" }}>&lt; 0.150</td>
                        <td className="p-2 font-mono" style={{ color: "var(--cs-text-secondary)" }}>&gt;= 0.500 (Strong: &gt;= 0.750)</td>
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
                            <span className="bg-amber-500/10 text-amber-450 px-1.5 py-0.5 rounded font-bold">Path. Supp.</span>
                          ) : isBenign ? (
                            <span className="bg-emerald-500/10 text-emerald-450 px-1.5 py-0.5 rounded font-bold">Benign</span>
                          ) : val !== null ? (
                            <span className="bg-slate-500/10 text-slate-400 px-1.5 py-0.5 rounded font-bold">VUS</span>
                          ) : (
                            <span style={{ color: "var(--cs-text-muted)" }}>N/A</span>
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
                      <tr className="hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-primary)", borderBottom: "1px solid var(--cs-border-subtle)" }}>
                        <td className="p-2 font-bold" style={{ color: "var(--cs-text-primary)" }}>FoldX ddG</td>
                        <td className="p-2 font-mono font-bold">{val !== null ? `${val.toFixed(2)} kcal/mol` : "N/A"}</td>
                        <td className="p-2 font-mono" style={{ color: "var(--cs-text-secondary)" }}>-0.5 to +0.5</td>
                        <td className="p-2 font-mono" style={{ color: "var(--cs-text-secondary)" }}>&gt; 0.50 (Severe: &gt; 1.50)</td>
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
                            <span style={{ color: "var(--cs-text-muted)" }}>N/A</span>
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
                      <tr className="hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-primary)", borderBottom: "1px solid var(--cs-border-subtle)" }}>
                        <td className="p-2 font-bold" style={{ color: "var(--cs-text-primary)" }}>GERP++</td>
                        <td className="p-2 font-mono font-bold">{val !== null ? val.toFixed(2) : "N/A"}</td>
                        <td className="p-2 font-mono" style={{ color: "var(--cs-text-secondary)" }}>&lt; 2.00</td>
                        <td className="p-2 font-mono" style={{ color: "var(--cs-text-secondary)" }}>&gt;= 2.00 (Highly Conserved)</td>
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
                            <span className="px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(196,104,73,0.15)", color: "var(--cs-accent-clay)" }}>Conserved</span>
                          ) : val !== null ? (
                            <span style={{ color: "var(--cs-text-muted)" }}>Neutral</span>
                          ) : (
                            <span style={{ color: "var(--cs-text-muted)" }}>N/A</span>
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
                      <tr className="hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-primary)", borderBottom: "1px solid var(--cs-border-subtle)" }}>
                        <td className="p-2 font-bold" style={{ color: "var(--cs-text-primary)" }}>phyloP (100-way)</td>
                        <td className="p-2 font-mono font-bold">{val !== null ? val.toFixed(2) : "N/A"}</td>
                        <td className="p-2 font-mono" style={{ color: "var(--cs-text-secondary)" }}>&lt; 1.50</td>
                        <td className="p-2 font-mono" style={{ color: "var(--cs-text-secondary)" }}>&gt;= 1.50 (Highly Conserved)</td>
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
                            <span className="px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(196,104,73,0.15)", color: "var(--cs-accent-clay)" }}>Conserved</span>
                          ) : val !== null ? (
                            <span style={{ color: "var(--cs-text-muted)" }}>Variable</span>
                          ) : (
                            <span style={{ color: "var(--cs-text-muted)" }}>N/A</span>
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
                      <tr className="hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-primary)" }}>
                        <td className="p-2 font-bold" style={{ color: "var(--cs-text-primary)" }}>CADD PHRED</td>
                        <td className="p-2 font-mono font-bold">{val !== null ? val.toFixed(1) : "N/A"}</td>
                        <td className="p-2 font-mono" style={{ color: "var(--cs-text-secondary)" }}>&lt; 15.0</td>
                        <td className="p-2 font-mono" style={{ color: "var(--cs-text-secondary)" }}>&gt;= 20.0 (Top 1% deleterious)</td>
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

            <div className="p-3 rounded-lg border text-[9px] leading-normal shadow-sm" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-secondary)" }}>
              <h5 className="font-bold text-[10px] uppercase mb-1" style={{ color: "var(--cs-text-primary)" }}>ACMG/AMP Evidence Codes Key:</h5>
              <ul className="list-disc pl-4 space-y-1">
                <li><strong className="font-mono" style={{ color: "var(--cs-accent-clay)" }}>PP3 (Pathogenic Supporting)</strong> {"/"} <strong className="font-mono" style={{ color: "var(--cs-accent-clay)" }}>BP4 (Benign Supporting)</strong>: Computational algorithms predict a deleterious/neutral effect on the protein.</li>
                <li><strong className="font-mono" style={{ color: "var(--cs-accent-clay)" }}>PM1 (Pathogenic Moderate)</strong>: Mutational hot-spot or critical functional domain (e.g. binding pocket interface) without benign variation.</li>
                <li><strong className="font-mono" style={{ color: "var(--cs-accent-clay)" }}>BP3 (Benign Supporting)</strong>: In-frame deletion/insertion in a repetitive region, or structurally neutral substitution.</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

