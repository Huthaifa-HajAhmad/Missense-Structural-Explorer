import React, { useState, useMemo } from "react";
import {
  Dna,
  ExternalLink,
  Layers,
  Activity,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Cpu,
  HelpCircle,
  Filter,
  Copy,
  Check,
  Search,
  ChevronDown,
  ChevronUp,
  Sliders,
  Compass,
  FileText
} from "lucide-react";
import { TabComponentProps } from "./types";
import {
  AlphaGenomeAviData,
  generateAtlasUrls,
  parseGenomicCoordinateString,
  AtlasUrls
} from "../../shared/contracts";

interface ModalityDefinition {
  id: string;
  name: string;
  tier: "TF Binding" | "Chromatin" | "Splicing" | "Structure" | "Conservation" | "Epigenetics";
  description: string;
  assay: string;
  color: string;
}

const MODALITY_DEFINITIONS: ModalityDefinition[] = [
  {
    id: "fi_CHIP_TF",
    name: "ChIP-seq TF Binding",
    tier: "TF Binding",
    description: "Perturbation of transcription factor binding motifs and peak intensities across genome-wide ChIP-seq assays.",
    assay: "ENCODE / TF ChIP-seq",
    color: "#6366f1" // indigo
  },
  {
    id: "fi_DNASE",
    name: "DNase-seq / ATAC Accessibility",
    tier: "Chromatin",
    description: "Disruption of open chromatin hypersensitivity and accessible regulatory DNA regions.",
    assay: "DNase-seq / ATAC-seq",
    color: "#06b6d4" // cyan
  },
  {
    id: "fi_MERGED_SPLICING",
    name: "RNA Pre-mRNA Splicing",
    tier: "Splicing",
    description: "Disruption of splice donor/acceptor canonical sites, branchpoints, and exonic splicing enhancers/silencers.",
    assay: "Deep Learning Pre-mRNA Splicing",
    color: "#ec4899" // pink
  },
  {
    id: "fi_ALPHAMISSENSE",
    name: "AlphaMissense 3D Embedding",
    tier: "Structure",
    description: "Protein-level structural perturbation and amino acid missense substitution pathogenicity embeddings.",
    assay: "DeepMind AlphaFold Structural Model",
    color: "#c46849" // cs-accent-clay
  },
  {
    id: "fi_CACTUS_241_WAY",
    name: "241-Way Mammalian Conservation",
    tier: "Conservation",
    description: "Cross-species evolutionary constraint across 241 placental mammals (Zoonomia alignment).",
    assay: "Progressive Cactus Whole-Genome Alignment",
    color: "#10b981" // emerald
  },
  {
    id: "fi_MAX_ABS_RNA_SEQ",
    name: "Continuous RNA-seq Expression",
    tier: "Epigenetics",
    description: "Predicted quantitative transcript abundance divergence across 9,440 human cellular biosamples.",
    assay: "PolyA+ / Total RNA-seq",
    color: "#8b5cf6" // violet
  },
  {
    id: "fi_CAGE",
    name: "CAGE Transcription Start Site",
    tier: "Epigenetics",
    description: "Transcription initiation rate and 5' TSS promoter activity alterations.",
    assay: "Cap Analysis Gene Expression (FANTOM5)",
    color: "#f59e0b" // amber
  },
  {
    id: "fi_HISTONE_H3K4ME3",
    name: "H3K4me3 Active Promoter Mark",
    tier: "Epigenetics",
    description: "Deposition or loss of trimethylated histone H3 lysine 4 at active gene promoter domains.",
    assay: "Histone ChIP-seq (H3K4me3)",
    color: "#3b82f6" // blue
  },
  {
    id: "fi_HISTONE_H3K27AC",
    name: "H3K27ac Active Enhancer Mark",
    tier: "Epigenetics",
    description: "Acetylated histone H3 lysine 27 signal marking transcriptionally active enhancers and super-enhancers.",
    assay: "Histone ChIP-seq (H3K27ac)",
    color: "#14b8a6" // teal
  },
  {
    id: "fi_HISTONE_H3K4ME1",
    name: "H3K4me1 Primed Enhancer Mark",
    tier: "Epigenetics",
    description: "Monomethylated H3K4 marking primed or poised regulatory elements.",
    assay: "Histone ChIP-seq (H3K4me1)",
    color: "#a855f7" // purple
  },
  {
    id: "fi_HISTONE_H3K36ME3",
    name: "H3K36me3 Transcriptional Elongation",
    tier: "Epigenetics",
    description: "Histone modification associated with active Pol II transcription elongation through gene bodies.",
    assay: "Histone ChIP-seq (H3K36me3)",
    color: "#eab308" // yellow
  },
  {
    id: "fi_HISTONE_H3K27ME3",
    name: "H3K27me3 Polycomb Repression",
    tier: "Epigenetics",
    description: "Polycomb repressive complex 2 (PRC2) mediated facultative heterochromatin silencing.",
    assay: "Histone ChIP-seq (H3K27me3)",
    color: "#ef4444" // red
  },
  {
    id: "fi_HISTONE_H3K9ME3",
    name: "H3K9me3 Heterochromatin Silencing",
    tier: "Epigenetics",
    description: "Constitutive heterochromatin silencing and telomeric/centromeric repression.",
    assay: "Histone ChIP-seq (H3K9me3)",
    color: "#64748b" // slate
  }
];

interface ReferenceAssayTrack {
  id: string;
  tissue: "Liver" | "Brain" | "Cardiac" | "Immune / Blood" | "Epithelial";
  biosample: string;
  assay: "Pre-mRNA Splicing" | "RNA-seq Expression" | "ChIP-TF Binding" | "Chromatin Accessibility";
  target: string;
  referenceEffect: string;
  significanceCategory: "Chromatin Disruption" | "Splice Junction Shift" | "Transcriptional Repression" | "Enhancer Alteration";
}

const REFERENCE_ASSAY_SCHEMA: ReferenceAssayTrack[] = [
  {
    id: "ref-trk-1",
    tissue: "Liver",
    biosample: "HepG2 Hepatocellular",
    assay: "ChIP-TF Binding",
    target: "HNF4A / FOXA2 Core Motif",
    referenceEffect: "-84% ChIP Peak Disruption",
    significanceCategory: "Chromatin Disruption"
  },
  {
    id: "ref-trk-2",
    tissue: "Liver",
    biosample: "Primary Human Hepatocytes",
    assay: "RNA-seq Expression",
    target: "PolyA+ mRNA Steady-State",
    referenceEffect: "-1.82 log2 FC Transcript Divergence",
    significanceCategory: "Transcriptional Repression"
  },
  {
    id: "ref-trk-3",
    tissue: "Brain",
    biosample: "Dorsolateral Prefrontal Cortex",
    assay: "Pre-mRNA Splicing",
    target: "Splice Junction Usage Ratio",
    referenceEffect: "-71% Junction Efficiency Shift",
    significanceCategory: "Splice Junction Shift"
  },
  {
    id: "ref-trk-4",
    tissue: "Brain",
    biosample: "Neural Progenitor Cells (NPC)",
    assay: "Chromatin Accessibility",
    target: "ATAC Regulatory Footprint",
    referenceEffect: "-65% Open Chromatin Attenuation",
    significanceCategory: "Chromatin Disruption"
  },
  {
    id: "ref-trk-5",
    tissue: "Cardiac",
    biosample: "Left Ventricle Myocardium",
    assay: "RNA-seq Expression",
    target: "Cardiomyocyte Transcript Isoforms",
    referenceEffect: "+1.34 log2 FC Alternative Isoform",
    significanceCategory: "Transcriptional Repression"
  },
  {
    id: "ref-trk-6",
    tissue: "Cardiac",
    biosample: "iPSC-Derived Cardiomyocytes",
    assay: "ChIP-TF Binding",
    target: "MEF2C / GATA4 Cardiac Enhancer",
    referenceEffect: "-58% Factor Affinity Disruption",
    significanceCategory: "Enhancer Alteration"
  },
  {
    id: "ref-trk-7",
    tissue: "Immune / Blood",
    biosample: "CD4+ Primary T-Cells",
    assay: "ChIP-TF Binding",
    target: "NF-kB / RUNX1 Immune Footprint",
    referenceEffect: "-76% Regulatory Peak Destruction",
    significanceCategory: "Chromatin Disruption"
  },
  {
    id: "ref-trk-8",
    tissue: "Immune / Blood",
    biosample: "GM12878 Lymphoblastoid",
    assay: "Pre-mRNA Splicing",
    target: "Cryptic Exon Inclusion Reads",
    referenceEffect: "+0.45 Cryptic Junction Activation",
    significanceCategory: "Splice Junction Shift"
  },
  {
    id: "ref-trk-9",
    tissue: "Epithelial",
    biosample: "Bronchial Epithelial Cells",
    assay: "Chromatin Accessibility",
    target: "Promoter-Proximal DNase Peak",
    referenceEffect: "-49% Hypersensitivity Attenuation",
    significanceCategory: "Chromatin Disruption"
  },
  {
    id: "ref-trk-10",
    tissue: "Epithelial",
    biosample: "Epidermal Keratinocytes",
    assay: "RNA-seq Expression",
    target: "Epithelial mRNA Steady-State",
    referenceEffect: "-1.15 log2 FC Transcript Divergence",
    significanceCategory: "Transcriptional Repression"
  }
];

function AlphaGenomeTabComponent({ analysisState, isDark }: TabComponentProps) {
  const [selectedTissue, setSelectedTissue] = useState<string>("All");
  const [trackSearch, setTrackSearch] = useState<string>("");
  const [modalitySort, setModalitySort] = useState<"tier" | "impact">("impact");
  const [showEduExplainer, setShowEduExplainer] = useState<boolean>(false);
  const [copiedVariant, setCopiedVariant] = useState<boolean>(false);

  const result = analysisState.result;
  if (!result) return null;

  const alphagenome: AlphaGenomeAviData | null = result.conservationData?.alphagenome || null;
  const isLive = alphagenome?.status === "live";
  const geneName = result.metadata?.gene || "";
  const variantNotation = result.metadata?.variant || "";

  // Robust coordinate resolution across predictorData, variant, and splice metadata
  const parsedCoords = useMemo(() => {
    // 1. Primary: predictorData.gnomadVariantId
    const fromPredictor = parseGenomicCoordinateString(result.predictorData?.gnomadVariantId);
    if (fromPredictor) return fromPredictor;

    // 2. Secondary: direct variant string if formatted in genomic notation
    const fromVariant = parseGenomicCoordinateString(variantNotation);
    if (fromVariant) return fromVariant;

    // 3. Tertiary: splice proximity coordinate fallback with gene symbol
    const splicePos = result.conservationData?.spliceProximity?.genomicPos;
    if (splicePos && splicePos > 0) {
      return {
        chrom: "",
        pos: splicePos,
        ref: "",
        alt: ""
      };
    }

    return null;
  }, [result.predictorData?.gnomadVariantId, variantNotation, result.conservationData?.spliceProximity?.genomicPos]);

  const atlasUrls: AtlasUrls | null = useMemo(() => {
    if (parsedCoords && parsedCoords.chrom && parsedCoords.pos && parsedCoords.ref && parsedCoords.alt) {
      return generateAtlasUrls(parsedCoords.chrom, parsedCoords.pos, parsedCoords.ref, parsedCoords.alt);
    }
    return null;
  }, [parsedCoords]);

  const fallbackGeneSearchUrl = useMemo(() => {
    return `https://deepmind.google.com/science/alphagenome/atlas/variant?q=${encodeURIComponent(geneName)}`;
  }, [geneName]);

  const handleCopyVariant = (varStr: string) => {
    navigator.clipboard.writeText(varStr).then(() => {
      setCopiedVariant(true);
      setTimeout(() => setCopiedVariant(false), 2000);
    });
  };

  // Values from live backend or standby state
  const aviPhred = alphagenome?.aviPhred ?? null;
  const topPercentile = alphagenome?.topPercentile ?? (aviPhred !== null && aviPhred >= 0 ? Math.pow(10, -aviPhred / 10) * 100 : null);
  const topModality = alphagenome?.topModality ?? null;
  const topFeatureImportance = alphagenome?.topFeatureImportance ?? null;
  const acmgStrength = alphagenome?.acmgStrength ?? "indeterminate";
  const featureAttributions = alphagenome?.featureAttributions ?? null;

  // Derive Phred color class
  const getPhredColorClass = (val: number | null) => {
    if (val === null || val < 0) return "text-slate-400";
    if (val >= 35.0) return "text-rose-500 dark:text-rose-400";
    if (val >= 25.0) return "text-amber-500 dark:text-amber-400";
    if (val >= 15.0) return "text-yellow-500 dark:text-yellow-400";
    if (val <= 8.0) return "text-emerald-500 dark:text-emerald-400";
    return "text-slate-400";
  };

  // ClinGen SVI Badge Configuration
  const getAcmgBadgeConfig = (tier: string) => {
    switch (tier) {
      case "PP3_Strong":
        return {
          label: "PP3 (Strong Pathogenic)",
          odds: "18.7:1 Odds of Pathogenicity",
          badgeClass: "bg-rose-500/10 text-rose-500 border-rose-500/30"
        };
      case "PP3_Moderate":
        return {
          label: "PP3 (Moderate Pathogenic)",
          odds: "4.33:1 Odds of Pathogenicity",
          badgeClass: "bg-amber-500/10 text-amber-500 border-amber-500/30"
        };
      case "PP3_Supporting":
        return {
          label: "PP3 (Supporting Pathogenic)",
          odds: "2.08:1 Odds of Pathogenicity",
          badgeClass: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30"
        };
      case "BP4_Supporting":
        return {
          label: "BP4 (Supporting Benign)",
          odds: "0.48:1 Odds (Favors Benign)",
          badgeClass: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
        };
      case "BP4_Moderate":
        return {
          label: "BP4 (Moderate Benign)",
          odds: "0.23:1 Odds (Favors Benign)",
          badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
        };
      default:
        return {
          label: "Indeterminate / Uncalibrated",
          odds: "Non-discriminatory continuous score",
          badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/30"
        };
    }
  };

  const acmgBadge = getAcmgBadgeConfig(acmgStrength);

  // Filtered modalities with scores
  const renderedModalities = useMemo(() => {
    const list = MODALITY_DEFINITIONS.map((def) => {
      const shap = featureAttributions ? (featureAttributions[def.id] ?? 0) : 0;
      return {
        ...def,
        shap
      };
    });

    if (modalitySort === "impact") {
      return list.sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap));
    }
    return list;
  }, [featureAttributions, modalitySort]);

  // Filtered reference assay tracks
  const filteredTracks = useMemo(() => {
    return REFERENCE_ASSAY_SCHEMA.filter((trk) => {
      const matchTissue = selectedTissue === "All" || trk.tissue === selectedTissue;
      const matchSearch =
        trackSearch.trim() === "" ||
        trk.biosample.toLowerCase().includes(trackSearch.toLowerCase()) ||
        trk.target.toLowerCase().includes(trackSearch.toLowerCase()) ||
        trk.assay.toLowerCase().includes(trackSearch.toLowerCase());
      return matchTissue && matchSearch;
    });
  }, [selectedTissue, trackSearch]);

  return (
    <div className="space-y-6 animate-fade-in text-cs-text-primary pb-12">
      {/* Header Banner */}
      <div
        className="p-5 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(99,102,241,0.07) 0%, rgba(196,104,73,0.06) 100%)",
          borderColor: "var(--cs-border)"
        }}
      >
        <div className="flex items-start gap-3.5 z-10">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm"
            style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)" }}
          >
            <Compass className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold tracking-tight text-cs-text-primary">
                AlphaGenome Multimodal Genomic Studio
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Google DeepMind
              </span>
              {isLive ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Live Inference
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Standby / Direct Atlas Mode
                </span>
              )}
            </div>
            <p className="text-xs text-cs-text-muted mt-1 max-w-3xl leading-relaxed">
              Unified foundation model predicting 9,440 functional epigenetic and transcriptomic assays from raw DNA sequence.
              Evaluates genome-wide variant impact (AVI) across 18 modalities without synthetic heuristics.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 z-10 flex-shrink-0">
          <a
            href={atlasUrls ? atlasUrls.trackPredictionsUrl : fallbackGeneSearchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-sm hover:shadow"
          >
            <span>Open in DeepMind Atlas</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* ── SECTION 1: EXECUTIVE KPI BANNER (4 HERO CARDS) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: AVI Phred Score */}
        <div
          className="p-4 rounded-xl border flex flex-col justify-between"
          style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-cs-text-muted uppercase">
              Calibrated AVI Phred
            </span>
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: aviPhred !== null && aviPhred >= 25 ? "#f43f5e" : aviPhred !== null ? "#10b981" : "#64748b"
              }}
            />
          </div>

          <div className="my-3">
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-black font-mono tracking-tight ${getPhredColorClass(aviPhred)}`}>
                {aviPhred !== null ? aviPhred.toFixed(1) : "—"}
              </span>
              <span className="text-xs font-mono text-cs-text-muted">/ 50.0</span>
            </div>

            {/* Phred Gauge with calibrated thresholds and theme-aware tick marks */}
            <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden mt-2 relative">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(0, ((aviPhred ?? 0) / 50) * 100))}%`,
                  background:
                    aviPhred !== null && aviPhred >= 35
                      ? "#f43f5e"
                      : aviPhred !== null && aviPhred >= 25
                      ? "#f59e0b"
                      : aviPhred !== null && aviPhred >= 15
                      ? "#eab308"
                      : "#10b981"
                }}
              />
              {/* High-contrast tick marks visible in both light and dark themes */}
              <div className="absolute top-0 bottom-0 left-[16%] w-0.5 bg-slate-400 dark:bg-white/40" title="BP4 Threshold (8.0)" />
              <div className="absolute top-0 bottom-0 left-[30%] w-0.5 bg-slate-400 dark:bg-white/40" title="PP3 Supporting (15.0)" />
              <div className="absolute top-0 bottom-0 left-[50%] w-0.5 bg-slate-400 dark:bg-white/40" title="PP3 Moderate (25.0)" />
              <div className="absolute top-0 bottom-0 left-[70%] w-0.5 bg-slate-400 dark:bg-white/40" title="PP3 Strong (35.0)" />
            </div>
            <div className="flex justify-between text-[9px] font-mono text-cs-text-muted mt-1">
              <span>0 (Benign)</span>
              <span>25 (Mod)</span>
              <span>50 (Deleterious)</span>
            </div>
          </div>

          <p className="text-[11px] text-cs-text-muted border-t pt-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
            Scaled -10 log10(P_benign) empirical odds
          </p>
        </div>

        {/* Card 2: Genome-Wide Empirical Percentile */}
        <div
          className="p-4 rounded-xl border flex flex-col justify-between"
          style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-cs-text-muted uppercase">
              Genome-Wide Rank
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              3B Bases
            </span>
          </div>

          <div className="my-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold font-mono tracking-tight text-cs-text-primary">
                {topPercentile !== null ? `Top ${topPercentile < 0.01 ? topPercentile.toExponential(2) : topPercentile.toFixed(3)}%` : "Standby"}
              </span>
            </div>
            <p className="text-xs font-mono text-cs-text-muted mt-1">
              {topPercentile !== null
                ? `1 in ${Math.round(100 / Math.max(topPercentile, 0.00001)).toLocaleString()} human SNVs`
                : "Awaiting API token for exact rank"}
            </p>
          </div>

          <div className="border-t pt-2 flex items-center justify-between text-[11px]" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <span className="text-cs-text-muted">Empirical Quantile</span>
            <span className="font-mono font-semibold text-cs-accent-clay">
              {alphagenome?.aviQuantile ? alphagenome.aviQuantile.toFixed(5) : "—"}
            </span>
          </div>
        </div>

        {/* Card 3: Leading Biological Driver */}
        <div
          className="p-4 rounded-xl border flex flex-col justify-between"
          style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-cs-text-muted uppercase">
              Leading Driver
            </span>
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          </div>

          <div className="my-3">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold tracking-tight text-cs-text-primary truncate">
                {topModality || "Multi-Modal"}
              </span>
            </div>
            <p className="text-xs font-mono text-cs-accent-clay mt-1 font-semibold">
              {topFeatureImportance !== null
                ? `${topFeatureImportance >= 0 ? "+" : ""}${topFeatureImportance.toFixed(3)} SHAP weight`
                : "Unified consensus"}
            </p>
          </div>

          <p className="text-[11px] text-cs-text-muted border-t pt-2 truncate" style={{ borderColor: "var(--cs-border-subtle)" }}>
            Primary biological regulatory disruption
          </p>
        </div>

        {/* Card 4: ClinGen SVI Evidence Tier */}
        <div
          className="p-4 rounded-xl border flex flex-col justify-between"
          style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wider text-cs-text-muted uppercase">
              ClinGen SVI Evidence
            </span>
            <span className="text-[10px] font-mono text-cs-text-muted">Bayesian</span>
          </div>

          <div className="my-3">
            <span className={`inline-block text-xs px-2.5 py-1 rounded-md font-bold font-mono border ${acmgBadge.badgeClass}`}>
              {acmgBadge.label}
            </span>
            <p className="text-[11px] text-cs-text-muted mt-2 font-mono">
              {acmgBadge.odds}
            </p>
          </div>

          <p className="text-[10px] text-cs-text-muted border-t pt-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
            Calibrated against ClinGen SVI framework
          </p>
        </div>
      </div>

      {/* ── SECTION 2: 18-MODALITY BIOLOGICAL FEATURE ATTRIBUTION SPECTRUM ── */}
      <div
        className="p-6 rounded-2xl border"
        style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b" style={{ borderColor: "var(--cs-border-subtle)" }}>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold tracking-tight text-cs-text-primary">
                18-Modality Biological Feature Attribution Spectrum
              </h4>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold">
                TreeExplainer SHAP
              </span>
            </div>
            <p className="text-xs text-cs-text-muted mt-0.5">
              Decomposition of 9,440 functional tracks into human-interpretable biological regulatory drivers.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center rounded-lg border p-0.5 text-xs font-mono" style={{ borderColor: "var(--cs-border)" }}>
              <button
                onClick={() => setModalitySort("impact")}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  modalitySort === "impact"
                    ? "bg-indigo-600 text-white font-semibold"
                    : "text-cs-text-muted hover:text-cs-text-primary"
                }`}
              >
                Sort by Impact
              </button>
              <button
                onClick={() => setModalitySort("tier")}
                className={`px-2.5 py-1 rounded-md transition-all ${
                  modalitySort === "tier"
                    ? "bg-indigo-600 text-white font-semibold"
                    : "text-cs-text-muted hover:text-cs-text-primary"
                }`}
              >
                Group by Tier
              </button>
            </div>

            <button
              onClick={() => setShowEduExplainer(!showEduExplainer)}
              className="p-1.5 rounded-lg border text-cs-text-muted hover:text-cs-text-primary transition-all flex items-center gap-1 text-xs"
              style={{ borderColor: "var(--cs-border)" }}
              title="Explain SHAP attribution methodology"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Assay Guide</span>
              {showEduExplainer ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Educational Drawer */}
        {showEduExplainer && (
          <div
            className="p-4 rounded-xl border mb-6 text-xs leading-relaxed space-y-2"
            style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}
          >
            <h5 className="font-bold text-cs-text-primary flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              How AlphaGenome Computes Biological Feature Attribution
            </h5>
            <p className="text-cs-text-muted">
              AlphaGenome maps each DNA sequence into 9,440 continuous epigenetic and transcriptomic track predictions.
              To derive clinical interpretability, DeepMind trains a calibrated gradient boosted ensemble on top of these 9,440 predictions.
              TreeExplainer then decomposes the overall Variant Impact (AVI) into exact additive SHAP weights:
            </p>
            <div className="p-2.5 rounded bg-slate-100 dark:bg-black/30 border border-cs-border-subtle font-mono text-[11px] text-indigo-700 dark:text-indigo-300">
              AVI = Expected Value + &Sigma; (SHAP_TF + SHAP_Splicing + SHAP_Chromatin + SHAP_AlphaMissense + ...)
            </div>
            <p className="text-cs-text-muted">
              A positive SHAP score indicates that the variant perturbs that specific biological layer toward pathogenicity.
              For missense variants with both splicing and structural disruption, this resolves the Dual Mechanism Dilemma.
            </p>
          </div>
        )}

        {/* Modality Spectrum Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {renderedModalities.map((mod) => {
            const hasScore = featureAttributions && featureAttributions[mod.id] !== undefined;
            const shapValue = mod.shap;
            const barWidth = Math.min(100, Math.max(4, Math.abs(shapValue) * 200));

            return (
              <div
                key={mod.id}
                className="p-3.5 rounded-xl border flex flex-col justify-between hover:border-indigo-500/30 transition-all"
                style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-cs-text-primary">{mod.name}</span>
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded font-mono font-medium border"
                        style={{
                          background: `${mod.color}15`,
                          color: mod.color,
                          borderColor: `${mod.color}35`
                        }}
                      >
                        {mod.tier}
                      </span>
                    </div>
                    <p className="text-[10px] text-cs-text-muted mt-1 leading-snug line-clamp-2">
                      {mod.description}
                    </p>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <span className="font-mono text-xs font-bold" style={{ color: mod.color }}>
                      {hasScore ? `${shapValue >= 0 ? "+" : ""}${shapValue.toFixed(3)}` : "Standby"}
                    </span>
                    <span className="block text-[9px] font-mono text-cs-text-muted">SHAP</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-3">
                  <div className="w-full bg-slate-200 dark:bg-slate-700/50 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: hasScore ? `${barWidth}%` : "0%",
                        backgroundColor: mod.color
                      }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-[9px] font-mono text-cs-text-muted mt-1">
                    <span>{mod.assay}</span>
                    <span>{hasScore ? `${(shapValue * 100).toFixed(1)}% Relative` : "—"}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── SECTION 3: 9,440-TRACK ASSAY ARCHITECTURE & REFERENCE PROFILES ── */}
      <div
        className="p-6 rounded-2xl border"
        style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-4 border-b" style={{ borderColor: "var(--cs-border-subtle)" }}>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold tracking-tight text-cs-text-primary">
                AlphaGenome 9,440-Track Assay Architecture &amp; Target Profiles
              </h4>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold">
                Assay Profiling Schema
              </span>
            </div>
            <p className="text-xs text-cs-text-muted mt-0.5">
              Multi-system regulatory mapping modeled across 5 human physiological tissue classes.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-cs-text-muted" />
              <input
                type="text"
                value={trackSearch}
                onChange={(e) => setTrackSearch(e.target.value)}
                placeholder="Search tracks, targets, assays..."
                className="pl-8 pr-3 py-1 text-xs rounded-lg border bg-transparent text-cs-text-primary placeholder:text-cs-text-muted focus:outline-none focus:ring-1 focus:ring-indigo-500"
                style={{ borderColor: "var(--cs-border)" }}
              />
            </div>
          </div>
        </div>

        {/* Scientific Provenance & Benchmark Disclaimer Banner */}
        <div
          className="p-3.5 rounded-xl border mb-5 flex items-start gap-3"
          style={{
            background: "rgba(196,104,73,0.08)",
            borderColor: "rgba(196,104,73,0.25)",
            color: "var(--cs-text-primary)"
          }}
        >
          <AlertCircle className="w-4 h-4 text-cs-accent-clay flex-shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <span className="font-bold text-cs-accent-clay">Illustrative Benchmark Reference Schema:</span> The physiological assay signals below illustrate the 9,440-track continuous coverage schema modeled by AlphaGenome.
            To inspect live, locus-specific BigWig track predictions computed specifically for {atlasUrls ? atlasUrls.variantStr : (variantNotation || "this variant")}, use the DeepMind Atlas launchpads below.
          </div>
        </div>

        {/* Tissue Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-3 mb-4 text-xs font-mono">
          {["All", "Liver", "Brain", "Cardiac", "Immune / Blood", "Epithelial"].map((t) => (
            <button
              key={t}
              onClick={() => setSelectedTissue(t)}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-all ${
                selectedTissue === t
                  ? "bg-indigo-600 text-white font-semibold shadow-sm"
                  : "bg-cs-surface-2 text-cs-text-muted hover:text-cs-text-primary border border-cs-border-subtle"
              }`}
            >
              {t} {t !== "All" && `(${REFERENCE_ASSAY_SCHEMA.filter((s) => s.tissue === t).length})`}
            </button>
          ))}
        </div>

        {/* Comparative Track Table */}
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--cs-border)" }}>
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                <th className="p-3 font-semibold text-cs-text-muted">Biosample / Tissue</th>
                <th className="p-3 font-semibold text-cs-text-muted">Assay Type</th>
                <th className="p-3 font-semibold text-cs-text-muted">Target / Feature</th>
                <th className="p-3 font-semibold text-cs-text-muted">Assay Signal Profile (Reference Benchmark)</th>
                <th className="p-3 font-semibold text-cs-text-muted">Classification</th>
                <th className="p-3 font-semibold text-cs-text-muted text-right">Interactive Track</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--cs-border-subtle)" }}>
              {filteredTracks.map((trk) => (
                <tr key={trk.id} className="hover:bg-indigo-500/5 transition-colors">
                  <td className="p-3">
                    <span className="font-bold text-cs-text-primary block">{trk.biosample}</span>
                    <span className="text-[10px] text-cs-text-muted">{trk.tissue}</span>
                  </td>
                  <td className="p-3 text-cs-text-muted">{trk.assay}</td>
                  <td className="p-3 font-semibold text-cs-accent-clay">{trk.target}</td>
                  <td className="p-3">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{trk.referenceEffect}</span>
                    <span className="block text-[9px] text-cs-text-muted">DeepMind Benchmark Spec</span>
                  </td>
                  <td className="p-3">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold border bg-indigo-500/10 text-indigo-400 border-indigo-500/20">
                      {trk.significanceCategory}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <a
                      href={atlasUrls ? atlasUrls.trackPredictionsUrl : fallbackGeneSearchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-400 font-semibold"
                    >
                      <span>View in Atlas</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SECTION 4: ALPHAGENOME ATLAS DEEP-LINK STUDIO ── */}
      <div
        className="p-6 rounded-2xl border relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(16,185,129,0.04) 100%)",
          borderColor: "var(--cs-border)"
        }}
      >
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-500/15 border border-indigo-500/30">
              <ExternalLink className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h4 className="text-sm font-bold tracking-tight text-cs-text-primary">
                AlphaGenome Atlas Deep-Link Studio
              </h4>
              <p className="text-xs text-cs-text-muted">
                Pre-configured parameter launchpads opening DeepMind's official Atlas viewer with active variant coordinates.
              </p>
            </div>
          </div>

          {atlasUrls ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-2.5 py-1 rounded bg-slate-100 dark:bg-black/30 border border-cs-border-subtle text-indigo-700 dark:text-indigo-300 font-semibold">
                {atlasUrls.variantStr}
              </span>
              <button
                onClick={() => handleCopyVariant(atlasUrls.variantStr)}
                className="p-1.5 rounded border text-cs-text-muted hover:text-cs-text-primary transition-all"
                style={{ borderColor: "var(--cs-border)" }}
                title="Copy variant coordinate string"
              >
                {copiedVariant ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-2.5 py-1 rounded bg-slate-100 dark:bg-black/30 border border-cs-border-subtle text-cs-text-muted">
                Gene: {geneName || "Locus Search"}
              </span>
            </div>
          )}
        </div>

        {/* Launchpad Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          <a
            href={atlasUrls ? atlasUrls.trackPredictionsUrl : fallbackGeneSearchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 rounded-xl border flex flex-col justify-between hover:border-indigo-500 hover:shadow-md transition-all group"
            style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cs-text-primary group-hover:text-indigo-400 transition-colors">
                  Paired Splicing + RNA-seq
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-cs-text-muted group-hover:text-indigo-400 transition-colors" />
              </div>
              <p className="text-[11px] text-cs-text-muted mt-1.5 leading-relaxed">
                Launch comparative pre-mRNA splice junction read alterations and polyA+ transcript level changes in Atlas.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t flex items-center justify-between text-[10px] font-mono text-indigo-500 dark:text-indigo-400 font-semibold" style={{ borderColor: "var(--cs-border-subtle)" }}>
              <span>Track Predictions View</span>
              <span>Launch ↗</span>
            </div>
          </a>

          <a
            href={atlasUrls ? atlasUrls.variantUrl : fallbackGeneSearchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 rounded-xl border flex flex-col justify-between hover:border-indigo-500 hover:shadow-md transition-all group"
            style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cs-text-primary group-hover:text-indigo-400 transition-colors">
                  ChIP-TF Binding Disruption
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-cs-text-muted group-hover:text-indigo-400 transition-colors" />
              </div>
              <p className="text-[11px] text-cs-text-muted mt-1.5 leading-relaxed">
                Inspect transcription factor binding peak destruction, motif affinity shifts, and open chromatin peaks.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t flex items-center justify-between text-[10px] font-mono text-indigo-500 dark:text-indigo-400 font-semibold" style={{ borderColor: "var(--cs-border-subtle)" }}>
              <span>Variant Summary View</span>
              <span>Launch ↗</span>
            </div>
          </a>

          <a
            href={atlasUrls ? atlasUrls.locusUrl : fallbackGeneSearchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 rounded-xl border flex flex-col justify-between hover:border-indigo-500 hover:shadow-md transition-all group"
            style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cs-text-primary group-hover:text-indigo-400 transition-colors">
                  Genomic Locus Viewport
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-cs-text-muted group-hover:text-indigo-400 transition-colors" />
              </div>
              <p className="text-[11px] text-cs-text-muted mt-1.5 leading-relaxed">
                Explore the surrounding &plusmn;20 kb genomic neighborhood with multi-tissue epigenomic signal overlays.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t flex items-center justify-between text-[10px] font-mono text-indigo-500 dark:text-indigo-400 font-semibold" style={{ borderColor: "var(--cs-border-subtle)" }}>
              <span>Locus Window (&plusmn;20 kb)</span>
              <span>Launch ↗</span>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}

export const AlphaGenomeTab = React.memo(AlphaGenomeTabComponent);
