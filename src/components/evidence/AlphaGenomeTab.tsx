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
  RefreshCw,
  Zap,
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
 * Which modality tiers describe a MECHANISM, and which describe CONSTRAINT.
 *
 * This split exists because the panel used to take `argmax |SHAP|` across all eighteen layers and
 * call the winner the "Leading Driver". For ACOT9 p.Ser489Cys that elected **Cactus** — the 241-way
 * placental-mammal conservation alignment — at +0.531, seven times the coding signal the
 * dual-mechanism panel below was discussing. Three things are wrong with presenting that as a driver:
 *
 *   1. **Category error.** Conservation is not a mechanism and not "regulatory disruption". It is
 *      evidence that the position matters. Conservation does not cause the variant's effect; it is a
 *      consequence of the constraint the effect reveals.
 *   2. **Two framings disagreeing on one screen.** The resolver below isolates coding vs splicing;
 *      the hero ran an eighteen-way argmax and returned something in neither category, so a reader
 *      cannot tell whether this variant is a conservation, coding or splicing story.
 *   3. **It restates the header.** Cactus scores high *because* the residue is constrained — which is
 *      the same fact the header already reports as MISSENSE Z +4.41 / Severe intolerance, expressed
 *      in SHAP units. A conservation value in the "driver" slot is near-circular with the gauge above.
 *
 * A conservation track is still worth showing — it is genuine corroboration that this position is
 * intolerant. It just must not outrank a mechanism in the mechanism's own slot.
 */
const MECHANISM_TIERS: ReadonlyArray<ModalityDefinition["tier"]> = [
  "Splicing",
  "Coding Impact",
  "Transcription",
  "Chromatin",
  "Epigenetics",
];

/**
 * Tiers that report evolutionary constraint rather than a mechanism.
 *
 * `"Structural Variant"` was in this list and does not belong: `IS_INSERTION` / `IS_DELETION` are
 * variant-class features, not conservation. With the footer hardcoding "conservation evidence", a
 * leading deletion rendered as "Constraint corroboration: Deletion +0.440 — conservation evidence,
 * not a mechanism" — the same category error this split exists to remove. Structural-variant
 * features are now in neither slot: an indel feature is neither a mechanism for a missense
 * substitution nor constraint, so the card declines to name it.
 */
const CONSTRAINT_TIERS: ReadonlyArray<ModalityDefinition["tier"]> = ["Conservation"];

/**
 * The smallest |SHAP| that may be presented as a leading mechanism.
 *
 * `pickTopModality` elects the largest magnitude present, so an all-zero vector elects a mechanism
 * at exactly 0.000 — the zero-as-finding defect this panel has already removed twice (unmeasured vs
 * measured-0, for both SHAP and `aviQuantile`). `splicingEvidence` carries a dominance floor for the
 * same reason; this mirrors it. Below the floor the card says the mechanism is unresolved rather
 * than naming a layer that contributed nothing.
 *
 * This is not cosmetic for the variant that prompted the fix: Cactus +0.531 carries 86% of the
 * attributed score and is 7× the coding signal, and the Atlas's own reading of a
 * conservation-dominated vector is that the molecular mechanism is *not* resolved by the AVI. The
 * card now says so instead of promoting AlphaMissense +0.076 into the headline.
 */
const MECHANISM_SHAP_FLOOR = 0.25;

/**
 * Largest-magnitude attribution within the given tiers, or `null` when none was measured.
 *
 * Unattributed layers are skipped rather than treated as zero, so a tier with no data cannot win by
 * default — the same zero-is-not-absent rule the rest of this panel applies.
 */
function pickTopModality(
  list: ReadonlyArray<{ name: string; tier: ModalityDefinition["tier"]; shap: number | null }>,
  tiers: ReadonlyArray<ModalityDefinition["tier"]>,
): { name: string; shap: number } | null {
  let best: { name: string; shap: number } | null = null;
  for (const m of list) {
    if (m.shap === null || !tiers.includes(m.tier)) continue;
    if (best === null || Math.abs(m.shap) > Math.abs(best.shap)) best = { name: m.name, shap: m.shap };
  }
  return best;
}

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
  // Defaults to tier order, not impact order. Impact order is the raw argmax framing — the one that
  // let a conservation track lead the panel (see MECHANISM_TIERS). Tier order puts the mechanism
  // layers first and constraint last, so the spectrum reads the same way the hero does.
  const [modalitySort, setModalitySort] = useState<"tier" | "impact">("tier");
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
   * The state's icon colour follows evidence availability, not the raw live flag. A source that
   * declined a build it never claimed to support is not a fault — alarming the panel invites the
   * user to fix something that cannot be fixed from here. Amber is deliberately absent: it is the
   * gauge's clinical-severity hue, and the two axes must not share a colour.
   *
   * Reduced from a four-property accent object to one class when the gradient hero was removed —
   * the ring and wash values existed only to paint it.
   */
  const stateIconClass = availability.state === "available"
    ? "text-cs-good"
    : availability.tone === "danger"
    ? "text-cs-danger"
    : availability.tone === "warn" || availability.tone === "neutral"
    ? "text-indigo-600 dark:text-indigo-300"
    : "text-cs-text-secondary";
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
  // `topModality` / `topFeatureImportance` are deliberately NOT read from the payload any more: the
  // server's value is an argmax across all eighteen layers including conservation, which is the
  // category error MECHANISM_TIERS exists to fix. The card derives its own from the tiered list.
  const acmgStrength = alphagenome?.acmgStrength ?? "indeterminate";
  const featureAttributions = alphagenome?.featureAttributions ?? null;

  /**
   * ONE source of truth for AVI severity colour, shared by the number, the status dot and the gauge
   * fill.
   *
   * Three sites previously derived this independently from raw palette values, which is how the dot
   * could read "good" green over an amber bar for the same Phred — and how the number came to be
   * painted at 1.92:1 (yellow-500), 2.15:1 (amber-500) and 2.54:1 (emerald-500) against its own
   * surface, while this file's comment claimed those exact values were "gone rather than tuned".
   *
   * Token-based, so both themes get the project's contrast-tuned values. Bands mirror
   * `calculateAlphaGenomeAcmgStrength`: ≤ 8 BP4, 9–14 indeterminate, ≥ 15 PP3-supporting,
   * ≥ 25 PP3-moderate, ≥ 35 PP3-strong. The two PP3 tiers share a token because the palette carries
   * one AA-safe warm value; both are PP3, so no clinical distinction is lost.
   */
  const phredBand = (val: number | null) => {
    if (val === null || val < 0) return { text: "text-cs-text-muted", fill: "var(--cs-text-muted)" };
    if (val >= 35) return { text: "text-cs-danger", fill: "var(--cs-danger)" };
    if (val >= 15) return { text: "text-cs-warn", fill: "var(--cs-warn)" };
    if (val <= 8) return { text: "text-cs-good", fill: "var(--cs-good)" };
    return { text: "text-cs-text-muted", fill: "var(--cs-border)" };
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

    // Tier order: mechanism tiers first, constraint last, and anything in neither bucket between
    // them. The spectrum's subtitle claims conservation is shown last and, before this, it was not —
    // the default was plain declaration order, in which Cactus and PhastCons sit at positions 12 and
    // 13 of 18 with five Coding Impact and Structural Variant entries after them. Stable, so the
    // declared order within a bucket survives.
    const bucket = (tier: ModalityDefinition["tier"]) =>
      MECHANISM_TIERS.includes(tier) ? 0 : CONSTRAINT_TIERS.includes(tier) ? 2 : 1;
    return [...list].sort((a, b) => bucket(a.tier) - bucket(b.tier));
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

  /**
   * The mechanism and the constraint, ranked separately and never against each other.
   * See MECHANISM_TIERS for why the raw eighteen-way argmax was wrong here, and
   * MECHANISM_SHAP_FLOOR for why a measured-but-negligible mechanism is reported as unresolved.
   */
  const leadingMechanismRaw = useMemo(
    () => pickTopModality(renderedModalities, MECHANISM_TIERS),
    [renderedModalities],
  );
  const leadingMechanism = useMemo(
    () => (leadingMechanismRaw && Math.abs(leadingMechanismRaw.shap) >= MECHANISM_SHAP_FLOOR ? leadingMechanismRaw : null),
    [leadingMechanismRaw],
  );
  /** True when a mechanism WAS attributed but sits below the floor — a different fact from "none". */
  const mechanismBelowFloor = leadingMechanismRaw !== null && leadingMechanism === null;
  const leadingConstraint = useMemo(
    () => pickTopModality(renderedModalities, CONSTRAINT_TIERS),
    [renderedModalities],
  );

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
      {/*
        ── SOURCE STRIP ──
        * Replaces a full-width hero card whose dominant feature was a 135° indigo gradient wash —
        * the single most recognisable AI-generated-design fingerprint. It also carried an icon tile,
        * a "Google DeepMind" pill, two paragraphs of transport provenance, a coordinate chip that
        * duplicated the variant header, and four equal-weight buttons competing with the numbers.
        *
        * What a reader needs *at the data* is the source, its state, and — when there is no score —
        * why. Provenance and diagnostics belong in the inspector beside this panel; the Atlas
        * deep-links live once, in the launcher row at the bottom. So: a flat strip on the ordinary
        * surface, no gradient, no elevation, one hairline.
        */}
      <div
        className="px-3 py-2 rounded-lg border flex flex-col md:flex-row md:items-center justify-between gap-3"
        style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface-2)" }}
      >
        <div className="flex items-start gap-3.5 min-w-0">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Plain name, sentence case. "Multimodal Genomic Studio" and the "Google DeepMind"
                  pill carried nothing a reader needed, and "DeepMind" already appeared twice more in
                  this viewport (the transport prose, then the Atlas launcher row). */}
              <h3 className="text-sm font-semibold tracking-tight text-cs-text-primary">
                AlphaGenome Atlas
              </h3>
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
                className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md font-mono font-semibold ${isAssessed ? TONE_CLASSES.good : TONE_CLASSES[availability.tone]}`}
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
                  className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md font-mono font-semibold bg-indigo-500/10 text-indigo-400"
                  title={`Channel verified to gdmscience.googleapis.com:443 in ${connectionTestResult.latencyMs}ms. Transport health is independent of whether a score reached this variant.`}
                >
                  <Zap className="w-3 h-3" />
                  channel {connectionTestResult.latencyMs}ms · {connectionTestResult.scorersCount ?? 0} scorers
                </span>
              )}
            </div>
            {/* The transport paragraph that lived here ("Queries gdmscience.googleapis.com:443 over
                TLS with a native gRPC client…") is provenance, not a finding. It now sits in the
                inspector beside this panel, where a reader goes to ask how a number was obtained. */}
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
              <div className="mt-2 flex items-start gap-2 max-w-[62ch]">
                <AlertCircle className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${stateIconClass}`} />
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
              <div className="mt-2 flex items-start gap-2 max-w-[62ch]">
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

        {/*
          Actions, demoted out of the data's way. Four equal-weight buttons sat here: "Test
          Connection" (a diagnostic used roughly once ever), "Re-evaluate Variant" (a second copy of
          the app's main analysis action, already available in the header), "Key Configured" (a
          *state* rendered as a button) and "DeepMind Atlas" (the one real call to action, which the
          launcher row at the bottom already provides, three links deep).
          So: two icon-sized diagnostics and one small text affordance. No button at hero weight.
        */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handleTestConnection}
            disabled={isTestingConnection}
            aria-label="Test the AlphaGenome connection"
            title="Ping the Atlas gRPC endpoint and verify credentials"
            className="p-1.5 rounded-md text-cs-text-muted hover:text-cs-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-[transform,color,background-color] duration-150 ease-out active:scale-[0.96] disabled:opacity-50"
          >
            <Activity className={`w-3.5 h-3.5 ${isTestingConnection ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={handleReevaluate}
            disabled={isReevaluating}
            aria-label="Re-evaluate this variant"
            title="Re-run variant analysis with the active credentials"
            className="p-1.5 rounded-md text-cs-text-muted hover:text-cs-text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-[transform,color,background-color] duration-150 ease-out active:scale-[0.96] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReevaluating ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => openSettingsTab("connections")}
            title="Open Connections Settings"
            className="ml-1 font-mono text-[10px] px-1.5 py-1 rounded-md text-cs-text-muted hover:text-cs-text-primary transition-colors duration-150"
          >
            {hasAlphaGenomeKey ? "key set" : hasAlphaGenomeEndpoint ? "endpoint set" : "configure key"}
          </button>
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

      {/*
        ── SECTION 1: THE FOUR NUMBERS ──
        * Was a symmetric four-up card grid — the most generic dashboard layout there is, and it gave
        * the derived percentile exactly as much visual authority as the measurement itself. The AVI
        * Phred now spans two of five columns and carries the largest type on the panel; the other
        * three are supporting facts. Labels drop their ALL-CAPS tracking: sentence case reads as
        * data, small-caps-everywhere reads as decoration.
        */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Card 1: AVI Phred Score — the measurement, given the room to be one. */}
        <div
          className="p-4 rounded-lg border flex flex-col justify-between lg:col-span-2"
          style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border-subtle)" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium tracking-wide text-cs-text-muted">
              Calibrated AVI Phred
            </span>
            {/* Token-driven, not raw palette: the project's own severity tokens are the ones tuned
                to clear contrast on these surfaces. */}
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: phredBand(aviPhred).fill }}
            />
          </div>

          <div className="my-3">
            <div className="flex items-baseline gap-2">
              <span className={`text-4xl font-bold font-mono tracking-tight tabular-nums ${phredBand(aviPhred).text}`}>
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
                  background: phredBand(aviPhred).fill
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
          className="p-4 rounded-lg border flex flex-col justify-between"
          style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium tracking-wide text-cs-text-muted">
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

        {/* Card 3: Leading mechanism — with the constraint evidence named separately.
            The raw eighteen-way argmax is deliberately not used here; see MECHANISM_TIERS. */}
        <div
          className="p-4 rounded-lg border flex flex-col justify-between"
          style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border-subtle)" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium tracking-wide text-cs-text-muted">
              Leading mechanism
            </span>
            {leadingMechanism && <Sparkles className="w-3.5 h-3.5 text-cs-text-muted" />}
          </div>

          <div className="my-3">
            {/*
              * `{topModality || "Multi-Modal"}` read absence as a finding: "Multi-Modal" sounds like
              * every layer contributed, and meant that none reported. And when a score WAS present it
              * was the raw argmax across all eighteen layers, which could elect a conservation track
              * and label it "Primary biological regulatory disruption" — a category error, since
              * conservation is not a mechanism (see MECHANISM_TIERS).
              */}
            <span className={`block text-lg font-semibold tracking-tight truncate ${leadingMechanism ? "text-cs-text-primary" : "text-cs-text-muted"}`}>
              {leadingMechanism?.name ?? "—"}
            </span>
            <p className={`text-xs font-mono mt-1 ${leadingMechanism ? "text-cs-text-secondary" : "text-cs-text-muted"}`}>
              {leadingMechanism
                ? `${leadingMechanism.shap >= 0 ? "+" : ""}${leadingMechanism.shap.toFixed(3)} signed SHAP`
                : mechanismBelowFloor
                ? `No feature above ${MECHANISM_SHAP_FLOOR.toFixed(2)} |SHAP| — mechanism not resolved`
                : "Largest attribution across coding, splicing and regulatory features"}
            </p>
          </div>

          {/*
            The reconciliation with the coding/splicing panel below.
            *
            * The word "corroboration" is gone. Nothing computed a relationship between the two
            * numbers; the only computed fact is which magnitude is larger, and that fires precisely
            * when constraint DOMINATES — so "corroborates" asserted an agreement the code never
            * established. What is true, and what the Atlas itself says of a conservation-dominated
            * vector, is that the mechanism is unresolved.
            *
            * The fallback also no longer claims "coding, splicing and regulatory layers only" when
            * NOTHING was attributed, which was reachable from a live payload with a null feature
            * vector.
          */}
          <p className="text-[11px] text-cs-text-muted border-t pt-2 leading-snug" style={{ borderColor: "var(--cs-border-subtle)" }}>
            {leadingConstraint && (!leadingMechanism || Math.abs(leadingConstraint.shap) > Math.abs(leadingMechanism.shap)) ? (
              <>
                Constraint dominates:{" "}
                <span className="font-mono">
                  {leadingConstraint.name} {leadingConstraint.shap >= 0 ? "+" : ""}
                  {leadingConstraint.shap.toFixed(3)}
                </span>{" "}
                — evolutionary constraint, not a mechanism. The molecular mechanism is not resolved by
                this score.
              </>
            ) : leadingMechanism ? (
              "Coding, splicing and regulatory features only."
            ) : mechanismBelowFloor ? (
              "Attributed, but nothing above the floor — no mechanism resolved."
            ) : (
              "No attribution reached this variant."
            )}
          </p>
        </div>

        {/* Card 4: ClinGen SVI Evidence Tier */}
        <div
          className="p-4 rounded-lg border flex flex-col justify-between"
          style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium tracking-wide text-cs-text-muted">
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

      {/*
        ── SECTION 2: MECHANISM RESOLUTION ──
        * The clinically load-bearing comparison, so it keeps full width and a real heading. What it
        * loses: the ALL-CAPS treatment (sentence case reads as a finding; small-caps-everywhere reads
        * as decoration), the "Biophysical Isolation Rule" pill, and the three-line Protocol Safety
        * Mandate — that is methodology, and it belongs in the inspector, not between two numbers.
        */}
      <div
        className="p-5 rounded-2xl border"
        style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border-subtle)" }}
      >
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <SplitSquareVertical className="w-4 h-4 text-cs-text-muted" />
            <h4 className="text-sm font-semibold tracking-tight text-cs-text-primary">
              Coding vs splicing
            </h4>
          </div>
          <span className="text-[10.5px] text-cs-text-muted">
            Layers of one composite score — see Provenance
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

        {/* The "Protocol Safety Mandate" paragraph that sat here — ClinGen SVI isolation of splicing
            from the missense consensus — is methodology, and three lines of it between two numbers
            is exactly the verbose content that belongs in the inspector beside this panel. */}
      </div>

      {/* ── SECTION 3: THE MODALITY BREAKDOWN ── */}
      <div
        className="p-6 rounded-2xl border"
        style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border-subtle)" }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b" style={{ borderColor: "var(--cs-border-subtle)" }}>
          <div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <h4 className="text-sm font-semibold tracking-tight text-cs-text-primary">
                Where the score comes from
              </h4>
              <span className="text-[10.5px] text-cs-text-muted">
                SHAP attribution across 18 biological layers
              </span>
            </div>
            <p className="text-xs text-cs-text-muted mt-1 max-w-[70ch]">
              {hasAttribution
                ? "Each layer's additive contribution to the AVI score. Coding, splicing and regulatory layers describe a mechanism; the conservation layers describe constraint, and are shown last for that reason."
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
              SHAP (expected-gradients approximation) then decomposes the overall Variant Impact (AVI) into additive attributions that sum to the raw score:
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
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-5">
          <div>
            {/*
              * The disclosure is the heading and the first sentence now, not a 10px badge. Ten rows
              * of plausible magnitudes in a monospace data grid is the strongest measurement
              * affordance on this panel, and it was carrying the weakest possible label — "Reference
              * Schema (Illustrative)" — attached to fabricated numbers a reader could filter and
              * page through as though they were this variant's.
              */}
            <div className="flex items-baseline gap-2 flex-wrap">
              <h4 className="text-sm font-semibold tracking-tight text-cs-text-primary">
                Reference track schema
              </h4>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                illustrative — not this variant
              </span>
            </div>
            <p className="text-xs text-cs-text-muted mt-1 max-w-[70ch]">
              The shape of AlphaGenome's output across ten example rows and four assay categories.
              The magnitudes below are
              examples of what each assay reports, not measurements of this variant; this variant's
              real tracks are in the Atlas, linked at the foot of this panel.
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

        {/* The five-line "Assay Reference Architecture" disclaimer that sat here now lives in the
            inspector's Provenance section, together with the Protocol Safety Mandate. Both are
            methodology; neither is a finding about this variant, and the main column is for findings.
            The disclosure that *does* need to travel with the table is in its heading above. */}

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
                  <th className="py-2.5 px-3.5 text-right">Example magnitude</th>
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
            <h4 className="text-sm font-semibold tracking-tight text-cs-text-primary">
              Open this variant in the Atlas
            </h4>
          </div>
          {/* "Authenticated URL Generation" was a claim about the plumbing that told a reader
              nothing. The links are the useful part. */}
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
