import React, { useMemo, useCallback, useState } from "react";
import { AnalysisResult } from "../types";
import { parseVariantCoordinate } from "../shared/variantCoordinate";
import { variantNumberingView } from "../shared/numbering";
import { THRESHOLDS } from "../shared/thresholds";
import { ExternalLink, Copy, Check, Dna, MapPin, FlaskConical, Scissors } from "lucide-react";

interface VariantHeaderProps {
  gene: string;
  variant: string;
  uniprotId: string;
  analysisResult: AnalysisResult | null;
}

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

type VhTone = "path" | "warn" | "good" | "muted";

interface VhBand {
  from: number;
  to: number;
  tone: VhTone;
}

interface VhTick {
  at: number;
  label: string;
}

/** One metric rendered as a threshold track inside the constraint rail. */
interface VhMetric {
  key: string;
  /** Compact visual label; the full metric name lives in `tooltip`/`detail`. */
  label: string;
  value: string;
  tone: VhTone;
  verdict: string;
  domain: readonly [number, number];
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
function vhPct(value: number, [lo, hi]: readonly [number, number]): number {
  return ((value - lo) / (hi - lo)) * 100;
}

/** Marker position, clamped so the dot never falls off either end of the track. */
function vhMarkerPct(value: number, domain: readonly [number, number]): number {
  return Math.max(2.5, Math.min(97.5, vhPct(value, domain)));
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
function formatPValue(p: number | null): string | null {
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
// Metric builders — one per gnomAD v2 signal
// ─────────────────────────────────────────────

/**
 * @param missenseZ gnomAD v2 missense Z
 * @param isPP2Constrained the server's own PP2 call, which additionally requires
 *   missense O/E < 0.6. The header must not re-derive PP2 from the Z threshold
 *   alone: it would claim ClinGen PP2 for genes the pipeline's flag says do not meet it.
 */
function buildMissenseZMetric(
  missenseZ: number | null | undefined,
  isPP2Constrained: boolean
): VhMetric {
  const domains = {
    domain: MISSENSE_Z_DOMAIN,
    bands: [
      { from: 0, to: 2.0, tone: "good" as VhTone },
      { from: 2.0, to: 3.09, tone: "warn" as VhTone },
      { from: 3.09, to: 5, tone: "path" as VhTone },
    ],
    ticks: [
      { at: 2.0, label: "2.0" },
      { at: 3.09, label: "3.09" },
    ],
  };
  const refRange =
    "Reference: tolerant below 2.0, constrained from 2.0, severe intolerance at or above 3.09.";
  const pp2Clause = isPP2Constrained
    ? " ClinGen PP2 is met (Z ≥ 3.09 and missense O/E < 0.6)."
    : " ClinGen PP2 is not met (it also requires missense O/E < 0.6).";

  const z = typeof missenseZ === "number" ? missenseZ : null;

  if (z === null || !Number.isFinite(z)) {
    return {
      key: "missense-z",
      label: "Missense Z",
      value: VH_NO_VALUE,
      tone: "muted",
      verdict: "No data",
      marker: null,
      ...domains,
      tooltip: "gnomAD v2 Missense Z score — not available for this gene.",
      detail: `Not measured for this gene. ${refRange}`,
    };
  }

  const value = signed(z);
  const tier =
    z >= 3.09
      ? {
          tone: "path" as VhTone,
          verdict: "Severe intolerance",
          why: isPP2Constrained
            ? "severe missense intolerance, ClinGen PP2 met"
            : "severe missense intolerance (ClinGen PP2 not met: missense O/E not below 0.6)",
        }
      : z >= 2.0
        ? { tone: "warn" as VhTone, verdict: "Constrained", why: "above the tolerant reference range" }
        : { tone: "good" as VhTone, verdict: "Tolerant", why: "within the tolerant reference range" };

  return {
    key: "missense-z",
    label: "Missense Z",
    value,
    tone: tier.tone,
    verdict: tier.verdict,
    marker: z,
    ...domains,
    tooltip: `gnomAD v2 Missense Z score ${value} — ${tier.why}. ${refRange}${z >= 3.09 ? pp2Clause : ""}`,
    // Reference-only: the label, value and verdict are already announced as visible text.
    detail: `${refRange}${z >= 3.09 ? pp2Clause : ""}`,
  };
}

function buildLoeufMetric(loeuf: number | null | undefined): VhMetric {
  // One source for the cut-points: the Score thresholds tab and this header must not disagree.
  const strong = THRESHOLDS.loeuf.pathogenicStrong;
  const constrained = THRESHOLDS.loeuf.pathogenicSupporting;
  const domains = {
    domain: LOEUF_DOMAIN,
    bands: [
      { from: 0, to: strong, tone: "path" as VhTone },
      { from: strong, to: constrained, tone: "warn" as VhTone },
      { from: constrained, to: LOEUF_DOMAIN[1], tone: "good" as VhTone },
    ],
    ticks: [
      { at: strong, label: String(strong) },
      { at: constrained, label: constrained.toFixed(1) },
    ],
  };
  const refRange =
    `Reference: strong loss-of-function intolerance below ${strong}, constrained below ${constrained.toFixed(2)} (gnomAD's suggested cut, the same one the Score thresholds tab uses), tolerant at or above ${constrained.toFixed(2)}.`;

  const v = typeof loeuf === "number" ? loeuf : null;

  if (v === null || !Number.isFinite(v)) {
    return {
      key: "loeuf",
      label: "LOEUF",
      value: VH_NO_VALUE,
      tone: "muted",
      verdict: "No data",
      marker: null,
      ...domains,
      tooltip: "gnomAD v2 loss-of-function observed/expected upper bound fraction (LOEUF) — not available for this gene.",
      detail: `Not measured for this gene. ${refRange}`,
    };
  }

  const value = v.toFixed(2);
  const tier =
    v < strong
      ? { tone: "path" as VhTone, verdict: "Strong LoF intolerance", why: "below the decile-1 intolerance threshold" }
      : v < constrained
        ? { tone: "warn" as VhTone, verdict: "LoF constrained", why: `below gnomAD's suggested constraint cut of ${constrained.toFixed(2)}` }
        : { tone: "good" as VhTone, verdict: "LoF tolerant", why: "at or above gnomAD's suggested constraint cut" };

  return {
    key: "loeuf",
    label: "LOEUF",
    value,
    tone: tier.tone,
    verdict: tier.verdict,
    marker: v,
    ...domains,
    tooltip: `gnomAD v2 loss-of-function observed/expected upper bound fraction (LOEUF) ${value} — ${tier.why}. ${refRange}`,
    detail: refRange,
  };
}

function buildRmcMetric(
  hasRegionalData: boolean,
  regional: { isConstrained: boolean; oeRatio: number | null; pValue: number | null; regionText: string | null } | null
): VhMetric {
  // No invented cutoffs here: gnomAD RMC is a tested sub-region call, so the track
  // carries only the neutral O/E = 1.0 baseline and the observed ratio.
  const domains = {
    domain: RMC_DOMAIN,
    bands: [] as VhBand[],
    ticks: [{ at: 1.0, label: "1.0" }],
  };
  const refRange = "Reference: unconstrained at O/E ≈ 1.0.";

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
      value: VH_NO_VALUE,
      tone: "muted",
      verdict: noCall.verdict,
      marker: null,
      ...domains,
      tooltip: `gnomAD v2 Regional Missense Constraint (RMC) — ${noCall.reason}.`,
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
  // breaking the row rhythm. The p-value is a likelihood-ratio statistic on
  // the window, so it is labelled as the approximate window LRT it is.
  const pClause = pText ? `, window LRT p = ${pText} (approximate)` : "";

  if (regional.isConstrained) {
    return {
      key: "regional-oe",
      label: "Regional O/E",
      value,
      tone: "path",
      verdict: "Subgenic constrained",
      marker: oe,
      ...domains,
      tooltip: `gnomAD v2 Regional Missense Constraint (RMC): ${regionDetail}${pClause}. Observed/expected ratio ${value} against a neutral baseline of 1.0.`,
      detail: `${regionSr}${pText ? `, window LRT p = ${pText}` : ""}. ${refRange}`,
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
      value,
      tone: "muted",
      verdict: "Sub-threshold window",
      marker: oe,
      ...domains,
      tooltip: `gnomAD v2 Regional Missense Constraint (RMC): the residue lies in candidate window ${region.replace(
        "–",
        " to "
      )}${pText ? ` (window LRT p = ${pText})` : ""}, which did not reach significance — not a constrained call.`,
      detail: `Candidate RMC window ${region.replace("–", " to ")} below significance. ${refRange}`,
    };
  }

  return {
    key: "regional-oe",
    label: "Regional O/E",
    value,
    tone: oe === null ? "muted" : "good",
    verdict: "Expected variation",
    marker: oe,
    ...domains,
    tooltip: `gnomAD v2 Regional Missense Constraint (RMC): the residue sits outside every constrained sub-region (observed/expected ${value}).`,
    // The "outside every constrained sub-region" clause is tooltip-only otherwise.
    detail: `Residue outside every constrained sub-region. ${refRange}`,
  };
}

// ─────────────────────────────────────────────
// Small utility sub-components
// ─────────────────────────────────────────────

/** Copy-to-clipboard icon button with transient checkmark feedback and timer cleanup */
function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    if (!navigator?.clipboard?.writeText) {
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard access denied or rejected
      });
  }, [text]);

  return (
    <button
      type="button"
      className="vh-icon-btn"
      onClick={handleCopy}
      title={`Copy ${label}`}
      aria-label={copied ? `Copied ${label} to clipboard` : `Copy ${label}`}
    >
      {copied ? <Check size={11} strokeWidth={2.5} /> : <Copy size={11} strokeWidth={2} />}
    </button>
  );
}

/**
 * One metric as a list row: label, value, reference track, threshold legend, verdict.
 * The reference ranges are drawn on the track as bands and tick marks; the numbers
 * beside it name those ticks in left-to-right order.
 */
function ConstraintMetric({ metric }: { metric: VhMetric }) {
  const { domain, bands, ticks, marker, tone } = metric;
  const markerLeft = marker === null ? null : vhMarkerPct(marker, domain);

  return (
    <li className="vh-metric" title={metric.tooltip}>
      <span className="vh-metric-label">{metric.label}</span>
      <span className="vh-metric-value" data-tone={tone}>
        {metric.value}
      </span>

      <span className="vh-scale" data-empty={marker === null ? "true" : undefined} aria-hidden="true">
        <span className="vh-scale-bar">
          {bands.map((band) => (
            <span
              key={`${band.from}-${band.to}`}
              className="vh-band"
              data-tone={band.tone}
              style={{
                left: `${vhPct(band.from, domain)}%`,
                width: `${vhPct(band.to, domain) - vhPct(band.from, domain)}%`,
              }}
            />
          ))}
        </span>
        {ticks.map((tick) => (
          <span key={tick.at} className="vh-tick" style={{ left: `${vhPct(tick.at, domain)}%` }} />
        ))}
        {markerLeft !== null && <span className="vh-marker" data-tone={tone} style={{ left: `${markerLeft}%` }} />}
        {ticks.map((tick) => (
          <span key={`label-${tick.at}`} className="vh-axis-label" style={{ left: `${vhPct(tick.at, domain)}%` }}>
            {tick.label}
          </span>
        ))}
      </span>

      <span className="vh-verdict" data-tone={tone}>
        {metric.verdict}
      </span>

      <span className="vh-sr-only">{metric.detail}</span>
    </li>
  );
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

function VariantHeader({ gene, variant, uniprotId, analysisResult }: VariantHeaderProps) {
  const gnomad = analysisResult?.gnomadConstraint;
  const predictorData = analysisResult?.predictorData;
  const conservation = analysisResult?.conservationData;

  // Gene / regional constraint signals (gnomAD v2)
  const hasRegionalData = gnomad?.hasRegionalData ?? false;
  const regional = gnomad?.regionalConstraint ?? null;
  const isPP2Constrained = gnomad?.isPP2Constrained ?? false;

  const metrics = useMemo<VhMetric[]>(
    () =>
      gnomad
        ? [
            buildMissenseZMetric(gnomad.missense_z, isPP2Constrained),
            buildLoeufMetric(gnomad.loeuf),
            buildRmcMetric(hasRegionalData, regional),
          ]
        : [],
    [gnomad, hasRegionalData, regional, isPP2Constrained]
  );

  // Transcript / lineage metadata
  const transcriptId = analysisResult?.transcriptId ?? predictorData?.transcriptId ?? null;
  const isManeSelect = analysisResult?.isManeSelect ?? predictorData?.isManeSelect ?? false;
  const isManePlusClinical = analysisResult?.isManePlusClinical ?? predictorData?.isManePlusClinical ?? false;
  const isCanonical = analysisResult?.isCanonical ?? predictorData?.isCanonical ?? false;
  const maneRefSeqId = analysisResult?.maneRefSeqId ?? predictorData?.maneRefSeqId ?? null;
  const displayTranscriptId = maneRefSeqId?.trim() || transcriptId || null;

  // Genomic coordinate identifier (display-ready VCF-like string).
  // The build is NOT ours to assume: the MyVariant.info fallback returns GRCh37
  // (vep-orchestrator), and the contract states that a coordinate with an unknown
  // or unsupported build must not be presented as though it were verified — a
  // wrong-build id pasted into another tool scores a different locus.
  const genomicId = predictorData?.gnomadVariantId ?? null;
  const genomicAssembly = predictorData?.gnomadVariantAssembly ?? null;
  const assemblyTag = genomicAssembly === "GRCh37" ? "hg19" : genomicAssembly === "GRCh38" ? "hg38" : null;
  const genomicTitle = `${genomicAssembly ?? "Build not reported"} genomic coordinates ${genomicId ?? ""}`.trim();

  // HGVS formatted variant notation
  const formattedVariant = useMemo(() => {
    if (!variant) return "";
    try {
      return parseVariantCoordinate(variant).hgvsp3;
    } catch {
      return variant;
    }
  }, [variant]);

  /**
   * Which numbering the header LEADS with.
   *
   * A clinician reads this to recognise their variant. When a coordinate resolved through the MANE
   * transcript and was converted for modelling, the lab's notation is the one they recognise, so it is
   * the headline and the canonical basis is stated beside it — instead of making them re-map
   * `p.Lys272Asn` back to the `p.Lys281Asn` their report names.
   */
  const numbering = useMemo(
    () =>
      variantNumberingView({
        variant,
        uniprotId,
        numberingRemap: (analysisResult as any)?.numberingRemap ?? null,
      }),
    [variant, uniprotId, analysisResult]
  );
  const headlineVariant = useMemo(() => {
    if (!numbering.remapped || !numbering.reported) return formattedVariant;
    try {
      return parseVariantCoordinate(numbering.reported).hgvsp3;
    } catch {
      return numbering.reported;
    }
  }, [numbering, formattedVariant]);

  // Transcript tier — colour and label only; the full wording moves to the tooltip.
  const transcriptTier = useMemo(() => {
    if (isManeSelect) return { tone: "good" as const, label: "MANE Select", suffix: "MANE Select — clinical gold standard" };
    if (isManePlusClinical) return { tone: "clay" as const, label: "MANE+Clin", suffix: "MANE Plus Clinical" };
    if (isCanonical) return { tone: "warn" as const, label: "Ensembl Canonical", suffix: "Ensembl canonical transcript" };
    return { tone: "muted" as const, label: null, suffix: "alternative / fallback transcript" };
  }, [isManeSelect, isManePlusClinical, isCanonical]);

  const transcriptTitle = displayTranscriptId
    ? `Transcript ${displayTranscriptId} — ${transcriptTier.suffix}`
    : undefined;

  const spliceProximity = conservation?.spliceProximity;
  const hasIdentifiers = Boolean(
    displayTranscriptId || genomicId || uniprotId || spliceProximity?.isNearSpliceSite
  );

  return (
    <div className="variant-header" role="banner" aria-label="Active variant">
      {/* ── Band 1 · the variant's identity ── */}
      <div className="variant-header-top">
        <div className="variant-header-identity">
          <span className="variant-header-gene">{gene}</span>
          {headlineVariant && (
            <span className="variant-header-hgvs">
              {headlineVariant}
              <CopyBtn text={headlineVariant} label="variant notation" />
            </span>
          )}
        </div>

        {/* Lineage identifiers sit directly under the gene — the header centres
            this whole block against the metric group, so nothing floats. */}
        {hasIdentifiers && (
          <div className="vh-identifiers" aria-label="Lineage and identifiers">
            {displayTranscriptId && (
              <span className="vh-chip" title={transcriptTitle}>
                <Dna className="vh-chip-icon" size={12} strokeWidth={1.75} aria-hidden="true" />
                <span className="vh-sr-only">Transcript </span>
                <span className="vh-chip-value">{displayTranscriptId}</span>
                {transcriptTier.label && (
                  <span className="vh-chip-tag" data-tone={transcriptTier.tone}>
                    {transcriptTier.label}
                  </span>
                )}
                <CopyBtn text={displayTranscriptId} label="transcript ID" />
              </span>
            )}

            {genomicId && (
              <span className="vh-chip" title={genomicTitle}>
                <MapPin className="vh-chip-icon" size={12} strokeWidth={1.75} aria-hidden="true" />
                <span className="vh-sr-only">{genomicAssembly ? `${genomicAssembly} coordinates ` : "Coordinates, build not reported, "}</span>
                <span className="vh-chip-value">{genomicId}</span>
                {assemblyTag && <span className="vh-chip-key">{assemblyTag}</span>}
                <CopyBtn text={genomicId} label="genomic coordinates" />
              </span>
            )}

            {uniprotId && (
              <span className="vh-chip" title={`UniProt protein accession ${uniprotId}`}>
                <FlaskConical className="vh-chip-icon" size={12} strokeWidth={1.75} aria-hidden="true" />
                <span className="vh-sr-only">UniProt accession </span>
                <span className="vh-chip-value">{uniprotId}</span>
                <a
                  href={`https://www.uniprot.org/uniprotkb/${encodeURIComponent(uniprotId)}/entry`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="vh-icon-btn"
                  title={`Open ${uniprotId} in UniProt`}
                  aria-label={`Open UniProt entry for ${uniprotId}`}
                >
                  <ExternalLink size={11} strokeWidth={2} />
                </a>
              </span>
            )}

            {spliceProximity?.isNearSpliceSite && (
              <span
                className="vh-chip vh-chip--alert"
                data-tone="path"
                title={`Splice alert — this variant sits ${spliceProximity.distance} bp from the nearest exon–intron boundary.`}
              >
                <Scissors className="vh-chip-icon" size={12} strokeWidth={1.75} aria-hidden="true" />
                <span className="vh-chip-value">{spliceProximity.distance} bp</span>
                <span className="vh-chip-tag" data-tone="path">
                  Splice site
                </span>
                <span className="vh-sr-only">
                  Splice alert: variant is {spliceProximity.distance} bp from the nearest exon–intron boundary.
                </span>
              </span>
            )}
          </div>
        )}

        {/* Modelled-basis phrase: its own line under the identifiers, in the
            header's soft verdict-fill grammar (clay = caution, not error) so the
            remap reads as a stated fact, not inline noise beside the HGVS.
            Inline style, like the rest of this header: the stylesheet it would
            live in is edited concurrently. */}
        {numbering.remapped && (
          <span
            className="variant-header-numbering-basis"
            data-testid="modelled-basis"
            title={numbering.basisNote ?? undefined}
            style={{
              fontFamily: "var(--cs-font-mono)",
              fontSize: "10px",
              fontWeight: 500,
              color: "var(--vh-clay-fg)",
              background: "var(--vh-clay-soft)",
              padding: "2px 6px",
              borderRadius: "4px",
              alignSelf: "flex-start",
            }}
          >
            modelled as {numbering.modelled}
            {uniprotId ? ` on canonical ${uniprotId}` : ""}
          </span>
        )}
      </div>

      {/* ── Band 2 · gnomAD v2 constraint list: one row per metric ──
          No caption: the list's aria-label and each row's tooltip already carry
          the gnomAD v2 / gene-constraint provenance, so a headline would only add
          a fourth line to a three-row group. */}
      {metrics.length > 0 && (
        <div className="vh-rail">
          {/* role="list" is explicit because `list-style: none` drops list semantics in
              WebKit, so VoiceOver would otherwise not announce "list, 3 items". */}
          <ul
            className="vh-metrics"
            role="list"
            aria-label="gnomAD v2 population constraint and normal ranges"
          >
            {metrics.map((metric) => (
              <ConstraintMetric key={metric.key} metric={metric} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default React.memo(VariantHeader);
