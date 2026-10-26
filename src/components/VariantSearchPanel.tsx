import { ResearchGuideButton } from "./knowledge/ResearchGuideButton";
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Trash2,
  ChevronDown,
  ChevronRight,
  Search,
  Sparkles,
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
  X,
  Eraser,
  ExternalLink,
} from "lucide-react";
import { AnalysisState, SearchHistoryItem } from "../types";
import { EVIDENCE_SUB_ITEMS, MasterView } from "./MasterSidebar";
import { useVariantAnalysisStore, useVariantAnalysisActions } from "../context/VariantAnalysisContext";
import { useSettings } from "../context/SettingsContext";
import { getWorkflowStageStatus, isOnDemandView, summarizeWorkflowStatuses } from "../shared/workflowStatus";
import { evidenceTabsLoading } from "../shared/evidenceTabProgress";
import { landscapeKey } from "../shared/landscapeEvidence";
import {
  needsNotationResolution,
  classifyNotation,
  cdnaReferenceProblem,
  isGenomicOrCdnaNotation,
  ACCEPTED_NOTATION_EXAMPLES,
  type GenomeAssembly,
  type NotationKind,
} from "../shared/variantNotation.ts";
import { ASSEMBLY_LABELS, statedAssemblyOf, withAssemblyAnnotation } from "../shared/assembly";
import { parseVariantCoordinate } from "../shared/variantCoordinate";
import { readQuickEntry, composeQuickEntry, quickEntryMatches } from "../shared/quickEntry";
import { ONBOARDING_BENCHMARK_PRESETS, type OnboardingPreset } from "../shared/benchmarkPresets";
import NumberingChoicePrompt from "./NumberingChoicePrompt";
import BuildMismatchPrompt from "./BuildMismatchPrompt";
import type { BuildHint, NumberingChoice } from "../shared/contracts";
import LiveTelemetryPanel from "./telemetry/LiveTelemetryPanel";

/* Variant query workbench: serif heading, a primary query composer, and a separate status rail.
   Theme tokens carry colour; optional editors expand without stretching the empty form. */

const PasteBtn: React.FC<{ setter: (v: string) => void }> = ({ setter }) => (
  <button
    type="button"
    tabIndex={-1}
    title="Paste from clipboard"
    aria-label="Paste from clipboard"
    onClick={() => pasteFromClipboard(setter)}
    className="qe-input__tool cs-tap-44"
  >
    <Clipboard className="w-3.5 h-3.5" />
  </button>
);

interface VariantSearchPanelProps {
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

/**
 * How many stages the automatic run settles, and how many the reader opens on demand. Derived from the
 * list above through the same predicate the progress maths uses, so the idle label ("6 core · 1
 * on-demand") and the in-flight count ("N of 6 settled") cannot quote different totals.
 */
export const WORKFLOW_STAGE_COUNTS = (() => {
  const onDemand = WORKFLOW_STAGES.filter(stage => isOnDemandView(stage.key)).length;
  return { core: WORKFLOW_STAGES.length - onDemand, onDemand } as const;
})();

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
 * Field-state marks, in the composer's own grammar: the parse ticket above marks a cell's kind with a
 * 6px dot (`.qe__kind`), so a field label says the same thing the same way — a toned dot and quiet
 * text. Tinted pills used to carry it (green, clay), which made the folded form the only part of the
 * panel that spoke in chips, and its colours a second vocabulary for one meaning.
 *
 * `warn` is the exception and stays a soft amber chip: it is the one state that asks for action, and
 * it matches the "Needs a look" chip on the disclosure that opens this form. `neutral` ("Optional",
 * "Auto-resolved") is a fact about the field, not a state, so it is plain muted text with no dot.
 */
const FIELD_BADGE_TONES: Record<FieldBadgeTone, string> = {
  neutral: "text-cs-text-muted",
  ok: "text-cs-text-secondary",
  clay: "text-cs-text-secondary",
  warn: "px-1.5 rounded-[var(--cs-radius-badge)] bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning-on-soft)]",
};

/**
 * Micro-badge occupying the right-hand slot of a field label.
 *
 * Every label uses the slot the same way, so "is this field required, and what did the parser
 * make of it?" is always read from the same place. Height is pinned so a badge appearing on a
 * keystroke never nudges the input beneath it.
 */
const FieldBadge: React.FC<{ tone?: FieldBadgeTone; title?: string; id?: string; children: React.ReactNode }> = ({
  tone = "neutral",
  title,
  id,
  children,
}) => (
  <span
    id={id}
    title={title}
    className={`inline-flex h-5 items-center gap-1.5 text-[11px] font-medium leading-4 shrink-0 whitespace-nowrap ${FIELD_BADGE_TONES[tone]}`}
  >
    {tone === "ok" || tone === "clay" ? <span className="qe__kind" data-tone={tone} aria-hidden="true" /> : null}
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
  rsid: {
    label: "dbSNP → resolve",
    tone: "clay",
    title:
      "dbSNP identifier. Resolved to its GRCh38 coordinate, then to a protein substitution. An rsID with several alternate alleles is not guessed — each allele is offered to run.",
  },
  "clinvar-vcv": {
    label: "ClinVar → resolve",
    tone: "clay",
    title:
      "ClinVar Variation ID. Resolved to its GRCh38 coordinate (canonical SPDI), then to a protein substitution.",
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
 * Copy the form states in more than one place. Held as constants so the hint and the test that pins it
 * cannot drift apart.
 */
const GENE_REQUIRED_HINT =
  "Enter a gene symbol above (e.g. NAE1) or prefix a transcript (e.g. NM_003905.4:c.347A>G).";
const COORDINATE_ACCEPTS_COPY = "Accepts chr-pos-ref-alt, VCF rows, rsIDs or ClinVar VCV IDs.";
const ROUTE_DERIVED_COPY = "Coordinate route active — gene and canonical protein are derived automatically";
/**
 * The conflict copy, built from both sides. Naming only one of them leaves the reader to guess which
 * value belongs to which field, and this strip is the only place the disagreement is stated.
 */
const routeConflictCopy = (resolved: string, typed: string) =>
  `This coordinate resolves to ${resolved}, not ${typed}. The coordinate is analysed.`;
/**
 * The both-filled state with nothing to warn about: both fields hold the SAME substitution (the app
 * resolves a coordinate to the protein change and puts it in the other field, so this is the ordinary
 * case), or this session has no resolution for this coordinate yet. Quiet 11px text, no button — the
 * strip still has to say which route the submit takes, it just has no conflict to report.
 */
const ROUTE_BOTH_QUIET_COPY = "Using the coordinate; the protein/cDNA field is not analysed.";

/**
 * A protein substitution as the three facts that decide identity: which residue, and what it becomes.
 *
 * Parsed rather than compared as text, because the same change is legitimately written four ways —
 * `p.Asp116Gly`, `p.D116G`, `D116G`, `DA116G` (FoldX) — and a text comparison would call those a
 * conflict. Returns null for anything that is not a single substitution (a cDNA or coordinate string,
 * an indel, junk), which is the signal for "cannot be judged" rather than "differs".
 */
function substitutionOf(notation: string): { pos: number; wt1: string; mut1: string } | null {
  if (!notation.trim()) return null;
  try {
    const parsed = parseVariantCoordinate(notation);
    return { pos: parsed.pos, wt1: parsed.wt1, mut1: parsed.mut1 };
  } catch {
    return null;
  }
}

function sameSubstitution(
  a: { pos: number; wt1: string; mut1: string },
  b: { pos: number; wt1: string; mut1: string }
): boolean {
  return a.pos === b.pos && a.wt1 === b.wt1 && a.mut1 === b.mut1;
}

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
      // Identifiers belong in this field because it is the one that accepts them: the server resolves them
      // to a coordinate, and the field's helper line lists them.
      ACCEPTED_NOTATION_EXAMPLES.rsid,
      ACCEPTED_NOTATION_EXAMPLES.clinvarVcv,
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
 * An underline marks the active view; focus remains distinct from selection.
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
    className="workbench-monitor-tab"
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
  const rowClass = "qe-field-label";

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
  id?: string;
  onChange: (build: GenomeAssembly) => void;
}> = ({ value, source, subject, id, onChange }) => {
  const stated = source !== "default";
  const title = stated
    ? `Genome build: ${ASSEMBLY_LABELS[value]} (stated ${source === "accession" ? "by the RefSeq accession" : "in the notation"})`
    : `Genome build: ${ASSEMBLY_LABELS[value]} (default — choose a build to state it in the notation)`;
  const select = (className: string) => (
    <select
      id={id}
      aria-label={`Genome build this ${subject} is expressed in`}
      title={title}
      value={value}
      onChange={(event) => onChange(event.target.value as GenomeAssembly)}
      className={className}
    >
      <option value="GRCh38">{ASSEMBLY_LABELS.GRCh38}</option>
      <option value="GRCh37">{ASSEMBLY_LABELS.GRCh37}</option>
    </select>
  );

  return (
    // The label-slot form: badge metrics (20px row, 11px text), a dot for the state, and a caret drawn
    // in the text colour because `appearance-none` removes the native arrow.
    <span className="qe-select qe-select--chip" data-stated={stated || undefined}>
      <span className="qe__kind" data-tone={stated ? "clay" : undefined} aria-hidden="true" />
      {select("qe-select__control")}
      <ChevronDown className="qe-select__caret" aria-hidden="true" />
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
  [ACCEPTED_NOTATION_EXAMPLES.rsid]: "dbSNP identifier, resolved to a coordinate",
  [ACCEPTED_NOTATION_EXAMPLES.clinvarVcv]: "ClinVar Variation ID, resolved to a coordinate",
};

/** One example per route; additional accepted forms remain available on demand. */
const ExampleRow: React.FC<{
  group: (typeof NOTATION_EXAMPLE_GROUPS)[number];
  onPick: (target: "variant" | "genomic", value: string) => void;
}> = ({ group, onPick }) => {
  const primary = group.target === "genomic" ? ACCEPTED_NOTATION_EXAMPLES.genomicDashed : group.values[0];
  const example = (value: string) => (
      <button
        key={value}
        type="button"
        onClick={() => onPick(group.target, value)}
        title={EXAMPLE_HINTS[value] ?? `${group.label} example`}
        aria-label={`Use example ${value} in the ${group.label} field`}
        className="query-example"
      >
        {value}
      </button>
  );
  return <div className="query-examples">
    <div className="query-examples__primary"><span>Try {group.target === "genomic" ? "coordinates" : "protein"}</span>{example(primary)}</div>
    <details>
      <summary>More {group.target === "genomic" ? "coordinate" : "protein & cDNA"} formats</summary>
      <div className="query-examples__more">{group.values.filter(value => value !== primary).map(example)}</div>
    </details>
  </div>;
};

function VariantSearchPanel({
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
  const landscapeOverview = useVariantAnalysisStore(s => s.landscapeOverview);

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
  const storeUniprotId = useVariantAnalysisStore(s => s.uniprotId ?? "");
  const uniprotId = propsUniprotId ?? storeUniprotId;
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
  // Same run-backed tabs as the sidebar's Evidence row, so the rail and the row cannot disagree.
  const loadingEvidenceTabs = evidenceTabsLoading(EVIDENCE_SUB_ITEMS, isBiophysicalLoading, result);

  // Derive stage status & metrics for live workflow rail
  const getStageInfo = (stage: (typeof WORKFLOW_STAGES)[number]["key"]) => {
    const currentKey = landscapeKey(gene, variant, uniprotId);
    const overviewStatus = landscapeOverview?.key === currentKey ? landscapeOverview?.status ?? null : null;
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
      hasStructureCoordinates: Boolean(loadedPdb),
      landscapeOverviewStatus: overviewStatus,
      evidenceTabsLoading: loadingEvidenceTabs
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
  // Completion and problems are judged over every stage, as before.
  const summary = summarizeWorkflowStatuses(stageInfos.map(({ info }) => info.rawStatus));
  /**
   * The COUNT the rail quotes ("N of M settled") and its progress bar cover the automatic run only. An
   * on-demand stage is opened by the reader, so counting it made the denominator swing between six and
   * seven as it was opened, while the idle label already said six core stages.
   */
  const coreSummary = summarizeWorkflowStatuses(
    stageInfos.filter(({ stage }) => !isOnDemandView(stage.key)).map(({ info }) => info.rawStatus)
  );
  const settledCount = coreSummary.settled;
  const progressPct = coreSummary.percent;

  const isWorkflowSettled = Boolean(result && summary.total > 0 && summary.settled >= summary.total);

  // Check if any pipeline stage or background solver is still in active execution
  const isPipelineActive = !isWorkflowSettled && Boolean(
    isForegroundActive ||
    isNarrativeLoading ||
    isStructuralLoading ||
    isPocketLoading ||
    isFolding ||
    dynamut2Status === "pending" ||
    ddmutStatus === "pending" ||
    engineState.thermompnnStatus === "pending" ||
    Object.values(result?.metadata?.pipelineStages ?? {}).some(outcome => outcome === "running") ||
    stageInfos.some(({ info }) => info.rawStatus === "progress"
  ));

  const hasCoreError = Boolean(
    result?.metadata?.pipelineStages?.core === "error" ||
    (analysisState?.error && !isPipelineActive)
  );

  const hasRun = Boolean(result) || isPipelineActive;

  const pipelineStatusLabel = isForegroundActive
    ? "Loading evidence"
    : hasCoreError
    ? "Analysis failed"
    : result
    ? isPipelineActive ? "Workspace ready · Enriching" : summary.hasProblems ? "Workspace ready · Partial results" : "Workspace ready"
    : "Pipeline ready";

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
    /**
     * Route the replayed notation into the field it was typed in. The handler fills the protein field
     * with the RESOLVED variant and clears the coordinate field, which put a coordinate into the protein
     * field's badge ("Protein HGVS") after the run had already been routed by its own text. The replayed
     * string is `query` (the submission as made), falling back to `variant` for entries without one.
     *
     * Runs AFTER the handler on purpose: the handler's fill would otherwise win.
     */
    const notation = (item.query ?? item.variant ?? "").trim();
    if (!notation) return;
    const { kind } = classifyNotation(notation);
    if (kind === "cdna") {
      setCustomVariant(notation);
      setCustomGenomic("");
    } else if (isGenomicOrCdnaNotation(notation)) {
      setCustomGenomic(notation);
      setCustomVariant("");
    }
  }, [handleSelectHistoryItem, setCustomVariant, setCustomGenomic]);

  /**
   * A benchmark card is a RUN, exactly like a Recent analyses chip: it goes through the same handler, so
   * the two entry points cannot diverge in what they do. (The card used to only fill the form, which
   * left a first-run reader with a filled form and no visible result until they pressed Analyse.)
   */
  const runBenchmark = useCallback((preset: OnboardingPreset) => {
    runFromHistory({ gene: preset.gene, variant: preset.variant, uniprotId: preset.uniprotId });
  }, [runFromHistory]);

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
  /**
   * Whether the coordinate field's text is something the server resolves: a coordinate, a transcript cDNA,
   * an out-of-scope coordinate (which still routes to the resolver so it can explain the scope), or a
   * dbSNP / ClinVar identifier. Identifiers were missing from the list, so an rsID typed here was
   * refused by the form's own badge and marked the Variant field required — though the route accepts it.
   * `isGenomicOrCdnaNotation` is the one list the server gate and the router share, so this follows it.
   */
  const genomicIsCoordinate = Boolean(genomicNotation && isGenomicOrCdnaNotation(customGenomic));
  /**
   * A BARE `c.` in the Variant field (no transcript, e.g. `c.347A>G`) names no reference sequence, so it
   * resolves only against a gene: the server pins it to that gene's MANE Select transcript. It therefore
   * REQUIRES a gene, where a transcript-qualified notation does not. Ignored when the coordinate route is
   * active, because the coordinate field is then what gets submitted.
   */
  const variantIsBareCdna =
    !genomicIsCoordinate && Boolean(customVariant.trim()) && cdnaReferenceProblem(customVariant) === "missing-transcript";
  const bareCdnaNeedsGene = variantIsBareCdna && !customGene.trim();
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
    (!!customVariant && needsNotationResolution(customVariant) && !variantIsBareCdna) || genomicIsCoordinate;
  const isGeneRequired = !notationResolvesItself;
  const isVariantRequired = !genomicIsCoordinate;

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
   * Which route the submit takes, for the strip under the coordinate field. The coordinate field wins whenever
   * it has text (the submit reads it first), so a protein/cDNA entry beside it is ignored; the strip says so
   * rather than letting that happen silently.
   */
  const coordinateRoute: "both" | "derived" | "unrecognised" | "empty" =
    !customGenomic.trim()
      ? "empty"
      : customVariant.trim() && genomicIsCoordinate
        ? "both"
        : genomicIsCoordinate
          ? "derived"
          : "unrecognised";

  /**
   * Is the both-filled state a CONFLICT, or two ways of writing the same variant?
   *
   * The strip used to go amber on the state alone — two fields with text — so the ordinary case (a
   * coordinate beside the protein change the app itself resolved it to and filled in) got an
   * alarm-styled card and a button that deletes the input the run actually uses. Amber now needs
   * evidence of a disagreement, and the only evidence available before a submit is this session's own
   * resolution of THIS coordinate: history stores the submitted notation (`query`) beside the
   * substitution it resolved to (`variant`). So:
   *
   *   • resolved differently → a real conflict, and the copy can name what the coordinate will run;
   *   • resolved the same     → agree; quiet, the fact still stated;
   *   • never resolved here   → unknown, not a conflict. Guessing would be the same false alarm in a
   *                             new costume, so it stays quiet until a run settles it.
   */
  const resolvedForCoordinate = customGenomic.trim()
    ? history.find(item => (item.query ?? "").trim() === customGenomic.trim())?.variant ?? null
    : null;
  const typedSubstitution = substitutionOf(customVariant);
  const resolvedSubstitution = substitutionOf(resolvedForCoordinate ?? "");
  /**
   * The two sides of a KNOWN disagreement, or null. An object rather than a boolean so the render can
   * read both values without non-null assertions — the branch that shows them is the branch that
   * proved they exist.
   */
  const routeConflict: { resolved: string; typed: string } | null =
    coordinateRoute === "both" &&
    resolvedForCoordinate &&
    typedSubstitution &&
    resolvedSubstitution &&
    !sameSubstitution(typedSubstitution, resolvedSubstitution)
      ? { resolved: resolvedForCoordinate, typed: customVariant.trim() }
      : null;

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
  // The folded fields wear the composer's field box (`.qe-input`), so the form reads as one surface.
  const inputBase = "qe-input";



  /**
   * Quick entry: one line over the four fields. The fields stay the source of truth; this line is a
   * draft that is parsed into them as it is typed, and re-derived from them when they change from
   * elsewhere (a recent analysis, a benchmark, an example chip, the fields themselves). The draft is
   * only rewritten when it no longer says what the fields say, so a trailing space survives typing.
   */
  const [quickDraft, setQuickDraft] = useState("");
  useEffect(() => {
    setQuickDraft(draft =>
      quickEntryMatches(draft, { gene: customGene, variant: customVariant, genomic: customGenomic })
        ? draft
        : composeQuickEntry({ gene: customGene, variant: customVariant, genomic: customGenomic }),
    );
  }, [customGene, customVariant, customGenomic]);
  const quickReading = readQuickEntry(quickDraft);
  // The fields are folded away by default; anything that needs a decision in them opens them.
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const fieldsNeedAttention =
    Boolean(routeConflict) ||
    bareCdnaNeedsGene ||
    coordinateRoute === "unrecognised" ||
    (Boolean(customUniprot.trim()) && !uniprotLooksValid);
  const onQuickEntryChange = (line: string) => {
    setQuickDraft(line);
    const read = readQuickEntry(line);
    setCustomGene(read.gene);
    setCustomVariant(read.variant);
    setCustomGenomic(read.genomic);
    if (read.uniprot) setCustomUniprot(read.uniprot);
  };
  const quickStatus = !quickDraft.trim()
    ? ""
    : quickReading.recognised
      ? `Reads as ${[quickReading.gene, quickReading.variant || quickReading.genomic].filter(Boolean).join(" · ")}`
      : quickReading.gene && !quickReading.variant
        ? `Gene ${quickReading.gene}. Add a protein change such as p.Arg248Trp.`
        : "Not recognised yet. Try GENE p.Arg248Trp or 20-23365054-G-A.";

  const isNonMissenseError = Boolean(
    analysisState?.error &&
    (analysisState.error.toLowerCase().includes("non-missense") ||
     analysisState.error.includes("Protein effect unknown") ||
     analysisState.error.toLowerCase().includes("synonymous") ||
     analysisState.error.toLowerCase().includes("nonsense") ||
     analysisState.error.toLowerCase().includes("frameshift") ||
     analysisState.error.toLowerCase().includes("insertion/deletion") ||
     analysisState.error.toLowerCase().includes("start-loss"))
  );

  return (
    <div className="variant-workbench cs-fade-in" id="variant-search-workspace">
      {/* ── Page header ─────────────────────────────────────────────────────────────────────── */}
      <header className="workbench-heading">
        <div className="min-w-0">
          <h1 className="workbench-title">Analyse a variant<span aria-hidden="true">.</span></h1>
          <p className="workbench-lede">
            Follow a single amino-acid change through evidence, structure and stability.
          </p>
        </div>

        {/* Reading guide sits at the trailing edge of the header, opposite the title. */}
        <div className="workbench-guide">
          <ResearchGuideButton topic="variant_identity" label="Which variant will be analysed?" />
        </div>

        {/* The API-key notice lives in the app header only — this page used to repeat it here AND
            in the header, two warnings for one fact. The form footer still names the consequence. */}
      </header>

      {/* The monitor spans both desktop rows; the form and recents keep their natural height.
          On narrow containers, DOM order remains query, recents, monitor. */}
      <div className="workbench-deck grid grid-cols-1 lg:grid-cols-12">
        <section
          className="workbench-query cs-panel flex flex-col min-w-0 lg:col-span-8 lg:col-start-1 lg:row-start-1"
          data-tour="variant-input"
          id="variant-input-card"
          aria-labelledby="variant-form-title"
        >
          <div className="workbench-section-heading">
            <span className="workbench-index" aria-hidden="true">01</span>
            <h2 id="variant-form-title">Variant query</h2>
          </div>

          <form onSubmit={onFormSubmit} className="flex flex-col flex-1">
            <div className="workbench-query-body">
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

              {analysisState?.error &&
              !isPipelineActive &&
              !(
                result?.numberingChoices &&
                result.numberingChoices.length >= 2 &&
                (result.numberingNotation ?? "") === customVariant.trim() &&
                (result.metadata?.gene ?? "") === customGene.trim() &&
                (result.metadata?.uniprotId ?? "") === customUniprot.trim()
              ) &&
              !(result?.buildHint && buildHintTarget) ? (
                isNonMissenseError ? (
                  <div
                    role="alert"
                    aria-live="polite"
                    data-testid="non-missense-error-prompt"
                    className="rounded-lg border px-4 py-3.5 flex flex-col gap-2.5 transition-colors"
                    style={{
                      borderColor: "var(--cs-border-danger, #fca5a5)",
                      background: "var(--cs-bg-danger-subtle, rgba(239, 68, 68, 0.05))",
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-[var(--cs-text-danger, #dc2626)] shrink-0" />
                        <span className="text-[13px] font-semibold text-[var(--cs-text-primary)]">
                          Variant Out of Scope: Non-Missense Consequence
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => actions.setAnalysisState((prev: any) => ({ ...prev, error: null }))}
                        className="text-cs-text-secondary hover:text-cs-text-primary text-[12px] p-1 -mr-1 -mt-1 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
                        title="Dismiss notification"
                        aria-label="Dismiss notification"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      {result?.nonMissenseRefusal?.hasCodon === false || analysisState.error.includes("p.?") ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          Non-coding / Intronic · No mature codon
                        </span>
                      ) : result?.nonMissenseRefusal?.isCoding ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                          Coding sequence · Synonymous / Non-missense
                        </span>
                      ) : null}
                      {result?.nonMissenseRefusal?.hgvsc && (
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-cs-surface-2 text-cs-text-primary border border-cs-border">
                          {result.nonMissenseRefusal.hgvsc}
                        </span>
                      )}
                    </div>

                    <p className="text-[12px] leading-relaxed text-[var(--cs-text-secondary)] font-mono">
                      {analysisState.error.replace(/^Analysis query error:\s*/i, "")}
                    </p>
                    <div className="text-[11px] leading-relaxed text-[var(--cs-text-secondary)] bg-cs-surface-2/60 border border-[var(--cs-border)] rounded-md p-3 flex flex-col gap-2">
                      <div className="font-semibold text-cs-text-primary">Does this variant alter a codon?</div>
                      <div>
                        {result?.nonMissenseRefusal?.hasCodon === false || analysisState.error.includes("p.?") ? (
                          <>
                            <strong>No, it does not alter a codon.</strong> This nucleotide is located within an <strong>intron</strong> (intervening non-coding sequence spliced out of pre-mRNA before translation). Because it does not belong to the mature mRNA coding frame, there is no codon triplet and no amino acid substitution to model in 3D protein structure.
                          </>
                        ) : (
                          <>
                            <strong>No missense substitution.</strong> Missense &amp; Fold specifically analyzes single amino acid substitutions in 3D structures. Synonymous mutations (which alter a nucleotide within a codon but preserve the amino acid) and non-coding alterations produce no protein structure change.
                          </>
                        )}
                      </div>
                      <div className="font-semibold text-cs-text-primary pt-0.5">Recommended resolution:</div>
                      <ul className="list-disc pl-4 space-y-1">
                        <li>To evaluate a protein missense substitution, enter the protein HGVS notation (e.g. <code className="font-mono text-cs-text-primary">p.Gly380Arg</code>) or coding cDNA mutation (<code className="font-mono text-cs-text-primary">c.1138G&gt;A</code>).</li>
                        <li>
                          For non-coding, intronic, or splice-site impacts, query specialized genomic and clinical databases:
                          <div className="flex flex-wrap gap-2 pt-1.5">
                            {(result?.nonMissenseRefusal?.gene || customGene) && (
                              <>
                                <a
                                  href={`https://www.ncbi.nlm.nih.gov/clinvar/?term=${encodeURIComponent(result?.nonMissenseRefusal?.gene || customGene)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-cs-surface border border-cs-border text-cs-text-primary hover:border-cs-accent-clay hover:text-cs-accent-clay transition-colors"
                                >
                                  ClinVar (NCBI) <ExternalLink className="w-3 h-3 ml-0.5 opacity-60" />
                                </a>
                                <a
                                  href={`https://gnomad.broadinstitute.org/gene/${encodeURIComponent(result?.nonMissenseRefusal?.gene || customGene)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-cs-surface border border-cs-border text-cs-text-primary hover:border-cs-accent-clay hover:text-cs-accent-clay transition-colors"
                                >
                                  gnomAD (Broad) <ExternalLink className="w-3 h-3 ml-0.5 opacity-60" />
                                </a>
                              </>
                            )}
                          </div>
                        </li>
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div
                    role="alert"
                    aria-live="polite"
                    data-testid="general-error-prompt"
                    className="rounded-lg border px-4 py-3 flex flex-col gap-2 transition-colors"
                    style={{
                      borderColor: "var(--cs-border-danger, #fca5a5)",
                      background: "var(--cs-bg-danger-subtle, rgba(239, 68, 68, 0.05))",
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-[var(--cs-text-danger, #dc2626)] shrink-0" />
                        <span className="text-[13px] font-semibold text-[var(--cs-text-primary)]">
                          Analysis Query Failed
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => actions.setAnalysisState((prev: any) => ({ ...prev, error: null }))}
                        className="text-cs-text-secondary hover:text-cs-text-primary text-[12px] p-1 -mr-1 -mt-1 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
                        title="Dismiss notification"
                        aria-label="Dismiss notification"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-[12px] leading-relaxed text-[var(--cs-text-secondary)]">
                      {analysisState.error.replace(/^Analysis query error:\s*/i, "")}
                    </p>
                  </div>
                )
              ) : null}

              {/* ── Command bar ────────────────────────────────────────────────────────────────
                  One line in, one action out. The line is a draft parsed into the four fields as it
                  is typed (the fields stay the source of truth: ids, labels and routing untouched),
                  and the primary action sits on the same row so the eye never leaves the input to
                  find it. Enter here submits like any query field. */}
              <div className="qe" id="quick-entry">
                <div className="qe__head">
                  <label htmlFor="input-quick-entry" className="qe__label">
                    Variant
                  </label>
                  <span className="qe__accepts">Protein / cDNA / coordinate / rsID / ClinVar VCV</span>
                </div>

                <div className="qe__bar" data-recognised={quickReading.recognised || undefined}>
                  <div className="qe__field">
                    <Search className="qe__icon" aria-hidden="true" />
                    <input
                      id="input-quick-entry"
                      type="text"
                      placeholder="e.g. NAE1 p.Asp116Gly"
                      autoComplete="off"
                      spellCheck={false}
                      value={quickDraft}
                      onChange={(e) => onQuickEntryChange(e.target.value)}
                      aria-describedby="input-quick-entry-status"
                      className="qe__input"
                    />
                    {quickDraft ? (
                      <button
                        type="button"
                        title="Clear the line"
                        aria-label="Clear quick entry"
                        onClick={() => onQuickEntryChange("")}
                        className="qe__tool"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        title="Paste from clipboard"
                        aria-label="Paste from clipboard"
                        onClick={() => pasteFromClipboard(onQuickEntryChange)}
                        className="qe__tool"
                      >
                        <Clipboard className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={isForegroundActive}
                    aria-label="Analyse variant"
                    className="qe__submit"
                  >
                    {isForegroundActive ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        Analysing…
                      </>
                    ) : (
                      <>
                        Analyse
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </>
                    )}
                  </button>
                </div>

                <p
                  id="input-quick-entry-status"
                  role="status"
                  aria-live="polite"
                  className={!quickDraft.trim() || quickReading.recognised ? "qe__status qe__status--assistive" : "qe__status"}
                  data-tone={!quickDraft.trim() ? "idle" : quickReading.recognised ? "ok" : "pending"}
                >
                  {quickDraft.trim() ? (
                    quickReading.recognised ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <span className="qe__status-dot" aria-hidden="true" />
                    )
                  ) : null}
                  <span>{quickStatus}</span>
                </p>

                {/* The parse, as a ticket: what each field now holds. Values only — the verdict words
                    ("Protein HGVS", "Derived", "Format OK") stay in the field labels, their one home. */}
                {quickDraft.trim() ? (
                  <dl className="qe__ticket" data-testid="quick-entry-preview">
                    {(() => {
                      const activeKind = genomicIsCoordinate ? genomicNotation?.kind : variantNotation?.kind;
                      const cells: Array<{ label: string; value: string; auto?: boolean; tone?: FieldBadgeTone; hint?: string }> = [
                        { label: "Gene", value: customGene.trim().toUpperCase(), auto: notationResolvesItself && !customGene.trim() },
                        {
                          label: "Change",
                          value: customGenomic.trim() || customVariant.trim(),
                          tone: activeKind ? NOTATION_BADGES[activeKind].tone : undefined,
                          hint: activeKind ? NOTATION_BADGES[activeKind].title : undefined,
                        },
                        { label: "UniProt", value: customUniprot.trim().toUpperCase(), auto: !customUniprot.trim() },
                        {
                          label: "Build",
                          value: genomicBuildControllable ? genomicBuild : variantBuildControllable ? variantBuild : "",
                          auto: !genomicBuildControllable && !variantBuildControllable,
                        },
                      ];
                      return cells.map(cell => (
                        <div key={cell.label} className="qe__cell" title={cell.hint}>
                          <dt>
                            {cell.tone ? <span className="qe__kind" data-tone={cell.tone} aria-hidden="true" /> : null}
                            {cell.label}
                          </dt>
                          <dd data-empty={!cell.value || undefined}>
                            {cell.value || (cell.auto ? "auto" : "—")}
                          </dd>
                        </div>
                      ));
                    })()}
                  </dl>
                ) : (
                  <div className="qe__try">
                    <span className="qe__try-label">Or try an example</span>
                    {[
                      { value: "NAE1 p.Asp116Gly", note: "protein" },
                      { value: "20-23365054-G-A", note: "coordinate" },
                      { value: "rs28934576", note: "dbSNP" },
                    ].map(({ value, note }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => onQuickEntryChange(value)}
                        className="qe__example"
                        title={`Fill the line with a ${note} example`}
                      >
                        <span className="qe__example-note">{note}</span>
                        <span className="qe__example-value">{value}<ArrowRight aria-hidden="true" /></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <details
                className="qe-fields"
                open={fieldsOpen || fieldsNeedAttention}
                onToggle={(e) => setFieldsOpen((e.currentTarget as HTMLDetailsElement).open)}
              >
                <summary className="qe-fields__summary">
                  <ChevronRight className="qe-fields__chevron" aria-hidden="true" />
                  Edit parsed fields
                  <span className="qe-fields__meta">
                    {fieldsNeedAttention ? (
                      <span className="qe-fields__attention">
                        <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                        Needs a look
                      </span>
                    ) : (
                      <span className="qe-fields__hint">Gene, notation, UniProt, build, coordinates</span>
                    )}
                  </span>
                </summary>
                <div className="qe-fields__body">
              {/* One two-column grid, so each row shares a baseline by construction: identity on top (gene,
                  accession), the two ways of naming the change beneath (protein/cDNA, or a coordinate), and the
                  route status across the foot. The coordinate used to have a column of its own, with a build row
                  whose only content was "Follows the coordinate you enter" and a field that repeated the line
                  above; the build now sits in the coordinate label's slot, as it does on the notation field. */}
              <div
                className="query-routes"
                id="workspace-accepted-inputs"
                role="group"
                aria-label="Parsed query fields"
              >
                    {/* Row 1: the gene. */}
                    <div className="flex flex-col gap-1.5 min-w-0">
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
                          aria-describedby="input-gene-symbol-hint"
                          placeholder="e.g. CNNM2"
                          autoComplete="off"
                          spellCheck={false}
                          value={customGene}
                          onChange={(e) => setCustomGene(e.target.value)}
                          className={inputBase + " font-mono font-medium uppercase tracking-wide"}
                        />
                        <PasteBtn setter={setCustomGene} />
                      </div>
                      <p id="input-gene-symbol-hint" className="query-route__help">
                        {bareCdnaNeedsGene ? (
                          <span className="text-[var(--cs-text-warning-on-soft)]">{GENE_REQUIRED_HINT}</span>
                        ) : variantIsBareCdna ? (
                          <span>Resolves on {customGene.trim().toUpperCase()}&apos;s MANE Select transcript.</span>
                        ) : null}
                      </p>
                    </div>

                    {/* Row 1, beside the gene: the optional UniProt accession.
                        The field is always the editable input — collapsed it was a 40px summary button
                        ("Resolved automatically"), open it is a 40px input, so the reveal step bought
                        no space and one extra click. Its STATE sits in the label row's slot, which is the
                        one place this form states a field's verdict ("Derived", "Optional", "Protein HGVS"). */}
                    <div className="flex flex-col gap-1.5 min-w-0">
                      <FieldLabel
                        htmlFor="input-uniprot-acc"
                        badge={
                          <FieldBadge
                            id="input-uniprot-acc-status"
                            /**
                             * `warn` is the only loud state this slot has. A well-formed accession is not
                             * a state worth a green chip: it is the ordinary case, the chip was the
                             * loudest colour in a row that is otherwise grey, and it said nothing the
                             * input's own text does not. `neutral` renders as plain muted text.
                             */
                            tone={uniprotLooksValid ? "neutral" : "warn"}
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
                          aria-describedby="input-uniprot-acc-status"
                          className={inputBase + " font-mono uppercase"}
                        />
                        <PasteBtn setter={setCustomUniprot} />
                      </div>
                    </div>

                    {/* Row 2: the protein or cDNA notation, with its examples directly beneath. */}
                    <div className="flex flex-col gap-1.5 min-w-0">
                      <FieldLabel
                        htmlFor="input-variant-notation"
                        required={isVariantRequired}
                        /**
                         * This field states a build too, for the two families that carry one: genomic HGVS
                         * pasted here, and transcript cDNA. It takes the same slot and metrics as the
                         * coordinate field's control, so the two fields read alike.
                         */
                        action={
                          variantBuildControllable ? (
                            <BuildSelect
                              value={variantBuild}
                              source={variantBuildSource}
                              /**
                               * Derived, not hardcoded: an accessioned GENOMIC coordinate lands in this field
                               * too (history items, a paste), and a select that announced "this cDNA" beside a
                               * "Genomic → resolve" badge would be describing a notation the reader is not
                               * looking at.
                               */
                              subject={variantNotation?.kind === "cdna" ? "cDNA" : "coordinate"}
                              onChange={applyVariantBuild}
                            />
                          ) : undefined
                        }
                        badge={
                          /**
                           * ONE thing in this slot: when the build control is shown it already names the
                           * family and the build, so a verdict badge beside it would be two `shrink-0` items in
                           * a pinned 20px row, where only the label can give.
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

                    {/* Row 2, beside the notation: the coordinate, with its examples directly beneath. */}
                    <div className="flex flex-col gap-1.5 min-w-0">
                      <FieldLabel
                        htmlFor="input-genomic-coords"
                        /**
                         * The build the coordinate is expressed in. It is DERIVED from the text (see BuildSelect), so it
                         * holds no state of its own, and it takes the same label slot as on the notation field. It was a
                         * 40px row above this field that read "Follows the coordinate you enter" until a build existed.
                         */
                        action={
                          genomicBuildControllable ? (
                            <BuildSelect
                              id="input-genomic-build"
                              value={genomicBuild}
                              source={genomicBuildSource}
                              subject="coordinate"
                              onChange={applyGenomicBuild}
                            />
                          ) : undefined
                        }
                        badge={
                          /**
                           * ONE thing in this slot. When the build control is showing it already states the build,
                           * so no badge here. Otherwise the slot names what the text is: a verdict for a
                           * recognised notation, or "Optional" while the field is empty.
                           */
                          genomicBuildControllable ? null : genomicNotation ? (
                            <FieldBadge
                              tone={NOTATION_BADGES[genomicNotation.kind].tone}
                              title={`${NOTATION_BADGES[genomicNotation.kind].title}${genomicIsCoordinate ? "" : " This field accepts coordinates, dbSNP IDs and ClinVar IDs."}`}
                            >
                              {NOTATION_BADGES[genomicNotation.kind].label}
                            </FieldBadge>
                          ) : (
                            <FieldBadge title="Optional: protein-level notation alone is enough to run the analysis.">
                              Optional
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

                    {/* Row 3, across both columns: which route the submit takes. A live region, so a change of route is
                        announced. "Both filled" splits in two: a KNOWN disagreement wears amber and offers the way out,
                        while agreement (or an unknown coordinate) gets the same quiet line an empty field
                        gets — information without an alarm. */}
                    <div className="query-routes__status" id="coordinate-route-status" role="status" aria-live="polite">
                      {coordinateRoute === "both" ? (
                        routeConflict ? (
                          <div className="query-route-status query-route-status--warn">
                            <span>{routeConflictCopy(routeConflict.resolved, routeConflict.typed)}</span>
                            <button
                              type="button"
                              className="query-route-status__action"
                              onClick={() => setCustomGenomic("")}
                            >
                              Clear coordinate
                            </button>
                          </div>
                        ) : (
                          <p className="query-route-status query-route-status--quiet">{ROUTE_BOTH_QUIET_COPY}</p>
                        )
                      ) : coordinateRoute === "derived" ? (
                        <p className="query-route-status">{ROUTE_DERIVED_COPY}</p>
                      ) : coordinateRoute === "unrecognised" ? (
                        // Unrecognised text still takes precedence at submit, so beside a protein/cDNA entry
                        // the strip says that too and offers the same one-click way out as "both".
                        <div className="query-route-status query-route-status--warn">
                          <span>
                            Not recognised as a coordinate yet. {COORDINATE_ACCEPTS_COPY}
                            {customVariant.trim() ? " While this field has text, the protein/cDNA field is ignored." : ""}
                          </span>
                          {customVariant.trim() ? (
                            <button
                              type="button"
                              className="query-route-status__action"
                              onClick={() => setCustomGenomic("")}
                            >
                              Clear coordinate
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        null
                      )}
                    </div>
              </div>
                </div>
              </details>

              <details className="workbench-ai">
                <summary className="workbench-ai-summary">
                  <Sparkles aria-hidden="true" />
                  <span>AI focus &amp; custom instructions</span>
                  <span className="workbench-ai-meta">{hasDirections ? `${userDirections.trim().length} chars set` : "Optional"}</span>
                  <ChevronDown className="workbench-ai-chevron" aria-hidden="true" />
                </summary>
              <fieldset className="qe-ai">
                <label htmlFor="textarea-user-directions" className="qe-ai__label">
                  What should the interpretation focus on?
                </label>
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
                  className="qe-ai__textarea"
                />
                <div className="flex justify-between items-start gap-3 text-[11px] text-cs-text-muted">
                  <span id="user-directions-privacy" className="flex items-start gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-px text-[var(--cs-text-warning)]" />
                    Do not include patient identifiers (names, MRNs, dates of birth).
                  </span>
                  <span className="tabular-nums shrink-0">{userDirections.length}/2000</span>
                </div>
              </fieldset>
              </details>
            </div>

            {/* ── Form footer: context left, the quiet secondary action right. The primary action lives
                in the command bar beside the input it acts on. ── */}
            <div className="workbench-query-footer">
              {/* Keyless-first: every stage runs without a key, and the narrative stage returns its
                  designed "AI not configured" report (rule-based ACMG from database metrics). The key
                  only adds the written interpretation, so it is a note here, never a gate — a gate
                  here was also bypassed by the history chips and the benchmarks, which always ran. */}
              <p className="text-[11px] text-cs-text-muted flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  {settings?.narrativeMode === "off" ? (
                    <span>AI synthesis is off. Evidence and classification remain available.</span>
                  ) : settings?.narrativeMode === "on-demand" ? (
                    <span>AI synthesis is available on demand in Report.</span>
                  ) : hasConfiguredGeminiKey ? null : (
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
                </span>
              </p>

              {/* Disabled while the fields are already empty — an inert Clear reads as a dead control. */}
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
                className="inline-flex items-center gap-1.5 h-8 px-3 -mr-1.5 rounded-[var(--cs-radius-input)] text-[12px] font-medium text-cs-text-secondary hover:text-cs-text-primary hover:bg-cs-bg-subtle cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
              >
                <Eraser className="w-3.5 h-3.5" aria-hidden="true" />
                Clear fields
              </button>
            </div>
          </form>
        </section>

        {/* Recent runs and first-run benchmarks share the ruled workbench tray. */}
        <section
          aria-labelledby="recent-title"
          className="workbench-recents flex flex-col gap-3 min-w-0 lg:col-span-8 lg:col-start-1 lg:row-start-2"
          data-tour="recent-benchmarks"
        >
          {history.length > 0 ? (
            <>
              <div className="workbench-recents-heading">
                <span className="workbench-index" aria-hidden="true">03</span>
                <h2 id="recent-title" className="text-[13px] font-semibold text-cs-text-primary">
                  Recent analyses <span className="workbench-recents-count">{history.length}</span>
                </h2>
                <button
                  type="button"
                  onClick={clearHistory}
                  className="workbench-history-clear"
                  title="Clear search history"
                  aria-label="Clear search history"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear history
                </button>
              </div>

              {/* Every entry stays in the list (the store keeps ten); the list scrolls inside its own box past
                  about three rows, so a longer history never pushes the deck or the monitor down the page. */}
              <ol className="workbench-recent-list" id="workbench-recent-list">
                {history.map((item, idx) => {
                  const isActive = gene === item.gene && variant === item.variant;
                  return (
                    <li key={`${item.gene}_${item.variant}_${idx}`}>
                    <button
                      type="button"
                      onClick={() => runFromHistory(item)}
                      aria-pressed={isActive}
                      className="workbench-recent"
                      title={`Reload ${item.gene} ${item.variant}`}
                      aria-label={`Select recent search ${item.gene} ${item.variant}`}
                    >
                      <span className="workbench-recent-number" aria-hidden="true">{String(idx + 1).padStart(2, "0")}</span>
                      <span className="workbench-recent-identity">
                        <span className="workbench-recent-gene">{item.gene}</span>
                        <span className="workbench-recent-variant">{formatVariantForDisplay(item.variant)}</span>
                        {item.query && item.query !== item.variant && item.query !== `${item.gene} ${item.variant}` && <span className="workbench-recent-query">{item.query}</span>}
                      </span>
                      <span className="workbench-recent-action">
                        {isActive && <span className="workbench-recent-current">Current</span>}
                        <span>Run again <ArrowRight aria-hidden="true" /></span>
                      </span>
                    </button>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : (
            <>
              <div className="workbench-recents-empty">
                <div>
                  <div className="workbench-recents-heading">
                    <span className="workbench-index" aria-hidden="true">03</span>
                    <h2 id="recent-title" className="text-[13px] font-semibold text-cs-text-primary">No recent analyses</h2>
                  </div>
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
              {/* Each card runs the benchmark, the same as a Recent analyses chip. The card is a control of its own
                  so it can carry a second, form-only action without nesting interactive elements. */}
              <div className="workbench-benchmarks">
                {ONBOARDING_BENCHMARK_PRESETS.map(preset => (
                  <div
                    key={preset.gene + preset.variant}
                    className="workbench-benchmark"
                  >
                    <button
                      type="button"
                      onClick={() => runBenchmark(preset)}
                      aria-label={`Run benchmark ${preset.gene} ${preset.variant}`}
                      title={preset.description}
                      className="text-left flex flex-col gap-0.5 px-3 pt-2.5 pb-1.5 rounded-t-[var(--cs-radius-card)] cursor-pointer transition-colors duration-150 hover:bg-cs-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="text-[12.5px] font-semibold text-cs-text-primary">{preset.gene}</span>
                        <span className="font-mono text-[11.5px] text-cs-text-secondary">{preset.variant}</span>
                      </span>
                      <span className="text-[11px] text-cs-text-muted">{preset.tag}</span>
                      <span className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-medium text-cs-text-accent">
                        Run benchmark
                        <ArrowRight className="w-3 h-3" aria-hidden="true" />
                      </span>
                    </button>
                    <div className="px-3 pb-1.5">
                      <button
                        type="button"
                        onClick={() => applyPreset(preset)}
                        aria-label={`Fill the form with ${preset.gene} ${preset.variant} without running`}
                        className="inline-flex items-center h-7 px-1.5 -ml-1.5 rounded-[var(--cs-radius-badge)] text-[11.5px] text-cs-text-muted hover:text-cs-text-primary cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
                      >
                        Fill form only
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* The monitor spans the query and recents; tab content scrolls within that shared height. */}
        <aside
          className="workbench-rail cs-panel lg:col-span-4 lg:col-start-9 lg:row-start-1 flex flex-col"
          data-tour="workflow-rail"
          id="workspace-stage-rail"
          aria-label="Services and pipeline"
        >
          <div className="workbench-rail-body">
            <div className="workbench-rail-heading">
              <span className="workbench-index" aria-hidden="true">02</span>
              <h2>Analysis monitor</h2>
              <Activity aria-hidden="true" />
            </div>
            <div
              ref={railTabListRef}
              role="tablist"
              aria-label="Analysis sidebar view switcher"
              onKeyDown={handleRailKeyDown}
              className="workbench-monitor-tabs"
            >
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
                  ) : hasCoreError ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--cs-text-danger)] shrink-0" aria-label="analysis failed" />
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
                <div className="workbench-pipeline-summary">
                  <div className="workbench-pipeline-status">
                    <span className="text-[12px] font-medium text-cs-text-primary inline-flex items-center gap-2">
                      {isPipelineActive ? (
                        <span className="cs-spinner" aria-hidden="true" />
                      ) : hasCoreError ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-[var(--cs-text-danger)]" />
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
                        ? `${settledCount} of ${coreSummary.total} settled`
                        : `${WORKFLOW_STAGE_COUNTS.core} core · ${WORKFLOW_STAGE_COUNTS.onDemand} on-demand`}
                    </span>
                  </div>
                  {!hasRun && <p className="workbench-pipeline-intro">Submit a variant to follow its analysis here. Results become available as each stage finishes.</p>}
                  {hasRun && (
                    <div
                      className="h-1 rounded-full bg-cs-surface-2 overflow-hidden"
                      role="progressbar"
                      aria-label="Pipeline progress"
                      aria-valuemin={0}
                      aria-valuemax={coreSummary.total}
                      aria-valuenow={settledCount}
                    >
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ease-out ${isPipelineActive ? "bg-cs-accent-clay" : hasCoreError ? "bg-[var(--cs-text-danger)]" : summary.hasProblems ? "bg-[var(--cs-text-warning)]" : "bg-[var(--cs-text-success)]"}`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  )}
                  {isPipelineActive && loadingStep && (
                    <p className="text-[11px] text-cs-text-muted truncate" aria-live="polite">{loadingStep}</p>
                  )}
                </div>

                {/* Stepper */}
                <ol className="workbench-pipeline-stages">
                  {stageInfos.map(({ stage: { key, title, Icon, targetView }, info }) => {
                    const isClickable = !!result && !!onViewChange;
                    /* Branch on the state, not the rendered word: `info.status` is a display label. */
                    const isRunning = info.rawStatus === "progress";
                    const isDone = info.rawStatus === "complete";
                    const isDegraded = info.rawStatus === "degraded";
                    const isErr = info.rawStatus === "error";

                    const node = isRunning
                      ? "border-cs-accent-clay text-cs-accent-clay bg-cs-surface"
                      : isDone
                      ? "border-transparent bg-[var(--cs-bg-success)] text-[var(--cs-text-good-on-soft)]"
                      : isDegraded || isErr
                      ? "border-transparent bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning-on-soft)]"
                      : "border-cs-border-subtle bg-cs-surface text-cs-text-muted";

                    return (
                      <li key={key} data-state={info.rawStatus}>
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
                          className={`workbench-pipeline-stage group ${
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
                          <span className={`workbench-pipeline-node ${node}`}>
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
                              {/* Keep status readable alongside the navigation arrow. */}
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
                                  <span>
                                    {info.status}
                                  </span>
                                  {isClickable && (
                                    <ArrowRight
                                      className="workbench-stage-arrow"
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
                      className="shrink-0 flex items-start gap-2.5 px-3 py-2.5 rounded-[var(--cs-radius-card)] border border-cs-accent-clay/25 bg-cs-accent-clay/[0.06] cs-fade-in"
                    >
                      <Compass className="w-3.5 h-3.5 mt-0.5 text-cs-text-accent shrink-0" aria-hidden="true" />
                      <p className="m-0 flex-1 text-[11px] leading-snug text-cs-text-secondary">
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
                        className="-mr-1 -mt-0.5 shrink-0 p-1 rounded-[var(--cs-radius-badge)] text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-surface-2 cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
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
