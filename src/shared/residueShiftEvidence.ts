/**
 * Residue Shift & Pocket Evidence Derivation — single source of truth.
 *
 * Two surfaces render the "Residue Shifts & Pockets" evidence:
 *
 *   1. The main Evidence column — the quantitative property scales and the P2Rank
 *      KPI cards (the decisive numbers).
 *   2. The Evidence Inspector sidebar — the prose interpretation and provenance
 *      (the "what does this mean" layer).
 *
 * Deriving the axis labels, severity banding, spatial classification and
 * interpretation separately in each pane is exactly how the two drift apart, so
 * every display decision that must agree lives here.
 *
 * Pure functions and plain data only: no React, no fetching, no client imports.
 * Amino-acid scale values are passed in by the caller rather than imported, so
 * this module stays dependency-free and unit-testable.
 */

import {
  describeFallbackReason,
  isNarrativeFallbackReason,
  type NarrativeFallbackPresentation,
} from "./narrativeFallback.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Amino-acid property scales
// ─────────────────────────────────────────────────────────────────────────────

export type AminoAcidScaleKey = "hydrophobicity" | "size" | "polarity" | "charge";

/** Normalised 0–100 physicochemical descriptor values for one residue. */
export interface AminoAcidScaleValues {
  hydrophobicity: number;
  size: number;
  polarity: number;
  charge: number;
}

export interface PropertyScaleDefinition {
  key: AminoAcidScaleKey;
  /** Row label in the scale card. */
  label: string;
  /**
   * Compact axis name for space-constrained renderers (the Insights radar chart
   * has ~9px polar ticks). Kept beside `label` so a renderer can never invent a
   * fourth name for the same axis.
   */
  shortLabel: string;
  /** What the 0 end of the axis means — rendered at the track's left edge. */
  lowAnchor: string;
  /** What the 100 end of the axis means — rendered at the track's right edge. */
  highAnchor: string;
  /** Phrase completing "the side chain becomes ..." for a positive delta. */
  increasesPhrase: string;
  /** Phrase completing "the side chain becomes ..." for a negative delta. */
  decreasesPhrase: string;
  /** Why the axis matters for a missense variant, in non-specialist language. */
  rationale: string;
  /** Where the 0–100 normalisation comes from. */
  source: string;
  /**
   * Only the charge axis is signed (0 = negative, 50 = neutral, 100 = positive),
   * so it is the only one that renders a meaningful midpoint.
   */
  midpointLabel?: string;
}

/**
 * The four axes the Residue Shifts tab contrasts.
 *
 * Ordering is deliberate and shared by every renderer: hydrophobicity and size
 * describe the side chain's physical bulk and water behaviour, polarity and
 * charge describe its electrochemistry.
 */
export const PROPERTY_SCALE_DEFINITIONS: readonly PropertyScaleDefinition[] = [
  {
    key: "hydrophobicity",
    label: "Hydrophobicity",
    shortLabel: "Hydrophobicity",
    lowAnchor: "Hydrophilic",
    highAnchor: "Hydrophobic",
    increasesPhrase: "more hydrophobic (further along the hydropathy index)",
    decreasesPhrase: "less hydrophobic (toward the hydrophilic end of this index)",
    rationale:
      "How strongly the side chain avoids water. Positions buried in the protein interior are usually hydrophobic and solvent-exposed positions usually hydrophilic, so a large move on this axis at a buried position is a classic route to misfolding.",
    source: "Kyte & Doolittle hydropathy, normalised 0–100",
  },
  {
    key: "size",
    label: "Residue Volume / Size",
    shortLabel: "Size",
    lowAnchor: "Small",
    highAnchor: "Large",
    increasesPhrase: "bulkier",
    decreasesPhrase: "smaller",
    rationale:
      "Side-chain bulk. A bulkier residue at a tightly packed position can clash with its neighbours; a smaller one can leave a hole in the core. Read this together with the burial and packing metrics below.",
    source: "Side-chain van der Waals volume, normalised 0–100",
  },
  {
    key: "polarity",
    label: "Polarity",
    shortLabel: "Polarity",
    lowAnchor: "Nonpolar",
    highAnchor: "Polar",
    increasesPhrase: "more polar",
    decreasesPhrase: "less polar",
    rationale:
      "How unevenly the side chain distributes its electrons, which governs how readily it forms hydrogen bonds. Polarity shifts rearrange local hydrogen-bond networks.",
    source: "Standard biochemical polarity classification, normalised 0–100",
  },
  {
    key: "charge",
    label: "Isoelectric Charge Index",
    shortLabel: "Charge",
    lowAnchor: "Negative",
    highAnchor: "Positive",
    /*
     * The phrase describes the INDEX, not the chemistry. The 0–100 table assigns
     * non-neutral values to residues with no net charge at pH 7.4 (Cys 35, Ser/Thr
     * 45, Tyr 45, Trp 48, Pro 52), so wording this axis as "(more basic)" /
     * "(more acidic)" asserted categorical chemistry that is false: Trp(48)→Ala(50)
     * rendered as "becomes more basic" though neither residue is basic, and
     * Ser(45)→Cys(35) as "more acidic" though Ser is not acidic. The parenthetical
     * is therefore reserved for moves that actually cross between the acidic and
     * basic poles, and no phrase claims an acid/base identity change on its own.
     */
    increasesPhrase: "further toward the positive end of this index",
    decreasesPhrase: "further toward the negative end of this index",
    rationale:
      "Position on a hand-normalised charge index, where 0 is negative, 50 is neutral and 100 is positive. A move that crosses the neutral midpoint is the consequential case for salt bridges and for the residue's pKa; smaller moves shift the index without changing the residue's acid/base character.",
    source: "Hand-normalised charge index (0–50–100); not a computed net charge at pH 7.4",
    midpointLabel: "Neutral",
  },
] as const;

/**
 * Look up an axis definition by key.
 *
 * Renderers that iterate `buildBiochemicalContrast().rows` need the compact label
 * and the source line, which the row carries for prose but not for compact
 * contexts. Going through one accessor means a new axis cannot be added to the
 * scales without also appearing in every consumer.
 */
export function getPropertyScaleDefinition(key: AminoAcidScaleKey): PropertyScaleDefinition {
  const definition = PROPERTY_SCALE_DEFINITIONS.find(candidate => candidate.key === key);
  if (!definition) {
    // Unreachable for the current union; kept so a future rename fails loudly in
    // development rather than rendering "undefined" in a chart legend.
    throw new Error(`Unknown amino-acid scale key: ${key}`);
  }
  return definition;
}

export type ShiftDirection = "increase" | "decrease" | "unchanged";

export type ShiftMagnitude = "unchanged" | "slight" | "moderate" | "marked";

/**
 * Magnitude bands for a change on a normalised 0–100 axis, in scale points.
 *
 * These are display bands, not published significance cutoffs: the axes are not
 * calibrated to any outcome, so they only rank how large a move is *relative to
 * the axis*. The prose deliberately says "moderate change on this scale" rather
 * than "moderate effect".
 */
export const SHIFT_MAGNITUDE_BANDS = {
  /** Deltas at or below this are described as unchanged/rounding-level. */
  unchanged: 0,
  /** |delta| <= this is a slight move. */
  slight: 9,
  /** |delta| <= this is a moderate move; anything larger is marked. */
  moderate: 29,
} as const;

export interface BiochemicalContrastRow {
  key: AminoAcidScaleKey;
  label: string;
  lowAnchor: string;
  highAnchor: string;
  midpointLabel?: string;
  wildTypeValue: number;
  mutantValue: number;
  /** mutant - wild type, on the 0–100 axis. */
  delta: number;
  absoluteDelta: number;
  direction: ShiftDirection;
  magnitude: ShiftMagnitude;
  /** Signed delta with a true minus sign, e.g. "+20" / "−5" / "0". */
  deltaLabel: string;
  /** Magnitude word only, e.g. "marked". */
  magnitudeLabel: string;
  /** e.g. "more positive (more basic)" or "no change". */
  plainChange: string;
  /** One sentence combining the numbers and the plain-language sense. */
  interpretation: string;
  rationale: string;
  source: string;
  /** Marker positions as 0–100 percentages, ready for absolute layout. */
  wildTypePosition: number;
  mutantPosition: number;
  /** Left edge and width of the segment joining the two markers. */
  spanStart: number;
  spanWidth: number;
}

/**
 * Rows ordered the way a reader needs them: the biggest move first.
 *
 * Every track is drawn on the same normalised 0–100 range, so the *width* of a change is
 * comparable between axes — but only if the rows are in a useful order. Presented in
 * definition order the reader has to compare four numbers to find what actually moved;
 * sorted, the answer is the first row, and it always agrees with the prose summary
 * (`headlineRow`) about which axis that is.
 *
 * Unchanged axes sort last: they carry the least information and they are the ones the
 * reader can skip. Ordering within each group preserves the definition order, so a table
 * built from this is stable across renders.
 */
export function rankContrastRowsByMagnitude(
  rows: readonly BiochemicalContrastRow[]
): BiochemicalContrastRow[] {
  const changed = rows.filter(row => row.direction !== "unchanged");
  const unchanged = rows.filter(row => row.direction === "unchanged");
  return [...changed.sort((a, b) => b.absoluteDelta - a.absoluteDelta), ...unchanged];
}

export interface BiochemicalContrast {
  wildTypeCode: string;
  mutantCode: string;
  wildTypeLabel: string;
  mutantLabel: string;
  rows: BiochemicalContrastRow[];
  changedRowCount: number;
  /** Largest-magnitude changed row, or null when nothing moved. */
  headlineRow: BiochemicalContrastRow | null;
  /** Deterministic plain-language summary; never claims pathogenicity. */
  summary: string;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatDelta(delta: number): string {
  if (delta === 0) return "0";
  // U+2212 minus sign, so the value never reads as a hyphen in a mono column.
  return delta > 0 ? `+${delta}` : `\u2212${Math.abs(delta)}`;
}

export function classifyShiftMagnitude(absoluteDelta: number): ShiftMagnitude {
  if (!Number.isFinite(absoluteDelta) || absoluteDelta <= SHIFT_MAGNITUDE_BANDS.unchanged) return "unchanged";
  if (absoluteDelta <= SHIFT_MAGNITUDE_BANDS.slight) return "slight";
  if (absoluteDelta <= SHIFT_MAGNITUDE_BANDS.moderate) return "moderate";
  return "marked";
}

/**
 * Phrase completing "the side chain becomes ...", by direction.
 *
 * A lookup rather than a nested ternary: the repository review rules prohibit
 * nested ternaries, and a record makes the three cases enumerable.
 */
function plainChangePhrase(
  definition: PropertyScaleDefinition,
  direction: ShiftDirection
): string {
  if (direction === "increase") return definition.increasesPhrase;
  if (direction === "decrease") return definition.decreasesPhrase;
  return "no change";
}

function buildContrastRow(
  definition: PropertyScaleDefinition,
  wildTypeValue: number,
  mutantValue: number
): BiochemicalContrastRow {
  const delta = Math.round((mutantValue - wildTypeValue) * 10) / 10;
  const absoluteDelta = Math.abs(delta);
  const direction: ShiftDirection = delta > 0 ? "increase" : delta < 0 ? "decrease" : "unchanged";
  const magnitude = classifyShiftMagnitude(absoluteDelta);
  const plainChange = plainChangePhrase(definition, direction);

  const interpretation =
    direction === "unchanged"
      ? `${definition.label} is identical for both residues on this scale (${wildTypeValue} of 100), so this descriptor carries no information about the pair.`
      : `${definition.label} moves ${formatDelta(delta)} points (${wildTypeValue} \u2192 ${mutantValue}): the side chain becomes ${plainChange}. This is a ${magnitude} change on this scale.`;

  const wildTypePosition = clampPercent(wildTypeValue);
  const mutantPosition = clampPercent(mutantValue);
  const spanStart = Math.min(wildTypePosition, mutantPosition);
  const spanWidth = Math.abs(mutantPosition - wildTypePosition);

  return {
    key: definition.key,
    label: definition.label,
    lowAnchor: definition.lowAnchor,
    highAnchor: definition.highAnchor,
    midpointLabel: definition.midpointLabel,
    wildTypeValue,
    mutantValue,
    delta,
    absoluteDelta,
    direction,
    magnitude,
    deltaLabel: formatDelta(delta),
    magnitudeLabel: magnitude,
    plainChange,
    interpretation,
    rationale: definition.rationale,
    source: definition.source,
    wildTypePosition,
    mutantPosition,
    spanStart,
    spanWidth,
  };
}

/**
 * Deterministic one-line reading of the contrast.
 *
 * Branches rather than nested ternaries (prohibited by the repository review
 * rules), and deliberately free of any pathogenicity claim: the axes are
 * descriptors of the residue pair, not calibrated effect sizes.
 */
function buildContrastSummary(params: {
  rows: readonly BiochemicalContrastRow[];
  changedRowCount: number;
  headlineRow: BiochemicalContrastRow | null;
  wildTypeLabel: string;
  mutantLabel: string;
}): string {
  const { rows, changedRowCount, headlineRow, wildTypeLabel, mutantLabel } = params;

  if (!headlineRow) {
    return `No axis moves on the 0\u2013100 scales: ${wildTypeLabel} and ${mutantLabel} are near-isosteric and near-isopolar here. Any effect must come from local geometry or from a mechanism these scales do not capture.`;
  }

  const axis = headlineRow.label.toLowerCase();
  if (changedRowCount === 1) {
    return `Only one of ${rows.length} axes moves: ${axis} ${headlineRow.deltaLabel} (\u2192 ${headlineRow.plainChange}).`;
  }

  return `${changedRowCount} of ${rows.length} axes move. The largest is ${axis} ${headlineRow.deltaLabel} \u2014 the side chain becomes ${headlineRow.plainChange}.`;
}

/**
 * Build the four-axis contrast between the wild-type and mutant residue.
 *
 * Returns null when either residue's property values are unavailable, so callers
 * render an explicit "not available" state instead of a zeroed-out scale.
 */
export function buildBiochemicalContrast(params: {
  wildTypeCode: string;
  mutantCode: string;
  wildTypeValues: AminoAcidScaleValues | null | undefined;
  mutantValues: AminoAcidScaleValues | null | undefined;
  wildTypeLabel?: string;
  mutantLabel?: string;
  definitions?: readonly PropertyScaleDefinition[];
}): BiochemicalContrast | null {
  const { wildTypeCode, mutantCode, wildTypeValues, mutantValues } = params;
  if (!wildTypeValues || !mutantValues) return null;

  const definitions = params.definitions ?? PROPERTY_SCALE_DEFINITIONS;
  const rows = definitions.map(definition =>
    buildContrastRow(definition, wildTypeValues[definition.key], mutantValues[definition.key])
  );

  const changedRows = rows.filter(row => row.direction !== "unchanged");
  const headlineRow = changedRows.reduce<BiochemicalContrastRow | null>(
    (largest, row) => (largest === null || row.absoluteDelta > largest.absoluteDelta ? row : largest),
    null
  );

  const wildTypeLabel = params.wildTypeLabel || wildTypeCode;
  const mutantLabel = params.mutantLabel || mutantCode;

  const summary = buildContrastSummary({
    rows,
    changedRowCount: changedRows.length,
    headlineRow,
    wildTypeLabel,
    mutantLabel
  });

  return {
    wildTypeCode,
    mutantCode,
    wildTypeLabel,
    mutantLabel,
    rows,
    changedRowCount: changedRows.length,
    headlineRow,
    summary,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Narrative reconciliation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Axis vocabulary, as word-boundary patterns.
 *
 * Word boundaries rather than substrings. The previous `includes()` version had a
 * cross-axis false positive that mattered clinically: polarity was matched on the
 * bare substring `"polar"`, so "loss of the nonpolar side chain" — a statement
 * about hydrophobicity — was reported as contradicting the *polarity* axis.
 * `\bpolar\b` does not match inside "nonpolar", so the boundary fixes that class
 * of bug outright.
 *
 * `hydrophil*` is listed alongside `hydrophob*` because the module's own
 * low-anchor word is "Hydrophilic", and the model is prompted for property-change
 * summaries — a claim of *becoming* hydrophilic was previously undetectable.
 */
const AXIS_NARRATIVE_PATTERNS: Record<AminoAcidScaleKey, RegExp> = {
  hydrophobicity: /\b(?:hydrophob\w*|hydropath\w*|hydrophil\w*|water-avoid\w*)\b/i,
  size: /\b(?:size|volume|bulk\w*|steric|van der waals)\b/i,
  polarity: /\b(?:polarity|polar)\b/i,
  charge: /\b(?:charge\w*|pka|electrostat\w*|acidic|basic|salt bridge\w*)\b/i,
};

/**
 * Change-claim stems, matched with a leading word boundary.
 *
 * A leading `\b` is enough: `\bchang` matches "change"/"changed" but not
 * "exchange"/"interchange" or "unchanged", because those have no boundary before
 * the stem. That single detail removes the substring hazards that made the
 * previous version report "Polarity is unchanged." as a claimed change.
 */
const CHANGE_CLAIM_PATTERN = new RegExp(
  String.raw`\b(?:chang|shift|increas|decreas|gain|loss|lost|alter|significan|mark|reduc|expand|swap|convert|becom)`,
  "i"
);

/**
 * Negation and absence markers.
 *
 * A sentence that denies a change is not a claim of one. Without this guard the
 * panel told the reader the opposite of what the prose said — "no significant
 * change in polarity" was rendered as "the narrative describes a change in
 * polarity, but that axis is flat".
 *
 * Deliberately crude, and biased toward false negatives: suppressing a real
 * claim only costs a missed caution, whereas a false alarm teaches the reader to
 * distrust accurate prose. `\bnon\b` does not match inside "nonpolar".
 */
const NEGATED_CLAIM_PATTERN = /\b(?:no|not|non|without|unchanged|unaffected|negligible|absence|lack\w*|neither|nor)\b/i;

export interface NarrativeDiscrepancy {
  axisKey: AminoAcidScaleKey;
  axisLabel: string;
  /** The prose sentence that claims a change on an axis the scales hold flat. */
  sentence: string;
  /** Both scale values, e.g. "100 → 100". */
  values: string;
}

/**
 * Find axes where the AI prose claims a change but the scales hold flat.
 *
 * The AI narrative and the 0–100 scales are independent evidence: the prose is
 * synthesised from the residue pair, while the scales are fixed normalised
 * descriptors. When they disagree the reader needs to know *which* axis is being
 * described loosely, rather than being left to reconcile it silently.
 *
 * Only the flat→claimed-change direction is reported, and negated sentences are
 * skipped. The scales are the weaker of the two sources (see the charge-axis
 * caveat in the header), so the caller must present this as a difference to weigh
 * — never as the prose being wrong.
 */
export function findNarrativeDiscrepancies(
  prose: string | null | undefined,
  contrast: BiochemicalContrast | null
): NarrativeDiscrepancy[] {
  if (!prose || !contrast) return [];

  // Split on sentence enders without a lookbehind assertion: Vite's default
  // target set includes browsers that do not support lookbehind, and esbuild
  // lowers an unsupported lookbehind literal into `new RegExp("(?<=...)")`,
  // which throws at *runtime* — during render — rather than at build time. The
  // delimiter is discarded either way, so the simpler pattern is equivalent.
  const sentences = prose
    .split(/[.!?;]+\s*|\n+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);

  const discrepancies: NarrativeDiscrepancy[] = [];

  for (const row of contrast.rows) {
    if (row.direction !== "unchanged") continue;

    const axisPattern = AXIS_NARRATIVE_PATTERNS[row.key];
    const sentence = sentences.find(
      candidate =>
        axisPattern.test(candidate) &&
        CHANGE_CLAIM_PATTERN.test(candidate) &&
        !NEGATED_CLAIM_PATTERN.test(candidate)
    );

    if (sentence) {
      discrepancies.push({
        axisKey: row.key,
        axisLabel: row.label,
        sentence,
        values: `${row.wildTypeValue} \u2192 ${row.mutantValue}`,
      });
    }
  }

  return discrepancies;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI biochemical-shift narrative state
// ─────────────────────────────────────────────────────────────────────────────

export type NarrativeState = "ready" | "loading" | "unavailable" | "absent";

export interface BiochemicalNarrative {
  state: NarrativeState;
  /** Prose with inline markdown emphasis stripped, or null when not available. */
  prose: string | null;
  /** Short badge label for the state. */
  badge: string;
  /** Explanation shown when there is no usable prose. */
  detail: string | null;
  /**
   * Short label for *why* synthesis produced no prose, from the shared degradation
   * vocabulary. Null when there is nothing structured to say.
   */
  reasonLabel: string | null;
  /**
   * Presentation tone for `reasonLabel`, from the same shared vocabulary the report bar
   * uses. A renderer must not choose a colour of its own: "AI not configured" is a setup
   * state and a rejected key is a failure, and painting both amber asserts a severity the
   * reason does not carry.
   */
  reasonTone: NarrativeFallbackPresentation["tone"] | null;
  /** Whether re-running synthesis has a realistic chance of succeeding. */
  retryable: boolean;
  /**
   * What the server actually tried and what the provider said, already sanitized
   * by the server. Kept separate from `detail` so clinical prose never mixes with
   * infrastructure telemetry.
   */
  diagnostics: string | null;
}

/**
 * Markers emitted by the pipeline and the model when synthesis did not produce
 * real prose. Matching these is how "no narrative" is distinguished from a
 * narrative that happens to contain the word "unavailable".
 */
const UNAVAILABLE_MARKERS = [
  "biochemical shift unavailable",
  "not synthesized",
  "details unavailable",
  "ai service offline",
  "key not configured",
  "output decoding error",
];

/** Strip the inline emphasis the model emits so prose is not shown with `**`. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*(?:\u26a0\ufe0f)?\s*(?:BIOCHEMICAL SHIFT NARRATIVE:)?\s*/i, "")
    .trim();
}

export interface BiochemicalNarrativeOptions {
  isLoading?: boolean;
  /**
   * Stable degradation code returned by the server (`NarrativeFallbackReason`).
   *
   * Without it the panel could only say "rule-based only" and echo the internal
   * placeholder — the reader saw a bare "Not synthesized" and had no way to tell a
   * busy provider from a missing key or an expired budget.
   */
  fallbackReason?: string | null;
  /** Sanitized provider line, when the server reported one. */
  providerDetail?: string | null;
  /** Models the server actually attempted, in order. */
  attemptedModels?: readonly string[] | null;
  /** The server's own retryability verdict, which wins over the reason's default. */
  retryable?: boolean | null;
}

/**
 * One line of provider/attempt diagnostics for the degraded state.
 *
 * Kept out of `detail`: the clinical explanation and the infrastructure telemetry
 * are different registers, and mixing them is how a provider payload ends up
 * inside a clinical report.
 */
function buildDiagnostics(options: BiochemicalNarrativeOptions): string | null {
  const parts: string[] = [];
  const attempted = (options.attemptedModels ?? []).filter(model => typeof model === "string" && model.trim());
  if (attempted.length > 0) parts.push(`Attempted: ${attempted.join(" → ")}`);
  const providerDetail = typeof options.providerDetail === "string" ? options.providerDetail.trim() : "";
  if (providerDetail) parts.push(`Provider: ${providerDetail}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function deriveBiochemicalNarrative(
  raw: string | null | undefined,
  options: BiochemicalNarrativeOptions = {}
): BiochemicalNarrative {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const stripped = trimmed ? stripInlineMarkdown(trimmed) : "";
  const isUnavailable =
    trimmed.length > 0 && UNAVAILABLE_MARKERS.some(marker => trimmed.toLowerCase().includes(marker));

  /*
   * The usability test runs on the *stripped* text, not the raw text. A value
   * consisting only of markdown scaffolding ("⚠️", "BIOCHEMICAL SHIFT NARRATIVE:",
   * "**") is non-empty before stripping and empty after, which previously produced
   * state "ready" with `prose: ""` — a blank paragraph under an "AI synthesis"
   * badge, with no explanatory detail because `detail` is null in the ready state.
   */
  if (stripped.length > 0 && !isUnavailable) {
    return {
      state: "ready",
      prose: stripped,
      badge: "AI synthesis",
      detail: null,
      reasonLabel: null,
      reasonTone: null,
      retryable: false,
      diagnostics: null,
    };
  }

  if (options.isLoading) {
    return {
      state: "loading",
      prose: null,
      badge: "Synthesising",
      detail: "The language model is composing the biochemical interpretation for this substitution.",
      reasonLabel: null,
      reasonTone: null,
      retryable: false,
      diagnostics: null,
    };
  }

  const presentation = describeFallbackReason(options.fallbackReason);
  const hasReason = isNarrativeFallbackReason(options.fallbackReason);
  const diagnostics = buildDiagnostics(options);

  return {
    state: "unavailable",
    prose: null,
    badge: "Rule-based only",
    /*
     * The structured reason is the explanation when there is one. Otherwise the marker
     * the pipeline wrote is the only information available, and it is shown as the
     * state label it is — never as markdown, and never in place of a reason the server
     * did classify.
     */
    detail: hasReason
      ? presentation.detail
      : stripped || "No AI biochemical narrative was returned for this substitution. The derived interpretation in this panel is computed from the residue property scales and is unaffected.",
    reasonLabel: hasReason ? presentation.label : null,
    reasonTone: hasReason ? presentation.tone : null,
    retryable: options.retryable ?? presentation.retryable,
    diagnostics,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// P2Rank pocket narrative
// ─────────────────────────────────────────────────────────────────────────────

export type PocketStatus =
  | "loading"
  | "error"
  | "success"
  /** P2Rank did not produce a result, but a secondary engine (fpocket) did. */
  | "fallback_engine"
  | "none_detected"
  | "unavailable"
  | "absent";

/** Distance bands from the variant residue to the candidate cavity. */
export const POCKET_PROXIMITY_BANDS = {
  /** At or below this the residue is effectively part of the cavity wall. */
  lining: 4,
  /** Matches the app's existing ACTIVE_SITE_PROXIMATE rule. */
  proximal: 8,
  /** Roughly a second shell of residues around the cavity mouth. */
  peripheral: 12,
} as const;

/** P2Rank's own cavity ranking index, expressed as the 0–100 the KPI card shows. */
export const POCKET_RANKING_BANDS = {
  weak: 20,
  moderate: 50,
  strong: 80,
} as const;

/** Cavity volume bands in Å³. */
export const POCKET_VOLUME_BANDS = {
  compact: 200,
  small: 500,
  large: 1000,
} as const;

export type PocketProximityBand = "lining" | "proximal" | "peripheral" | "distal" | "unknown";
export type PocketRankingBand = "weak" | "moderate" | "strong" | "very_strong" | "unknown";
export type PocketVolumeBand = "compact" | "small" | "drug_like" | "large" | "unknown";

export type PocketSpatialClassification =
  | "ACTIVE_SITE_LINING"
  | "ACTIVE_SITE_PROXIMATE"
  | "POCKET_PERIPHERAL"
  | "DISTAL_SURFACE"
  | "UNCLASSIFIED";

export interface PocketResidueSummary {
  name: string;
  index: number;
  distance: number;
  /** Chain the residue belongs to, when the payload carries it. */
  chain?: string;
}

/**
 * Where each number in a pocket result actually came from.
 *
 * Without this the client cannot tell a measured cavity volume from a surface
 * point count, or a calibrated site probability from a rescaled raw score — and
 * the payload in production carries `pocketVolume = sasPoints * 10`
 * (`runner.ts:331-334`) because the real P2Rank predictions CSV has no volume
 * column. Absent provenance is therefore treated as *unverified*, and the client
 * refuses to print a unit it cannot vouch for.
 */
export interface PocketProvenance {
  /** Which engine produced the numbers. */
  engine?: "p2rank" | "fpocket" | null;
  /**
   * `measured` = an engine-reported volume; `unavailable` = none was measured.
   * `scaled_surface_points` is the legacy value for a surface-point count that was
   * published as a volume in cubic Ångströms, kept only so an older cached payload
   * is still recognised as unverified rather than trusted.
   */
  volumeSource?: "measured" | "unavailable" | "scaled_surface_points" | null;
  /** `probability` = P2Rank's calibrated per-profile field; `rescaled_raw_score` = a score rescaled to look like one. */
  scoreSource?: "probability" | "rescaled_raw_score" | "unavailable" | null;
}

export interface PocketNarrativeInput {
  status?: string | null;
  pocketDistance?: number | null;
  /**
   * Distance from the variant residue to P2Rank's own cavity centre (`center_x/y/z`).
   * Preferred over `pocketDistance` when present: `pocketDistance` is measured to
   * the centroid of the pocket's residues, which grows as the pocket grows, so the
   * 4/8/12 Å bands only describe proximity meaningfully against the real centre.
   */
  cavityCentreDistance?: number | null;
  pocketScore?: number | null;
  pocketVolume?: number | null;
  likelyCofactor?: string | null;
  pocketResidues?: readonly PocketResidueSummary[] | null;
  sasPoints?: number | null;
  surfaceAtoms?: number | null;
  /** Optional: absent provenance is treated as unverified, never as measured. */
  provenance?: PocketProvenance | null;
}

export interface PocketNarrative {
  status: PocketStatus;
  /** One-line verdict, e.g. "Distal to the nearest predicted cavity". */
  headline: string;
  /** Short badge label mirroring the headline. */
  badge: string;
  badgeTone: "neutral" | "accent" | "warn" | "danger";
  /** Multi-sentence explanation written for a reader new to P2Rank. */
  plainLanguage: string | null;
  /** What the reader may and may not conclude. */
  bottomLine: string | null;
  classification: { code: PocketSpatialClassification; label: string; detail: string };
  proximity: {
    band: PocketProximityBand;
    label: string;
    distance: number | null;
    detail: string;
    /** What the distance is measured to, so a label cannot misname it. */
    reference: string;
  };
  ranking: { band: PocketRankingBand; label: string; score: number | null; detail: string };
  volume: {
    band: PocketVolumeBand;
    label: string;
    volume: number | null;
    detail: string;
    /**
     * False when the payload carries no engine-reported volume. Renderers must
     * not print "Å³", nor any ligand-capacity band, while this is false.
     */
    isMeasured: boolean;
    /** P2Rank's solvent-accessible surface point count, when reported. */
    surfacePoints: number | null;
  };
  cofactor: { name: string | null; detail: string };
  lining: { count: number; nearest: PocketResidueSummary | null; includesVariantResidue: boolean };
  /** Failure/limitation notes the reader must see next to the numbers. */
  caveats: string[];
  /** Term-by-term explanation of the three KPI numbers. */
  glossary: { term: string; meaning: string }[];
}

const COFACTOR_ABSENT_MARKERS = ["none", "not recorded", "no curated", "n/a", "unknown"];

function classifyProximity(distance: number | null, includesVariantResidue: boolean): PocketProximityBand {
  if (includesVariantResidue) return "lining";
  if (distance === null || !Number.isFinite(distance)) return "unknown";
  if (distance <= POCKET_PROXIMITY_BANDS.lining) return "lining";
  if (distance <= POCKET_PROXIMITY_BANDS.proximal) return "proximal";
  if (distance <= POCKET_PROXIMITY_BANDS.peripheral) return "peripheral";
  return "distal";
}

const PROXIMITY_LABELS: Record<PocketProximityBand, string> = {
  lining: "Cavity-lining",
  proximal: "Pocket-proximal",
  peripheral: "Pocket rim",
  distal: "Distal to cavity",
  unknown: "Unmapped",
};

/**
 * Band a reported ranking index.
 *
 * Zero is `weak`, not `unknown`: P2Rank reporting 0 is a real, maximally
 * unenthusiastic result, and "Not reported" would be an untrue statement about
 * the tool's output. `unknown` is reserved for a value that is absent or
 * non-numeric — i.e. the caller had nothing to band.
 */
export function classifyPocketRanking(score: number | null): PocketRankingBand {
  if (score === null || !Number.isFinite(score) || score < 0) return "unknown";
  if (score <= POCKET_RANKING_BANDS.weak) return "weak";
  if (score <= POCKET_RANKING_BANDS.moderate) return "moderate";
  if (score <= POCKET_RANKING_BANDS.strong) return "strong";
  return "very_strong";
}

const RANKING_LABELS: Record<PocketRankingBand, string> = {
  weak: "Weak",
  moderate: "Moderate",
  strong: "Strong",
  very_strong: "Very strong",
  unknown: "Not reported",
};

export function classifyPocketVolume(volume: number | null): PocketVolumeBand {
  if (volume === null || !Number.isFinite(volume) || volume <= 0) return "unknown";
  if (volume < POCKET_VOLUME_BANDS.compact) return "compact";
  if (volume < POCKET_VOLUME_BANDS.small) return "small";
  if (volume < POCKET_VOLUME_BANDS.large) return "drug_like";
  return "large";
}

const VOLUME_LABELS: Record<PocketVolumeBand, string> = {
  compact: "Very small",
  small: "Small",
  drug_like: "Ligand-sized",
  large: "Large",
  unknown: "Not reported",
};

const VOLUME_DETAILS: Record<PocketVolumeBand, string> = {
  compact: "smaller than the pocket a typical drug-like small molecule needs (roughly 300\u2013500 \u00c5\u00b3)",
  small: "at the low end of what a small drug-like ligand occupies",
  drug_like: "in the range a small drug-like ligand occupies",
  large: "large enough to accommodate a cofactor or a short peptide",
  unknown: "not reported for this cavity",
};

const RANKING_DETAILS: Record<PocketRankingBand, string> = {
  weak: "P2Rank ranks this cavity poorly against the other cavities it found in the same structure",
  moderate: "P2Rank gives this cavity middling support as a ligand-binding site",
  strong: "P2Rank favours this cavity as a ligand-binding site",
  very_strong: "P2Rank strongly favours this cavity as a ligand-binding site",
  unknown: "P2Rank reported no ranking index for this cavity",
};

/**
 * What the distance is actually measured between.
 *
 * The runner computes the mean position of every atom of every residue P2Rank
 * assigned to the pocket, and compares it to the variant residue's all-atom
 * centroid. It is therefore the centroid of the *pocket residues*, which is not
 * the cavity's geometric centre (P2Rank reports `center_x/y/z`, and the runner
 * parses then discards them). The two coincide only for a compact, symmetric
 * pocket, so every label and sentence here must say "centroid of the pocket
 * residues" rather than "cavity centre".
 *
 * A second consequence: the quantity grows with pocket size, so a residue that
 * genuinely lines a large cavity can sit 15 Å from it. The bands below therefore
 * only carry information for the non-member fallback case, where the runner
 * selected the nearest pocket that does *not* contain the variant residue.
 */
const DISTANCE_REFERENCE = "the centroid of the pocket residues";
/** Reference phrase used when the engine reported its own cavity centre. */
const CAVITY_CENTRE_REFERENCE = "the cavity centre";

/**
 * Which reference the reported distance uses.
 *
 * P2Rank reports `center_x/y/z`, so when that is available the distance is to the
 * real cavity centre and the 4/8/12 Å bands mean what they say. Otherwise the only
 * available quantity is the centroid of the pocket's own residues, which is
 * pocket-size dependent — and every label says so.
 */
function distanceReference(hasCavityCentre: boolean): string {
  return hasCavityCentre ? CAVITY_CENTRE_REFERENCE : DISTANCE_REFERENCE;
}

const EMPTY_CLASSIFICATION: PocketNarrative["classification"] = Object.freeze({
  code: "UNCLASSIFIED",
  label: "UNCLASSIFIED",
  detail: "No pocket computation has been classified yet.",
});

function spatialClassificationFor(
  proximity: PocketProximityBand,
  reference: string = DISTANCE_REFERENCE
): { code: PocketSpatialClassification; label: string; detail: string } {
  switch (proximity) {
    case "lining":
      return {
        code: "ACTIVE_SITE_LINING",
        label: "ACTIVE_SITE_LINING",
        detail: "This residue is one of the residues P2Rank returned as part of the cavity wall.",
      };
    case "proximal":
      return {
        code: "ACTIVE_SITE_PROXIMATE",
        label: "ACTIVE_SITE_PROXIMATE",
        detail: `This residue sits within ${POCKET_PROXIMITY_BANDS.proximal} \u00c5 of ${reference} \u2014 first shell.`,
      };
    case "peripheral":
      return {
        code: "POCKET_PERIPHERAL",
        label: "POCKET_PERIPHERAL",
        detail: `This residue sits ${POCKET_PROXIMITY_BANDS.proximal}\u2013${POCKET_PROXIMITY_BANDS.peripheral} \u00c5 from ${reference} \u2014 on the rim rather than in the cavity.`,
      };
    case "distal":
      return {
        code: "DISTAL_SURFACE",
        label: "DISTAL_SURFACE",
        detail: `This residue is further than ${POCKET_PROXIMITY_BANDS.peripheral} \u00c5 from ${reference}, so it does not shape the cavity itself.`,
      };
    default:
      return {
        code: "UNCLASSIFIED",
        label: "UNCLASSIFIED",
        detail: `No distance to ${reference} was reported, so spatial classification cannot be assigned.`,
      };
  }
}

/**
 * Map the runner's status vocabulary onto the narrative's.
 *
 * A present pocket object whose status is missing or unrecognised is treated as
 * `unavailable`, not `absent`. `absent` means "no computation was requested",
 * and returning it for a payload that exists made the inspector show "No cavity
 * scan requested / Standby" while the main column's badge showed "Model Offline"
 * for the same object.
 *
 * `"fallback"` is the runner's marker for *fpocket* having produced the numbers
 * after P2Rank did not (`runner.ts:551`). It is real cavity data, so it is mapped
 * to its own status rather than being reported as an unavailable service.
 */
function normalisePocketStatus(
  pocket: PocketNarrativeInput | null | undefined,
  options: { isLoading?: boolean; error?: string | null }
): PocketStatus {
  if (options.isLoading) return "loading";
  if (options.error) return "error";
  if (!pocket) return "absent";

  const status = (pocket.status ?? "").toLowerCase();
  if (status === "success") return "success";
  if (status === "fallback") return "fallback_engine";
  if (status === "unavailable") return "unavailable";
  if (status === "none_detected") return "none_detected";
  return "unavailable";
}
/**
 * Sentence describing where the cavity sits relative to the variant residue.
 *
 * Written as branches because the three cases are genuinely different results:
 * a lining residue with no reported centroid, a measured distance, and a
 * non-lining residue with no distance at all. The wording names the measured
 * reference point (`DISTANCE_REFERENCE`) rather than "the cavity centre", which
 * the number is not.
 */
function buildDistanceClause(
  rawDistance: number | null,
  includesVariantResidue: boolean,
  reference: string = DISTANCE_REFERENCE
): string {
  if (rawDistance !== null) {
    const liningNote = includesVariantResidue ? ", and this residue is one of the residues lining it" : "";
    return `The nearest cavity P2Rank found has ${reference} ${rawDistance.toFixed(2)} \u00c5 from this residue${liningNote}.`;
  }
  if (includesVariantResidue) {
    return "This residue is one of the residues lining the predicted cavity, although no centroid distance was reported.";
  }
  return `P2Rank did not report a distance from this residue to ${reference}.`;
}

/**
 * What the reader may and may not conclude from the proximity and ranking bands.
 *
 * Adjacency to a cavity and confidence that the cavity binds a ligand are
 * independent, so all four combinations carry a different conclusion. Proximity
 * is never presented as a functional finding on its own.
 */
function buildPocketBottomLine(
  proximityBand: PocketProximityBand,
  rankingBand: PocketRankingBand
): string {
  const isAdjacent = proximityBand === "lining" || proximityBand === "proximal";
  const isFavoured = rankingBand === "strong" || rankingBand === "very_strong";
  const isRejected = rankingBand === "weak";

  if (isAdjacent && isRejected) {
    return "This substitution can change the shape or chemistry of a predicted cavity, but P2Rank ranks that cavity poorly, so a ligand-binding mechanism is not supported. A structural effect here would have to act through something else.";
  }
  if (isAdjacent && !isFavoured) {
    /*
     * The moderate band. This branch previously emitted "P2Rank itself does not
     * consider that cavity a likely ligand-binding site", which the panel's own
     * band label contradicts: the number is shown in the same card, labelled
     * "moderate". Attributing a rejection to the tool on a middling score makes
     * the panel disagree with the figure printed beside it, so the sentence now
     * states what is observable and leaves the tool's judgement out of it.
     */
    return "This substitution can change the shape or chemistry of a predicted cavity. P2Rank's support for that cavity is middling, so treat a ligand-binding mechanism as undetermined rather than supported or excluded.";
  }
  if (isAdjacent) {
    return "This substitution can change the shape or chemistry of a cavity that P2Rank favours as a ligand-binding site. That makes a loss of ligand binding a plausible route to loss of function \u2014 a hypothesis to test, not a finding.";
  }
  if (proximityBand === "peripheral") {
    return "This residue sits on the rim of a predicted cavity rather than in it. A substitution here is unlikely to change the cavity's shape directly, but it can still alter the surface a ligand passes over.";
  }
  return "This residue is well outside the nearest predicted cavity, so the substitution is unlikely to act by reshaping it. Look to stability, packing or interaction evidence for the mechanism.";
}

/**
 * Sentence describing the cavity's size — or stating that none was measured.
 *
 * A surface point count is never presented as a volume. `surfacePoints` is
 * P2Rank's own reported count (`sas_points`), which is a real measurement of the
 * cavity surface, so it is quoted as a count with its own name and no unit.
 */
function buildVolumeClause(
  volume: number | null,
  volumeBand: PocketVolumeBand,
  isMeasuredVolume: boolean,
  surfacePoints: number | null
): string {
  if (isMeasuredVolume && volume !== null) {
    return `It encloses about ${volume.toLocaleString()} \u00c5\u00b3 of space \u2014 ${VOLUME_DETAILS[volumeBand]}.`;
  }
  if (surfacePoints !== null) {
    return `P2Rank reports ${surfacePoints.toLocaleString()} solvent-accessible surface points on it; no cavity volume was measured, so none is quoted.`;
  }
  return "No cavity size was reported.";
}

/**
 * Badge tone from the two independent bands.
 *
 * Branches rather than a nested ternary: the tone depends on two axes, and
 * spelling the combinations out keeps each one reviewable.
 */
function pocketBadgeTone(
  proximityBand: PocketProximityBand,
  rankingBand: PocketRankingBand
): PocketNarrative["badgeTone"] {
  const isAdjacent = proximityBand === "lining" || proximityBand === "proximal";
  if (!isAdjacent) return "neutral";
  if (rankingBand === "strong" || rankingBand === "very_strong") return "accent";
  return "warn";
}

const EMPTY_GLOSSARY = [
  {
    term: "Pocket distance",
    meaning:
      "How far the variant residue sits from the pocket: from the cavity centre when the engine reports one (P2Rank does), otherwise from the centroid of the pocket's own residues, which grows as the pocket gets larger.",
  },
  {
    term: "P2Rank ranking index",
    meaning:
      "P2Rank's confidence that the cavity is a ligand-binding site, on the 0\u2013100 scale this panel reports. P2Rank documents this quantity as a probability calibrated against known complexes, per model profile \u2014 so it is not an affinity, and values from different profiles are not comparable.",
  },
  {
    term: "Pocket volume",
    meaning:
      "How much space the cavity encloses, in cubic \u00c5ngstr\u00f6ms (\u00c5\u00b3). Only shown when the engine reported a measured volume; a surface-point count is never presented as a volume.",
  },
] as const;

/**
 * Turn raw P2Rank output into prose a non-structural reader can act on.
 *
 * Every branch is explicit: a cavity that was never computed, one that was
 * searched for and not found, and one that was found but ranked poorly are three
 * different results and must never be rendered as the same "no data" state.
 */
export function derivePocketNarrative(
  pocket: PocketNarrativeInput | null | undefined,
  options: {
    isLoading?: boolean;
    error?: string | null;
    variantResidueIndex?: number | null;
    /** Chain of the modelled variant residue, so membership is not index-only. */
    variantResidueChain?: string | null;
  } = {}
): PocketNarrative {
  const status = normalisePocketStatus(pocket, options);

  const emptyResult = (overrides: Partial<PocketNarrative>): PocketNarrative => ({
    status,
    headline: "",
    badge: "",
    badgeTone: "neutral",
    plainLanguage: null,
    bottomLine: null,
    classification: EMPTY_CLASSIFICATION,
    proximity: { band: "unknown", label: PROXIMITY_LABELS.unknown, distance: null, detail: "", reference: DISTANCE_REFERENCE },
    ranking: { band: "unknown", label: RANKING_LABELS.unknown, score: null, detail: "" },
    volume: {
      band: "unknown",
      label: VOLUME_LABELS.unknown,
      volume: null,
      detail: "",
      isMeasured: false,
      surfacePoints: null
    },
    cofactor: { name: null, detail: "" },
    lining: { count: 0, nearest: null, includesVariantResidue: false },
    caveats: [],
    glossary: [...EMPTY_GLOSSARY],
    ...overrides
  });

  if (status === "loading") {
    return emptyResult({
      headline: "Scoring cavities",
      badge: "Computing",
      badgeTone: "neutral",
      plainLanguage:
        "P2Rank is scanning the 3D model for surface cavities and measuring their distance to this residue.",
      bottomLine: null,
      caveats: ["Results are provisional until the scan finishes."]
    });
  }

  if (status === "error") {
    return emptyResult({
      headline: "Cavity scan failed",
      badge: "Error",
      badgeTone: "danger",
      plainLanguage: options.error ? `P2Rank could not complete: ${options.error}` : "P2Rank could not complete.",
      bottomLine:
        "A failed scan is missing evidence, not negative evidence. Do not read it as confirmation that the residue is far from any cavity.",
      caveats: ["Retry the detection before drawing any conclusion from this panel."]
    });
  }

  if (status === "absent") {
    return emptyResult({
      headline: "No cavity scan requested",
      badge: "Standby",
      badgeTone: "neutral",
      plainLanguage:
        "No P2Rank prediction has been run for this residue yet. Pocket proximity is only computed once a 3D model for this variant is available.",
      bottomLine: "Nothing here is evidence either way \u2014 the analysis simply has not run.",
      caveats: []
    });
  }

  if (status === "none_detected") {
    /*
     * The runner returns `none_detected` for four distinct causes, two of which
     * mean P2Rank never saw the residue at all (the residue is absent from the
     * modelled structure, or its coordinates could not be extracted). The earlier
     * copy asserted a confident biological negative — "the substitution therefore
     * has no predicted cavity to disrupt at this site" — from what may be a pure
     * data-availability failure. The text now states the observable and names the
     * ambiguity rather than resolving it in the predictor's favour.
     */
    return emptyResult({
      headline: "No cavity returned for this residue",
      badge: "No pocket reported",
      badgeTone: "neutral",
      plainLanguage:
        "P2Rank produced no cavity for this residue. That can mean its search found no cavity within reach, or that the residue could not be located in the modelled structure at all; this payload does not distinguish the two.",
      bottomLine:
        "Treat this as absent evidence, not as a negative finding. A geometric cavity detector also routinely misses allosteric, interface and shallow surface sites.",
      caveats: [
        "P2Rank predicts cavity geometry from a single static conformation and does not know which cavities are functionally used.",
        "If the residue is missing from the model, no cavity could ever have been assigned to it.",
      ]
    });
  }

  if (status === "fallback_engine") {
    /*
     * `fallback` in the runner's vocabulary means fpocket returned the pocket after
     * P2Rank did not. That is real cavity data, and reporting it as "P2Rank
     * unavailable / Model offline" discarded a valid result and mislabelled its
     * source. The numbers are presented, attributed to the engine that produced
     * them.
     */
    return emptyResult({
      headline: "Cavity computed by the fallback engine",
      badge: "fpocket fallback",
      badgeTone: "warn",
      plainLanguage:
        "P2Rank did not return a result for this variant, so the cavity numbers come from the fpocket fallback engine instead. The distances and residues describe the same modelled structure, but they are not P2Rank's output.",
      bottomLine:
        "The cavity data is usable, but it comes from a different detector with different caveats. Do not compare these numbers against P2Rank values from other variants.",
      caveats: [
        "Different cavity detectors define pocket boundaries differently, so volumes and residue memberships are not interchangeable between them.",
      ]
    });
  }

  if (status === "unavailable") {
    return emptyResult({
      headline: "P2Rank unavailable",
      badge: "Model offline",
      badgeTone: "warn",
      plainLanguage:
        "P2Rank did not run for this variant, so no cavity could be measured. This is an infrastructure result rather than a biological one.",
      bottomLine:
        "Absence of a cavity result is not evidence that the residue is distant from a binding site.",
      caveats: ["Retry detection once the P2Rank runtime is available."]
    });
  }

  // ── status === "success" ──
  const finiteOrNull = (value: number | null | undefined): number | null =>
    value !== null && value !== undefined && Number.isFinite(value) ? value : null;

  /*
   * Prefer P2Rank's own cavity centre over the centroid of its residues.
   *
   * Both are reported by the runner now; the centroid is the fallback because it
   * is the only quantity available when the engine does not report a centre
   * (fpocket) or when the payload predates that field. The 4/8/12 Å bands below
   * only describe proximity meaningfully against the real centre, so which one was
   * used travels with the number.
   */
  const cavityCentreDistance = finiteOrNull(pocket?.cavityCentreDistance);
  const residueCentroidDistance = finiteOrNull(pocket?.pocketDistance);
  const rawDistance = cavityCentreDistance ?? residueCentroidDistance;
  const reference = distanceReference(cavityCentreDistance !== null);

  const score = finiteOrNull(pocket?.pocketScore);
  const volume = finiteOrNull(pocket?.pocketVolume);

  const residues = (pocket?.pocketResidues ?? []).filter(
    (residue): residue is PocketResidueSummary =>
      Boolean(residue) && typeof residue.index === "number" && Number.isFinite(residue.index)
  );
  const variantResidueIndex =
    options.variantResidueIndex === null || options.variantResidueIndex === undefined
      ? null
      : options.variantResidueIndex;
  const variantResidueChain = options.variantResidueChain?.trim() || null;

  /**
   * Membership is matched on index *and* chain where both are known.
   *
   * The payload carries a chain per residue and the runner's nearest-pocket
   * fallback can select another chain's copy in a homo-oligomer with shared
   * numbering. Index-only matching then produced an affirmative "Variant residue
   * lines cavity: Yes" for a residue that is not the modelled variant residue.
   */
  const includesVariantResidue =
    variantResidueIndex !== null &&
    residues.some(residue => {
      if (residue.index !== variantResidueIndex) return false;
      if (!variantResidueChain || !residue.chain) return true;
      return residue.chain.trim().toUpperCase() === variantResidueChain.toUpperCase();
    });

  /**
   * Nearest lining residue, excluding the variant residue itself.
   *
   * Each entry's `distance` is measured *to the variant residue*, so when the
   * variant residue is a member its own distance is 0.00 and the panel printed
   * "Nearest lining residue: GLU433 · 0.0 Å" — describing the residue under
   * investigation as its own nearest neighbour.
   */
  const neighbours = residues.filter(residue => residue.index !== variantResidueIndex);
  const nearest =
    neighbours.length > 0
      ? neighbours.reduce((closest, residue) => (residue.distance < closest.distance ? residue : closest))
      : null;

  const proximityBand = classifyProximity(rawDistance, includesVariantResidue);
  const classification = spatialClassificationFor(proximityBand, reference);
  const rankingBand = classifyPocketRanking(score);

  /*
   * Volume is only a volume when the payload says so.
   *
   * In production the runner computes `pocketVolume = sasPoints * 10` because the
   * real P2Rank predictions CSV has no volume column (per-pocket volume is only
   * emitted by `-export_pocket_descriptors`, which is not passed). That makes the
   * number a solvent-accessible surface point COUNT scaled by an arbitrary ten,
   * whose magnitude additionally scales with P2Rank's `-tessellation` setting.
   * Printing it as "Å³" and banding it against ligand-capacity thresholds
   * (`VOLUME_DETAILS`) manufactured a physical quantity with a unit.
   *
   * Absent provenance therefore means "unverified", and nothing downstream may
   * print a unit for it. `isMeasured` drives the renderers.
   */
  const isMeasuredVolume = pocket?.provenance?.volumeSource === "measured" && volume !== null;
  const volumeBand = isMeasuredVolume ? classifyPocketVolume(volume) : "unknown";
  const surfacePoints =
    pocket?.sasPoints !== null && pocket?.sasPoints !== undefined && Number.isFinite(pocket.sasPoints)
      ? pocket.sasPoints
      : null;

  const distanceClause = buildDistanceClause(rawDistance, includesVariantResidue, reference);

  const rankingClause =
    score !== null
      ? `P2Rank's ranking index for that cavity is ${score} of 100 (${RANKING_LABELS[
          rankingBand
        ].toLowerCase()}), which means ${RANKING_DETAILS[rankingBand]}.`
      : `P2Rank reported no ranking index for that cavity.`;

  const volumeClause = buildVolumeClause(volume, volumeBand, isMeasuredVolume, surfacePoints);

  const plainLanguage = `${distanceClause} ${rankingClause} ${volumeClause}`;

  const bottomLine = buildPocketBottomLine(proximityBand, rankingBand);

  const cofactorName =
    pocket?.likelyCofactor && !COFACTOR_ABSENT_MARKERS.some(marker => pocket.likelyCofactor!.toLowerCase().includes(marker))
      ? pocket.likelyCofactor
      : null;

  const caveats = [
    "P2Rank detects cavity geometry, not function: it cannot tell whether a cavity actually binds a ligand in the cell.",
    "Distances are measured between residue centres of mass in a single static conformation, so flexible loops and induced-fit motions are not represented.",
  ];
  if (rankingBand === "weak") {
    caveats.unshift(
      "A low ranking index means the residue is near a geometric cavity, not near a validated binding site."
    );
  }

  const headlineByProximity: Record<PocketProximityBand, string> = {
    lining: "Lining a predicted cavity",
    proximal: "Proximal to a predicted cavity",
    peripheral: "On the rim of a predicted cavity",
    distal: "Distal to the nearest predicted cavity",
    unknown: "Cavity proximity unclassified",
  };

  return {
    status,
    headline: headlineByProximity[proximityBand],
    badge: classification.label,
    badgeTone: pocketBadgeTone(proximityBand, rankingBand),
    plainLanguage,
    bottomLine,
    classification,
    proximity: {
      band: proximityBand,
      label: PROXIMITY_LABELS[proximityBand],
      distance: rawDistance,
      detail: classification.detail,
      reference,
    },
    ranking: {
      band: rankingBand,
      label: RANKING_LABELS[rankingBand],
      score,
      detail: RANKING_DETAILS[rankingBand],
    },
    volume: {
      band: volumeBand,
      label: VOLUME_LABELS[volumeBand],
      // The raw value is withheld unless the payload vouches for it being a volume.
      volume: isMeasuredVolume ? volume : null,
      detail: isMeasuredVolume ? VOLUME_DETAILS[volumeBand] : "",
      isMeasured: isMeasuredVolume,
      surfacePoints,
    },
    cofactor: {
      name: cofactorName,
      detail: cofactorName
        ? "Curated UniProt annotation for the ligand or cofactor known to occupy this region of the protein."
        : "No curated ligand or cofactor annotation is recorded for this position, so the predicted cavity has no known physiological occupant in the databases."
    },
    lining: { count: residues.length, nearest, includesVariantResidue },
    caveats,
    glossary: [...EMPTY_GLOSSARY]
  };
}
