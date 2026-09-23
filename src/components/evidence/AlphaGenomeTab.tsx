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
import { ENGINE_STATE_LABELS, type EngineTone } from "../../shared/engineStatus";
import { resolveSourceAvailability } from "../../shared/evidenceAvailability";

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

/**
 * Presentation only — the *words* come from `ENGINE_STATE_LABELS` via the resolver, so this map can
 * never introduce a status vocabulary of its own.
 *
 * Two deliberate choices, both learned from the design system rather than invented here:
 *
 * 1. **Amber is reserved for clinical severity.** `upstream-error` and `no-result` are system
 *    conditions, and this app already paints "PP3-moderate" amber on the gauge 200px below. A hue
 *    that answers both "how bad is this variant?" and "is the software working?" makes the reader
 *    disambiguate by context, so infrastructure states take the indigo the app already uses for
 *    transport and links. The state is still unmistakable without amber: it carries an icon and a
 *    canonical label word.
 * 2. **The AA-safe badge primitives are reused, not re-derived.** `primitives.css` ships
 *    `cs-badge-good` / `cs-badge-muted` with foreground values chosen to clear WCAG AA at small
 *    text; `layout.css:248-251` records that the raw `--cs-good` / `--cs-warn` roles do *not* at
 *    this size. Hand-rolled `text-emerald-500` / `text-amber-500` on a white surface measure ≈2.5:1
 *    and ≈2.15:1 — below 4.5:1 — so those are gone rather than tuned.
 */
const TONE_CLASSES: Record<EngineTone, string> = {
  good: "cs-badge cs-badge-good",
  muted: "cs-badge cs-badge-muted",
  neutral: "cs-badge border-indigo-500/25 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
  warn: "cs-badge border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  danger: "cs-badge cs-badge-path",
};

/**
 * The SHAP attribution for one modality, or `null` when the model never attributed it.
 *
 * `null` and `0` are different facts and were previously the same value. `0.000` is a measurement
 * meaning "this biological layer contributed nothing to the variant's impact" — a substantive
 * negative result, and the one a clinician most wants to see ruled out. Returning `0` for a missing
 * key made every unmeasured layer indistinguishable from a measured zero, so all 18 cards read as
 * unmeasured whenever the aggregate happened to be flat (standby RCA §2A).
 */
function extractModalityShap(def: ModalityDefinition, featureAttributions: Record<string, number> | null): number | null {
  if (!featureAttributions) return null;
  for (const alias of [def.id, def.name, ...def.aliases]) {
    if (alias in featureAttributions && Number.isFinite(featureAttributions[alias])) {
      return featureAttributions[alias];
    }
  }
  return null;
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

/**
 * The null-result guard lives in this wrapper, which declares no hooks of its own.
 *
 * It previously sat inside the body, above ten `useMemo`/`useCallback` calls — a Rules-of-Hooks
 * violation that is unreachable today (the only host returns before mounting any tab) but that
 * `EvidenceDashboardCard` records as having already crashed once in exactly this shape, and this repo
 * has no eslint to catch the next one. Splitting the component makes the violation unrepresentable
 * rather than merely unreached.
 */
function AlphaGenomeTabComponent({ analysisState }: TabComponentProps) {
  const result = analysisState.result;
  if (!result) return null;
  return <AlphaGenomeTabBody result={result} />;
}

function AlphaGenomeTabBody({
  result,
}: {
  result: NonNullable<TabComponentProps["analysisState"]["result"]>;
}) {
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

  const alphagenome: AlphaGenomeAviData | null = result.conservationData?.alphagenome || null;
  const isLive = alphagenome?.status === "live";
  // Two different facts, previously one flag: a custom endpoint is not a credential. Counting a URL
  // alone as "configured" let a keyless user see a button reading "Key Configured" — a false
  // statement about a credential, on the transport axis where it is merely wrong rather than
  // misleading, but it is still the same class of claim this change is meant to retire.
  const hasAlphaGenomeKey = Boolean(settings.alphagenomeApiKey?.trim());
  const hasAlphaGenomeEndpoint = hasAlphaGenomeKey || Boolean(settings.alphagenomeApiUrl?.trim());

  /**
   * WHY THIS SOURCE HAS NO VALUE — decided by the shared resolver, not by this file.
   *
   * Two facts were previously conflated into one amber badge, and the conflation is what made this
   * panel un-debuggable: transport health (does the key work?) and evidence availability (did a
   * score reach this variant?) are independent, and here they disagreed. `Test Connection` passing
   * proved the credential; the build gate had already declined the coordinate. The panel said
   * "Awaiting API key" and sent the user back to the screen that was never the problem.
   *
   * `availability.action` is what gates the remedy sentence below, and no coverage condition — a
   * build refusal or an unindexed variant — can produce a credential action
   * (see evidenceAvailability.ts).
   */
  const assemblyRefusals = result.conservationData?.assemblyRefusals ?? null;
  const availability = resolveSourceAvailability({
    source: "alphagenome",
    refusals: assemblyRefusals,
    // The value itself, not a per-site boolean: an earlier revision took `hasValue` and this file
    // required `status === "live"` while the predictors panel did not, so two panels could make
    // opposite claims about one payload. A returned score is information even when the flag says
    // the run was imperfect — which is `engineStatus`'s own rule.
    value: alphagenome?.aviPhred ?? null,
    status: alphagenome?.status ?? null,
    // A *tri*-state, and the honest one. The client can only attest to a key it holds: with no key
    // in browser settings the server may still be reading `process.env.ALPHAGENOME_API_KEY`, which
    // this page cannot see. Passing a definite `false` there let an unknown outrank the provider's
    // own message and send a server-keyed deployment to Settings for a plain timeout — the original
    // defect, mirrored. `undefined` means "unknown", and the resolver never infers a missing
    // credential from it.
    configured: settings.alphagenomeApiKey?.trim() ? true : undefined,
    message: alphagenome?.message ?? null,
  });
  const isAssessed = availability.state === "available";

  /**
   * The second, independent axis: did the model attribute the score across modalities?
   *
   * `alphagenome-client.ts` emits `featureAttributions: null` on a **live** result whenever the
   * feature-importance scorer returns nothing. Gating the 18 modality cards on the AVI score alone
   * therefore rendered "AVI assessed" beside eighteen unexplained em-dashes under a subtitle
   * claiming a completed decomposition — silent absence, arriving from a new direction.
   * Attribution gets its own flag and its own sentence.
   */
  const hasAttribution = isAssessed && (alphagenome?.featureAttributions ?? null) !== null;

  /**
   * The status bar's accent follows evidence availability, not the raw live flag. A source that
   * declined a build it never claimed to support is not a fault — alarming the panel invites the
   * user to fix something that cannot be fixed from here. Amber is deliberately absent: it is the
   * gauge's clinical-severity hue, and the two axes must not share a colour.
   */
  const accent = availability.state === "available"
    ? { ring: "rgba(22,163,74,0.3)", wash: "rgba(22,163,74,0.06)", icon: "text-cs-good", iconWash: "rgba(22,163,74,0.12)" }
    : availability.tone === "danger"
    ? { ring: "rgba(185,28,28,0.3)", wash: "rgba(185,28,28,0.05)", icon: "text-cs-danger", iconWash: "rgba(185,28,28,0.12)" }
    : availability.tone === "warn" || availability.tone === "neutral"
    ? { ring: "rgba(99,102,241,0.3)", wash: "rgba(99,102,241,0.05)", icon: "text-indigo-600 dark:text-indigo-300", iconWash: "rgba(99,102,241,0.12)" }
    : { ring: "var(--cs-border)", wash: "rgba(99,102,241,0.05)", icon: "text-cs-text-secondary", iconWash: "rgba(99,102,241,0.10)" };
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

  // Values read straight off the payload; absence is classified once, by `availability` above.
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
          label: "Indeterminate",
          odds: "AVI sits between the BP4 and PP3 bands",
          badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/30"
        };
    }
  };

  /**
   * "Indeterminate" is a clinical conclusion: the model ran and landed between the BP4 and PP3
   * bands. It was previously reachable from a null score as well — `acmgStrength` defaults to
   * `"indeterminate"`, and `calculateAlphaGenomeAcmgStrength(null)` returns `"indeterminate"` too,
   * so absence of evidence and evidence of no effect rendered as one badge and the ClinGen SVI card
   * could not be read. Only an assessed variant may use the tier map now.
   */
  const acmgBadge = isAssessed
    ? getAcmgBadgeConfig(acmgStrength)
    : {
        label: availability.label,
        odds: "No AVI score, so no SVI tier was assigned",
        badgeClass: "bg-slate-500/10 text-slate-400 border-slate-500/30"
      };

  // All 18 modalities, each carrying its attribution or `null` when the model reported none.
  // Nothing is filtered here; the search and tissue controls below belong to the reference-track
  // table further down the page.
  const renderedModalities = useMemo(() => {
    const list = MODALITY_DEFINITIONS.map((def) => {
      const shap = extractModalityShap(def, featureAttributions);
      return {
        ...def,
        shap
      };
    });

    if (modalitySort === "impact") {
      // Unattributed layers sort to the end. With `Math.abs(null)` coercing to 0, an unmeasured
      // layer used to sort *among* the measured ones, so "Sort by Impact" interleaved blanks with
      // real attributions and the ordering claimed a ranking it had not made.
      return list.sort((a, b) => {
        if (a.shap === null && b.shap === null) return 0;
        if (a.shap === null) return 1;
        if (b.shap === null) return -1;
        return Math.abs(b.shap) - Math.abs(a.shap);
      });
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
          background: `linear-gradient(135deg, ${accent.wash} 0%, rgba(99,102,241,0.05) 100%)`,
          borderColor: accent.ring
        }}
      >
        <div className="flex items-start gap-3.5 z-10">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm"
            style={{ background: accent.iconWash, border: `1px solid ${accent.ring}` }}
          >
            <Compass className={`w-5 h-5 ${accent.icon}`} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold tracking-tight text-cs-text-primary">
                AlphaGenome Multimodal Genomic Studio
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Google DeepMind
              </span>
              {/*
                * AXIS 1 — evidence availability for THIS variant. Both words come from
                * `ENGINE_STATE_LABELS`, including the positive state: the first revision wrote
                * "AVI assessed" by hand, which is a status word the guard structurally cannot see
                * (it scans the retired *absence* labels), so the claim "no surface invents a status
                * word" had a hole exactly here and this file fell into it.
                *
                * The tooltip no longer claims attribution was received — attribution is a separate
                * axis (`hasAttribution`) and a live result can carry a score with no feature vector.
                */}
              <span
                className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-mono font-semibold ${isAssessed ? TONE_CLASSES.good : TONE_CLASSES[availability.tone]}`}
                title={availability.reason ?? (isAssessed
                  ? (hasAttribution ? "AVI score and modality attribution received" : "AVI score received; the model returned no modality attribution")
                  : undefined)}
              >
                {isAssessed ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                {isAssessed ? ENGINE_STATE_LABELS.computed : availability.label}
              </span>
              {/*
                * AXIS 2 — transport health, its own badge with its own noun. These facts are
                * independent, and until now they shared a single amber word: the credential
                * verified (296ms, 22 scorers) while the build gate had already declined the
                * coordinate. Two axes make the disagreement legible instead of misleading.
                */}
              {connectionTestResult?.ok && (
                <span
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-mono font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/25"
                  title={`Channel verified to gdmscience.googleapis.com:443 in ${connectionTestResult.latencyMs}ms. Transport health is independent of whether a score reached this variant.`}
                >
                  <Zap className="w-3 h-3" />
                  channel {connectionTestResult.latencyMs}ms · {connectionTestResult.scorersCount ?? 0} scorers
                </span>
              )}
            </div>
            <p className="text-xs text-cs-text-muted mt-1 max-w-3xl leading-relaxed">
              Queries <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-black/10 dark:bg-white/10">gdmscience.googleapis.com:443</code>{" "}
              over TLS with a native gRPC client, returning a calibrated AVI score and 18-modality biological SHAP weights.
            </p>
            {/*
              * ONE explanation, in place of the twenty-odd "Standby" strings this panel used to
              * scatter across four KPI cards, eighteen modality cards and two mechanism cards.
              * Absence is a property of the source and this variant, so it belongs once, at the
              * source — repeating it in every slot that lacked a number manufactured the impression
              * of twenty-five separate problems.
              *
              * The remedy sentence is gated on `availability.action`, which no coverage condition —
              * build refusal or unindexed variant — can set to a credential action.
              */}
            {!isAssessed && (
              <div className="mt-2.5 flex items-start gap-2 max-w-3xl">
                <AlertCircle className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${accent.icon}`} />
                <p className="text-[11.5px] leading-relaxed text-cs-text-secondary">
                  {availability.reason ?? `No AVI score reached this variant (${availability.label}).`}{" "}
                  <span className="text-cs-text-muted">
                    {availability.action === "retry"
                      ? "Re-evaluate the variant to ask the Atlas again."
                      : availability.action === "configure-credentials"
                      ? "Add or check the AlphaGenome credential in Settings, then re-evaluate."
                      : availability.state === "not-covered"
                      ? "No setting changes this."
                      : "No cause was recorded for this absence."}
                  </span>
                </p>
              </div>
            )}
            {/*
              * The attribution axis, stated separately. A live score with no feature vector used to
              * leave eighteen cards showing a bare em-dash under a heading claiming a completed
              * decomposition — the silent absence this change exists to remove, re-entering through
              * a second axis the first revision had not separated.
              */}
            {isAssessed && !hasAttribution && (
              <div className="mt-2 flex items-start gap-2 max-w-3xl">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-cs-text-secondary" />
                <p className="text-[11.5px] leading-relaxed text-cs-text-secondary">
                  The AVI score was returned without modality attributions, so the eighteen layers
                  below are not assessed for this variant — an em-dash means no value was reported,
                  which is different from a measured 0.000.
                </p>
              </div>
            )}
            {/* Locus Coordinate Chip with Copy action */}
            <div className="flex items-center gap-2 mt-2">
              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-black/5 dark:bg-white/5 border border-cs-border text-cs-text-secondary">
                {parsedCoords ? `${parsedCoords.chrom}:${parsedCoords.pos} (${parsedCoords.ref}>${parsedCoords.alt})` : variantNotation}
              </span>
              <button
                onClick={() => handleCopyVariant(parsedCoords ? `${parsedCoords.chrom}:${parsedCoords.pos}:${parsedCoords.ref}:${parsedCoords.alt}` : variantNotation)}
                className="text-[11px] px-1.5 py-1 rounded-md text-cs-text-muted hover:text-cs-text-primary flex items-center gap-1 font-mono transition-[transform,color,background-color,border-color] duration-150 ease-out active:scale-[0.96]"
                title="Copy coordinates"
              >
                {copiedVariant ? <Check className="w-3 h-3 text-cs-good" /> : <Copy className="w-3 h-3" />}
                <span>{copiedVariant ? "Copied" : "Copy"}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 z-10 flex-wrap">
          <button
            onClick={handleTestConnection}
            disabled={isTestingConnection}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-cs-text-primary border transition-[transform,color,background-color,border-color] duration-150 ease-out active:scale-[0.96] disabled:opacity-50"
            style={{ borderColor: "var(--cs-border)" }}
            title="Ping AlphaGenome Atlas API and verify credentials"
          >
            <Activity className={`w-3.5 h-3.5 text-indigo-400 ${isTestingConnection ? "animate-spin" : ""}`} />
            <span>{isTestingConnection ? "Testing..." : "Test Connection"}</span>
          </button>

          <button
            onClick={handleReevaluate}
            disabled={isReevaluating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 transition-[transform,color,background-color,border-color] duration-150 ease-out active:scale-[0.96] disabled:opacity-50"
            title="Re-run variant analysis with active AlphaGenome credentials"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isReevaluating ? "animate-spin" : ""}`} />
            <span>{isReevaluating ? "Evaluating..." : "Re-evaluate Variant"}</span>
          </button>

          <button
            onClick={() => openSettingsTab("connections")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-cs-text-primary border transition-[transform,color,background-color,border-color] duration-150 ease-out active:scale-[0.96]"
            style={{ borderColor: "var(--cs-border)" }}
            title="Open Connections Settings"
          >
            <Key className="w-3.5 h-3.5 text-indigo-400" />
            <span>{hasAlphaGenomeKey ? "Key Configured" : hasAlphaGenomeEndpoint ? "Endpoint Set" : "Configure Key"}</span>
          </button>

          <a
            href={atlasUrls ? atlasUrls.trackPredictionsUrl : fallbackGeneSearchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-[transform,color,background-color,border-color] duration-150 ease-out active:scale-[0.96] shadow-sm hover:shadow"
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
                className="h-full rounded-full transition-[width] duration-500 ease-out"
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
              {/* Decorative marks; their meaning is stated in the legend below rather than left
                  to a `title` that keyboard and touch users never see. */}
              <div aria-hidden className="absolute top-0 bottom-0 left-[16%] w-0.5 bg-slate-400 dark:bg-white/40" />
              <div aria-hidden className="absolute top-0 bottom-0 left-[30%] w-0.5 bg-slate-400 dark:bg-white/40" />
              <div aria-hidden className="absolute top-0 bottom-0 left-[50%] w-0.5 bg-slate-400 dark:bg-white/40" />
              <div aria-hidden className="absolute top-0 bottom-0 left-[70%] w-0.5 bg-slate-400 dark:bg-white/40" />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-cs-text-muted mt-1">
              <span>0 (Benign)</span>
              <span>25 (Mod)</span>
              <span>50 (Deleterious)</span>
            </div>
            <p className="text-[10px] font-mono text-cs-text-muted mt-1">
              Ticks: 8 BP4 · 15 PP3-supporting · 25 PP3-moderate · 35 PP3-strong
            </p>
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
              {/*
                * "—" rather than a status word in the headline slot. This card's largest type is
                * reserved for the measurement; giving it to "Standby" made the absence the most
                * prominent thing on the card and explained nothing. The reason is stated once, at
                * the source, above.
                */}
              <span className={`text-2xl font-bold font-mono tracking-tight ${topPercentile !== null ? "text-cs-text-primary" : "text-cs-text-muted"}`}>
                {topPercentile !== null ? `Top ${topPercentile < 0.01 ? topPercentile.toExponential(2) : topPercentile.toFixed(3)}%` : "—"}
              </span>
            </div>
            <p className="text-xs font-mono text-cs-text-muted mt-1">
              {topPercentile !== null
                ? `1 in ${Math.round(100 / Math.max(topPercentile, 0.00001)).toLocaleString()} human SNVs`
                : "Genome-wide percentile of the AVI score"}
            </p>
          </div>

          <div className="border-t pt-2 flex items-center justify-between text-[11px]" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <span className="text-cs-text-muted">Empirical Quantile</span>
            <span className="font-mono font-semibold text-cs-accent-clay">
              {/* A measured quantile of exactly 0 is a value; the truthiness test here conflated it
                  with absence — the same zero/absent collapse this change removed for SHAP. */}
              {alphagenome?.aviQuantile !== null && alphagenome?.aviQuantile !== undefined
                ? alphagenome.aviQuantile.toFixed(5)
                : "—"}
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
              {/*
                * `{topModality || "Multi-Modal"}` read absence as a finding. "Multi-Modal" sounds
                * like every biological layer contributed; it meant no layer reported — and the two
                * are opposite conclusions a reader cannot tell apart. Same for the "Unified
                * consensus" sub-line that used to sit under it.
                */}
              <span className={`text-lg font-bold tracking-tight truncate ${topModality ? "text-cs-text-primary" : "text-cs-text-muted"}`}>
                {topModality ?? "—"}
              </span>
            </div>
            <p className={`text-xs font-mono mt-1 font-semibold ${topFeatureImportance !== null ? "text-cs-accent-clay" : "text-cs-text-muted"}`}>
              {topFeatureImportance !== null
                ? `${topFeatureImportance >= 0 ? "+" : ""}${topFeatureImportance.toFixed(3)} SHAP weight`
                : "Highest-|SHAP| modality"}
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
          <div className="p-3.5 rounded-lg border bg-cs-surface-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-xs text-cs-text-primary">Protein Structural Impact (AlphaMissense)</span>
              <span className={`font-mono text-xs font-bold ${alphaMissenseShap !== null ? "text-amber-500" : "text-cs-text-muted"}`}>
                {alphaMissenseShap !== null ? `${alphaMissenseShap >= 0 ? "+" : ""}${alphaMissenseShap.toFixed(3)} SHAP` : "—"}
              </span>
            </div>
            <p className="text-[11px] text-cs-text-muted leading-relaxed">
              Reflects perturbation of 3D amino acid fold, hydrophobic packing, and local steric contacts in the translated polypeptide.
            </p>
          </div>

          <div className="p-3.5 rounded-lg border bg-cs-surface-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-xs text-cs-text-primary">Pre-mRNA Splicing Disruption (Splice Sites/Junctions)</span>
              <span className={`font-mono text-xs font-bold ${splicingShap !== null ? "text-pink-500" : "text-cs-text-muted"}`}>
                {splicingShap !== null ? `${splicingShap >= 0 ? "+" : ""}${splicingShap.toFixed(3)} SHAP` : "—"}
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
            <strong>Protocol Safety Mandate:</strong> In adherence with ClinGen SVI and biophysical engine standards, AlphaGenome pre-mRNA splicing predictions are strictly isolated from the missense consensus vote. Missense consensus voting reflects translated protein stability (ΔΔG / structural impact), ensuring splicing and coding mechanisms are evaluated independently without double-counting.
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
              {hasAttribution
                ? "Decomposition of 9,440 functional tracks into human-interpretable biological regulatory drivers."
                : "Eighteen biological layers the AVI score decomposes across — not attributed for this variant."}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div role="group" aria-label="Modality ordering" className="flex items-center rounded-lg border p-0.5 text-xs font-mono" style={{ borderColor: "var(--cs-border)" }}>
              <button
                onClick={() => setModalitySort("impact")}
                aria-pressed={modalitySort === "impact"}
                className={`px-2.5 py-1.5 rounded-md transition-[transform,color,background-color,border-color] duration-150 ease-out active:scale-[0.96] ${
                  modalitySort === "impact"
                    ? "bg-indigo-600 text-white font-semibold"
                    : "text-cs-text-muted hover:text-cs-text-primary"
                }`}
              >
                Sort by Impact
              </button>
              <button
                onClick={() => setModalitySort("tier")}
                aria-pressed={modalitySort === "tier"}
                className={`px-2.5 py-1.5 rounded-md transition-[transform,color,background-color,border-color] duration-150 ease-out active:scale-[0.96] ${
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
              aria-expanded={showEduExplainer}
              className="p-2 rounded-lg border text-cs-text-muted hover:text-cs-text-primary transition-[transform,color,background-color,border-color] duration-150 ease-out active:scale-[0.96] flex items-center gap-1 text-xs"
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
            className="p-4 rounded-lg border mb-6 text-xs leading-relaxed space-y-2"
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
            const hasScore = shapValue !== null;
            const barWidth = shapValue === null ? 0 : Math.min(100, Math.max(4, Math.abs(shapValue) * 200));

            return (
              <div
                key={mod.id}
                className="p-3.5 rounded-lg border flex flex-col justify-between hover:border-indigo-500/30 transition-colors duration-150"
                style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-cs-text-primary">{mod.name}</span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium border"
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
                    <span
                      className="font-mono text-xs font-bold"
                      style={{ color: shapValue !== null ? mod.color : "var(--cs-text-muted)" }}
                    >
                      {shapValue !== null ? `${shapValue >= 0 ? "+" : ""}${shapValue.toFixed(3)}` : "—"}
                    </span>
                    <span className="block text-[10px] font-mono text-cs-text-muted">SHAP</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-3">
                  <div className="w-full bg-slate-200 dark:bg-slate-700/50 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-[width] duration-300 ease-out"
                      style={{
                        width: hasScore ? `${barWidth}%` : "0%",
                        backgroundColor: mod.color
                      }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-[10px] font-mono text-cs-text-muted mt-1">
                    <span>{mod.assay}</span>
                    <span>{shapValue !== null ? `${(shapValue * 100).toFixed(1)}% Rel` : "—"}</span>
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

            <div role="group" aria-label="Filter reference tracks by tissue" className="flex items-center gap-1 overflow-x-auto pb-1 max-w-full">
              {["All", "Liver", "Brain", "Cardiac", "Immune / Blood", "Epithelial"].map((tissue) => (
                <button
                  key={tissue}
                  onClick={() => setSelectedTissue(tissue)}
                  aria-pressed={selectedTissue === tissue}
                  className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-[transform,color,background-color,border-color] duration-150 ease-out active:scale-[0.96] whitespace-nowrap font-medium ${
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
        <div className="mb-4 p-3 rounded-lg border border-cs-border bg-cs-surface-2 text-xs text-cs-text-muted flex items-start gap-2.5">
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
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--cs-border)" }}>
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
            className="p-4 rounded-lg border flex flex-col justify-between hover:border-indigo-500 hover:shadow-md transition-[transform,border-color,box-shadow] duration-150 ease-out active:scale-[0.96] group"
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
            className="p-4 rounded-lg border flex flex-col justify-between hover:border-indigo-500 hover:shadow-md transition-[transform,border-color,box-shadow] duration-150 ease-out active:scale-[0.96] group"
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
            className="p-4 rounded-lg border flex flex-col justify-between hover:border-indigo-500 hover:shadow-md transition-[transform,border-color,box-shadow] duration-150 ease-out active:scale-[0.96] group"
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
