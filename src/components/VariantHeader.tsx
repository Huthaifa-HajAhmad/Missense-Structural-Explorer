import React, { useMemo, useCallback, useState } from "react";
import { AnalysisResult } from "../types";
import { parseVariantCoordinate } from "../shared/variantCoordinate";
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
  /** Variant-specific footnote (RMC region + p-value). */
  note: string | null;
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
 */
function formatPValue(p: number | null): string | null {
  if (p === null || !Number.isFinite(p) || p <= 0) return null;
  if (p >= 0.001) return p.toFixed(3);
  const exponent = Math.floor(Math.log10(p));
  const mantissa = p / 10 ** exponent;
  const digits = String(Math.abs(exponent))
    .split("")
    .map((d) => SUPERSCRIPT[Number(d)])
    .join("");
  return `${mantissa.toFixed(1)}×10⁻${digits}`;
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

function buildMissenseZMetric(missenseZ: number | null | undefined): VhMetric {
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
    note: null,
  };
  const refRange = "Reference: tolerant below 2.0, constrained from 2.0, severe intolerance at or above 3.09 (ClinGen PP2).";

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
      detail: `gnomAD v2 Missense Z score. Not measured for this gene. ${refRange}`,
    };
  }

  const value = signed(z);
  const tier =
    z >= 3.09
      ? { tone: "path" as VhTone, verdict: "Severe intolerance", why: "severe missense intolerance (ClinGen PP2)" }
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
    tooltip: `gnomAD v2 Missense Z score ${value} — ${tier.why}. ${refRange}`,
    detail: `gnomAD v2 Missense Z score ${value}: ${tier.why}. ${refRange}`,
  };
}

function buildLoeufMetric(loeuf: number | null | undefined): VhMetric {
  const domains = {
    domain: LOEUF_DOMAIN,
    bands: [
      { from: 0, to: 0.35, tone: "path" as VhTone },
      { from: 0.35, to: 1.0, tone: "warn" as VhTone },
      { from: 1.0, to: 1.5, tone: "good" as VhTone },
    ],
    ticks: [
      { at: 0.35, label: "0.35" },
      { at: 1.0, label: "1.0" },
    ],
    note: null,
  };
  const refRange =
    "Reference: strong loss-of-function intolerance below 0.35, moderate constraint below 1.0, tolerant at or above 1.0.";

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
      detail: `gnomAD v2 loss-of-function (LOEUF). Not measured for this gene. ${refRange}`,
    };
  }

  const value = v.toFixed(2);
  const tier =
    v < 0.35
      ? { tone: "path" as VhTone, verdict: "Strong LoF intolerance", why: "below the decile-1 intolerance threshold" }
      : v < 1.0
        ? { tone: "warn" as VhTone, verdict: "Moderate constraint", why: "below the tolerant reference range" }
        : { tone: "good" as VhTone, verdict: "LoF tolerant", why: "within the tolerant reference range" };

  return {
    key: "loeuf",
    label: "LOEUF",
    value,
    tone: tier.tone,
    verdict: tier.verdict,
    marker: v,
    ...domains,
    tooltip: `gnomAD v2 loss-of-function observed/expected upper bound fraction (LOEUF) ${value} — ${tier.why}. ${refRange}`,
    detail: `gnomAD v2 loss-of-function (LOEUF) ${value}: ${tier.why}. ${refRange}`,
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
    return {
      key: "regional-oe",
      label: "Regional O/E",
      value: VH_NO_VALUE,
      tone: "muted",
      verdict: hasRegionalData ? "No data" : "No gnomAD blocks",
      marker: null,
      ...domains,
      note: null,
      tooltip: "gnomAD v2 Regional Missense Constraint (RMC) — this gene has no gnomAD constraint blocks.",
      detail: `gnomAD v2 Regional Missense Constraint (RMC). The gene has no gnomAD constraint blocks, so no sub-regional call was made. ${refRange}`,
    };
  }

  const oe = typeof regional.oeRatio === "number" && Number.isFinite(regional.oeRatio) ? regional.oeRatio : null;
  const value = oe === null ? VH_NO_VALUE : oe.toFixed(2);
  const pText = formatPValue(regional.pValue);
  const region = compactRegion(regional.regionText);

  const noteParts: string[] = [];
  if (regional.isConstrained && region) noteParts.push(region);
  if (regional.isConstrained && pText) noteParts.push(`p = ${pText}`);
  const note = noteParts.length > 0 ? noteParts.join(" · ") : null;

  const regionDetail = region ? `Constrained block ${region.replace("–", " to ")}` : "Constrained sub-region";

  if (regional.isConstrained) {
    return {
      key: "regional-oe",
      label: "Regional O/E",
      value,
      tone: "path",
      verdict: "Subgenic constrained",
      marker: oe,
      ...domains,
      note,
      tooltip: `gnomAD v2 Regional Missense Constraint (RMC): ${regionDetail}${
        pText ? `, p = ${pText}` : ""
      }. Observed/expected ratio ${value} against a neutral baseline of 1.0.`,
      detail: `gnomAD v2 Regional Missense Constraint (RMC) ${value}: ${regionDetail}${
        pText ? `, p-value ${pText}` : ""
      }. ${refRange}`,
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
    note: null,
    tooltip: `gnomAD v2 Regional Missense Constraint (RMC): the residue sits outside every constrained sub-region (observed/expected ${value}).`,
    detail: `gnomAD v2 Regional Missense Constraint (RMC) ${value}: residue outside every constrained sub-region, so variation is expected. ${refRange}`,
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

/** One metric: label + value, reference track, threshold axis, verdict. */
function ConstraintMetric({ metric }: { metric: VhMetric }) {
  const { domain, bands, ticks, marker, tone } = metric;
  const markerLeft = marker === null ? null : vhMarkerPct(marker, domain);

  return (
    <li className="vh-metric" title={metric.tooltip}>
      <div className="vh-metric-head">
        <span className="vh-metric-label">{metric.label}</span>
        <span className="vh-metric-value" data-tone={tone}>
          {metric.value}
        </span>
      </div>

      <div className="vh-scale" data-empty={marker === null ? "true" : undefined} aria-hidden="true">
        <span className="vh-scale-track">
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
      </div>

      <div className="vh-axis" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick.at} className="vh-axis-label" style={{ left: `${vhPct(tick.at, domain)}%` }}>
            {tick.label}
          </span>
        ))}
      </div>

      <div className="vh-foot">
        <span className="vh-verdict" data-tone={tone}>
          {metric.verdict}
        </span>
        {metric.note && <span className="vh-note">{metric.note}</span>}
      </div>

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

  const metrics = useMemo<VhMetric[]>(
    () =>
      gnomad
        ? [
            buildMissenseZMetric(gnomad.missense_z),
            buildLoeufMetric(gnomad.loeuf),
            buildRmcMetric(hasRegionalData, regional),
          ]
        : [],
    [gnomad, hasRegionalData, regional]
  );

  // Transcript / lineage metadata
  const transcriptId = analysisResult?.transcriptId ?? predictorData?.transcriptId ?? null;
  const isManeSelect = analysisResult?.isManeSelect ?? predictorData?.isManeSelect ?? false;
  const isManePlusClinical = analysisResult?.isManePlusClinical ?? predictorData?.isManePlusClinical ?? false;
  const isCanonical = analysisResult?.isCanonical ?? predictorData?.isCanonical ?? false;
  const maneRefSeqId = analysisResult?.maneRefSeqId ?? predictorData?.maneRefSeqId ?? null;
  const displayTranscriptId = maneRefSeqId?.trim() || transcriptId || null;

  // Genomic coordinate identifier (display-ready VCF-like string)
  const genomicId = predictorData?.gnomadVariantId ?? null;

  // HGVS formatted variant notation
  const formattedVariant = useMemo(() => {
    if (!variant) return "";
    try {
      return parseVariantCoordinate(variant).hgvsp3;
    } catch {
      return variant;
    }
  }, [variant]);

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
      {/* ── Band 1 · identity (left) + lineage identifiers (right, filling the header's dead space) ── */}
      <div className="variant-header-top">
        <div className="variant-header-identity">
          <span className="variant-header-gene">{gene}</span>
          {formattedVariant && (
            <span className="variant-header-hgvs">
              {formattedVariant}
              <CopyBtn text={formattedVariant} label="variant notation" />
            </span>
          )}
        </div>

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
              <span className="vh-chip" title={`GRCh38 genomic coordinates ${genomicId}`}>
                <MapPin className="vh-chip-icon" size={12} strokeWidth={1.75} aria-hidden="true" />
                <span className="vh-sr-only">GRCh38 coordinates </span>
                <span className="vh-chip-value">{genomicId}</span>
                <span className="vh-chip-key">hg38</span>
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
      </div>

      {/* ── Band 2 · gnomAD v2 constraint rail: source label + three threshold tracks ── */}
      {metrics.length > 0 && (
        <ul className="vh-rail" aria-label="gnomAD v2 population constraint and normal ranges">
          <li className="vh-rail-meta">
            <span className="vh-rail-src">gnomAD v2</span>
            <span className="vh-rail-scope">Gene constraint</span>
          </li>
          {metrics.map((metric) => (
            <ConstraintMetric key={metric.key} metric={metric} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default React.memo(VariantHeader);
