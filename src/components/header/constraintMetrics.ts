/**
 * constraintMetrics.ts — the gnomAD v4.1.2 gene-constraint metrics the variant header shows.
 *
 * Pure: no React. Each builder turns one gnomAD signal into a `VhMetric` — value, tone, verdict, the
 * reference track (domain, direction, bands, ticks) and the full sentences for tooltips and assistive
 * tech. Moved out of `VariantHeader.tsx` unchanged when the header split into a top-bar identity and a
 * one-line context strip, so the strip's micro-tracks, its reading cards and the inspector's full tracks read the
 * same metric objects.
 */
import { THRESHOLDS } from "../../shared/thresholds";
import { resolveEvidenceAvailability } from "../../shared/evidenceAvailability";
import { CONSTRAINT_GUIDANCE_URL, CONSTRAINT_RELEASE, type ConstraintMetricKey, type RegionalConstraintStatus } from "../../shared/constraintSource";

export type { ConstraintMetricKey };
import type { AnalysisResult } from "../../types";

// ─────────────────────────────────────────────
// Display constants
// ─────────────────────────────────────────────

/** Em dash used wherever a metric has no measured value. */
const VH_NO_VALUE = "—";

/**
 * Reference domains for the threshold tracks. Each domain is the *display* window
 * for that metric — it is not a claim about the metric's maximum, and markers are
 * clamped into the track so an out-of-window value still renders on-scale.
 */
const MISSENSE_Z_DOMAIN: readonly [number, number] = [0, 5];
const LOEUF_DOMAIN: readonly [number, number] = [0, 1.5];
const RMC_DOMAIN: readonly [number, number] = [0, 1.5];

export type VhTone = "path" | "warn" | "good" | "muted";

/**
 * Who set a track's cut-points. The reader has to know this to weigh a band: an app-defined display
 * band, a cut gnomAD publishes, and a neutral baseline are three different kinds of line.
 */
export type VhCutPointOrigin = "app" | "gnomad" | "baseline";

export interface VhCutPoints {
  origin: VhCutPointOrigin;
  /** The cut-points as drawn, e.g. "2.0 · 3.09". */
  label: string;
  /** One sentence on what the lines are and where they come from. */
  text: string;
  /** The published guidance behind the lines, when there is one. */
  href?: string;
}

/** Visible names for the cut-point origins, shared by the card and the inspector. */
export const CUT_POINT_ORIGIN_LABELS: Record<VhCutPointOrigin, string> = {
  app: "App-defined",
  gnomad: "gnomAD",
  baseline: "Baseline",
};

export interface VhBand {
  from: number;
  to: number;
  tone: VhTone;
}

export interface VhTick {
  at: number;
  label: string;
  kind?: "app";
}

/** One metric rendered as a threshold track inside the constraint rail. */
export interface VhMetric {
  key: ConstraintMetricKey;
  /** Compact visual label; the full metric name lives in `name`, `tooltip` and `detail`. */
  label: string;
  /** Full metric name, for the card and inspector headings. */
  name: string;
  /**
   * The release this reading comes from. Regional O/E has its own (v4.1.1), so it must not inherit
   * the gene metrics' label — the strip tags any metric whose release differs from the group's.
   */
  release: string;
  /** Where the cut-points come from; null when interpretation is withheld (no bands are drawn). */
  cutPoints: VhCutPoints | null;
  /**
   * Visible facts about this reading beyond value and verdict — PP2 proxy status, the RMC block and
   * its p-value, why a call is absent. They used to live only in tooltips.
   */
  facts: string[];
  value: string;
  tone: VhTone;
  verdict: string;
  domain: readonly [number, number];
  /**
   * Draw the axis high-to-low. Every track reads less depleted on the left and constrained on the
   * right; LOEUF and O/E fall as constraint rises, so their axes run backwards. Without this the
   * Missense Z row ran green-to-red and the LOEUF row under it red-to-green, and the reader had to
   * flip the meaning of "right" between adjacent rows.
   */
  reversed: boolean;
  bands: VhBand[];
  ticks: VhTick[];
  /** Raw metric value plotted on the track, or null when unmeasured. */
  marker: number | null;
  tooltip: string;
  detail: string;
}

// ─────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────

/** Percentage position of a value inside a display domain. */
export function vhPct(value: number, [lo, hi]: readonly [number, number]): number {
  return ((value - lo) / (hi - lo)) * 100;
}

/** Position of a value on a metric's track, honouring the axis direction. */
export function vhPos(value: number, metric: Pick<VhMetric, "domain" | "reversed">): number {
  const pct = vhPct(value, metric.domain);
  return metric.reversed ? 100 - pct : pct;
}

/** Marker position, clamped so the dot never falls off either end of the track. */
export function vhMarkerPct(value: number, metric: Pick<VhMetric, "domain" | "reversed">): number {
  return Math.max(2.5, Math.min(97.5, vhPos(value, metric)));
}

/**
 * Two tick numerals closer than this (percent of the track) cannot both be centred on their ticks
 * without overprinting: a numeral is ~24px, and the narrowest track the rail or the card gives
 * them is ~220px. LOEUF's 0.36 and 0.45 sit 6% apart and used to read "0.450.36".
 */
const TICK_LABEL_SPLIT_PCT = 15;

export type TickLabelAlign = "center" | "start" | "end";

/**
 * How each tick's numeral anchors to its tick, by tick position in `metric.ticks`. Numerals centre
 * on their ticks unless a neighbour is too close; then the left one ends at its tick and the right
 * one starts at its tick, so the pair fans outwards and can never touch, at any track width.
 */
export function tickLabelAlignments(metric: Pick<VhMetric, "ticks" | "domain" | "reversed">): TickLabelAlign[] {
  const drawn = metric.ticks.map((tick, index) => ({ index, at: vhPos(tick.at, metric) })).sort((a, b) => a.at - b.at);
  const align: TickLabelAlign[] = metric.ticks.map(() => "center");
  for (let i = 1; i < drawn.length; i++) {
    if (drawn[i].at - drawn[i - 1].at >= TICK_LABEL_SPLIT_PCT) continue;
    if (align[drawn[i - 1].index] === "center") align[drawn[i - 1].index] = "end";
    if (align[drawn[i].index] === "center") align[drawn[i].index] = "start";
  }
  return align;
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/**
 * Compact p-value. gnomAD RMC p-values run to ~20 significant characters, which is
 * unreadable in a header row, so tiny values collapse to `6.6×10⁻⁶`.
 *
 * Two rounding traps this avoids:
 *  - `toFixed(3)` across the 0.001–0.01 band turns 0.0015 into "0.002" and 0.00149
 *    into "0.001", i.e. it can display a p-value as meeting a 0.001 significance
 *    line that the true value does not meet. That band keeps a fourth decimal.
 *  - rounding the mantissa after taking `Math.log10` can carry it to 10.0
 *    (9.99e-6 → "10.0×10⁻⁶"), which is not valid scientific notation.
 *    `toExponential` normalises the carry into the exponent.
 */
export function formatPValue(p: number | null): string | null {
  if (p === null || !Number.isFinite(p) || p <= 0) return null;
  if (p >= 0.01) return p.toFixed(3);
  if (p >= 0.001) return String(Number(p.toFixed(4)));
  const [mantissa, exponent] = p.toExponential(1).split("e");
  const digits = String(Math.abs(Number(exponent)))
    .split("")
    .map((d) => SUPERSCRIPT[Number(d)])
    .join("");
  return `${mantissa}×10⁻${digits}`;
}

/** "Gln199 to Met555" → "Gln199–Met555" */
function compactRegion(regionText: string | null): string | null {
  if (!regionText) return null;
  return regionText.replace(/\s+to\s+/i, "–").trim();
}

function signed(value: number): string {
  return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

// ─────────────────────────────────────────────
// Metric builders — one per gnomAD v4.1.2 signal
// ─────────────────────────────────────────────

/**
 * @param missenseZ gnomAD v4.1.2 missense Z
 * @param isPP2Constrained the server's own PP2 call, which additionally requires
 *   missense O/E < 0.6. The header must not re-derive PP2 from the Z threshold
 *   alone: it would claim App-defined PP2 proxy for genes the pipeline's flag says do not meet it.
 */
export function buildMissenseZMetric(
  missenseZ: number | null | undefined,
  isPP2Constrained: boolean
): VhMetric {
  const supporting = THRESHOLDS.misZ.pathogenicSupporting;
  const strong = THRESHOLDS.misZ.pathogenicStrong;
  const domains = {
    domain: MISSENSE_Z_DOMAIN,
    reversed: false,
    bands: [
      { from: 0, to: supporting, tone: "good" as VhTone },
      { from: supporting, to: strong, tone: "warn" as VhTone },
      { from: strong, to: 5, tone: "path" as VhTone },
    ],
    ticks: [
      { at: supporting, label: supporting.toFixed(1), kind: "app" as const },
      { at: strong, label: String(strong), kind: "app" as const },
    ],
  };
  const refRange =
    `Reference: app-defined display bands at Z ${supporting.toFixed(1)} and ${strong}; these are not ClinGen cutoffs. Positive Z means fewer missense variants than expected; Z of 0 or less does not establish tolerance.`;
  const pp2 = THRESHOLDS.pp2Constraint;
  const reference = {
    name: "Missense Z score",
    release: "gnomAD v4.1.2",
    cutPoints: {
      origin: "app" as const,
      label: `${supporting.toFixed(1)} · ${strong}`,
      text: "Display bands drawn as dashed marks; they are not ClinGen cutoffs.",
    },
  };
  const pp2Fact = isPP2Constrained
    ? `App PP2 proxy met: Z ≥ ${pp2.missenseZ} and missense O/E < ${pp2.oeMisBelow}. This is not the recorded ACMG criterion.`
    : `App PP2 proxy not met: it needs Z ≥ ${pp2.missenseZ} and missense O/E < ${pp2.oeMisBelow}.`;
  const pp2Clause = isPP2Constrained
    ? ` App-defined PP2 proxy is met (Z ≥ ${pp2.missenseZ} and missense O/E < ${pp2.oeMisBelow}); this is not the recorded ACMG criterion or a ClinGen genome-wide cutoff.`
    : ` App-defined PP2 proxy is not met (it also requires missense O/E < ${pp2.oeMisBelow}); this is not a ClinGen genome-wide cutoff.`;

  const z = typeof missenseZ === "number" ? missenseZ : null;

  if (z === null || !Number.isFinite(z)) {
    return {
      key: "missense-z",
      label: "Missense Z",
      ...reference,
      facts: [],
      value: VH_NO_VALUE,
      tone: "muted",
      verdict: "No data",
      marker: null,
      ...domains,
      tooltip: "gnomAD v4.1.2 Missense Z score — not available for this gene.",
      detail: `Not measured for this gene. ${refRange}`,
    };
  }

  const value = signed(z);
  const tier =
    z >= strong
      ? {
          tone: "path" as VhTone,
          verdict: "Severe intolerance",
          why: isPP2Constrained
            ? "severe missense depletion, app-defined PP2 proxy met"
            : "severe missense depletion (App-defined PP2 proxy not met)",
        }
      : z >= supporting
        ? { tone: "warn" as VhTone, verdict: "Constrained", why: "above the app-defined lower depletion display band" }
        : z > 0
          ? // The band is drawn green (the unconstrained side), so the tone stays; the verdict refuses "Tolerant":
            // Z in (0, 2) only says slightly fewer missense variants than expected, below the constraint range.
            // (Fixed in 93ee30b, lost in the header merge; header/__tests__/missenseZVerdict.test.ts pins it.)
            { tone: "good" as VhTone, verdict: "Not constrained", why: "a positive Z means slightly fewer missense variants than expected, below the constraint range" }
          : { tone: "good" as VhTone, verdict: "No depletion", why: "observed missense variants at or above expectation; this does not establish benignity or tolerance" };

  return {
    key: "missense-z",
    label: "Missense Z",
    ...reference,
    facts: [pp2Fact],
    value,
    tone: tier.tone,
    verdict: tier.verdict,
    marker: z,
    ...domains,
    tooltip: `gnomAD v4.1.2 Missense Z score ${value} — ${tier.why}. ${refRange}${z >= strong ? pp2Clause : ""}`,
    // Reference-only: the label, value and verdict are already announced as visible text.
    detail: `${refRange}${z >= strong ? pp2Clause : ""}`,
  };
}

export function buildLoeufMetric(loeuf: number | null | undefined): VhMetric {
  // One source for the cut-points: the Score thresholds tab and this header must not disagree.
  const strong = THRESHOLDS.loeuf.pathogenicStrong;
  const constrained = THRESHOLDS.loeuf.pathogenicSupporting;
  const domains = {
    domain: LOEUF_DOMAIN,
    reversed: true,
    bands: [
      { from: 0, to: strong, tone: "path" as VhTone },
      { from: strong, to: constrained, tone: "warn" as VhTone },
      { from: constrained, to: LOEUF_DOMAIN[1], tone: "good" as VhTone },
    ],
    ticks: [
      { at: strong, label: String(strong) },
      { at: constrained, label: String(constrained) },
    ],
  };
  const refRange =
    `Reference: strongest 10% of MANE Select genes below ${strong}, constrained below ${constrained.toFixed(2)} (gnomAD's suggested cut, v4.1.1 guidance retained in v4.1.2; an optional prioritization threshold); at or above ${constrained.toFixed(2)} the gene is not shown to be constrained, which is not the same as tolerating loss of function.`;

  const reference = {
    name: "LOEUF · loss-of-function observed/expected upper bound",
    release: "gnomAD v4.1.2",
    cutPoints: {
      origin: "gnomad" as const,
      label: `${strong} · ${constrained.toFixed(2)}`,
      text: `${strong}: the strongest 10% of MANE Select genes. ${constrained.toFixed(2)}: gnomAD's suggested cut, an optional prioritisation threshold. Axis reversed.`,
      href: CONSTRAINT_GUIDANCE_URL,
    },
  };

  const v = typeof loeuf === "number" ? loeuf : null;

  if (v === null || !Number.isFinite(v)) {
    return {
      key: "loeuf",
      label: "LOEUF",
      ...reference,
      facts: [],
      value: VH_NO_VALUE,
      tone: "muted",
      verdict: "No data",
      marker: null,
      ...domains,
      tooltip: "gnomAD v4.1.2 loss-of-function observed/expected upper bound fraction (LOEUF) — not available for this gene.",
      detail: `Not measured for this gene. ${refRange}`,
    };
  }

  const value = v.toFixed(2);
  const tier =
    v < strong
      ? { tone: "path" as VhTone, verdict: "Strong LoF intolerance", why: "below the v4.1.1/v4.1.2 MANE Select 10th-percentile cutoff" }
      : v < constrained
        ? { tone: "warn" as VhTone, verdict: "LoF constrained", why: `below gnomAD's suggested constraint cut of ${constrained.toFixed(2)}` }
        /*
         * `good` is the BAND's tone for this range (drawn green like every other track's
         * unconstrained side), so the reading keeps it rather than sitting grey inside its own band.
         * The verdict carries the honesty: at or above the suggested cut the gene is NOT shown to be
         * constrained, and the tooltip refuses the stronger word "tolerant" that the old verdict used.
         */
        : { tone: "good" as VhTone, verdict: "Not LoF constrained", why: "at or above gnomAD's suggested constraint cut; this does not show the gene tolerates loss of function" };

  return {
    key: "loeuf",
    label: "LOEUF",
    ...reference,
    facts: [],
    value,
    tone: tier.tone,
    verdict: tier.verdict,
    marker: v,
    ...domains,
    tooltip: `gnomAD v4.1.2 loss-of-function observed/expected upper bound fraction (LOEUF) ${value} — ${tier.why}. ${refRange}`,
    detail: refRange,
  };
}

export function buildRmcMetric(
  hasRegionalData: boolean,
  regional: { isConstrained: boolean; oeRatio: number | null; pValue: number | null; regionText: string | null } | null,
  status?: RegionalConstraintStatus,
  source = "gnomAD v4.1.1"
): VhMetric {
  // No invented cutoffs here: gnomAD RMC is a tested sub-region call, so the track
  // carries only the neutral O/E = 1.0 baseline and the observed ratio.
  const domains = {
    domain: RMC_DOMAIN,
    reversed: true,
    bands: [] as VhBand[],
    ticks: [{ at: 1.0, label: "1.0" }],
  };
  const refRange = "Reference: O/E = 1.0 is the neutral baseline. A regional call requires verified GRCh38 transcript/locus identity and passed QC.";
  const reference = {
    name: "Regional missense O/E (RMC)",
    release: source,
    cutPoints: {
      origin: "baseline" as const,
      label: "O/E 1.0",
      text: "The neutral baseline. A regional call needs depletion, significance and passed QC on a verified GRCh38 locus. Axis reversed.",
    },
  };
  const unavailable: Partial<Record<RegionalConstraintStatus, [string, string]>> = {
    "unverified-locus": ["Unverified locus", "A verified GRCh38 single-nucleotide locus and transcript are required; protein residue numbers alone are insufficient."],
    "transcript-mismatch": ["Transcript mismatch", "The annotated transcript is absent from this gene's constraint release; regional evidence is withheld."],
    "failed-qc": ["QC warning", "The gene or regional interval failed quality checks; no regional constraint call is made."],
    "invalid-data": ["Invalid data", "The interval or its statistics are invalid or ambiguous; no regional call is made."],
    "no-regions": ["No regions", "No regional intervals are released for this transcript."],
    "outside-region": ["Outside regions", "The verified locus lies outside the released intervals; this does not establish tolerance."],
  };
  const absence = status ? unavailable[status] : undefined;
  if (absence) return { key: "regional-oe", label: "Regional O/E", ...reference, facts: [absence[1]], value: VH_NO_VALUE, tone: "muted", verdict: absence[0], marker: null, ...domains, tooltip: `${source}: ${absence[1]}`, detail: `${absence[1]} ${refRange}` };

  if (!regional) {
    // `regional` is null in two different situations, and they mean opposite things:
    // the gene has no RMC blocks at all, or it has blocks but this variant had no
    // residue position to look up. The verdict already distinguished them; the copy
    // must too, or it tells the reader the gene is unstudied when it is not.
    const noCall = hasRegionalData
      ? {
          verdict: "No data",
          reason: "no sub-regional call was returned for this residue",
          sentence:
            "No sub-regional call was returned for this residue, so RMC is not assessed here. This is not a statement about the gene.",
        }
      : {
          verdict: "No gnomAD blocks",
          reason: "this gene has no gnomAD constraint blocks",
          sentence: "The gene has no gnomAD constraint blocks, so no sub-regional call was made.",
        };
    return {
      key: "regional-oe",
      label: "Regional O/E",
      ...reference,
      facts: [noCall.sentence],
      value: VH_NO_VALUE,
      tone: "muted",
      verdict: noCall.verdict,
      marker: null,
      ...domains,
      tooltip: `${source} Regional Missense Constraint (RMC) — ${noCall.reason}.`,
      detail: `${noCall.sentence} ${refRange}`,
    };
  }

  const oe = typeof regional.oeRatio === "number" && Number.isFinite(regional.oeRatio) ? regional.oeRatio : null;
  const value = oe === null ? VH_NO_VALUE : oe.toFixed(2);
  const pText = formatPValue(regional.pValue);
  const region = compactRegion(regional.regionText);

  const regionDetail = region ? `Constrained block ${region.replace("–", " to ")}` : "Constrained sub-region";
  // sr-only: the verdict already announces "Subgenic constrained", so the
  // detail names the block without repeating the verdict word.
  const regionSr = region ? `RMC block ${region.replace("–", " to ")}` : "RMC sub-region";
  // The block span and its p-value are facts about the RMC window, not about
  // this residue, so they are tooltip / sr-only provenance. A visible footnote
  // would hand the third row a second text line the other rows don't have,
  // breaking the row rhythm. The released p-value is a regional chi-square statistic.
  const pClause = pText ? `, regional chi-square p = ${pText} (approximate)` : "";
  const blockSpan = region ? region.replace("–", " to ") : null;
  const pFact = pText ? `Regional chi-square p = ${pText} (approximate).` : null;

  if (regional.isConstrained) {
    return {
      key: "regional-oe",
      label: "Regional O/E",
      ...reference,
      facts: [blockSpan ? `Constrained block ${blockSpan}.` : "Constrained sub-region.", ...(pFact ? [pFact] : [])],
      value,
      tone: "path",
      verdict: "Subgenic constrained",
      marker: oe,
      ...domains,
      tooltip: `${source} Regional Missense Constraint (RMC): ${regionDetail}${pClause}. Observed/expected ratio ${value} against a neutral baseline of 1.0.`,
      detail: `${regionSr}${pText ? `, regional chi-square p = ${pText}` : ""}. ${refRange}`,
    };
  }

  // The server gates the constrained call on the window's own significance, so a
  // non-constrained result with a span means "matched a candidate window that did
  // not clear it" — say that, instead of the copy below, which is only true when
  // no window matched at all (region is null then).
  if (region) {
    return {
      key: "regional-oe",
      label: "Regional O/E",
      ...reference,
      facts: [`Candidate window ${blockSpan}; it did not reach significance, so this is not a constrained call.`, ...(pFact ? [pFact] : [])],
      value,
      tone: "muted",
      verdict: "Sub-threshold window",
      marker: oe,
      ...domains,
      tooltip: `${source} Regional Missense Constraint (RMC): the residue lies in candidate window ${region.replace(
        "–",
        " to "
      )}${pText ? ` (regional chi-square p = ${pText})` : ""}, which did not reach significance — not a constrained call.`,
      detail: `Candidate RMC window ${region.replace("–", " to ")} below significance. ${refRange}`,
    };
  }

  return {
    key: "regional-oe",
    label: "Regional O/E",
    ...reference,
    facts: ["The residue sits outside every constrained sub-region; this does not establish tolerance."],
    value,
    tone: "muted",
    verdict: "Outside regions",
    marker: oe,
    ...domains,
    tooltip: `${source} Regional Missense Constraint (RMC): the residue sits outside every constrained sub-region (observed/expected ${value}).`,
    // The "outside every constrained sub-region" clause is tooltip-only otherwise.
    detail: `Residue outside every constrained sub-region. ${refRange}`,
  };
}

/** Shared by the compact header and Details; absent values always retain a visible state. */
export function constraintSourceLabel(result: AnalysisResult | null | undefined): string {
  const release = result?.gnomadConstraint?.provenance?.release;
  return release ? `gnomAD v${release}` : result?.gnomadConstraint ? "gnomAD (release unreported)" : `gnomAD v${CONSTRAINT_RELEASE}`;
}
export function buildConstraintMetrics(analysisResult: AnalysisResult | null | undefined): VhMetric[] {
  if (!analysisResult) return [];
  const gnomad = analysisResult.gnomadConstraint;
  const metrics = [
    buildMissenseZMetric(gnomad?.missense_z, gnomad?.isPP2Constrained ?? false),
    buildLoeufMetric(gnomad?.loeuf),
    buildRmcMetric(gnomad?.hasRegionalData ?? false, gnomad?.regionalConstraint ?? null, gnomad?.regionalStatus,
      gnomad?.regionalRelease ? `gnomAD v${gnomad.regionalRelease}` : "gnomAD (regional release unreported)"),
  ];
  const source = constraintSourceLabel(analysisResult);
  const status = analysisResult.serviceStatus?.gnomadConstraint ?? analysisResult.metadata?.serviceStatus?.gnomadConstraint;
  const legacy = !!gnomad && gnomad.provenance?.release !== CONSTRAINT_RELEASE;
  const flagLabels: Record<string, string> = {
    low_exome_coverage: "Low exome coverage", low_exome_mapping_quality: "Low exome mapping quality",
    outlier_syn: "Synonymous count outlier", outlier_mis: "Missense count outlier", outlier_lof: "LoF count outlier",
    no_exp_syn: "No expected synonymous variants", no_exp_mis: "No expected missense variants", no_exp_lof: "No expected LoF variants",
    "missing-or-zero-expected-variants": "Missing or zero expected counts",
  };
  const qc = gnomad?.qualityFlags?.length ? `QC warning: ${gnomad.qualityFlags.map(f => flagLabels[f] ?? f.replaceAll("_", " ")).join(", ")}. Constraint interpretation withheld.` : null;
  for (const metric of metrics) {
    if (metric.key !== "regional-oe") {
      metric.release = source;
      metric.tooltip = metric.tooltip.replace("gnomAD v4.1.2", source);
      if (qc) Object.assign(metric, { value: VH_NO_VALUE, marker: null, tone: "muted", verdict: "QC warning", tooltip: `${source}: ${qc}`, detail: qc, facts: [qc] });
    }
    if (legacy) Object.assign(metric, { bands: [], ticks: [], cutPoints: null, facts: [], tone: "muted", verdict: gnomad?.provenance ? "Different release" : "Release unreported", tooltip: "Constraint values require the pinned release and transcript provenance for interpretation. Re-run the analysis to use current data.", detail: "Interpretation withheld until current source provenance is available." });
    if (!gnomad) {
      const failed = status === "error" || status === "timeout";
      const availability = resolveEvidenceAvailability({ status: failed ? "unavailable" : status, value: null,
        message: failed ? "The constraint source could not be loaded. Re-run the analysis." : null });
      Object.assign(metric, { verdict: availability.label ?? "No result", tone: "muted", facts: [], tooltip: `${source}: ${availability.reason ?? availability.label ?? "No result"}`, detail: availability.reason ?? "No constraint result was returned." });
    }
    if (metric.marker !== null && (metric.marker < metric.domain[0] || metric.marker > metric.domain[1])) {
      metric.detail += " Value outside the display range; the marker is clamped at the edge.";
      metric.tooltip += " Value outside the display range; the marker is clamped at the edge.";
      metric.facts.push("Value outside the display range; the marker is clamped at the edge.");
    }
  }
  return metrics;
}

/**
 * The short release tag a reading carries when its release differs from the group's label
 * ("v4.1.1" on Regional O/E under "gnomAD v4.1.2"), or null when there is nothing to attribute:
 * the release matches the group's, no value was measured, or interpretation is withheld
 * (`cutPoints` null — a legacy or different release), where a tag would only contradict the verdict.
 */
export function releaseTag(metric: Pick<VhMetric, "release" | "marker" | "cutPoints">, groupSource: string): string | null {
  if (metric.marker === null || metric.cutPoints === null || metric.release === groupSource) return null;
  return metric.release.replace(/^gnomAD \((.*)\)$/, "$1").replace(/^gnomAD /, "");
}

/** Where the constraint numbers came from, as the inspector's Source section lists them. */
export interface ConstraintProvenanceView {
  /** "gnomAD v4.1.2" — the gene metrics' release. */
  geneSource: string;
  /** The gene's gnomAD browser page. */
  geneHref: string;
  assembly: string;
  /** "ENST….9" */
  transcript: string;
  /** How that transcript was chosen, in words. */
  selection: string;
  /** "gnomAD v4.1.1", or null when the payload carries no regional release. */
  regionalSource: string | null;
}

const TRANSCRIPT_SELECTION_LABELS: Record<string, string> = {
  matched: "Annotated transcript",
  "mane-select": "MANE Select reference",
  "sole-transcript": "Sole protein-coding transcript",
};

/** Null when the payload has no provenance (a legacy payload): the inspector then names no source. */
export function buildConstraintProvenance(result: AnalysisResult | null | undefined): ConstraintProvenanceView | null {
  const provenance = result?.gnomadConstraint?.provenance;
  if (!provenance) return null;
  const regionalRelease = result?.gnomadConstraint?.regionalRelease;
  return {
    geneSource: constraintSourceLabel(result),
    geneHref: `https://gnomad.broadinstitute.org/gene/${encodeURIComponent(provenance.geneId)}?dataset=gnomad_r4`,
    assembly: provenance.assembly,
    transcript: `${provenance.transcriptId}.${provenance.transcriptVersion}`,
    selection: TRANSCRIPT_SELECTION_LABELS[provenance.selection] ?? "Canonical reference",
    regionalSource: regionalRelease ? `gnomAD v${regionalRelease}` : null,
  };
}
