import React, { useState, useMemo, useCallback } from "react";
import {
  ExternalLink,
  Activity,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  HelpCircle,
  Copy,
  Check,
  Search,
  ChevronDown,
  ChevronUp,
  Compass,
  Key,
  RefreshCw,
  Zap,
  ShieldCheck,
  SplitSquareVertical
} from "lucide-react";
import { TabComponentProps } from "./types";
import {
  AlphaGenomeAviData,
  generateAtlasUrls,
  parseGenomicCoordinateString,
  AtlasUrls
} from "../../shared/contracts";
import { useSettings } from "../../context/SettingsContext";
import { useApiClient } from "../../apiClient";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";

export interface ModalityDefinition {
  id: string;
  name: string;
  tier: "Splicing" | "Coding Impact" | "Transcription" | "Chromatin" | "Epigenetics" | "Conservation" | "Structural Variant";
  description: string;
  assay: string;
  color: string;
  aliases: string[];
}

export const MODALITY_DEFINITIONS: ModalityDefinition[] = [
  {
    id: "MERGED_SPLICING",
    name: "Splicing",
    tier: "Splicing",
    description: "Disruption of splice donor/acceptor canonical sites, branchpoints, and exonic splicing enhancers/silencers.",
    assay: "Deep Learning Pre-mRNA Splicing",
    color: "#ec4899", // pink
    aliases: ["fi_MERGED_SPLICING", "Splicing", "SPLICE_SITES", "SPLICE_JUNCTIONS"]
  },
  {
    id: "ALPHAMISSENSE",
    name: "AlphaMissense",
    tier: "Coding Impact",
    description: "Protein-level structural perturbation and amino acid missense substitution pathogenicity embeddings.",
    assay: "DeepMind AlphaFold Structural Model",
    color: "#c46849", // accent clay
    aliases: ["fi_ALPHAMISSENSE", "AlphaMissense"]
  },
  {
    id: "MAX_ABS_RNA_SEQ",
    name: "RNA-seq",
    tier: "Transcription",
    description: "Predicted quantitative transcript abundance divergence across 9,440 human cellular biosamples.",
    assay: "PolyA+ / Total RNA-seq",
    color: "#8b5cf6", // violet
    aliases: ["fi_MAX_ABS_RNA_SEQ", "RNA-seq", "RNA_SEQ"]
  },
  {
    id: "MAX_ABS_ATAC",
    name: "ATAC-seq",
    tier: "Chromatin",
    description: "Disruption of open chromatin accessibility in regulatory DNA regions across cellular types.",
    assay: "ATAC-seq",
    color: "#06b6d4", // cyan
    aliases: ["fi_MAX_ABS_ATAC", "ATAC-seq", "ATAC"]
  },
  {
    id: "MAX_ABS_DNASE",
    name: "DNase-seq",
    tier: "Chromatin",
    description: "DNase I hypersensitive site signal alteration reflecting local chromatin decompaction.",
    assay: "DNase-seq",
    color: "#0284c7", // sky blue
    aliases: ["fi_DNASE", "fi_MAX_ABS_DNASE", "DNase-seq", "DNASE-seq", "DNASE"]
  },
  {
    id: "MAX_ABS_CHIP_TF",
    name: "ChIP-TF",
    tier: "Chromatin",
    description: "Perturbation of transcription factor binding motifs and peak intensities across genome-wide ChIP-seq assays.",
    assay: "ENCODE / TF ChIP-seq",
    color: "#6366f1", // indigo
    aliases: ["fi_CHIP_TF", "fi_MAX_ABS_CHIP_TF", "ChIP-TF", "CHIP_TF"]
  },
  {
    id: "MAX_ABS_CHIP_HISTONE",
    name: "ChIP-Histone",
    tier: "Epigenetics",
    description: "Chromatin modification changes across activating and repressive histone tail marks.",
    assay: "Histone ChIP-seq",
    color: "#3b82f6", // blue
    aliases: ["fi_MAX_ABS_CHIP_HISTONE", "ChIP-Histone", "CHIP_HISTONE"]
  },
  {
    id: "MAX_ABS_CAGE",
    name: "CAGE",
    tier: "Transcription",
    description: "Transcription initiation rate and 5' TSS promoter activity alterations.",
    assay: "Cap Analysis Gene Expression (FANTOM5)",
    color: "#f59e0b", // amber
    aliases: ["fi_CAGE", "fi_MAX_ABS_CAGE", "CAGE"]
  },
  {
    id: "MAX_ABS_PROCAP",
    name: "PRO-cap",
    tier: "Transcription",
    description: "Precision nuclear run-on transcription elongation and nascent RNA synthesis dynamics.",
    assay: "Precision Run-On Capped RNA-seq",
    color: "#d97706", // dark amber
    aliases: ["fi_PROCAP", "fi_MAX_ABS_PROCAP", "PRO-cap", "PROCAP"]
  },
  {
    id: "MAX_ABS_POLYADENYLATION",
    name: "Polyadenylation",
    tier: "Transcription",
    description: "Alternative polyadenylation (APA) signal site selection and 3' UTR cleavage perturbation.",
    assay: "3' End-seq / PolyA-seq",
    color: "#e11d48", // rose
    aliases: ["fi_POLYADENYLATION", "fi_MAX_ABS_POLYADENYLATION", "Polyadenylation", "POLYADENYLATION"]
  },
  {
    id: "MAX_ABS_CONTACT_MAPS",
    name: "3D Genome Contacts",
    tier: "Chromatin",
    description: "Long-range chromatin folding, topological associating domain (TAD) boundaries, and enhancer-promoter loops.",
    assay: "Hi-C / Micro-C",
    color: "#14b8a6", // teal
    aliases: ["fi_CONTACT_MAPS", "fi_MAX_ABS_CONTACT_MAPS", "3D Genome Contacts", "CONTACT_MAPS"]
  },
  {
    id: "CACTUS_241_WAY",
    name: "Cactus (241-way)",
    tier: "Conservation",
    description: "Cross-species evolutionary constraint across 241 placental mammals (Zoonomia alignment).",
    assay: "Progressive Cactus Whole-Genome Alignment",
    color: "#10b981", // emerald
    aliases: ["fi_CACTUS_241_WAY", "Cactus", "Cactus (241-way)"]
  },
  {
    id: "PHASTCONS_470_WAY",
    name: "PhastCons 470",
    tier: "Conservation",
    description: "Multi-vertebrate phylogenetic hidden Markov model conservation across 470 species.",
    assay: "UCSC PhastCons 470-way",
    color: "#059669", // dark emerald
    aliases: ["fi_PHASTCONS_470_WAY", "PhastCons 470", "PHASTCONS_470_WAY"]
  },
  {
    id: "PROTEIN_TERMINATION",
    name: "Protein Termination",
    tier: "Coding Impact",
    description: "Creation of premature stop codons (nonsense mutation) causing truncated protein or NMD.",
    assay: "Coding Sequence Translation",
    color: "#dc2626", // strong red
    aliases: ["fi_PROTEIN_TERMINATION", "Protein Termination", "PROTEIN_TERMINATION"]
  },
  {
    id: "START_LOST",
    name: "Start Lost",
    tier: "Coding Impact",
    description: "Ablation of canonical translation initiation codon (ATG).",
    assay: "Coding Sequence Translation",
    color: "#ea580c", // orange
    aliases: ["fi_START_LOST", "Start Lost", "START_LOST"]
  },
  {
    id: "STOP_LOST",
    name: "Stop Lost",
    tier: "Coding Impact",
    description: "Disruption of translation termination codon resulting in C-terminal extension.",
    assay: "Coding Sequence Translation",
    color: "#ca8a04", // mustard
    aliases: ["fi_STOP_LOST", "Stop Lost", "STOP_LOST"]
  },
  {
    id: "IS_INSERTION",
    name: "Insertion",
    tier: "Structural Variant",
    description: "Inframe or frameshift nucleotide insertion effect on reading frame.",
    assay: "Sequence Topology",
    color: "#475569", // slate
    aliases: ["fi_IS_INSERTION", "Insertion", "IS_INSERTION"]
  },
  {
    id: "IS_DELETION",
    name: "Deletion",
    tier: "Structural Variant",
    description: "Inframe or frameshift nucleotide deletion effect on reading frame.",
    assay: "Sequence Topology",
    color: "#334155", // dark slate
    aliases: ["fi_IS_DELETION", "Deletion", "IS_DELETION"]
  }
];

function extractModalityShap(def: ModalityDefinition, featureAttributions: Record<string, number> | null): number {
  if (!featureAttributions) return 0;
  for (const alias of [def.id, def.name, ...def.aliases]) {
    if (alias in featureAttributions && typeof featureAttributions[alias] === "number") {
      return featureAttributions[alias];
    }
  }
  return 0;
}

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

function AlphaGenomeTabComponent({ analysisState }: TabComponentProps) {
  const [selectedTissue, setSelectedTissue] = useState<string>("All");
  const [trackSearch, setTrackSearch] = useState<string>("");
  const [modalitySort, setModalitySort] = useState<"tier" | "impact">("impact");
  const [showEduExplainer, setShowEduExplainer] = useState<boolean>(false);
  const [copiedVariant, setCopiedVariant] = useState<boolean>(false);

  // Connection testing state
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    ok: boolean;
    latencyMs: number;
    scorersCount?: number;
    error?: string;
    mode?: string;
  } | null>(null);

  // In-situ re-evaluation state
  const [isReevaluating, setIsReevaluating] = useState<boolean>(false);
  const [reevalError, setReevalError] = useState<string | null>(null);

  const { settings, openSettingsTab } = useSettings();
  const { fetchWithAuth } = useApiClient();

  const result = analysisState.result;
  if (!result) return null;

  const alphagenome: AlphaGenomeAviData | null = result.conservationData?.alphagenome || null;
  const isLive = alphagenome?.status === "live";
  const hasConfiguredKey = Boolean(settings.alphagenomeApiKey?.trim() || settings.alphagenomeApiUrl?.trim());
  const geneName = result.metadata?.gene || "";
  const variantNotation = result.metadata?.variant || "";

  // Robust coordinate resolution across predictorData and variant notation
  const parsedCoords = useMemo(() => {
    const fromPredictor = parseGenomicCoordinateString(result.predictorData?.gnomadVariantId);
    if (fromPredictor) return fromPredictor;

    const fromVariant = parseGenomicCoordinateString(variantNotation);
    if (fromVariant) return fromVariant;

    return null;
  }, [result.predictorData?.gnomadVariantId, variantNotation]);

  const atlasUrls: AtlasUrls | null = useMemo(() => {
    if (parsedCoords && parsedCoords.chrom && parsedCoords.pos && parsedCoords.ref && parsedCoords.alt) {
      return generateAtlasUrls(parsedCoords.chrom, parsedCoords.pos, parsedCoords.ref, parsedCoords.alt);
    }
    return null;
  }, [parsedCoords]);

  const fallbackGeneSearchUrl = useMemo(() => {
    return `https://deepmind.google.com/science/alphagenome/atlas/variant?q=${encodeURIComponent(geneName)}`;
  }, [geneName]);

  const handleCopyVariant = useCallback((varStr: string) => {
    navigator.clipboard.writeText(varStr).then(() => {
      setCopiedVariant(true);
      setTimeout(() => setCopiedVariant(false), 2000);
    });
  }, []);

  const handleTestConnection = useCallback(async () => {
    setIsTestingConnection(true);
    setConnectionTestResult(null);
    try {
      const res = await fetchWithAuth("/api/v1/alphagenome/verify-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await res.json();
      const rawError = data?.error;
      const errorMsg =
        typeof rawError === "object"
          ? rawError?.message || JSON.stringify(rawError)
          : typeof rawError === "string"
            ? rawError
            : !res.ok
              ? `HTTP ${res.status}`
              : undefined;

      setConnectionTestResult({
        ok: Boolean(data?.ok),
        latencyMs: data?.latencyMs ?? 0,
        scorersCount: data?.scorersCount,
        mode: data?.mode,
        error: errorMsg
      });
    } catch (err: any) {
      setConnectionTestResult({
        ok: false,
        latencyMs: 0,
        error: err.message || "Network error testing connection"
      });
    } finally {
      setIsTestingConnection(false);
    }
  }, [fetchWithAuth]);

  const handleReevaluate = useCallback(async () => {
    setIsReevaluating(true);
    setReevalError(null);
    try {
      const res = await fetchWithAuth("/api/v1/analyze-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gene: geneName,
          variant: variantNotation,
          uniprotId: result.metadata?.uniprotId || undefined
        })
      });
      if (!res.ok) {
        throw new Error(`Re-evaluation returned HTTP status ${res.status}`);
      }
      const data = await res.json();
      if (data?.conservationData) {
        useVariantAnalysisStore.getState().updateAnalysisResultSlice(
          "conservationData",
          data.conservationData,
          variantNotation
        );
      }
      if (data?.ruleBasedInsights) {
        useVariantAnalysisStore.getState().updateAnalysisResultSlice(
          "ruleBasedInsights",
          data.ruleBasedInsights,
          variantNotation
        );
      }
    } catch (err: any) {
      setReevalError(err.message || "Failed to re-evaluate variant");
    } finally {
      setIsReevaluating(false);
    }
  }, [fetchWithAuth, geneName, variantNotation, result.metadata?.uniprotId]);

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
          label: "Indeterminate / Standby",
          odds: "Non-discriminatory continuous score",
          badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/30"
        };
    }
  };

  const acmgBadge = getAcmgBadgeConfig(acmgStrength);

  // Filtered modalities with scores
  const renderedModalities = useMemo(() => {
    const list = MODALITY_DEFINITIONS.map((def) => {
      const shap = extractModalityShap(def, featureAttributions);
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

  // Dual-mechanism detection (Splicing vs Coding)
  const splicingShap = useMemo(() => {
    const spliceDef = MODALITY_DEFINITIONS.find((m) => m.id === "MERGED_SPLICING")!;
    return extractModalityShap(spliceDef, featureAttributions);
  }, [featureAttributions]);

  const alphaMissenseShap = useMemo(() => {
    const amDef = MODALITY_DEFINITIONS.find((m) => m.id === "ALPHAMISSENSE")!;
    return extractModalityShap(amDef, featureAttributions);
  }, [featureAttributions]);

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
      {/* ── CONNECTION & STATUS DIAGNOSTIC BAR ── */}
      <div
        className="p-4 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-4 relative overflow-hidden"
        style={{
          background: isLive
            ? "linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(99,102,241,0.06) 100%)"
            : "linear-gradient(135deg, rgba(245,158,11,0.06) 0%, rgba(99,102,241,0.06) 100%)",
          borderColor: isLive ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"
        }}
      >
        <div className="flex items-start gap-3.5 z-10">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm"
            style={{
              background: isLive ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)",
              border: `1px solid ${isLive ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"}`
            }}
          >
            <Compass className={`w-5 h-5 ${isLive ? "text-emerald-500" : "text-amber-500"}`} />
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
                  <CheckCircle2 className="w-3 h-3" /> Live gRPC Channel
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Standby (Direct Atlas Mode)
                </span>
              )}
              {connectionTestResult?.ok && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" /> {connectionTestResult.latencyMs}ms ({connectionTestResult.scorersCount ?? 0} Scorers)
                </span>
              )}
            </div>
            <p className="text-xs text-cs-text-muted mt-1 max-w-3xl leading-relaxed">
              Native gRPC client connected directly to <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-black/10 dark:bg-white/10">gdmscience.googleapis.com:443</code> over TLS.
              Continuous calibrated AVI scores and 18-modality biological SHAP weights.
            </p>
            {/* Locus Coordinate Chip with Copy action */}
            <div className="flex items-center gap-2 mt-2">
              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-black/5 dark:bg-white/5 border border-cs-border text-cs-text-secondary">
                {parsedCoords ? `${parsedCoords.chrom}:${parsedCoords.pos} (${parsedCoords.ref}>${parsedCoords.alt})` : variantNotation}
              </span>
              <button
                onClick={() => handleCopyVariant(parsedCoords ? `${parsedCoords.chrom}:${parsedCoords.pos}:${parsedCoords.ref}:${parsedCoords.alt}` : variantNotation)}
                className="text-[11px] text-cs-text-muted hover:text-cs-text-primary flex items-center gap-1 font-mono transition-colors"
                title="Copy coordinates"
              >
                {copiedVariant ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copiedVariant ? "Copied" : "Copy"}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 z-10 flex-wrap">
          <button
            onClick={handleTestConnection}
            disabled={isTestingConnection}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-cs-text-primary border transition-all disabled:opacity-50"
            style={{ borderColor: "var(--cs-border)" }}
            title="Ping AlphaGenome Atlas API and verify credentials"
          >
            <Activity className={`w-3.5 h-3.5 text-indigo-400 ${isTestingConnection ? "animate-spin" : ""}`} />
            <span>{isTestingConnection ? "Testing..." : "Test Connection"}</span>
          </button>

          <button
            onClick={handleReevaluate}
            disabled={isReevaluating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 transition-all disabled:opacity-50"
            title="Re-run variant analysis with active AlphaGenome credentials"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isReevaluating ? "animate-spin" : ""}`} />
            <span>{isReevaluating ? "Evaluating..." : "Re-evaluate Variant"}</span>
          </button>

          <button
            onClick={() => openSettingsTab("connections")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-cs-text-primary border transition-all"
            style={{ borderColor: "var(--cs-border)" }}
            title="Open Connections Settings"
          >
            <Key className="w-3.5 h-3.5 text-indigo-400" />
            <span>{hasConfiguredKey ? "Key Configured" : "Configure Key"}</span>
          </button>

          <a
            href={atlasUrls ? atlasUrls.trackPredictionsUrl : fallbackGeneSearchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-sm hover:shadow"
          >
            <span>DeepMind Atlas</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Connection Test Error Banner */}
      {connectionTestResult && !connectionTestResult.ok && (
        <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span><strong>Connection Verification Failed:</strong> {String(connectionTestResult.error || "Unknown error")}</span>
          </div>
          <button
            onClick={() => openSettingsTab("connections")}
            className="underline font-semibold hover:text-rose-300 flex-shrink-0"
          >
            Review Key in Settings
          </button>
        </div>
      )}

      {/* Re-evaluation Error Banner */}
      {reevalError && (
        <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span><strong>Re-evaluation Error:</strong> {reevalError}</span>
        </div>
      )}

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

            {/* Phred Gauge with calibrated thresholds */}
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
                : "Awaiting API key for exact rank"}
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

      {/* ── SECTION 2: DUAL-MECHANISM RESOLVER (CODING VS SPLICING) ── */}
      <div
        className="p-5 rounded-2xl border"
        style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <SplitSquareVertical className="w-4 h-4 text-indigo-400" />
            <h4 className="text-xs font-bold tracking-tight text-cs-text-primary uppercase">
              Dual-Mechanism Resolution: Coding Missense vs Pre-mRNA Splicing
            </h4>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded font-mono font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            Biophysical Isolation Rule
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3.5 rounded-xl border bg-cs-surface-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-xs text-cs-text-primary">Protein Structural Impact (AlphaMissense)</span>
              <span className="font-mono text-xs font-bold text-amber-500">
                {alphaMissenseShap !== 0 ? `${alphaMissenseShap >= 0 ? "+" : ""}${alphaMissenseShap.toFixed(3)} SHAP` : "Standby"}
              </span>
            </div>
            <p className="text-[11px] text-cs-text-muted leading-relaxed">
              Reflects perturbation of 3D amino acid fold, hydrophobic packing, and local steric contacts in the translated polypeptide.
            </p>
          </div>

          <div className="p-3.5 rounded-xl border bg-cs-surface-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-xs text-cs-text-primary">Pre-mRNA Splicing Disruption (Splice Sites/Junctions)</span>
              <span className="font-mono text-xs font-bold text-pink-500">
                {splicingShap !== 0 ? `${splicingShap >= 0 ? "+" : ""}${splicingShap.toFixed(3)} SHAP` : "Standby"}
              </span>
            </div>
            <p className="text-[11px] text-cs-text-muted leading-relaxed">
              Reflects nuclear pre-mRNA processing disruption (donor/acceptor sites or cryptic splicing) independent of amino acid translation.
            </p>
          </div>
        </div>

        <div className="mt-3.5 p-2.5 rounded-lg border bg-slate-50 dark:bg-slate-900/40 text-[11px] text-cs-text-muted flex items-start gap-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
          <ShieldCheck className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
          <span>
            <strong>Protocol Safety Mandate:</strong> In adherence with ClinGen SVI and biophysical engine standards, AlphaGenome pre-mRNA splicing predictions are strictly isolated from the missense consensus vote. Missense consensus voting reflects translated protein stability ($\Delta\Delta G$ / structural impact), ensuring splicing and coding mechanisms are evaluated independently without double-counting.
          </span>
        </div>
      </div>

      {/* ── SECTION 3: 18-MODALITY BIOLOGICAL FEATURE ATTRIBUTION SPECTRUM ── */}
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {renderedModalities.map((mod) => {
            const shapValue = mod.shap;
            const hasScore = isLive && shapValue !== 0;
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
                    <span>{hasScore ? `${(shapValue * 100).toFixed(1)}% Rel` : "—"}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── SECTION 4: 9,440-TRACK ASSAY ARCHITECTURE & REFERENCE PROFILES ── */}
      <div
        className="p-6 rounded-2xl border"
        style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold tracking-tight text-cs-text-primary">
                Multi-Tissue Epigenomic & Splicing Track Predictions
              </h4>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold">
                9,440 Assays
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-amber-500/10 text-amber-500 border border-amber-500/20 font-semibold">
                Reference Schema (Illustrative)
              </span>
            </div>
            <p className="text-xs text-cs-text-muted mt-0.5">
              Profiles across primary human tissues, ENCODE cell lines, and Roadmap Epigenomics biosamples.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-cs-text-muted" />
              <input
                type="text"
                value={trackSearch}
                onChange={(e) => setTrackSearch(e.target.value)}
                placeholder="Filter biosample or assay..."
                className="pl-8 pr-3 py-1 text-xs rounded-lg border bg-transparent text-cs-text-primary placeholder:text-cs-text-muted focus:outline-none focus:ring-1 focus:ring-indigo-500"
                style={{ borderColor: "var(--cs-border)" }}
              />
            </div>

            <div className="flex items-center gap-1 overflow-x-auto pb-1 max-w-full">
              {["All", "Liver", "Brain", "Cardiac", "Immune / Blood", "Epithelial"].map((tissue) => (
                <button
                  key={tissue}
                  onClick={() => setSelectedTissue(tissue)}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all whitespace-nowrap font-medium ${
                    selectedTissue === tissue
                      ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                      : "border-cs-border text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-surface-2"
                  }`}
                  style={{ borderColor: selectedTissue === tissue ? undefined : "var(--cs-border)" }}
                >
                  {tissue}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Protocol Disclaimer & Direct DeepMind Launcher Notice */}
        <div className="mb-4 p-3 rounded-xl border border-cs-border bg-cs-surface-2 text-xs text-cs-text-muted flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>Assay Reference Architecture:</strong> The tracks below illustrate DeepMind AlphaGenome&apos;s multimodal output schema across 10 key biological categories. In accordance with the project&apos;s Strict No-Heuristics Policy, variant-specific continuous signal tracks across all 9,440 tissue assays are viewed directly in the Sovereign{" "}
            <a
              href={atlasUrls ? atlasUrls.trackPredictionsUrl : fallbackGeneSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 underline font-semibold hover:text-indigo-300 inline-flex items-center gap-1"
            >
              DeepMind Atlas 9,440 Track Viewer <ExternalLink className="w-3 h-3" />
            </a>.
          </p>
        </div>

        {/* Tracks Table */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cs-border)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead
                className="border-b text-cs-text-muted font-mono uppercase text-[10px] tracking-wider"
                style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}
              >
                <tr>
                  <th className="py-2.5 px-3.5">Assay Category</th>
                  <th className="py-2.5 px-3.5">Biosample / Tissue</th>
                  <th className="py-2.5 px-3.5">Molecular Target</th>
                  <th className="py-2.5 px-3.5">Significance Class</th>
                  <th className="py-2.5 px-3.5 text-right">Reference Effect Size</th>
                </tr>
              </thead>
              <tbody className="divide-y font-mono text-[11px]" style={{ borderColor: "var(--cs-border-subtle)" }}>
                {filteredTracks.map((trk) => (
                  <tr key={trk.id} className="hover:bg-indigo-500/5 transition-colors">
                    <td className="py-2.5 px-3.5 font-sans font-medium text-cs-text-primary">
                      {trk.assay}
                    </td>
                    <td className="py-2.5 px-3.5 text-cs-text-muted">
                      {trk.biosample} ({trk.tissue})
                    </td>
                    <td className="py-2.5 px-3.5 text-indigo-400">
                      {trk.target}
                    </td>
                    <td className="py-2.5 px-3.5">
                      <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-cs-surface border border-cs-border text-cs-text-muted">
                        {trk.significanceCategory}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-semibold text-cs-text-primary">
                      {trk.referenceEffect}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── SECTION 5: EXTERNAL PORTALS & ATLAS WORKSPACE LAUNCHERS ── */}
      <div
        className="p-6 rounded-2xl border"
        style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ExternalLink className="w-4 h-4 text-indigo-400" />
            <h4 className="text-xs font-bold tracking-tight text-cs-text-primary uppercase">
              DeepMind AlphaGenome Workspace Launchers
            </h4>
          </div>
          <span className="text-[10px] font-mono text-cs-text-muted">
            Authenticated URL Generation
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  9,440 Track Viewer
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-cs-text-muted group-hover:text-indigo-400 transition-colors" />
              </div>
              <p className="text-[11px] text-cs-text-muted mt-1.5 leading-relaxed">
                Inspect raw continuous signal tracks across RNA-seq, CAGE, ChIP-TF, DNase-seq, and splicing assays.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t flex items-center justify-between text-[10px] font-mono text-indigo-500 dark:text-indigo-400 font-semibold" style={{ borderColor: "var(--cs-border-subtle)" }}>
              <span>Track Predictions</span>
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
                  Variant Impact Overview
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
