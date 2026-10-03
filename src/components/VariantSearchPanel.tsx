import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Trash2,
  ChevronDown,
  Loader2,
  Clipboard,
  ShieldAlert,
  CheckCircle2,
  ArrowRight,
  Layers,
  Activity,
  BarChart2,
  Map,
  FlaskConical,
  BookOpen,
  FileText,
  AlertTriangle,
  Compass,
  CornerDownLeft,
  X,
  Eraser,
} from "lucide-react";
import { AnalysisState, SearchHistoryItem } from "../types";
import { MasterView } from "./MasterSidebar";
import { useVariantAnalysisStore, useVariantAnalysisActions } from "../context/VariantAnalysisContext";
import { useSettings } from "../context/SettingsContext";
import { getWorkflowStageStatus, summarizeWorkflowStatuses } from "../shared/workflowStatus";
import {
  needsNotationResolution,
  classifyNotation,
  ACCEPTED_NOTATION_EXAMPLES,
  type GenomeAssembly,
  type NotationKind,
} from "../shared/variantNotation.ts";
import { ASSEMBLY_LABELS, statedAssemblyOf, withAssemblyAnnotation } from "../shared/assembly";
import { ONBOARDING_BENCHMARK_PRESETS, type OnboardingPreset } from "../shared/benchmarkPresets";
import NumberingChoicePrompt from "./NumberingChoicePrompt";
import BuildMismatchPrompt from "./BuildMismatchPrompt";
import type { BuildHint, NumberingChoice } from "../shared/contracts";
import LiveTelemetryPanel from "./telemetry/LiveTelemetryPanel";

/* ──────────────────────────────────────────────────────────────────────────────────────────────
   DESIGN NOTES — Search workspace

   Colour. Clay is reserved for "act here": the primary button, focus rings, the running spinner
   and hover on fill-in affordances. Headings and section icons are neutral. Status colour comes
   from the semantic tokens (`--cs-text-success`, `--cs-bg-warning`, …) and appears only where a
   state needs attention — a nominal state is quiet text.

   Type. Five sizes on this screen: 20 (page title), 14 (card title, button), 13 (inputs, body),
   12 (labels, rows), 11 (meta: badges, hints, latency). Weights 400/500/600 only.

   Radius. 16 panel · 12 grouped container · 8 control · 6 chip.

   Motion. Colour/background transitions at 150ms. No scale-on-press for anything wider than a
   chip: 4% of a 640px button is a 25px jolt. Progress bar width eases over 300ms.
   ────────────────────────────────────────────────────────────────────────────────────────────── */

const PasteBtn: React.FC<{ setter: (v: string) => void }> = ({ setter }) => (
  <button
    type="button"
    tabIndex={-1}
    title="Paste from clipboard"
    aria-label="Paste from clipboard"
    onClick={() => pasteFromClipboard(setter)}
    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center rounded-md cursor-pointer text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-bg-subtle transition-colors duration-150 z-10"
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
  onOpenOnboarding?: () => void;
}

/**
 * The pipeline stages, in order. Titles match the sidebar's view names exactly, so a stage and the
 * view it opens are called the same thing. Exported so the rail's stage count is derived from this list
 * instead of a literal, and so a test can assert the rendered list against it.
 */
export const WORKFLOW_STAGES = [
  { key: "evidence", title: "Evidence", Icon: BarChart2, targetView: "evidence" as MasterView },
  { key: "structure", title: "3D structure", Icon: Layers, targetView: "structure" as MasterView },
  { key: "energetics", title: "Energetics", Icon: Activity, targetView: "energetics" as MasterView },
  { key: "landscape", title: "Landscape", Icon: Map, targetView: "landscape" as MasterView },
  { key: "insights", title: "Insights", Icon: FlaskConical, targetView: "insights" as MasterView },
  { key: "literature", title: "Literature", Icon: BookOpen, targetView: "literature" as MasterView },
  { key: "report", title: "Report", Icon: FileText, targetView: "report" as MasterView },
] as const;

type RailTabId = "telemetry" | "pipeline";
const RAIL_TAB_ORDER: RailTabId[] = ["telemetry", "pipeline"];

/**
 * How long an active run waits before offering the explore-early hint under the last stage.
 *
 * A hint that fires on click reads as nagging (runs sometimes settle relevant stages in
 * seconds), so it waits for real elapsed time instead. 10s clears any quick partial-cache
 * run while arriving before the reader's attention has fully parked on the progress bar —
 * and by then some stages have usually settled, so the "ready to explore" list has
 * something to point at.
 */
const EXPLORE_HINT_DELAY_MS = 10_000;

type FieldBadgeTone = "neutral" | "ok" | "warn" | "clay";

/**
 * The pill a chip wears, WITHOUT its padding, split out because two different controls now wear it.
 *
 * The state badges and the genome-build control share one right-hand slot, so they must agree on what
 * a chip looks like. They did not: the build control was the only element in that row with no
 * background and with its own trailing padding, so its label sat inset from every sibling chip and read
 * as misaligned. Deriving both from these constants is what makes that impossible to reintroduce —
 * there is one definition of the pill, and the padding is the only thing a caller may vary.
 */
const FIELD_CHIP_BOX = "rounded-[var(--cs-radius-badge)] font-medium";
const FIELD_CHIP_SURFACE: Record<FieldBadgeTone, string> = {
  neutral: "",
  ok: "bg-[var(--cs-bg-success)] text-[var(--cs-text-good-on-soft)]",
  warn: "bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning-on-soft)]",
  clay: "bg-cs-accent-clay/10 text-cs-text-accent",
};

/**
 * Field-state chips, on the semantic tokens. `neutral` is deliberately NOT a chip: "Optional" is
 * a fact about the field, not a state, and boxing it gave it the same visual weight as a warning.
 */
const FIELD_BADGE_TONES: Record<FieldBadgeTone, string> = {
  neutral: "text-cs-text-muted",
  ok: `px-1.5 py-0.5 ${FIELD_CHIP_BOX} ${FIELD_CHIP_SURFACE.ok}`,
  warn: `px-1.5 py-0.5 ${FIELD_CHIP_BOX} ${FIELD_CHIP_SURFACE.warn}`,
  clay: `px-1.5 py-0.5 ${FIELD_CHIP_BOX} ${FIELD_CHIP_SURFACE.clay}`,
};

/**
 * Micro-badge occupying the right-hand slot of a field label.
 *
 * Every label uses the slot the same way, so "is this field required, and what did the parser
 * make of it?" is always read from the same place. Height is pinned so a badge appearing on a
 * keystroke never nudges the input beneath it.
 */
const FieldBadge: React.FC<{ tone?: FieldBadgeTone; title?: string; children: React.ReactNode }> = ({
  tone = "neutral",
  title,
  children,
}) => (
  <span
    title={title}
    className={`text-[11px] leading-4 shrink-0 whitespace-nowrap ${FIELD_BADGE_TONES[tone]}`}
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

/**
 * Examples, grouped by the field they belong in — and now rendered directly UNDER that field, so
 * the either/or split between the two notation inputs is shown by position rather than explained
 * in a separate box below the submit button.
 */
const NOTATION_EXAMPLE_GROUPS: Array<{
  target: "variant" | "genomic";
  label: string;
  values: string[];
}> = [
  {
    target: "variant",
    label: "Variant notation",
    values: [
      ACCEPTED_NOTATION_EXAMPLES.protein,
      ACCEPTED_NOTATION_EXAMPLES.proteinAccessioned,
      ACCEPTED_NOTATION_EXAMPLES.cdna,
      // The build-annotated form is a chip of its own: the field can STATE which reference the
      // transcript is read against, and a reader who has hg19 cDNA has no other way to find that out.
      ACCEPTED_NOTATION_EXAMPLES.cdnaAssemblyAnnotated,
    ],
  },
  {
    target: "genomic",
    label: "Genomic coords",
    values: [
      ACCEPTED_NOTATION_EXAMPLES.genomicHgvs,
      ACCEPTED_NOTATION_EXAMPLES.genomicHgvsAssemblyAnnotated,
      ACCEPTED_NOTATION_EXAMPLES.genomicAccession,
      ACCEPTED_NOTATION_EXAMPLES.genomicDashed,
    ],
  },
];

/**
 * Display-only HGVS tidy-up for history chips: `p.ser489cys` → `p.Ser489Cys`.
 *
 * History stores whatever was typed, so the tray mixed lower-case entries with properly cased
 * catalogue examples. Only the three-letter protein form is touched; one-letter (`p.V600E`),
 * cDNA and genomic strings are returned unchanged, and the stored value is never rewritten.
 */
export function formatVariantForDisplay(variant: string): string {
  const m = /^p\.([a-z]{3})(\d+)([a-z]{3}|ter|\*)$/i.exec(variant.trim());
  if (!m) return variant;
  const cap = (x: string) => (x === "*" ? x : x.charAt(0).toUpperCase() + x.slice(1).toLowerCase());
  return `p.${cap(m[1])}${m[2]}${cap(m[3])}`;
}

/**
 * One segment of the rail switcher. Both segments are rendered from this so the two states can
 * never drift apart in padding, radius or motion. Segments split the track equally, so the
 * control never overflows the rail at the narrowest two-column width.
 *
 * The active surface is NOT painted here: a shared thumb behind both segments carries it and
 * glides between them (see the tablist), so a switch is one motion. A segment only owns its
 * text colour and its focus ring.
 */
const RailTab: React.FC<{
  id: RailTabId;
  active: boolean;
  label: string;
  badge?: React.ReactNode;
  tabIndex: number;
  onSelect: () => void;
}> = ({ id, active, label, badge, tabIndex, onSelect }) => (
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
    className={`relative flex-1 min-w-0 h-7 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)] ${
      active
        ? "text-cs-text-primary"
        : "text-cs-text-secondary hover:text-cs-text-primary"
    }`}
  >
    <span className="truncate">{label}</span>
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

/**
 * Field label row: label on the left, and on the right EITHER a state badge OR a control.
 *
 * The row is `h-5` and its right-hand slot is pinned, so a badge appearing on a keystroke never
 * nudges the input beneath it — which is why the build control (`action`) is badge-metric rather than
 * the app's `cs-seg-control`, whose own primitive plus its settings size variant are both taller than
 * this row.
 *
 * `action` is rendered as a SIBLING of the `<label>`, not inside it: interactive content nested in a
 * label activates the labelled control, so a `<select>` in there would focus the notation input on
 * every click.
 */
const FieldLabel: React.FC<{
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}> = ({ htmlFor, required, children, badge, action }) => {
  const text = (
    <span>
      {children}
      {required && (
        <span className="text-cs-text-accent ml-0.5" aria-hidden="true">
          *
        </span>
      )}
    </span>
  );
  const rowClass = "h-5 flex items-center justify-between gap-2 text-[12px] font-medium text-cs-text-secondary";

  if (action) {
    return (
      <div className={rowClass}>
        <label htmlFor={htmlFor}>{text}</label>
        {/* BOTH, when both are given — but the callers suppress their badge while a control takes this
            slot, because two `shrink-0` items cannot fit the pinned 20px row: only the label can give,
            and it then wraps into the input below. */}
        <span className="flex items-center gap-1.5 shrink-0">
          {badge}
          {action}
        </span>
      </div>
    );
  }
  return (
    <label htmlFor={htmlFor} className={rowClass}>
      {text}
      {badge}
    </label>
  );
};

/**
 * The genome build of a coordinate notation, as a control.
 *
 * WHY A `<select>` AND NOT A TOGGLE
 * ---------------------------------
 * A build is a property of the COORDINATE, not of the session: the submitted string is what the
 * server reads, and it refuses to trust a forwarded coordinate whose build was not stated (a
 * defaulted label over another build's position is the wrong-locus hazard). So this control carries
 * no state of its own — its value is DERIVED from the notation, and choosing a build REWRITES the
 * notation to state it. There is then nothing that can disagree with the text: no sticky toggle, no
 * conflict banner, and the reader sees exactly what will be sent.
 *
 * LOOKS LIKE THE CHIP IT REPLACES, and is built from the same pill the state badges are built from.
 * It was the only element in that row wearing no background — bare text with 12px of trailing padding
 * reserved for a caret that `appearance-none` had removed — so its label sat inside where every sibling
 * chip's text sits and read as misaligned next to them. The slot is a chip slot; a control in it has to
 * be a chip.
 *
 * Metrics match the badge it replaces (`h-5`, 11px, `--cs-radius-badge`, `px-1.5`), because the slot it
 * lives in is pinned at 20px; the closed state is what is seen, and the option text carries the full
 * labels from `ASSEMBLY_LABELS` so there is one spelling of every build name.
 *
 * A DEFAULTED build wears the quiet surface and a STATED one the clay tint. Both are pills, so the row
 * is visually consistent either way, while the colour still answers "did the caller say this, or is it
 * the server's fallback?" — the distinction the whole build policy rests on, which a plain tinted chip
 * would have hidden.
 */
const BuildSelect: React.FC<{
  value: GenomeAssembly;
  /** How the value was established, so the control can say whether it was STATED or assumed. */
  source: "annotation" | "accession" | "default";
  /**
   * Which field's notation this control rewrites, for the accessible name.
   *
   * Both notation fields can show one, and the accessible name is the only thing a screen-reader user
   * has to tell them apart — two identically named selects in one form is a coin flip.
   */
  subject: "coordinate" | "cDNA";
  onChange: (build: GenomeAssembly) => void;
}> = ({ value, source, subject, onChange }) => {
  const surface =
    source === "default"
      ? "bg-cs-surface-2 text-cs-text-muted hover:text-cs-text-secondary"
      : FIELD_CHIP_SURFACE.clay;

  return (
    // The wrapper is the chip: it carries the pill and positions the caret, while the `<select>` fills
    // it edge to edge (no padding of its own to double up), so the ring and the pill have one box.
    <span className={`relative inline-flex h-5 shrink-0 items-center ${FIELD_CHIP_BOX} ${surface}`}>
      <select
        aria-label={`Genome build this ${subject} is expressed in`}
        title={
          source === "default"
            ? `Genome build: ${ASSEMBLY_LABELS[value]} (default — choose a build to state it in the notation)`
            : `Genome build: ${ASSEMBLY_LABELS[value]} (stated ${
                source === "accession" ? "by the RefSeq accession" : "in the notation"
              })`
        }
        value={value}
        onChange={(event) => onChange(event.target.value as GenomeAssembly)}
        // `pr-4` is the caret's room, reserved INSIDE the chip so the chip's right edge still lands
        // flush with the badges beside it — the padding that made this look misaligned was padding
        // with nothing in it.
        className="h-5 cursor-pointer appearance-none rounded-[var(--cs-radius-badge)] bg-transparent pl-1.5 pr-4 text-[11px] font-medium leading-4 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
      >
        <option value="GRCh38">{ASSEMBLY_LABELS.GRCh38}</option>
        <option value="GRCh37">{ASSEMBLY_LABELS.GRCh37}</option>
      </select>
      {/* Drawn, because `appearance-none` removes the native arrow — and in the text's own colour, so
          the control and its caret cannot disagree about which state the build is in. */}
      <ChevronDown className="pointer-events-none absolute right-1 w-3 h-3" aria-hidden="true" />
    </span>
  );
};

/**
 * One breath per chip. The tooltip used to replay the group's full paragraph on EVERY chip of a
 * group — hovering any example surfaced a multi-sentence treatise — so the tooltips now say only
 * what the hovered form IS: which field it feeds is already carried by the chip's position
 * (directly under that field) and its accessible label. The fallback covers a catalogue value
 * this map has not met yet.
 */
const EXAMPLE_HINTS: Record<string, string> = {
  [ACCEPTED_NOTATION_EXAMPLES.protein]: "Three-letter protein change",
  [ACCEPTED_NOTATION_EXAMPLES.proteinAccessioned]: "Protein change on a numbered accession",
  [ACCEPTED_NOTATION_EXAMPLES.cdna]: "Transcript cDNA change",
  [ACCEPTED_NOTATION_EXAMPLES.cdnaAssemblyAnnotated]: "cDNA naming its reference build",
  [ACCEPTED_NOTATION_EXAMPLES.genomicHgvs]: "Genomic HGVS",
  [ACCEPTED_NOTATION_EXAMPLES.genomicHgvsAssemblyAnnotated]: "Genomic HGVS naming the build",
  [ACCEPTED_NOTATION_EXAMPLES.genomicAccession]: "Accession-qualified genomic coordinate",
  [ACCEPTED_NOTATION_EXAMPLES.genomicDashed]: "Dashed chromosome-position form",
};

/** Example chips shown beneath a notation field. */
const ExampleRow: React.FC<{
  group: (typeof NOTATION_EXAMPLE_GROUPS)[number];
  onPick: (target: "variant" | "genomic", value: string) => void;
}> = ({ group, onPick }) => (
  <div className="flex flex-wrap items-center gap-1 pt-0.5">
    <span className="text-[11px] text-cs-text-muted mr-0.5">Try</span>
    {group.values.map(value => (
      <button
        key={value}
        type="button"
        onClick={() => onPick(group.target, value)}
        title={EXAMPLE_HINTS[value] ?? `${group.label} example`}
        aria-label={`Use example ${value} in the ${group.label} field`}
        className="px-1.5 h-5 rounded-[var(--cs-radius-badge)] font-mono text-[11px] leading-5 text-cs-text-secondary bg-cs-surface-2 hover:bg-cs-accent-clay/10 hover:text-cs-text-accent cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)] max-w-full truncate"
      >
        {value}
      </button>
    ))}
  </div>
);

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
  onOpenOnboarding,
}: VariantSearchPanelProps) {
  // Directly subscribe to Zustand store slices to guarantee instant re-renders on keystroke and paste
  const storeCustomGene = useVariantAnalysisStore(s => s.customGene ?? "");
  const storeCustomVariant = useVariantAnalysisStore(s => s.customVariant ?? "");
  const storeCustomUniprot = useVariantAnalysisStore(s => s.customUniprot ?? "");
  const storeCustomGenomic = useVariantAnalysisStore(s => s.customGenomic ?? "");
  const storeAnalysisState = useVariantAnalysisStore(s => s.analysisState);
  const storeGene = useVariantAnalysisStore(s => s.gene ?? "");
  const storeVariant = useVariantAnalysisStore(s => s.variant ?? "");
  const storeHistory = useVariantAnalysisStore(s => s.history ?? []);

  const userDirections = useVariantAnalysisStore(s => s.userDirections ?? "");
  const loadingStep = useVariantAnalysisStore(s => s.loadingStep ?? "");
  const isFolding = useVariantAnalysisStore(s => s.isFolding ?? false);
  const isBiophysicalLoading = useVariantAnalysisStore(s => s.isBiophysicalLoading ?? false);
  const isClinicalLoading = useVariantAnalysisStore(s => s.isClinicalLoading ?? false);
  const isNarrativeLoading = useVariantAnalysisStore(s => s.isNarrativeLoading ?? false);
  const isStructuralLoading = useVariantAnalysisStore(s => s.isStructuralLoading ?? false);
  const isPocketLoading = useVariantAnalysisStore(s => s.isPocketLoading ?? false);
  const loadedPdb = useVariantAnalysisStore(s => s.pdbText);
  const engineState = useVariantAnalysisStore(s => s.primaryBiophysics);
  // Submission is blocked only during intake/core, never by optional background work.
  const isForegroundActive = Boolean((propsAnalysisState ?? storeAnalysisState).isLoading || isBiophysicalLoading || isClinicalLoading);
  const dynamut2Status = useVariantAnalysisStore(s => s.dynamut2Status ?? null);
  const ddmutStatus = useVariantAnalysisStore(s => s.ddmutStatus ?? null);

  const actions = useVariantAnalysisActions();
  const { hasConfiguredGeminiKey, openSettingsTab, settings } = useSettings();

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
    isStructuralLoading ||
    Object.values(result?.metadata?.pipelineStages ?? {}).some(outcome => outcome === "running") ||
    isFolding ||
    dynamut2Status === "pending" ||
    ddmutStatus === "pending" ||
    engineState.thermompnnStatus === "pending" ||
    isPocketLoading
  );

  const [activeRightTab, setActiveRightTab] = useState<RailTabId>(result ? "pipeline" : "telemetry");

  /* ── Explore-early hint ─────────────────────────────────────────────────────────────────
     Appears in the rail (under the last stage) after `EXPLORE_HINT_DELAY_MS` of an active
     run, telling the reader the workspace is already browsable. Dismissed per run: a new
     run resets the dismissal and the timer, and a finished arm offers nothing. */
  const [exploreHintVisible, setExploreHintVisible] = useState(false);
  const exploreHintDismissedRef = useRef(false);

  useEffect(() => {
    if (!isPipelineActive) {
      // A finished or idle run re-arms both, so the next slow stage gets its own notice.
      setExploreHintVisible(false);
      exploreHintDismissedRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      if (!exploreHintDismissedRef.current) setExploreHintVisible(true);
    }, EXPLORE_HINT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isPipelineActive]);
  /* ───────────────────────────────────────────────────────────────────────────────────── */

  /**
   * Set once the reader picks a tab themselves, and cleared when a run finishes.
   *
   * The auto-switch below keys off an aggregate of six loading flags which is not a run
   * identity: `isLoading` goes false when the analysis completes while background fold and
   * pocket work continues, so a later flag flip re-triggered it and yanked the reader off the
   * tab they had deliberately chosen. An explicit choice now wins for the rest of that run.
   */
  const userChoseTabRef = useRef(false);
  const selectRailTab = useCallback((tab: RailTabId) => {
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
   * A recents chip is a RUN, not a form fill: the wired handler executes the analysis straight
   * through the store (handleSelectHistoryItem → executeAnalysis), never crossing the form
   * submit that switches the rail — so the run used to start while the reader was left looking
   * at Services. The switch happens here instead, and clears a pinned tab choice first: the
   * `isPipelineActive` backstop can miss this path twice over — background work can hold the
   * flag already true so the effect never re-fires, and a cache-hit run can flip the loading
   * flags within one batch so they never observably turn true. A run starting is itself the
   * reader's intent; no earlier tab choice should outvote it.
   */
  const runFromHistory = useCallback((item: SearchHistoryItem) => {
    userChoseTabRef.current = false;
    setActiveRightTab("pipeline");
    handleSelectHistoryItem(item);
  }, [handleSelectHistoryItem]);

  /**
   * Empties the four query fields, leaving the workspace as it was before the last fill.
   *
   * Scope is deliberately the query inputs only: AI focus instructions are a separate,
   * deliberately-set input (the reader types or leaves them for future analyses — notice the
   * char-count badge is stated on its label), and the run state/history are owned by
   * Recents' own Clear. Anything a run has already rendered (result, rail states) is
   * untouched: this is "clear the form", not "reset the workspace".
   */
  const clearQueryFields = useCallback(() => {
    actions.setCustomGene("");
    actions.setCustomUniprot("");
    actions.setCustomVariant("");
    actions.setCustomGenomic("");
  }, [actions]);

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

  /**
   * Which field's notation the build-mismatch refusal is about — `null` when the fields no longer hold
   * it, so the prompt is never answered on the reader's behalf.
   *
   * It has to be the ORIGINATING field: a refusal can come from a coordinate (the Genomic field) or
   * from transcript cDNA (the Variant field), and writing the retry into the other one would move the
   * notation between the two alternatives this form keeps separate — changing which field the pipeline
   * reads, and leaving the field it was moved to carrying a notation its own badge calls invalid.
   *
   * A NON-EMPTY SIBLING means the question is stale: the reader has abandoned this coordinate and
   * started another query. Without that half of the guard, clicking the retry silently erased what they
   * had since typed — the notation they were working on, replaced by one they had moved on from.
   */
  const refusedNotation = (result?.metadata?.variant ?? "").trim();
  const buildHintTarget: "genomic" | "variant" | null =
    !result?.buildHint || !refusedNotation
      ? null
      : customGenomic.trim() === refusedNotation
        ? customVariant.trim() === ""
          ? "genomic"
          : null
        : customGenomic.trim() === "" && customVariant.trim() === refusedNotation
          ? "variant"
          : null;
  /**
   * A retry cannot loop: the server offers the other build only after checking that IT carries the
   * submitted allele — so annotating there cannot reproduce the same mismatch at that position — and it
   * withholds the offer when neither build carries the allele. That is also why there is no client-side
   * "already tried that build" guard here: withholding on a STATED build would remove the one-click
   * remedy from the case where the annotation itself is the mistake (an hg19 coordinate labelled
   * GRCh38), which the evidence — the allele matching the other build — actually points at.
   */

  /**
   * Answers the build-mismatch prompt: put the server's annotated spelling in the field it came from
   * and run.
   *
   * The hint's notation already STATES its build (`Chr1(GRCh37):g.…`, `NM_004333.6(GRCh37):c.…`), so
   * this is a complete request and not a re-labelling: the server verifies the locus on that build
   * before annotating, exactly as it does for a hand-typed annotation. The sibling notation field is
   * cleared because the two are alternatives, not additive inputs. The gene field is left alone — the
   * notation resolves its own gene.
   */
  const retryAsHintedBuild = (hint: BuildHint) => {
    if (buildHintTarget === "variant") {
      actions.setCustomVariant(hint.notation);
      actions.setCustomGenomic("");
    } else {
      actions.setCustomGenomic(hint.notation);
      actions.setCustomVariant("");
    }
    onFormSubmit({ preventDefault() {} } as React.FormEvent);
  };

  // Parsed verdicts, shown so the routing the form already performs is visible rather than
  // implied. Routing itself goes through `needsNotationResolution`, so the badge can describe the
  // parser but can never disagree with it.
  const variantNotation = customVariant.trim() ? classifyNotation(customVariant) : null;
  const genomicNotation = customGenomic.trim() ? classifyNotation(customGenomic) : null;
  /**
   * Only a notation the SERVER will resolve from this field gets an assembly claim.
   *
   * This previously asserted "GRCh38 default" for ANY non-empty content — including
   * `p.Gly380Arg` or `asdf` — while simultaneously marking the Gene field "Derived", so the
   * panel claimed a resolution that would never happen, in the one place it exists to be
   * trusted. The kind is the same value that drives routing, so the badge cannot disagree
   * with what the pipeline will actually do.
   *
   * cDNA is included because the translate route accepts it from EITHER notation field (people paste
   * a transcript notation here, and history items land here). Leaving it out marked the Variant field
   * "required" and said this field "only accepts genomic coordinates" for a notation the server had
   * just accepted — and after a build-mismatch retry, that empty sibling field's `required` attribute
   * then blocked the next submit through native validation, with nothing on screen to explain why.
   */
  const genomicIsCoordinate = Boolean(
    genomicNotation &&
      (genomicNotation.kind === "genomic-hgvs" ||
        genomicNotation.kind === "genomic-dashed" ||
        genomicNotation.kind === "genomic-bare" ||
        genomicNotation.kind === "cdna" ||
        // A recognised coordinate that is out of missense scope still routes to the resolver,
        // which explains the scope rather than pretending it is a protein substitution.
        genomicNotation.kind === "non-substitution")
  );
  /**
   * Does the app resolve the notation itself before modelling?
   *
   * True for coordinate/cDNA input AND for accession-qualified protein notation
   * (`NP_001032248.1:p.Lys281Asn`), which carries its own protein and is mapped onto canonical
   * numbering by the server. Both cases derive the gene, so the Gene field is not required.
   * Gated on the parsed kind rather than "the field is non-empty": junk text must not relax the
   * required-field rules.
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
  /**
   * The build control's derived state for the coordinate field.
   *
   * `statedAssemblyOf` reports what the NOTATION says (an inline annotation, or a RefSeq accession),
   * and `"default"` when it says nothing — so the control can distinguish a build the caller stated
   * from the GRCh38 the server falls back to. Choosing a build rewrites the notation, which is why
   * there is no separate value to keep in sync: the text IS the state.
   *
   * Gated on annotatability so the control never appears where it could not act (an indel, or a
   * protein notation typed into the coordinate field).
   */
  const genomicStated = customGenomic.trim() ? statedAssemblyOf(customGenomic) : null;
  const genomicBuild: GenomeAssembly = genomicStated?.build ?? "GRCh38";
  const genomicBuildSource = genomicStated?.source ?? "default";
  const genomicBuildControllable =
    Boolean(customGenomic.trim()) && withAssemblyAnnotation(customGenomic, "GRCh38") !== null;
  const applyGenomicBuild = useCallback(
    (build: GenomeAssembly) => {
      const rewritten = withAssemblyAnnotation(customGenomic, build);
      // Null means the notation carries no build to state — the control is not rendered then, so
      // this is a guard rather than a path.
      if (rewritten) actions.setCustomGenomic(rewritten);
    },
    [customGenomic, actions]
  );
  /**
   * The same control for the VARIANT field, where the build-bearing families are genomic HGVS (people
   * paste coordinates here) and transcript cDNA — `NM_004333.6(GRCh37):c.1799T>A`.
   *
   * A cDNA notation needs it as much as a genomic one: the transcript is read against a reference, so
   * an hg19 transcript sequence against GRCh38 is the same wrong-reference hazard, and until the
   * grammar accepted the annotated form there was no way to state it in this field at all.
   * `withAssemblyAnnotation` returning null is the gate — it is null for protein notations and for a
   * BARE `c.1799T>A` (which names no transcript, so no reference sequence to qualify).
   */
  const variantStated = customVariant.trim() ? statedAssemblyOf(customVariant) : null;
  const variantBuild: GenomeAssembly = variantStated?.build ?? "GRCh38";
  const variantBuildSource = variantStated?.source ?? "default";
  const variantBuildControllable =
    Boolean(customVariant.trim()) && withAssemblyAnnotation(customVariant, "GRCh38") !== null;
  const applyVariantBuild = useCallback(
    (build: GenomeAssembly) => {
      const rewritten = withAssemblyAnnotation(customVariant, build);
      if (rewritten) actions.setCustomVariant(rewritten);
    },
    [customVariant, actions]
  );
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

  /**
   * Loads a complete benchmark query. Unlike a notation example it sets the gene and accession
   * too, so the form is immediately submittable — the notation examples alone never were, because
   * a bare `p.Arg408Trp` still needs a gene.
   */
  const applyPreset = (preset: OnboardingPreset) => {
    setCustomGene(preset.gene);
    setCustomVariant(preset.variant);
    setCustomUniprot(preset.uniprotId);
    setCustomGenomic("");
  };

  // Solid clay, not clay/25: an alpha ring composites to ~1.35:1 on white, far under the 3:1
  // WCAG 2.2 SC 1.4.11 requires of a focus indicator, and `outline-none` removes the native
  // one, so this ring is the only cue. Solid clay measures 3.87:1 on white.
  //
  // Placeholders are reset to normal case: the gene/genomic/UniProt inputs upper-case their VALUE,
  // and `uppercase` also applied to the placeholder, so "E.G. Q9H8M5 (AUTO-RESOLVED IF OMITTED)"
  // shouted beside a lower-case "e.g. p.Gly380Arg".
  const inputBase = `w-full h-10 rounded-[var(--cs-radius-input)] pl-3 pr-10 text-[13px] outline-none border transition-[border-color,box-shadow,background-color] duration-150 ease-out select-text focus:ring-2 focus:ring-[var(--cs-accent-clay)] placeholder:normal-case placeholder:tracking-normal placeholder:font-normal placeholder:text-cs-text-muted ${classInput}`;

  // Derive stage status & metrics for live workflow rail
  const getStageInfo = (stage: (typeof WORKFLOW_STAGES)[number]["key"]) => {
    const raw = getWorkflowStageStatus({
      ...engineState,
      foldingPhase: engineState.foldingProgress?.phase,
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
      isNarrativeLoading,
      hasStructureCoordinates: Boolean(loadedPdb)
    });
    /**
     * Display labels for the workflow states. "In Progress" was retired — it is in
     * `LEGACY_ENGINE_LABELS` (`engineStatus.ts`), which bans it precisely because it implies waiting
     * forever, and a stalled stage rendered with it looked identical to a working one.
     *
     * Callers branch on `rawStatus`, never on the display word.
     */
    const statusMap: Record<string, string> = {
      complete: "Complete",
      progress: "Running",
      pending: "Pending",
      degraded: "Degraded",
      error: "Error",
      unavailable: "Unavailable",
      "on-demand": "On demand"
    };
    return {
      status: statusMap[raw.status] || raw.status,
      rawStatus: raw.status,
      desc: raw.desc
    };
  };

  const stageInfos = WORKFLOW_STAGES.map(stage => ({ stage, info: getStageInfo(stage.key) }));
  const summary = summarizeWorkflowStatuses(stageInfos.map(({ info }) => info.rawStatus));
  const settledCount = summary.settled;
  const hasRun = Boolean(result) || isPipelineActive;
  const progressPct = summary.percent;

  const pipelineStatusLabel = isForegroundActive
    ? "Loading evidence"
    : result
    ? isPipelineActive ? "Workspace ready · Enriching" : summary.hasProblems ? "Workspace ready · Partial results" : "Workspace ready"
    : "Pipeline ready";

  return (
    <div className="w-full flex flex-col gap-6 cs-fade-in" id="variant-search-workspace">
      {/* ── Page header ─────────────────────────────────────────────────────────────────────── */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-medium tracking-tight text-cs-text-primary">Analyse a variant</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-cs-text-secondary max-w-2xl">
            Give a gene and protein change, or genomic coordinates. Evidence, structure and stability
            arrive independently. AI synthesis is optional.
          </p>
        </div>

        {/* The API-key notice lives in the app header only — this page used to repeat it here AND
            in the header, two warnings for one fact. The form footer still names the consequence. */}
      </header>

      {/* ── Main grid: form (8) + rail (4) ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5 items-stretch">
        {/* ── Left column: query form, then recent analyses ──
            At lg the grid row is as tall as the rail's floor, so the form (whose
            footer already pins via mt-auto) takes the leftover height instead of
            letting it pool under the recents card — both panels then share one
            bottom line with the rail. Below lg the row is content-sized, so the
            grow is inert. */}
        <div className="lg:col-span-8 flex flex-col gap-6 min-w-0">
        <section
          className="cs-panel flex flex-col flex-1"
          data-tour="variant-input"
          id="variant-input-card"
          aria-labelledby="variant-form-title"
        >
          <h2 id="variant-form-title" className="sr-only">Variant query</h2>

          <form onSubmit={onFormSubmit} className="flex flex-col flex-1">
            {/* flex-1: this is the slab that stretches to the panel floor; the AI field inside
                it takes the leftover, so no dead gap pools above the pinned footer. */}
            <div className="p-6 flex flex-col gap-6 flex-1 min-h-0">
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

              {result?.buildHint && buildHintTarget && !isPipelineActive ? (
                <BuildMismatchPrompt
                  notation={refusedNotation}
                  hint={result.buildHint}
                  buildDeclared={result.coordinateLift?.buildDeclared}
                  onRetry={retryAsHintedBuild}
                />
              ) : null}

              {/* Protein identity */}
              <fieldset className="flex flex-col gap-3">
                <legend className="text-[13px] font-semibold text-cs-text-primary mb-3">Protein</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel
                      htmlFor="input-gene-symbol"
                      required={isGeneRequired}
                      badge={
                        !isGeneRequired ? (
                          <FieldBadge tone="clay" title="Your coordinate notation resolves the gene, so this field is not required.">
                            Derived
                          </FieldBadge>
                        ) : null
                      }
                    >
                      Gene symbol
                    </FieldLabel>
                    <div className="relative">
                      <input
                        id="input-gene-symbol"
                        type="text"
                        required={isGeneRequired}
                        placeholder="e.g. CNNM2"
                        autoComplete="off"
                        spellCheck={false}
                        value={customGene}
                        onChange={(e) => setCustomGene(e.target.value)}
                        className={inputBase + " font-mono font-medium uppercase tracking-wide"}
                      />
                      <PasteBtn setter={setCustomGene} />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <FieldLabel
                      htmlFor="input-uniprot-acc"
                      badge={
                        <FieldBadge
                          tone={uniprotLooksValid ? (customUniprot.trim() ? "ok" : "neutral") : "warn"}
                          title={
                            uniprotLooksValid
                              ? "Optional: the accession is auto-resolved from the gene when omitted."
                              : "Accessions are 6 or 10 alphanumerics, e.g. Q9H8M5. Check for a typo."
                          }
                        >
                          {customUniprot.trim() ? (uniprotLooksValid ? "Format OK" : "Check format") : "Auto-resolved"}
                        </FieldBadge>
                      }
                    >
                      UniProt accession
                    </FieldLabel>
                    <div className="relative">
                      <input
                        id="input-uniprot-acc"
                        type="text"
                        placeholder="e.g. Q9H8M5"
                        autoComplete="off"
                        spellCheck={false}
                        value={customUniprot}
                        onChange={(e) => setCustomUniprot(e.target.value)}
                        aria-invalid={!uniprotLooksValid || undefined}
                        className={inputBase + " font-mono uppercase"}
                      />
                      <PasteBtn setter={setCustomUniprot} />
                    </div>
                  </div>
                </div>
              </fieldset>

              {/* Variant — two alternative routes, shown side by side with an explicit "or" */}
              <fieldset className="flex flex-col" id="workspace-accepted-inputs">
                <legend className="w-full flex items-baseline justify-between gap-2 mb-3">
                  <span className="text-[13px] font-semibold text-cs-text-primary">Variant</span>
                  <span className="text-[11px] text-cs-text-muted">Use one or the other</span>
                </legend>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-x-3 gap-y-4 items-start">
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <FieldLabel
                      htmlFor="input-variant-notation"
                      required={isVariantRequired}
                      /**
                       * This field now states a build too, for the two families that carry one:
                       * genomic HGVS pasted here, and transcript cDNA. It takes the same slot and
                       * metrics as the coordinate field's control, so the two fields read alike.
                       */
                      action={
                        variantBuildControllable ? (
                          <BuildSelect
                            value={variantBuild}
                            source={variantBuildSource}
                            /**
                             * Derived, not hardcoded: an accessioned GENOMIC coordinate lands in this
                             * field too (history items, a paste), and a select that announced "this
                             * cDNA" beside a "Genomic → resolve" badge would be describing a notation
                             * the reader is not looking at.
                             */
                            subject={variantNotation?.kind === "cdna" ? "cDNA" : "coordinate"}
                            onChange={applyVariantBuild}
                          />
                        ) : undefined
                      }
                      badge={
                        /**
                         * ONE thing in this slot, exactly as the coordinate field does it: when the
                         * control is shown it already names the family and the build, so the verdict
                         * badge beside it would be two `shrink-0` items in a pinned 20px row — where
                         * only the label can give, and it wraps into the input below.
                         */
                        variantBuildControllable ? null : variantNotation ? (
                          <FieldBadge tone={NOTATION_BADGES[variantNotation.kind].tone} title={NOTATION_BADGES[variantNotation.kind].title}>
                            {NOTATION_BADGES[variantNotation.kind].label}
                          </FieldBadge>
                        ) : !isVariantRequired ? (
                          <FieldBadge title="Your genomic coordinates define the variant, so this field is not required.">
                            Optional
                          </FieldBadge>
                        ) : null
                      }
                    >
                      Protein or cDNA notation
                    </FieldLabel>
                    <div className="relative">
                      <input
                        id="input-variant-notation"
                        type="text"
                        required={isVariantRequired}
                        placeholder="e.g. p.Gly380Arg"
                        autoComplete="off"
                        spellCheck={false}
                        value={customVariant}
                        onChange={(e) => setCustomVariant(e.target.value)}
                        className={inputBase + " font-mono font-medium"}
                      />
                      <PasteBtn setter={setCustomVariant} />
                    </div>
                    <ExampleRow group={NOTATION_EXAMPLE_GROUPS[0]} onPick={applyNotationExample} />
                  </div>

                  <div className="hidden md:flex flex-col items-center self-stretch pt-5" aria-hidden="true">
                    <span className="h-10 flex items-center text-[11px] font-medium text-cs-text-muted">or</span>
                  </div>

                  <div className="flex flex-col gap-1.5 min-w-0">
                    <FieldLabel
                      htmlFor="input-genomic-coords"
                      /**
                       * The right-hand slot states, and SETS, the build.
                       *
                       * It used to hold a passive badge ("GRCh38 default" / "GRCh37 annotated") in
                       * exactly this position; the control takes that slot's metrics and tones, so
                       * the claim a reader already looked for here is now the thing they can change
                       * — no new row, no layout shift.
                       */
                      action={
                        genomicBuildControllable ? (
                          <BuildSelect
                            value={genomicBuild}
                            source={genomicBuildSource}
                            subject="coordinate"
                            onChange={applyGenomicBuild}
                          />
                        ) : undefined
                      }
                      badge={
                        /**
                         * ONE thing in this slot, as measured: when the control is shown it already
                         * states the build (and says whether it was stated or assumed), so the
                         * assembly-label badge beside it would be the same fact twice in a 20px row.
                         * The verdict badge has no such twin — it says the notation is not a
                         * coordinate at all, which is exactly when no control is shown.
                         */
                        genomicBuildControllable ? null : genomicNotation && !genomicIsCoordinate ? (
                          <FieldBadge
                            tone={NOTATION_BADGES[genomicNotation.kind].tone}
                            title={`${NOTATION_BADGES[genomicNotation.kind].title} This field only accepts genomic coordinates.`}
                          >
                            {NOTATION_BADGES[genomicNotation.kind].label}
                          </FieldBadge>
                        ) : (
                          <FieldBadge
                            tone={genomicAssemblyLabel ? "clay" : "neutral"}
                            title={genomicAssemblyLabel ? "Genome build this coordinate will be resolved against." : "Optional: protein-level notation alone is enough to run the analysis."}
                          >
                            {genomicAssemblyLabel ?? "Optional"}
                          </FieldBadge>
                        )
                      }
                    >
                      Genomic coordinates
                    </FieldLabel>
                    <div className="relative">
                      <input
                        id="input-genomic-coords"
                        type="text"
                        placeholder="e.g. 20-23365054-G-A"
                        autoComplete="off"
                        spellCheck={false}
                        value={customGenomic}
                        onChange={(e) => setCustomGenomic(e.target.value)}
                        className={inputBase + " font-mono"}
                      />
                      <PasteBtn setter={setCustomGenomic} />
                    </div>
                    <ExampleRow group={NOTATION_EXAMPLE_GROUPS[1]} onPick={applyNotationExample} />
                  </div>
                </div>
              </fieldset>

              {/* AI focus (optional) — an open field, not a disclosure.
                  The workspace form flexes to share one bottom line with the rail, so a collapsed
                  disclosure under the Variant field left nothing between itself and the footer,
                  while the panel stretched — the dead space the open field now fills: the block
                  takes the leftover height and the writing surface grows with it (capped, so a
                  very tall window pools only modest slack below it). Label, badge and hint row
                  follow the same anatomy as every other field. */}
              <fieldset className="flex flex-col gap-1.5 flex-1 min-h-0">
                <FieldLabel
                  htmlFor="textarea-user-directions"
                  badge={
                    hasDirections ? (
                      <FieldBadge tone="clay" title="Custom analysis instructions are set and will direct the AI narrative.">
                        {userDirections.trim().length} chars
                      </FieldBadge>
                    ) : (
                      <FieldBadge title="Steer the AI synthesis; biophysical stages run without it.">
                        Optional
                      </FieldBadge>
                    )
                  }
                >
                  AI focus &amp; custom instructions
                </FieldLabel>
                <textarea
                  id="textarea-user-directions"
                  aria-label="AI Focus Area & Custom Analysis Instructions"
                  aria-describedby="user-directions-privacy"
                  placeholder="e.g. Focus on disruption of the cofactor-binding loop, or weigh ACMG PM2/PS3."
                  value={userDirections}
                  onChange={(e) => {
                    const text = e.target.value.slice(0, 2000);
                    setUserDirections(text);
                  }}
                  maxLength={2000}
                  className="w-full rounded-[var(--cs-radius-input)] border border-cs-border bg-cs-surface px-2.5 py-2 text-[13px] leading-relaxed text-cs-text-primary outline-none resize-none min-h-[88px] flex-1 max-h-[224px] select-text placeholder:text-cs-text-muted transition-[border-color,box-shadow] duration-150 ease-out focus:ring-2 focus:ring-[var(--cs-accent-clay)] focus:border-[var(--cs-accent-clay)]"
                />
                <div className="flex justify-between items-start gap-3 text-[11px] text-cs-text-muted">
                  <span id="user-directions-privacy" className="flex items-start gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px text-[var(--cs-text-warning)]" />
                    Do not include patient identifiers (names, MRNs, dates of birth).
                  </span>
                  <span className="tabular-nums shrink-0">{userDirections.length}/2000</span>
                </div>
              </fieldset>
            </div>

            {/* ── Form footer: hint left, primary action right ── */}
            <div className="mt-auto flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-t border-cs-border-subtle bg-cs-surface-2/60">
              {/* Keyless-first: every stage runs without a key, and the narrative stage returns its
                  designed "AI not configured" report (rule-based ACMG from database metrics). The key
                  only adds the written interpretation, so it is a note here, never a gate — a gate
                  here was also bypassed by the history chips and the benchmarks, which always ran. */}
              <p className="text-[11px] text-cs-text-muted flex flex-wrap items-center gap-x-1.5 gap-y-1">
                {settings?.narrativeMode === "off" ? (
                  <span>AI synthesis is off. Evidence and classification remain available.</span>
                ) : settings?.narrativeMode === "on-demand" ? (
                  <span>AI synthesis is available on demand in Report.</span>
                ) : hasConfiguredGeminiKey ? (
                  <>
                    <kbd className="inline-flex items-center gap-1 h-5 px-1.5 rounded border border-cs-border bg-cs-surface font-sans text-[11px] text-cs-text-secondary">
                      <CornerDownLeft className="w-3 h-3" />
                      Enter
                    </kbd>
                    runs from any field
                  </>
                ) : (
                  <>
                    <span>Evidence and rule-based classification work without Gemini.</span>
                    <button
                      type="button"
                      onClick={() => openSettingsTab("connections")}
                      className="font-medium text-cs-text-accent underline-offset-2 hover:underline cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
                    >
                      Add a key
                    </button>
                  </>
                )}
              </p>

              <div className="flex items-center gap-2 sm:ml-auto">
                {/* Quiet secondary action beside the primary one. Disabled while the fields are
                    already empty — an inert Clear in a footer reads as a dead control, and the
                    form states its own fill state through the badges that fields already wear. */}
                <button
                  type="button"
                  onClick={clearQueryFields}
                  disabled={
                    !customGene.trim() &&
                    !customUniprot.trim() &&
                    !customVariant.trim() &&
                    !customGenomic.trim()
                  }
                  aria-label="Clear query fields"
                  className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-[var(--cs-radius-input)] text-[12.5px] font-medium text-cs-text-secondary hover:text-cs-text-primary hover:bg-cs-bg-subtle cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
                >
                  <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                  Clear
                </button>
                <button
                  type="submit"
                  disabled={isForegroundActive}
                  aria-label="Analyse variant"
                  className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-[var(--cs-radius-input)] text-[14px] font-medium text-white bg-cs-accent-clay hover:brightness-[1.06] active:brightness-95 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition-[filter,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--cs-surface)] sm:min-w-[168px]"
                >
                  {isForegroundActive ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Analysing…
                    </>
                  ) : (
                    <>
                      Analyse variant
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </section>

          {/* ── Recent analyses / first-run benchmarks ──
              Boxed on the same panel surface as the form and the rail, so the lower
              row reads as a third structural element instead of loose chips under
              the panel — the workspace then closes with the same two-surface rhythm
              it opens with. */}
        <section aria-labelledby="recent-title" className="cs-panel p-4 flex flex-col gap-3" data-tour="recent-benchmarks">
          {history.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <h2 id="recent-title" className="text-[13px] font-semibold text-cs-text-primary">
                  Recent analyses <span className="ml-1 font-normal text-cs-text-muted tabular-nums">{history.length}</span>
                </h2>
                <button
                  type="button"
                  onClick={clearHistory}
                  className="inline-flex items-center gap-1.5 h-7 px-2 rounded-[var(--cs-radius-input)] text-[12px] text-cs-text-muted hover:text-[var(--cs-text-danger-on-soft)] hover:bg-[var(--cs-bg-danger)] cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
                  title="Clear search history"
                  aria-label="Clear search history"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {history.slice(0, 8).map((item, idx) => {
                  const isActive = gene === item.gene && variant === item.variant;
                  return (
                    <button
                      key={`${item.gene}_${item.variant}_${idx}`}
                      type="button"
                      onClick={() => runFromHistory(item)}
                      aria-pressed={isActive}
                      className={`inline-flex items-center gap-2 h-8 px-3 rounded-[var(--cs-radius-input)] border text-[12px] cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)] ${
                        isActive
                          ? "border-cs-accent-clay bg-cs-accent-clay/10"
                          : "border-cs-border-subtle bg-cs-surface hover:border-cs-border hover:bg-cs-surface-2"
                      }`}
                      title={`Reload ${item.gene} ${item.variant}`}
                      aria-label={`Select recent search ${item.gene} ${item.variant}`}
                    >
                      <span className="font-semibold text-cs-text-primary">{item.gene}</span>
                      <span className="font-mono text-[11.5px] text-cs-text-secondary">{formatVariantForDisplay(item.variant)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
                <div>
                  <h2 id="recent-title" className="text-[13px] font-semibold text-cs-text-primary">No recent analyses</h2>
                  <p className="text-[12px] text-cs-text-muted mt-0.5">
                    Variants you analyse in this session will appear here. To start, load a benchmark control:
                  </p>
                </div>
                {onOpenOnboarding && (
                  <button
                    type="button"
                    onClick={onOpenOnboarding}
                    className="self-start sm:self-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--cs-radius-input)] text-[12px] font-medium text-cs-text-secondary hover:text-cs-text-primary hover:bg-cs-bg-subtle cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    Take the tour
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ONBOARDING_BENCHMARK_PRESETS.map(preset => (
                  <button
                    key={preset.gene + preset.variant}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    aria-label={`Load benchmark ${preset.gene} ${preset.variant}`}
                    title={preset.description}
                    className="group text-left flex flex-col gap-0.5 px-3 py-2.5 rounded-[var(--cs-radius-card)] border border-cs-border-subtle bg-cs-surface hover:border-cs-border hover:bg-cs-surface-2 cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="text-[12.5px] font-semibold text-cs-text-primary">{preset.gene}</span>
                      <span className="font-mono text-[11.5px] text-cs-text-secondary">{preset.variant}</span>
                    </span>
                    <span className="text-[11px] text-cs-text-muted">{preset.tag}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
        </div>

        {/* ── Rail: services / pipeline ──
            From `lg` up the rail's content is taken out of flow (absolute fill) over a fixed floor, so
            neither tab can resize the row and switching tabs never moves the page; the services list
            scrolls inside it with a fade as the cue. Below `lg` the columns stack and the list flows
            instead — a nested scroller inside a scrolling page is a trap on touch. */}
        <aside
          className="cs-panel lg:col-span-4 lg:relative min-h-[480px] lg:min-h-[672px] flex flex-col"
          data-tour="workflow-rail"
          id="workspace-stage-rail"
          aria-label="Services and pipeline"
        >
          <div className="flex flex-col gap-4 p-4 flex-1 min-h-0 lg:absolute lg:inset-0">
            <div
              ref={railTabListRef}
              role="tablist"
              aria-label="Analysis sidebar view switcher"
              onKeyDown={handleRailKeyDown}
              className="relative flex items-center gap-1 p-1 rounded-[var(--cs-radius-input)] bg-cs-surface-2 shrink-0"
            >
              {/* Sliding active thumb — the one surface that says which segment is selected, so a
                  switch (click, arrow key, or the auto-switch when a run starts) reads as a glide
                  instead of one background vanishing and another appearing. Geometry of exactly
                  two equal segments: half the track minus the gap share is one slot; sliding by
                  its own width plus the 4px gap lands on the other. Transform is the only
                  animated property, and reduced motion freezes it in place (the position itself
                  remains the static cue). */}
              <span
                aria-hidden="true"
                className={`absolute top-1 bottom-1 left-1 w-[calc(50%-6px)] rounded-md bg-cs-surface shadow-[0_0_0_1px_var(--cs-border)] transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${
                  activeRightTab === "telemetry" ? "translate-x-0" : "translate-x-[calc(100%+4px)]"
                }`}
              />
              <RailTab
                id="telemetry"
                active={activeRightTab === "telemetry"}
                tabIndex={activeRightTab === "telemetry" ? 0 : -1}
                onSelect={() => selectRailTab("telemetry")}
                label="Services"
              />
              <RailTab
                id="pipeline"
                active={activeRightTab === "pipeline"}
                tabIndex={activeRightTab === "pipeline" ? 0 : -1}
                onSelect={() => selectRailTab("pipeline")}
                label="Pipeline"
                badge={
                  isPipelineActive ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-cs-accent-clay animate-pulse shrink-0" aria-label="running" />
                  ) : result && summary.hasProblems ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--cs-text-warning)] shrink-0" aria-label="partial results" />
                  ) : result ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--cs-text-success)] shrink-0" aria-label="complete" />
                  ) : null
                }
              />
            </div>

            {activeRightTab === "telemetry" ? (
              <div key="telemetry" id="panel-telemetry" role="tabpanel" aria-labelledby="tab-telemetry" className="flex-1 min-h-0 flex flex-col cs-tab-transition">
                <LiveTelemetryPanel className="flex-1 min-h-0" />
              </div>
            ) : (
              <div key="pipeline" id="panel-pipeline" role="tabpanel" aria-labelledby="tab-pipeline" className="flex-1 min-h-0 flex flex-col gap-3 cs-tab-transition">
                {/* Status line + progress. The count is derived from the list, never a literal. */}
                <div className="flex flex-col gap-2 shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium text-cs-text-primary inline-flex items-center gap-2">
                      {isPipelineActive ? (
                        <span className="cs-spinner" aria-hidden="true" />
                      ) : result && summary.hasProblems ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-[var(--cs-text-warning)]" />
                      ) : result ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[var(--cs-text-success)]" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-cs-border" aria-hidden="true" />
                      )}
                      {pipelineStatusLabel}
                    </span>
                    <span className="text-[11px] tabular-nums text-cs-text-muted">
                      {hasRun
                        ? `${settledCount} of ${summary.total} settled`
                        : `${WORKFLOW_STAGES.length} stages`}
                    </span>
                  </div>
                  {hasRun && (
                    <div
                      className="h-1 rounded-full bg-cs-surface-2 overflow-hidden"
                      role="progressbar"
                      aria-label="Pipeline progress"
                      aria-valuemin={0}
                      aria-valuemax={summary.total}
                      aria-valuenow={settledCount}
                    >
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ease-out ${isPipelineActive ? "bg-cs-accent-clay" : "bg-[var(--cs-text-success)]"}`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  )}
                  {isPipelineActive && loadingStep && (
                    <p className="text-[11px] text-cs-text-muted truncate" aria-live="polite">{loadingStep}</p>
                  )}
                </div>

                {/* Stepper */}
                <ol className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col">
                  {stageInfos.map(({ stage: { key, title, Icon, targetView }, info }, i) => {
                    const isClickable = !!result && !!onViewChange;
                    /* Branch on the state, not the rendered word: `info.status` is a display label. */
                    const isRunning = info.rawStatus === "progress";
                    const isDone = info.rawStatus === "complete";
                    const isDegraded = info.rawStatus === "degraded";
                    const isErr = info.rawStatus === "error";
                    const isLast = i === WORKFLOW_STAGES.length - 1;

                    const node = isRunning
                      ? "border-cs-accent-clay text-cs-accent-clay bg-cs-surface"
                      : isDone
                      ? "border-transparent bg-[var(--cs-bg-success)] text-[var(--cs-text-good-on-soft)]"
                      : isDegraded || isErr
                      ? "border-transparent bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning-on-soft)]"
                      : "border-cs-border-subtle bg-cs-surface text-cs-text-muted";

                    return (
                      <li key={key} className="relative flex">
                        {/* connector */}
                        {!isLast && (
                          <span
                            className={`absolute left-[19px] top-[34px] bottom-[-2px] w-px ${isDone ? "bg-[var(--cs-text-success)]/40" : "bg-cs-border-subtle"}`}
                            aria-hidden="true"
                          />
                        )}
                        <div
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
                          className={`group flex-1 min-w-0 flex items-start gap-3 px-1.5 py-1.5 rounded-[var(--cs-radius-input)] select-none transition-colors duration-150 ${
                            isClickable
                              ? "cursor-pointer hover:bg-cs-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
                              : ""
                          }`}
                        >
                          {/* One icon slot: the stage's identity while idle, the state glyph once
                              there is a state worth reporting. The running glyph is the house
                              border-arc (`cs-spinner`), not a scaled SVG: at 14px an SVG stroke
                              lands on fractional pixels and reads pixelated, while a 1.5px
                              border rasterises cleanly. Bare variant — no track inside the ring. */}
                          <span className={`relative z-[1] w-[26px] h-[26px] shrink-0 rounded-full border flex items-center justify-center ${node}`}>
                            {isRunning ? (
                              <span className="cs-spinner cs-spinner-bare" aria-hidden="true" />
                            ) : isDone ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : isDegraded || isErr ? (
                              <AlertTriangle className="w-3.5 h-3.5" />
                            ) : (
                              <Icon className="w-3.5 h-3.5" />
                            )}
                          </span>

                          <div className="flex flex-col min-w-0 flex-1 pt-[3px] pb-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[12.5px] font-medium text-cs-text-primary truncate">{title}</span>
                              {/* The state word ends flush at the panel edge, and ONE trailing slot
                                  serves both the word and the go-affordance: the word is the resting
                                  state, and hovering or keyboard-focusing a clickable row cross-fades
                                  it into the arrow at the same spot. The arrow used to trail OUTSIDE
                                  this column — opacity-0 yet space-occupying — which shoved every
                                  status word ~26px off the edge whenever a result made the rows
                                  clickable, and let the words jump as clickability turned over.
                                  Pending before any run says nothing; the word appears once it does. */}
                              {hasRun && (
                                <span
                                  className={`relative shrink-0 flex items-center justify-end min-h-[18px] text-[11px] ${
                                    isRunning
                                      ? "text-cs-text-accent"
                                      : isDone
                                      ? "text-[var(--cs-text-good-on-soft)]"
                                      : isDegraded || isErr
                                      ? "text-[var(--cs-text-warning-on-soft)]"
                                      : "text-cs-text-muted"
                                  }`}
                                >
                                  <span
                                    className={`transition-opacity duration-150 ${
                                      isClickable ? "group-hover:opacity-0 group-focus-visible:opacity-0" : ""
                                    }`}
                                  >
                                    {info.status}
                                  </span>
                                  {isClickable && (
                                    <ArrowRight
                                      className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cs-text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150"
                                      aria-hidden="true"
                                    />
                                  )}
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] leading-snug text-cs-text-muted line-clamp-2">{info.desc}</span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>

                {/* Explore-early hint, in the dead space under the last step. Identifies the
                    stages that already settled so the pointer is to real content, and reads
                    as a passive notice (mirrors the house callouts) with one clay accent that
                    says the workspace is live now — not that the pipeline is done. */}
                {isPipelineActive && exploreHintVisible && (() => {
                  const readyStages = stageInfos.filter(({ info }) => info.rawStatus === "complete");
                  const readyList = readyStages
                    .map(({ stage }) => stage.title)
                    .slice(0, 3)
                    .join(", ");
                  const remaining = readyStages.length > 3 ? `\u00A0+${readyStages.length - 3}` : "";
                  return (
                    <div
                      role="status"
                      className="relative shrink-0 flex items-start gap-2.5 px-3 py-2.5 rounded-[var(--cs-radius-card)] border border-cs-accent-clay/25 bg-cs-accent-clay/[0.06] cs-fade-in"
                    >
                      <Compass className="w-3.5 h-3.5 mt-0.5 text-cs-text-accent shrink-0" aria-hidden="true" />
                      <p className="m-0 text-[11px] leading-snug text-cs-text-secondary">
                        <span className="font-medium text-cs-text-primary">No need to wait —</span>{" "}
                        {readyList ? (
                          <>the workspace is already live: <span className="text-cs-text-primary">{readyList}</span>{remaining} are ready to explore.</>
                        ) : (
                          <>the workspace keeps updating as each stage lands — feel free to look around in the meantime.</>
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          exploreHintDismissedRef.current = true;
                          setExploreHintVisible(false);
                        }}
                        title="Dismiss notice"
                        aria-label="Dismiss notice"
                        className="absolute top-1.5 right-1.5 p-1 rounded-[var(--cs-radius-badge)] text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-surface-2 cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
                      >
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })()}

                {result && !isPipelineActive && onViewChange && (
                  <p className="text-[11px] text-cs-text-muted shrink-0">Select a stage to open it.</p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

    </div>
  );
}

export default React.memo(VariantSearchPanel);
