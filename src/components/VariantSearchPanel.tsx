import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  Search, 
  Dna, 
  Sparkles, 
  History, 
  Trash2, 
  ChevronDown, 
  Loader2, 
  Clipboard, 
  ShieldAlert,
  CheckCircle2,
  Zap,
  HelpCircle,
  ArrowRight,
  Layers,
  Activity,
  BarChart2,
  Map,
  FlaskConical,
  BookOpen,
  FileText,
  AlertTriangle,
  KeyRound
} from "lucide-react";
import { AnalysisState, SearchHistoryItem } from "../types";
import { MasterView } from "./MasterSidebar";
import { useVariantAnalysisStore, useVariantAnalysisActions } from "../context/VariantAnalysisContext";
import { useSettings } from "../context/SettingsContext";
import { getWorkflowStageStatus } from "../shared/workflowStatus";
import { needsNotationResolution, classifyNotation, ACCEPTED_NOTATION_EXAMPLES, type NotationKind } from "../shared/variantNotation.ts";
import NumberingChoicePrompt from "./NumberingChoicePrompt";
import type { NumberingChoice } from "../shared/contracts";
import LiveTelemetryPanel from "./telemetry/LiveTelemetryPanel";

const PasteBtn: React.FC<{ setter: (v: string) => void }> = ({ setter }) => (
  <button
    type="button"
    tabIndex={-1}
    title="Paste from clipboard"
    aria-label="Paste from clipboard"
    onClick={() => pasteFromClipboard(setter)}
    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded transition-[color,scale] duration-150 ease-out cursor-pointer text-cs-text-muted hover:text-cs-accent-clay active:scale-[0.96] z-10"
  >
    <Clipboard className="w-3.5 h-3.5" />
  </button>
);

interface VariantSearchPanelProps {
  isDark: boolean;
  classCard?: string;
  classCardHeader?: string;
  classCardTitle?: string;
  classInput?: string;
  classBorderSec?: string;
  customGene?: string;
  setCustomGene?: (val: string) => void;
  customVariant?: string;
  setCustomVariant?: (val: string) => void;
  customUniprot?: string;
  setCustomUniprot?: (val: string) => void;
  customGenomic?: string;
  setCustomGenomic?: (val: string) => void;
  analysisState?: AnalysisState;
  handleSearchSubmit?: (e: React.FormEvent) => void;
  gene?: string;
  variant?: string;
  uniprotId?: string;
  history?: SearchHistoryItem[];
  clearHistory?: () => void;
  handleSelectHistoryItem?: (item: SearchHistoryItem) => void;
  onViewChange?: (view: MasterView) => void;
}

/**
 * The pipeline stages, in order. Exported so the rail's stage count is derived from this list
 * instead of a literal, and so a test can assert the rendered list against it.
 */
export const WORKFLOW_STAGES = [
  { key: "evidence", title: "Evidence Pipeline", Icon: BarChart2, targetView: "evidence" as MasterView },
  { key: "structure", title: "3D Structure", Icon: Layers, targetView: "structure" as MasterView },
  { key: "energetics", title: "Energetics Engine", Icon: Activity, targetView: "energetics" as MasterView },
  { key: "landscape", title: "Landscape Minimap", Icon: Map, targetView: "landscape" as MasterView },
  { key: "insights", title: "Variant Insights", Icon: FlaskConical, targetView: "insights" as MasterView },
  { key: "literature", title: "Literature Mining", Icon: BookOpen, targetView: "literature" as MasterView },
  { key: "report", title: "Clinical Report", Icon: FileText, targetView: "report" as MasterView },
] as const;

type RailTabId = "telemetry" | "pipeline";
const RAIL_TAB_ORDER: RailTabId[] = ["telemetry", "pipeline"];

type FieldBadgeTone = "neutral" | "ok" | "warn" | "clay";

const FIELD_BADGE_TONES: Record<FieldBadgeTone, string> = {
  neutral: "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] border-[var(--cs-border-subtle)]",
  // -700 rather than -600: this text is 9.5px bold, where AA needs 4.5:1, and the -600 shades
  // measure 3.0-3.7:1 on the light surfaces. See the contrast note in styles/variables.css.
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  clay: "bg-[var(--cs-accent-mag-soft)] text-[var(--cs-accent-clay)] border-[var(--cs-accent-clay)]/30",
};

/**
 * Micro-badge occupying the right-hand slot of a field label.
 *
 * Every label used that slot differently before: one carried a red asterisk, two spelled
 * "(Optional)" into the label text itself, and the rest left it empty — so the two columns
 * never lined up and "is this field required?" had to be read three different ways. Shared
 * geometry also keeps the label row's height stable, since `leading-none` + a 3px pad stays
 * under the 12px label's own line box.
 */
const FieldBadge: React.FC<{ tone?: FieldBadgeTone; title?: string; children: React.ReactNode }> = ({
  tone = "neutral",
  title,
  children,
}) => (
  <span
    title={title}
    className={`text-[9.5px] font-mono font-bold uppercase leading-none px-1.5 py-[3px] rounded-[var(--cs-radius-badge)] border shrink-0 whitespace-nowrap ${FIELD_BADGE_TONES[tone]}`}
  >
    {children}
  </span>
);

/**
 * Verdict badge per notation family, for the right-hand slot of the Variant Notation label.
 *
 * `unknown` is deliberately neutral rather than a warning: every prefix of a valid notation
 * ("p.Gly3" on the way to "p.Gly380Arg") classifies as unknown, so an amber state here would
 * flash a false alarm on almost every keystroke.
 */
const NOTATION_BADGES: Record<NotationKind, { label: string; tone: FieldBadgeTone; title: string }> = {
  "protein-hgvs": {
    label: "Protein HGVS",
    tone: "ok",
    title: "Analysed directly — no coordinate translation needed.",
  },
  "protein-foldx": {
    label: "Protein code",
    tone: "ok",
    title: "FoldX-style substitution code — analysed directly.",
  },
  "protein-accessioned": {
    label: "Protein → canonical",
    tone: "clay",
    title:
      "Accession-qualified protein notation. The accession names the numbering basis (e.g. a MANE Select RefSeq protein), so the substitution is mapped onto canonical UniProt numbering before modelling.",
  },
  cdna: {
    label: "cDNA → resolve",
    tone: "clay",
    title: "Transcript cDNA. Resolved to a protein substitution by Ensembl VEP, with VariantValidator as the fallback tier.",
  },
  "genomic-hgvs": {
    label: "Genomic → resolve",
    tone: "clay",
    title: "Genomic HGVS. Resolved to a protein substitution by Ensembl VEP, with VariantValidator as the fallback tier.",
  },
  "genomic-dashed": {
    label: "Genomic → resolve",
    tone: "clay",
    title: "Dashed genomic coordinates. Resolved to a protein substitution by Ensembl VEP, with VariantValidator as the fallback tier.",
  },
  "genomic-bare": {
    label: "Genomic → resolve",
    tone: "clay",
    title: "Genomic coordinates. Resolved to a protein substitution by Ensembl VEP, with VariantValidator as the fallback tier.",
  },
  "non-substitution": {
    label: "Out of scope",
    tone: "warn",
    title: "A recognised coordinate notation, but not a single-nucleotide substitution. This platform analyses missense substitutions only.",
  },
  unknown: {
    label: "No match",
    tone: "neutral",
    title: "Not yet a recognised notation. Protein HGVS (p.Gly380Arg), cDNA (c.123A>G) or genomic coordinates (20-23365054-G-A) are accepted.",
  },
};

/**
 * UniProtKB accession shape, from UniProt's own documented pattern.
 *
 * The previous `^[A-Z0-9]{6}(?:[A-Z0-9]{4})?$` accepted any six alphanumerics, so a `123456`
 * typo read "Format OK" under a feature advertised as typo detection. This form is exact:
 * the O/P/Q prefix has its own alternative (they are real first letters — P51587, Q9H8M5)
 * and the alphanumeric-prefix form requires a letter in the third position.
 */
const UNIPROT_ACCESSION_PATTERN = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;

/** The examples are grouped by the field they belong in, which is also the fix for the two notation fields overlapping. */
const NOTATION_EXAMPLE_GROUPS: Array<{
  target: "variant" | "genomic";
  label: string;
  hint: string;
  values: string[];
}> = [
  {
    target: "variant",
    label: "Variant notation",
    hint: "Protein-level substitutions, accession-qualified protein notations and transcript cDNA go in the Variant Notation field.",
    values: [
      ACCEPTED_NOTATION_EXAMPLES.protein,
      ACCEPTED_NOTATION_EXAMPLES.proteinAccessioned,
      ACCEPTED_NOTATION_EXAMPLES.cdna,
    ],
  },
  {
    target: "genomic",
    label: "Genomic coords",
    hint: "Coordinate notations go in the Genomic Coordinates field.",
    values: [
      ACCEPTED_NOTATION_EXAMPLES.genomicHgvs,
      ACCEPTED_NOTATION_EXAMPLES.genomicHgvsAssemblyAnnotated,
      ACCEPTED_NOTATION_EXAMPLES.genomicAccession,
      ACCEPTED_NOTATION_EXAMPLES.genomicDashed,
    ],
  },
];

/**
 * Shared geometry for the outcome badge on the far right of the rail header.
 *
 * Both tabs use it so the header never changes colour system on switch — including weight, since
 * a `font-bold` on one variant and not the other changed the badge's measured width and broke
 * the "never changes box size" guarantee. `min-w-0` plus an allowed shrink lets the badge yield
 * space instead of overflowing: it is `shrink-0 whitespace-nowrap`, and measured against the
 * shipped font the header needs ~404px, so below ~1440px in a two-column layout the badge was
 * pushed past the card's `overflow-hidden` edge — entirely hidden at 1024px. `flex-wrap` on the
 * header means the badge drops to its own line rather than being clipped.
 */
const RAIL_BADGE_BASE =
  "flex items-center gap-1.5 text-[10.5px] font-semibold px-2 py-0.5 rounded-[var(--cs-radius-badge)] border shrink-0 whitespace-nowrap";

/**
 * One segment of the rail switcher. Both segments are rendered from this so the
 * two states can never drift apart in padding, radius or motion.
 *
 * The label may wrap and the segment may shrink: `whitespace-nowrap` here was the other half of
 * the header overflow, because two unshrinkable children cannot fit a ~350px track.
 */
const RailTab: React.FC<{
  id: RailTabId;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  tabIndex: number;
  onSelect: () => void;
}> = ({ id, active, icon, label, badge, tabIndex, onSelect }) => (
  <button
    type="button"
    role="tab"
    id={`tab-${id}`}
    aria-selected={active}
    // Only the active tab references a panel, because only the active panel is mounted: the
    // inactive tab's `aria-controls` was a dangling IDREF (axe: aria-valid-attr-value, serious).
    aria-controls={active ? `panel-${id}` : undefined}
    tabIndex={tabIndex}
    onClick={onSelect}
    className={`px-3 py-1.5 rounded-[var(--cs-radius-input)] text-[12px] flex items-center gap-1.5 cursor-pointer border active:scale-[0.96] transition-[background-color,border-color,color,box-shadow,scale] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)] ${
      active
        ? "bg-[var(--cs-surface)] text-[var(--cs-accent-clay)] font-semibold border-[var(--cs-accent-clay)]/40 shadow-xs ring-1 ring-[var(--cs-accent-clay)]/20"
        : "text-[var(--cs-text-secondary)] hover:text-[var(--cs-text-primary)] hover:bg-[var(--cs-surface)]/60 font-medium border-transparent"
    }`}
  >
    {icon}
    {/* Allowed to wrap rather than being pinned to one line: at the narrowest two-column
        width the tablist still needed ~32px more than the track affords, and a nowrap label
        pushed that overflow past the card's clipping edge. */}
    <span className="text-left">{label}</span>
    {badge}
  </button>
);

/** Reads clipboard text and calls setter. Silently ignores permission errors. */
async function pasteFromClipboard(setter: (val: string) => void) {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      if (text !== undefined && text !== null) {
        setter(text.trim());
      }
    }
  } catch (err) {
    console.warn("[Paste] Clipboard readText failed or permission denied:", err);
  }
}

function VariantSearchPanel({
  isDark,
  classInput = "",
  classBorderSec = "",
  customGene: propsCustomGene,
  setCustomGene: propsSetCustomGene,
  customVariant: propsCustomVariant,
  setCustomVariant: propsSetCustomVariant,
  customUniprot: propsCustomUniprot,
  setCustomUniprot: propsSetCustomUniprot,
  customGenomic: propsCustomGenomic,
  setCustomGenomic: propsSetCustomGenomic,
  analysisState: propsAnalysisState,
  handleSearchSubmit: propsHandleSearchSubmit,
  gene: propsGene,
  variant: propsVariant,
  uniprotId: propsUniprotId,
  history: propsHistory,
  clearHistory: propsClearHistory,
  handleSelectHistoryItem: propsHandleSelectHistoryItem,
  onViewChange,
}: VariantSearchPanelProps) {
  // Directly subscribe to Zustand store slices to guarantee instant re-renders on keystroke and paste
  const storeCustomGene = useVariantAnalysisStore(s => s.customGene ?? "");
  const storeCustomVariant = useVariantAnalysisStore(s => s.customVariant ?? "");
  const storeCustomUniprot = useVariantAnalysisStore(s => s.customUniprot ?? "");
  const storeCustomGenomic = useVariantAnalysisStore(s => s.customGenomic ?? "");
  const storeAnalysisState = useVariantAnalysisStore(s => s.analysisState);
  const storeGene = useVariantAnalysisStore(s => s.gene ?? "");
  const storeVariant = useVariantAnalysisStore(s => s.variant ?? "");
  const storeUniprotId = useVariantAnalysisStore(s => s.uniprotId ?? "");
  const storeHistory = useVariantAnalysisStore(s => s.history ?? []);

  const userDirections = useVariantAnalysisStore(s => s.userDirections ?? "");
  const loadingStep = useVariantAnalysisStore(s => s.loadingStep ?? "");
  const isFolding = useVariantAnalysisStore(s => s.isFolding ?? false);
  const isBiophysicalLoading = useVariantAnalysisStore(s => s.isBiophysicalLoading ?? false);
  const isClinicalLoading = useVariantAnalysisStore(s => s.isClinicalLoading ?? false);
  const isNarrativeLoading = useVariantAnalysisStore(s => s.isNarrativeLoading ?? false);
  const isPocketLoading = useVariantAnalysisStore(s => s.isPocketLoading ?? false);
  const dynamut2Status = useVariantAnalysisStore(s => s.dynamut2Status ?? null);
  const ddmutStatus = useVariantAnalysisStore(s => s.ddmutStatus ?? null);

  const actions = useVariantAnalysisActions();
  const { hasConfiguredGeminiKey, openSettingsTab } = useSettings();

  // Active state bindings with direct store reactivity
  const customGene = storeCustomGene;
  const setCustomGene = actions.setCustomGene;
  const customVariant = storeCustomVariant;
  const setCustomVariant = actions.setCustomVariant;
  const customUniprot = storeCustomUniprot;
  const setCustomUniprot = actions.setCustomUniprot;
  const customGenomic = storeCustomGenomic;
  const setCustomGenomic = actions.setCustomGenomic;
  const setUserDirections = actions.setUserDirections;

  const analysisState = propsAnalysisState ?? storeAnalysisState;
  const gene = propsGene ?? storeGene;
  const variant = propsVariant ?? storeVariant;
  const history = propsHistory ?? storeHistory;
  const clearHistory = propsClearHistory ?? actions.clearHistory;
  const handleSelectHistoryItem = propsHandleSelectHistoryItem ?? ((item: SearchHistoryItem) => {
    actions.setGene(item.gene);
    actions.setVariant(item.variant);
    actions.setUniprotId(item.uniprotId);
    actions.setCustomGene(item.gene);
    actions.setCustomVariant(item.variant);
    actions.setCustomUniprot(item.uniprotId ?? "");
    actions.setCustomGenomic("");
  });
  const handleSearchSubmit = propsHandleSearchSubmit ?? ((e: React.FormEvent) => {
    e.preventDefault();
  });

  const result = analysisState.result;

  // Check if any pipeline stage or background solver is still in active execution
  const isPipelineActive = Boolean(
    analysisState.isLoading ||
    isBiophysicalLoading ||
    isClinicalLoading ||
    isNarrativeLoading ||
    isFolding ||
    isPocketLoading
  );

  const [activeRightTab, setActiveRightTab] = useState<"pipeline" | "telemetry">(result ? "pipeline" : "telemetry");

  /**
   * Set once the reader picks a tab themselves, and cleared when a run finishes.
   *
   * The auto-switch below keys off an aggregate of six loading flags which is not a run
   * identity: `isLoading` goes false when the analysis completes while background fold and
   * pocket work continues, so a later flag flip re-triggered it and yanked the reader off the
   * tab they had deliberately chosen. An explicit choice now wins for the rest of that run.
   */
  const userChoseTabRef = useRef(false);
  const selectRailTab = useCallback((tab: "pipeline" | "telemetry") => {
    userChoseTabRef.current = true;
    setActiveRightTab(tab);
  }, []);

  useEffect(() => {
    if (isPipelineActive) {
      if (!userChoseTabRef.current) {
        setActiveRightTab("pipeline");
      }
    } else {
      // Between runs the reader's choice no longer applies, so the next run auto-focuses again.
      userChoseTabRef.current = false;
    }
  }, [isPipelineActive]);

  // Roving focus for the rail switcher: arrow keys move and activate, as the
  // tablist pattern expects. Without this the switcher was pointer-only.
  const railTabListRef = useRef<HTMLDivElement>(null);
  const handleRailKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = RAIL_TAB_ORDER.indexOf(activeRightTab);
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (current + 1) % RAIL_TAB_ORDER.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (current - 1 + RAIL_TAB_ORDER.length) % RAIL_TAB_ORDER.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = RAIL_TAB_ORDER.length - 1;
    if (next === null) return;

    e.preventDefault();
    // Arrow-key selection is a user choice too, so it pins the tab for the rest of the run.
    selectRailTab(RAIL_TAB_ORDER[next]);
    railTabListRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      ?.[next]?.focus();
  }, [activeRightTab, selectRailTab]);

  const onFormSubmit = (e: React.FormEvent) => {
    setActiveRightTab("pipeline");
    handleSearchSubmit(e);
  };

  /**
   * Answers the numbering prompt: record the decision, put the chosen notation in the Variant field
   * and run.
   *
   * Order matters — `setCustomVariant` CLEARS any previous decision (a decision belongs to one
   * notation), so the basis is set after it. The canonical reading additionally sends
   * `numberingBasis: "canonical"`, because re-submitting the bare string alone is refused again: the
   * route cannot tell an answered question from an unanswered one. The other readings need nothing,
   * as each is already expressed in canonical numbering.
   *
   * The genomic field is cleared because `handleSearchSubmit` prefers it when it has content, which
   * would silently ignore the choice the reader just made.
   */
  const chooseNumbering = (choice: NumberingChoice) => {
    actions.setCustomVariant(choice.variant);
    if (choice.basisKind === "canonical") actions.setNumberingBasis("canonical");
    actions.setCustomGenomic("");
    onFormSubmit({ preventDefault() {} } as React.FormEvent);
  };

  // Parsed verdicts, shown so the routing the form already performs is visible rather than
  // implied. Routing itself goes through `needsNotationResolution`, so the badge can describe the
  // parser but can never disagree with it.
  const variantNotation = customVariant.trim() ? classifyNotation(customVariant) : null;
  const genomicNotation = customGenomic.trim() ? classifyNotation(customGenomic) : null;
  /**
   * Only a genuine coordinate notation gets an assembly claim.
   *
   * This previously asserted "GRCh38 default" for ANY non-empty content — including
   * `p.Gly380Arg` or `asdf` — while simultaneously marking the Gene field "Derived", so the
   * panel claimed a resolution that would never happen, in the one place it exists to be
   * trusted. The kind is the same value that drives routing, so the badge cannot disagree
   * with what the pipeline will actually do.
   */
  const genomicIsCoordinate = Boolean(
    genomicNotation &&
      (genomicNotation.kind === "genomic-hgvs" ||
        genomicNotation.kind === "genomic-dashed" ||
        genomicNotation.kind === "genomic-bare" ||
        // A recognised coordinate that is out of missense scope still routes to the resolver,
        // which explains the scope rather than pretending it is a protein substitution.
        genomicNotation.kind === "non-substitution")
  );
  /**
   * Routing, gated on the parsed kind rather than on "the field is non-empty".
   *
   * `!!customGenomic.trim()` meant ANY text in this field counted as a coordinate: junk relaxed
   * the Variant field to optional and marked the Gene "Derived", so a form could be submitted
   * with no usable notation at all and fail server-side instead of at the field.
   */
  /**
   * Does the app resolve the notation itself before modelling?
   *
   * True for coordinate/cDNA input AND for accession-qualified protein notation
   * (`NP_001032248.1:p.Lys281Asn`), which carries its own protein and is mapped onto canonical
   * numbering by the server. Both cases derive the gene, so the Gene field is not required.
   */
  const notationResolvesItself =
    (!!customVariant && needsNotationResolution(customVariant)) || genomicIsCoordinate;
  const isGeneRequired = !notationResolvesItself;
  const isVariantRequired = !genomicIsCoordinate;

  const genomicAssemblyLabel = genomicIsCoordinate && genomicNotation
    ? genomicNotation.assembly
      ? `${genomicNotation.assembly} annotated`
      : "GRCh38 default"
    : null;
  const uniprotLooksValid = !customUniprot.trim() || UNIPROT_ACCESSION_PATTERN.test(customUniprot.trim());
  const hasDirections = userDirections.trim().length > 0;

  /**
   * Fills a field from the example catalogue.
   *
   * The sibling notation field is cleared, because the two are alternative routes to the
   * same answer rather than additive inputs — the same reason selecting a recent analysis
   * clears the coordinate field. Leaving both populated is what made it ambiguous which one
   * the pipeline would actually follow.
   */
  const applyNotationExample = (target: "variant" | "genomic", value: string) => {
    if (target === "variant") {
      setCustomVariant(value);
      setCustomGenomic("");
    } else {
      setCustomGenomic(value);
      setCustomVariant("");
    }
  };

  // Solid clay, not clay/25: an alpha ring composites to ~1.35:1 on white, far under the 3:1
  // WCAG 2.2 SC 1.4.11 requires of a focus indicator, and `outline-none` removes the native
  // one, so this ring is the only cue. Solid clay measures 3.87:1 on white.
  const inputBase = `w-full h-10 rounded-lg px-3 text-[13px] outline-none border transition-[border-color,box-shadow,background-color] duration-150 ease-out font-medium select-text focus:ring-2 focus:ring-[var(--cs-accent-clay)] ${classInput}`;

  // Derive stage status & metrics for live workflow rail
  const getStageInfo = (stage: "evidence" | "structure" | "energetics" | "landscape" | "insights" | "literature" | "report") => {
    const raw = getWorkflowStageStatus({
      view: stage,
      result,
      isFolding,
      isBiophysicalLoading,
      isClinicalLoading,
      isLoadingSearch: analysisState.isLoading,
      loadingStep,
      isPocketLoading,
      dynamut2Status,
      ddmutStatus,
      isNarrativeLoading
    });
    const statusMap: Record<string, string> = {
      complete: "Complete",
      progress: "In Progress",
      pending: "Pending",
      degraded: "Degraded",
      error: "Error"
    };
    return {
      status: statusMap[raw.status] || raw.status,
      desc: raw.desc
    };
  };

  return (
    <div className="w-full flex flex-col gap-6 cs-fade-in no-scrollbar" id="variant-search-workspace">
      {/* ── Screen Header & Context Banner ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--cs-border-subtle)]">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="p-1.5 rounded-lg bg-[var(--cs-accent-mag-soft)] text-[var(--cs-accent-clay)]">
              <Dna className="w-4 h-4" />
            </span>
            <h1 
              className="text-[20px] font-medium tracking-tight"
              style={{ color: "var(--cs-text-primary)" }}
            >
              Variant Analysis Workspace
            </h1>
          </div>
          <p className="text-[13px] max-w-3xl leading-relaxed" style={{ color: "var(--cs-text-secondary)", borderRadius: "var(--cs-radius-input)" }}>
            Enter target gene symbol, HGVS variant notation, and optional UniProt accession to run real-time structural, energetic, and clinical evidence pipelines.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          {!hasConfiguredGeminiKey && (
            <button
              type="button"
              onClick={() => openSettingsTab("api")}
              title="API key is not configured — click to open Settings"
              className="badge-data-source text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 cursor-pointer flex items-center gap-1.5 transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 shadow-xs"
            >
              <AlertTriangle className="w-3 h-3 text-amber-500" />
              API Key Required
            </button>
          )}
        </div>
      </div>

      {/* ── Main Workspace Card (outer panel — 16px, matches Accepted Inputs) ── */}
      <div
        className="cs-panel"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--cs-border-subtle)]">
          {/* ── LEFT COLUMN: Search Variant Form (col-span-7) ── */}
          <div className="lg:col-span-7 p-6 lg:p-7 flex flex-col">
            <div>
              <div className="flex items-center justify-between mb-4 pb-2.5 border-b border-[var(--cs-border-subtle)]">
                <h2 className="text-[14px] font-semibold flex items-center gap-2" style={{ color: "var(--cs-text-primary)" }}>
                  <Search className="w-4 h-4 text-[var(--cs-accent-clay)]" />
                  Search Variant
                </h2>
              </div>

              <form onSubmit={onFormSubmit} className="flex flex-col gap-4">
                {result?.numberingChoices &&
                /**
                 * Two readings minimum: a single "choice" is not a decision, and the refusal message
                 * already names it. Plus: only while the inputs still match the run that produced the
                 * refusal — `numberingChoices` lives on the last result and the fields are store-bound,
                 * so without this a reader could edit the notation and then answer a question about the
                 * previous one.
                 */
                result.numberingChoices.length >= 2 &&
                (result.numberingNotation ?? "") === customVariant.trim() &&
                (result.metadata?.gene ?? "") === customGene.trim() &&
                (result.metadata?.uniprotId ?? "") === customUniprot.trim() ? (
                  <NumberingChoicePrompt
                    notation={result.numberingNotation ?? customVariant}
                    choices={result.numberingChoices}
                    onChoose={chooseNumbering}
                  />
                ) : null}
                {/* Row 1: Gene + Variant */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label 
                      htmlFor="input-gene-symbol"
                      className="text-[12px] font-medium flex justify-between items-center gap-2"
                      style={{ color: "var(--cs-text-secondary)" }}
                    >
                      <span>Gene Symbol {isGeneRequired && <span className="text-rose-500">*</span>}</span>
                      {!isGeneRequired && (
                        <FieldBadge tone="clay" title="Your coordinate notation resolves the gene, so this field is not required.">
                          Derived
                        </FieldBadge>
                      )}
                    </label>
                    <div className="relative">
                      <input
                        id="input-gene-symbol"
                        type="text"
                        required={isGeneRequired}
                        placeholder="e.g. CNNM2"
                        value={customGene}
                        onChange={(e) => setCustomGene(e.target.value)}
                        className={inputBase + " pr-9 font-semibold tracking-wide uppercase"}
                        style={{ fontFamily: "var(--cs-font-mono)" }}
                      />
                      <PasteBtn setter={setCustomGene} />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label 
                      htmlFor="input-variant-notation"
                      className="text-[12px] font-medium flex justify-between items-center gap-2"
                      style={{ color: "var(--cs-text-secondary)" }}
                    >
                      <span>Variant Notation {isVariantRequired && <span className="text-rose-500">*</span>}</span>
                      {variantNotation ? (
                        <FieldBadge tone={NOTATION_BADGES[variantNotation.kind].tone} title={NOTATION_BADGES[variantNotation.kind].title}>
                          {NOTATION_BADGES[variantNotation.kind].label}
                        </FieldBadge>
                      ) : !isVariantRequired ? (
                        <FieldBadge title="Your genomic coordinates define the variant, so this field is not required.">
                          Optional
                        </FieldBadge>
                      ) : null}
                    </label>
                    <div className="relative">
                      <input
                        id="input-variant-notation"
                        type="text"
                        required={isVariantRequired}
                        placeholder="e.g. p.Gly380Arg"
                        value={customVariant}
                        onChange={(e) => setCustomVariant(e.target.value)}
                        className={inputBase + " pr-9 font-semibold tracking-wide"}
                        style={{ fontFamily: "var(--cs-font-mono)" }}
                      />
                      <PasteBtn setter={setCustomVariant} />
                    </div>
                  </div>
                </div>

                {/* Row 2: Genomic Coordinates */}
                <div className="flex flex-col gap-1.5">
                  <label 
                    htmlFor="input-genomic-coords"
                    className="text-[12px] font-medium flex justify-between items-center gap-2"
                    style={{ color: "var(--cs-text-secondary)" }}
                  >
                    <span>Genomic Coordinates</span>
                    {genomicNotation && !genomicIsCoordinate ? (
                      <FieldBadge
                        tone={NOTATION_BADGES[genomicNotation.kind].tone}
                        title={`${NOTATION_BADGES[genomicNotation.kind].title} This field only accepts genomic coordinates.`}
                      >
                        {NOTATION_BADGES[genomicNotation.kind].label}
                      </FieldBadge>
                    ) : (
                      <FieldBadge title={genomicAssemblyLabel ? "Genome build this coordinate will be resolved against." : "Optional: protein-level notation alone is enough to run the analysis."}>
                        {genomicAssemblyLabel ?? "Optional"}
                      </FieldBadge>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      id="input-genomic-coords"
                      type="text"
                      placeholder="e.g. 20-23365054-G-A"
                      value={customGenomic}
                      onChange={(e) => setCustomGenomic(e.target.value)}
                      className={inputBase + " pr-9 uppercase"}
                      style={{ fontFamily: "var(--cs-font-mono)" }}
                    />
                    <PasteBtn setter={setCustomGenomic} />
                  </div>
                </div>

                {/* Row 3: UniProt Accession */}
                <div className="flex flex-col gap-1.5">
                  <label 
                    htmlFor="input-uniprot-acc"
                    className="text-[12px] font-medium flex justify-between items-center gap-2"
                    style={{ color: "var(--cs-text-secondary)" }}
                  >
                    <span>UniProt Accession</span>
                    <FieldBadge
                      tone={uniprotLooksValid ? "neutral" : "warn"}
                      title={
                        uniprotLooksValid
                          ? "Optional: the accession is auto-resolved from the gene when omitted."
                          : "Accessions are 6 or 10 alphanumerics, e.g. Q9H8M5. Check for a typo."
                      }
                    >
                      {customUniprot.trim() ? (uniprotLooksValid ? "Format OK" : "Check format") : "Auto-resolved"}
                    </FieldBadge>
                  </label>
                  <div className="relative">
                    <input
                      id="input-uniprot-acc"
                      type="text"
                      placeholder="e.g. Q9H8M5 (Auto-resolved if omitted)"
                      value={customUniprot}
                      onChange={(e) => setCustomUniprot(e.target.value)}
                      className={inputBase + " pr-9 uppercase"}
                      style={{ fontFamily: "var(--cs-font-mono)" }}
                    />
                    <PasteBtn setter={setCustomUniprot} />
                  </div>
                </div>

                {/* AI Focus Area / Custom Instructions (Collapsible — nested panel, 16px like Accepted Inputs) */}
                <div className="cs-nested-panel transition-[border-color]">
                  <details className="group">
                    <summary className="flex justify-between items-center gap-2 px-3.5 py-2.5 text-xs font-medium select-none cursor-pointer transition-colors hover:bg-[var(--cs-bg-subtle)]" style={{ color: "var(--cs-text-secondary)", borderRadius: "var(--cs-radius-input)" }}>
                      <span className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-[var(--cs-accent-clay)]" />
                        AI Focus Area & Custom Analysis Instructions
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {/* Collapsed content used to be silent: instructions could be set and then
                            invisible, with nothing on the closed row to say so. */}
                        {hasDirections && (
                          <FieldBadge tone="clay" title="Custom analysis instructions are set and will direct the AI narrative.">
                            {userDirections.trim().length} chars
                          </FieldBadge>
                        )}
                        <span className="transition-transform group-open:rotate-180 text-[var(--cs-text-muted)]">
                          <ChevronDown className="w-4 h-4" />
                        </span>
                      </span>
                    </summary>
                    <div className="p-3.5 border-t border-[var(--cs-border-subtle)] space-y-2.5">
                      <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] leading-relaxed flex gap-2">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                        <span style={{ color: "var(--cs-text-secondary)", borderRadius: "var(--cs-radius-input)" }}>
                          <strong>Privacy Notice:</strong> Filtered workspace. Do not submit patient PII (names, MRNs, dates of birth).
                        </span>
                      </div>
                      <textarea
                        id="textarea-user-directions"
                        aria-label="AI Focus Area & Custom Analysis Instructions"
                        placeholder="e.g. Focus on structural disruption of cofactor binding loop, evaluate ACMG PM2/PS3 rules, or analyze active site residue proximity..."
                        value={userDirections}
                        onChange={(e) => {
                          const text = e.target.value.slice(0, 2000);
                          setUserDirections(text);
                        }}
                        maxLength={2000}
                        className="w-full h-20 rounded-lg border p-2.5 text-xs outline-none bg-[var(--cs-surface)] resize-none border-[var(--cs-border)] select-text transition-[border-color,box-shadow] duration-150 ease-out focus:ring-2 focus:ring-[var(--cs-accent-clay)] focus:border-[var(--cs-accent-clay)]"
                        style={{ color: "var(--cs-text-primary)" }}
                      />
                      <div className="flex justify-between items-center text-[10px]" style={{ color: "var(--cs-text-muted)" }}>
                        <span>Directs downstream AI narrative synthesis</span>
                        <span>{userDirections.length}/2000 chars</span>
                      </div>
                    </div>
                  </details>
                </div>

                {/* Submit Action Button — Greyed out with direct CTA if API keys are unconfigured */}
                {!hasConfiguredGeminiKey ? (
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => openSettingsTab("api")}
                      aria-label="API Key Required — Open Settings"
                      className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-[13.5px] font-semibold transition-[background-color,scale] duration-150 ease-out cursor-pointer shadow-xs bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-700 dark:text-amber-300 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                    >
                      <KeyRound className="w-4 h-4 text-amber-500" />
                      <span>API Key Required · Configure to Analyze</span>
                      <ArrowRight className="w-4 h-4 ml-1 opacity-80" />
                    </button>
                    <p className="text-[11px] text-center text-cs-text-muted">
                      Pipeline execution requires a configured API key. Click above to configure.
                    </p>
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={isPipelineActive}
                    aria-label="Analyze Variant"
                    className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold text-white transition-[background-color,filter,scale] duration-150 ease-out cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-none hover:brightness-105 disabled:hover:brightness-100 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--cs-surface)]"
                    style={{ background: "var(--cs-accent-clay)" }}
                  >
                    {isPipelineActive ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Executing Pipeline Analysis…
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Analyze Variant
                        <ArrowRight className="w-4 h-4 ml-1 opacity-80" />
                      </>
                    )}
                  </button>
                )}
              </form>

              {/* Format Help Box (Preserves layout card height balance with clean, modern badge chips) */}
              {/*
                Accepted-inputs reference, rebuilt on two rules.

                CONTENT: every example is read from `ACCEPTED_NOTATION_EXAMPLES`, the same
                catalogue the server's 400 response is generated from, so the panel can no
                longer advertise a grammar the parser rejects. The previous hand-written copy
                had already drifted — it listed a ClinVar Variation ID as an input format,
                but the analysis route only ever branches on genomic/cDNA vs protein, so a
                bare VCV id fails in the pipeline (the ClinVar reader accepts one, but that
                is an internal call, not a notation for these fields).

                AFFORDANCE: each example fills its own field. The two notation fields overlap
                in meaning — the Variant field accepts both protein and cDNA — and grouping
                the examples by destination field is what makes that split self-evident.
              */}
              <div className="cs-nested-panel mt-4">
                <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[var(--cs-border-subtle)]">
                  <span className="flex items-center gap-2 text-[11.5px] font-semibold" style={{ color: "var(--cs-text-primary)" }}>
                    <HelpCircle className="w-3.5 h-3.5 text-[var(--cs-accent-clay)]" />
                    Accepted Inputs
                  </span>
                  <FieldBadge tone="neutral" title="Selecting an example fills the matching field and clears the other.">
                    Click to fill
                  </FieldBadge>
                </div>

                <div className="px-3 py-2.5 space-y-2">
                  {NOTATION_EXAMPLE_GROUPS.map(group => (
                    <div key={group.target} className="flex items-start gap-2.5">
                      <span
                        className="w-[86px] shrink-0 pt-[5px] text-right text-[10px] font-medium leading-tight"
                        style={{ color: "var(--cs-text-muted)" }}
                      >
                        {group.label}
                      </span>
                      <div className="flex flex-wrap gap-1 min-w-0">
                        {group.values.map(value => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => applyNotationExample(group.target, value)}
                            title={`${group.hint} Fills "${value}" and clears the other notation field.`}
                            aria-label={`Use example ${value} in the ${group.label} field`}
                            className="px-1.5 py-[3px] rounded-[var(--cs-radius-badge)] border border-[var(--cs-border-subtle)] bg-[var(--cs-surface)] font-mono text-[10px] transition-[background-color,border-color,scale] duration-150 ease-out hover:border-[var(--cs-accent-clay)]/50 hover:bg-[var(--cs-accent-mag-soft)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cs-accent-clay)]"
                            style={{ color: "var(--cs-text-secondary)" }}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Recent Analyses / Zero-History Placeholder Tray ── */}
              <div className="mt-4 pt-3 border-t border-[var(--cs-border-subtle)]">
                {history.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase" style={{ color: "var(--cs-text-secondary)", borderRadius: "var(--cs-radius-input)" }}>
                        <History className="w-3.5 h-3.5 text-[var(--cs-accent-clay)]" />
                        <span>Recent Analyses ({history.length})</span>
                      </div>
                      <button
                        type="button"
                        onClick={clearHistory}
                        className="text-[10.5px] font-medium flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors cursor-pointer hover:bg-rose-500/10 text-[var(--cs-text-muted)] hover:text-rose-500"
                        title="Clear search history"
                        aria-label="Clear search history"
                      >
                        <Trash2 className="w-3 h-3" />
                        Clear
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {history.slice(0, 8).map((item, idx) => {
                        const isActive = gene === item.gene && variant === item.variant;
                        return (
                          <button
                            key={`${item.gene}_${item.variant}_${idx}`}
                            type="button"
                            onClick={() => handleSelectHistoryItem(item)}
                            aria-pressed={isActive}
                            className={`px-2.5 py-1 rounded-lg text-[11px] cursor-pointer flex items-center gap-1.5 border shadow-xs transition-[background-color,border-color,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cs-accent-clay)] ${
                              isActive
                                ? "border-[var(--cs-accent-clay)] bg-[var(--cs-accent-mag-soft)]"
                                : "border-[var(--cs-border-subtle)] bg-[var(--cs-surface)] hover:border-[var(--cs-accent-clay)]/50 hover:bg-[var(--cs-surface-2)]"
                            }`}
                            title={`Reload ${item.gene} ${item.variant}`}
                            aria-label={`Select recent search ${item.gene} ${item.variant}`}
                          >
                            <span className="font-semibold" style={{ color: "var(--cs-text-primary)" }}>
                              {item.gene}
                            </span>
                            <span className="font-mono text-[10.5px]" style={{ color: "var(--cs-text-secondary)", borderRadius: "var(--cs-radius-input)" }}>
                              {item.variant}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* Zero-History Empty State Placeholder */
                  <div className="cs-nested-panel border-dashed p-4 flex flex-col items-center justify-center text-center gap-2 select-none" style={{ background: "color-mix(in srgb, var(--cs-surface-2) 40%, transparent)" }}>
                    <div className="w-8 h-8 rounded-full bg-[var(--cs-surface)] border border-[var(--cs-border-subtle)] flex items-center justify-center text-[var(--cs-accent-clay)] shadow-xs">
                      <History className="w-4 h-4" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[12px] font-semibold" style={{ color: "var(--cs-text-primary)" }}>
                        No Recent Variant Analyses
                      </p>
                      <p className="text-[11px] max-w-sm leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
                        Analyzed variants in this session will appear here for instant 1-click re-querying and review.
                      </p>
                    </div>
                    <div className="pt-0.5 flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-lg bg-[var(--cs-surface)] border border-[var(--cs-border-subtle)] text-[var(--cs-text-muted)]">
                      <span>💡 Paste HGVS, cDNA, or genomic coordinates to start</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── RIGHT COLUMN: Segmented Workflow Pipeline & Telemetry Rail (col-span-5) ──
              Height-locked to the left column. From `lg` up the rail's inner layout is taken out
              of flow (absolute fill) so neither tab's content can contribute to the grid row
              height: the card is sized by the form column plus a floor, and both panels
              distribute/scroll inside a fixed track instead of resizing it.

              The floor is NOT breakpoint-qualified. Below `lg` the columns stack, and with the
              floor behind `lg:` the rail went back to sizing its own row, so switching tabs
              still resized the card (by ~100px, more than the 14px this fixed). A floor at every
              width keeps the stacked track stable too. */}
          <div className="lg:col-span-5 lg:relative min-h-[690px] bg-[var(--cs-surface-2)]">
            <div className="flex flex-col gap-4 p-6 lg:p-7 lg:absolute lg:inset-0">
              {/* `flex-wrap` + `min-w-0`: two unshrinkable children need ~404px and the 5/12
                  track only affords ~350px at the breakpoint, so without wrapping the status
                  badge was pushed past the card's overflow-hidden edge — fully hidden at
                  1024px and still clipped at 1280px. */}
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 pb-2.5 border-b border-[var(--cs-border-subtle)] shrink-0">
                {/* Segmented Switcher */}
                <div
                  ref={railTabListRef}
                  role="tablist"
                  aria-label="Analysis sidebar view switcher"
                  onKeyDown={handleRailKeyDown}
                  className="flex items-center gap-1 p-1 rounded-xl bg-[var(--cs-bg-subtle)] border border-[var(--cs-border)] shadow-xs min-w-0"
                >
                  <RailTab
                    id="telemetry"
                    active={activeRightTab === "telemetry"}
                    tabIndex={activeRightTab === "telemetry" ? 0 : -1}
                    onSelect={() => selectRailTab("telemetry")}
                    icon={<Activity className={`w-3.5 h-3.5 ${activeRightTab === "telemetry" ? "text-[var(--cs-accent-clay)]" : "text-[var(--cs-text-muted)]"}`} />}
                    label="Service Telemetry"
                  />

                  <RailTab
                    id="pipeline"
                    active={activeRightTab === "pipeline"}
                    tabIndex={activeRightTab === "pipeline" ? 0 : -1}
                    onSelect={() => selectRailTab("pipeline")}
                    icon={<Layers className={`w-3.5 h-3.5 ${activeRightTab === "pipeline" ? "text-[var(--cs-accent-clay)]" : "text-[var(--cs-text-muted)]"}`} />}
                    label="Workflow Pipeline"
                    badge={
                      isPipelineActive ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                      ) : result ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      ) : null
                    }
                  />
                </div>

                {/* Outcome badge.
                    The telemetry tab used to carry an unconditional emerald "Pre-flight Ready"
                    chip. It read no diagnostics state at all, so it asserted readiness while the
                    panel directly beneath it rendered "Checking…", "0/10 Online" in rose, or
                    "9/10 Online" in amber — a claim contradicted 20px below itself, and redundant
                    with that panel's own counter. It is gone rather than re-derived, because a
                    second status indicator for the same fact is the thing that drifted.
                    The pipeline chip IS derived, from real run state. */}
                {activeRightTab === "pipeline" && (
                  <span className={`${RAIL_BADGE_BASE} ${
                    isPipelineActive
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
                      : result
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25"
                      : "bg-[var(--cs-surface)] text-[var(--cs-text-secondary)] border-[var(--cs-border)]"
                  }`}>
                    {isPipelineActive ? (
                      <Activity className="w-3 h-3 text-amber-500 animate-pulse shrink-0" />
                    ) : result ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    )}
                    {isPipelineActive ? "Live Execution" : result ? "Result Loaded" : "Pipeline Ready"}
                  </span>
                )}
              </div>

              {activeRightTab === "telemetry" ? (
                <div key="telemetry" id="panel-telemetry" role="tabpanel" aria-labelledby="tab-telemetry" className="flex-1 min-h-0 flex flex-col cs-tab-transition">
                  <LiveTelemetryPanel className="flex-1 min-h-0" />
                </div>
              ) : (
                <div key="pipeline" id="panel-pipeline" role="tabpanel" aria-labelledby="tab-pipeline" className="flex-1 min-h-0 flex flex-col justify-between gap-2.5 cs-tab-transition">
                  {/* Matching Subheader */}
                  <div className="flex items-center justify-between px-1 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-cs-text-primary">
                        Workflow Pipeline Execution
                      </span>
                      <span className="text-[10px] font-mono text-[var(--cs-text-muted)] px-1.5 py-0.5 rounded-[var(--cs-radius-badge)] bg-[var(--cs-surface-2)] border border-[var(--cs-border-subtle)]">
                        {/* Derived from the list, never a literal: an eighth stage previously
                            still read "7/7 Complete" on a pipeline that ran eight. */}
                        {isPipelineActive
                          ? "Running"
                          : result
                          ? `${WORKFLOW_STAGES.length}/${WORKFLOW_STAGES.length} Complete`
                          : `${WORKFLOW_STAGES.length} Stages`}
                      </span>
                    </div>
                  </div>

                  {/* Workflow Live Stages List — same row rhythm as the telemetry rail,
                      with surplus height distributed INTO the rows rather than the gaps:
                      each bar is `flex-1` so the seven stages share the track equally and
                      fill it edge to edge, instead of pooling dead space between bars. */}
                  <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-2 my-0.5">
                    {WORKFLOW_STAGES.map(({ key, title, Icon, targetView }) => {
                      const info = getStageInfo(key as any);
                      const isClickable = !!result && !!onViewChange;
                      const isRunning = info.status === "In Progress" || info.status === "Computing";
                      const isDone = info.status === "Complete";
                      const isDegraded = info.status === "Degraded" || info.status === "degraded";
                      const isErr = info.status === "Error" || info.status === "error";

                      return (
                        <div
                          key={key}
                          onClick={() => isClickable && onViewChange?.(targetView)}
                          role={isClickable ? "button" : undefined}
                          tabIndex={isClickable ? 0 : undefined}
                          aria-label={isClickable ? `Navigate to ${title} view` : title}
                          onKeyDown={e => {
                            if (isClickable && (e.key === "Enter" || e.key === " ")) {
                              e.preventDefault();
                              onViewChange?.(targetView);
                            }
                          }}
                          className={`flex-1 min-h-[46px] px-3 py-2 rounded-[var(--cs-radius-input)] border transition-[border-color,background-color,scale] duration-150 ease-out flex items-center justify-between gap-2.5 select-none bg-[var(--cs-surface)] ${
                            isClickable ? "cursor-pointer hover:border-[var(--cs-accent-clay)]/70 hover:bg-[var(--cs-surface-2)] shadow-xs active:scale-[0.99] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cs-accent-clay)]" : ""
                          } ${
                            isDone
                              ? "border-[var(--cs-border)]"
                              : isRunning
                              ? "border-[var(--cs-accent-clay)]/50"
                              : isDegraded || isErr
                              ? "border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/10"
                              : "border-[var(--cs-border-subtle)]"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            {/* One icon slot: it carries the stage's identity while the stage
                                is idle, and switches to the state glyph once there is a state
                                worth reporting. The status pill below always states it in text. */}
                            {isRunning ? (
                              <Loader2 className="w-4 h-4 animate-spin text-[var(--cs-accent-clay)] shrink-0" />
                            ) : isDone ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : isDegraded || isErr ? (
                              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                            ) : (
                              <Icon className="w-4 h-4 text-[var(--cs-text-muted)] shrink-0" />
                            )}

                            <div className="flex flex-col min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[12px] font-semibold text-cs-text-primary truncate">
                                  {title}
                                </span>
                              </div>
                              <span className="text-[10px] text-cs-text-secondary truncate font-sans leading-tight">
                                {info.desc}
                              </span>
                            </div>
                          </div>

                          {/* Right Action / Status Badge */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`text-[9.5px] font-mono font-bold uppercase px-1.5 py-0.5 rounded-[var(--cs-radius-badge)] border ${
                              isDone
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                : isRunning
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                : isDegraded || isErr
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                                : "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20"
                            }`}>
                              {info.status}
                            </span>

                            {isClickable && (
                              <span className="p-0.5 rounded text-cs-text-muted hover:text-cs-accent-clay transition-colors">
                                <ArrowRight className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Right-column status footer — same 8px radius as the stage bars above it */}
                  <div className="cs-nested-panel p-3 px-3.5 text-[11.5px] leading-relaxed flex items-center gap-2.5 shadow-xs shrink-0" style={{ color: "var(--cs-text-secondary)", borderRadius: "var(--cs-radius-input)" }}>
                    <Zap className="w-4 h-4 text-[var(--cs-accent-clay)] shrink-0" />
                    <span className="truncate">
                      {isPipelineActive
                        ? loadingStep || "Processing pipeline analysis…"
                        : result
                          ? "Analysis complete! Click on any pipeline stage card to navigate and explore."
                          : "Parallel biophysical computation engine ready"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(VariantSearchPanel);
