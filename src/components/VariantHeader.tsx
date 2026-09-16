import React, { useMemo, useCallback, useState } from "react";
import { AnalysisResult } from "../types";
import { parseVariantCoordinate } from "../shared/variantCoordinate";
import { ExternalLink, Copy, Check } from "lucide-react";

interface VariantHeaderProps {
  gene: string;
  variant: string;
  uniprotId: string;
  analysisResult: AnalysisResult | null;
}

// ─────────────────────────────────────────────
// Pure classifier helpers
// ─────────────────────────────────────────────

/** Semantic badge class for Missense Z-score */
function getMisZMeta(z: number | null) {
  if (z === null || !Number.isFinite(z)) {
    return {
      display: "No Data",
      badgeClass: "vh-pill--muted",
      statusText: "Unmeasured",
      statusClass: "vh-status--muted",
    };
  }
  const display = z > 0 ? `+${z.toFixed(2)}` : z.toFixed(2);
  if (z >= 3.09) {
    return {
      display,
      badgeClass: "vh-pill--path",
      statusText: "Severe Intolerance",
      statusClass: "vh-status--path",
    };
  }
  if (z >= 2.0) {
    return {
      display,
      badgeClass: "vh-pill--warn",
      statusText: "Constrained",
      statusClass: "vh-status--warn",
    };
  }
  return {
    display,
    badgeClass: "vh-pill--ben",
    statusText: "Tolerant",
    statusClass: "vh-status--ben",
  };
}

/** Semantic badge class for LOEUF */
function getLoeufMeta(v: number | null) {
  if (v === null || !Number.isFinite(v)) {
    return {
      display: "No Data",
      badgeClass: "vh-pill--muted",
      statusText: "Unmeasured",
      statusClass: "vh-status--muted",
    };
  }
  const display = v.toFixed(2);
  if (v < 0.35) {
    return {
      display,
      badgeClass: "vh-pill--path",
      statusText: "Strong LoF Intolerance",
      statusClass: "vh-status--path",
    };
  }
  if (v < 1.0) {
    return {
      display,
      badgeClass: "vh-pill--warn",
      statusText: "Moderate Constraint",
      statusClass: "vh-status--warn",
    };
  }
  return {
    display,
    badgeClass: "vh-pill--ben",
    statusText: "LoF Tolerant",
    statusClass: "vh-status--ben",
  };
}

/** Semantic badge class for Regional Missense Constraint (RMC) */
function getRmcMeta(
  hasRegionalData: boolean,
  regional: { isConstrained: boolean; oeRatio: number | null; pValue: number | null; regionText: string | null } | null
) {
  if (!hasRegionalData && !regional) {
    return {
      display: "No Data",
      badgeClass: "vh-pill--muted",
      statusText: "No gnomAD Blocks",
      statusClass: "vh-status--muted",
      refDetail: "Gene lacks RMC blocks",
    };
  }
  if (regional && regional.isConstrained) {
    const oeStr = regional.oeRatio !== null ? `O/E ${regional.oeRatio.toFixed(2)}` : "Constrained";
    const pStr = regional.pValue !== null ? ` (p < ${regional.pValue})` : "";
    return {
      display: oeStr,
      badgeClass: "vh-pill--path",
      statusText: "Subgenic Constrained",
      statusClass: "vh-status--path",
      refDetail: regional.regionText ? `Residues ${regional.regionText}${pStr}` : `Constrained region${pStr}`,
    };
  }
  return {
    display: "Unconstrained",
    badgeClass: "vh-pill--ben",
    statusText: "Expected Variation",
    statusClass: "vh-status--ben",
    refDetail: "Residue outside constrained sub-regions",
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

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

function VariantHeader({ gene, variant, uniprotId, analysisResult }: VariantHeaderProps) {
  const gnomad        = analysisResult?.gnomadConstraint;
  const predictorData = analysisResult?.predictorData;
  const conservation  = analysisResult?.conservationData;

  // Gene constraint signals (gnomAD v2)
  const misZ            = gnomad?.missense_z ?? null;
  const loeuf           = gnomad?.loeuf ?? null;
  const hasRegionalData = gnomad?.hasRegionalData ?? false;
  const regional        = gnomad?.regionalConstraint ?? null;

  // Derived metadata for list-style constraint cards
  const misZMeta  = useMemo(() => getMisZMeta(misZ), [misZ]);
  const loeufMeta = useMemo(() => getLoeufMeta(loeuf), [loeuf]);
  const rmcMeta   = useMemo(() => getRmcMeta(hasRegionalData, regional), [hasRegionalData, regional]);

  // Transcript / lineage metadata
  const transcriptId       = analysisResult?.transcriptId ?? predictorData?.transcriptId ?? null;
  const isManeSelect       = analysisResult?.isManeSelect ?? predictorData?.isManeSelect ?? false;
  const isManePlusClinical = analysisResult?.isManePlusClinical ?? predictorData?.isManePlusClinical ?? false;
  const isCanonical        = analysisResult?.isCanonical ?? predictorData?.isCanonical ?? false;
  const maneRefSeqId       = analysisResult?.maneRefSeqId ?? predictorData?.maneRefSeqId ?? null;
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

  // Consolidate transcript tier styling and metadata
  const transcriptTier = useMemo(() => {
    if (isManeSelect)
      return { mod: "vh-pill--ben", label: "MANE Select", suffix: " (MANE Select — clinical gold standard)" };
    if (isManePlusClinical)
      return { mod: "vh-pill--mag", label: "MANE+Clin", suffix: " (MANE Plus Clinical)" };
    if (isCanonical)
      return { mod: "vh-pill--warn", label: "Ensembl Canonical", suffix: " (Ensembl Canonical)" };
    return { mod: "vh-pill--muted", label: null, suffix: " (Alternative / Fallback)" };
  }, [isManeSelect, isManePlusClinical, isCanonical]);

  const transcriptTitle = `Transcript: ${displayTranscriptId}${transcriptTier.suffix}`;

  return (
    <div className="variant-header" role="banner" aria-label="Active variant">
      {/* ── Tier 1 · Gene + HGVS notation ── */}
      <div className="variant-header-top">
        <div className="variant-header-gene">{gene}</div>
        {formattedVariant && (
          <div className="variant-header-hgvs">
            {formattedVariant}
            <CopyBtn text={formattedVariant} label="variant notation" />
          </div>
        )}
      </div>

      {/* ── Tier 2 · Semantic badge clusters ── */}
      <div className="variant-header-clusters">
        {/* ──────────────────────────────────────
            Cluster A: Lineage & Identifiers
            Transcript · Genomic Coordinates · UniProt · Splice Alert
            ────────────────────────────────────── */}
        {(displayTranscriptId || genomicId || uniprotId || conservation?.spliceProximity?.isNearSpliceSite) && (
          <div className="variant-header-group" aria-label="Lineage and identifiers">
            {/* Transcript */}
            {displayTranscriptId && (
              <span className={`vh-pill ${transcriptTier.mod}`} title={transcriptTitle}>
                <span className="vh-pill-label">Transcript</span>
                <span className="vh-pill-value">{displayTranscriptId}</span>
                {transcriptTier.label && <span className="vh-tag">{transcriptTier.label}</span>}
                <CopyBtn text={displayTranscriptId} label="transcript ID" />
              </span>
            )}

            {/* Genomic Coordinates */}
            {genomicId && (
              <span
                className="vh-pill vh-pill--muted"
                title={`GRCh38 genomic coordinates: ${genomicId}`}
              >
                <span className="vh-pill-label">GRCh38</span>
                <span className="vh-pill-value">{genomicId}</span>
                <CopyBtn text={genomicId} label="genomic coordinates" />
              </span>
            )}

            {/* UniProt */}
            {uniprotId && (
              <span
                className="vh-pill vh-pill--muted"
                title={`UniProt protein accession: ${uniprotId}`}
              >
                <span className="vh-pill-label">UniProt</span>
                <span className="vh-pill-value">{uniprotId}</span>
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

            {/* Splice Junction Proximity Alert (when ≤ 10 bp) */}
            {conservation?.spliceProximity?.isNearSpliceSite && (
              <span
                className="vh-pill vh-pill--path vh-pill--pulse"
                title={`Splice Junction Proximity: Variant is located ${conservation.spliceProximity.distance} bp from the nearest exon-intron boundary.`}
              >
                <span className="vh-pill-label">Splice Alert</span>
                <span className="vh-pill-value">{conservation.spliceProximity.distance} bp adjacent</span>
                <span className="vh-tag">Splice Site</span>
              </span>
            )}
          </div>
        )}

        {/* ──────────────────────────────────────
            Cluster B: Gene & Regional Constraint (gnomAD v2)
            List style showing clearly written metric titles, current scores, and normal ranges
            ────────────────────────────────────── */}
        {gnomad != null && (
          <div className="vh-constraint-cluster" aria-label="gnomAD v2 Gene and Regional Constraint">
            <div className="vh-constraint-header">
              <span className="vh-constraint-badge">gnomAD v2</span>
              <span className="vh-constraint-title">Population Constraint & Normal Ranges</span>
            </div>

            <div className="vh-constraint-list" role="list">
              {/* Metric 1: Missense Z score */}
              <div
                className="vh-constraint-card"
                role="listitem"
                title={`gnomAD v2 Missense Z Score: ${misZMeta.display}. Values ≥ 3.09 indicate severe regional intolerance (ClinGen PP2). Normal expected population range is < 2.0.`}
              >
                <div className="vh-constraint-card-top">
                  <span className="vh-constraint-name">Missense Z score</span>
                  <span className={`vh-score-badge ${misZMeta.badgeClass}`}>{misZMeta.display}</span>
                  <span className={`vh-status-tag ${misZMeta.statusClass}`}>{misZMeta.statusText}</span>
                </div>
                <div className="vh-constraint-card-bot">
                  <span className="vh-ref-item">
                    <span className="vh-ref-kw">Normal:</span> &lt; 2.0
                  </span>
                  <span className="vh-ref-sep">·</span>
                  <span className="vh-ref-item">
                    <span className="vh-ref-kw">Severe:</span> ≥ 3.09 (PP2)
                  </span>
                </div>
              </div>

              {/* Metric 2: Loss-of-function (LOEUF) */}
              <div
                className="vh-constraint-card"
                role="listitem"
                title={`gnomAD v2 Loss-of-function (LOEUF): ${loeufMeta.display}. Lower values (< 0.35, decile 1) indicate strong haploinsufficiency intolerance. Normal range is ≥ 1.0.`}
              >
                <div className="vh-constraint-card-top">
                  <span className="vh-constraint-name">Loss-of-function (LOEUF)</span>
                  <span className={`vh-score-badge ${loeufMeta.badgeClass}`}>{loeufMeta.display}</span>
                  <span className={`vh-status-tag ${loeufMeta.statusClass}`}>{loeufMeta.statusText}</span>
                </div>
                <div className="vh-constraint-card-bot">
                  <span className="vh-ref-item">
                    <span className="vh-ref-kw">Normal:</span> ≥ 1.0
                  </span>
                  <span className="vh-ref-sep">·</span>
                  <span className="vh-ref-item">
                    <span className="vh-ref-kw">Intolerant:</span> &lt; 0.35
                  </span>
                </div>
              </div>

              {/* Metric 3: Regional Missense Constraint (RMC) */}
              <div
                className="vh-constraint-card"
                role="listitem"
                title={`gnomAD v2 Regional Missense Constraint (RMC): ${rmcMeta.display}. ${rmcMeta.refDetail}. Normal baseline is Unconstrained (O/E ~ 1.0).`}
              >
                <div className="vh-constraint-card-top">
                  <span className="vh-constraint-name">Regional Missense Constraint (RMC)</span>
                  <span className={`vh-score-badge ${rmcMeta.badgeClass}`}>{rmcMeta.display}</span>
                  <span className={`vh-status-tag ${rmcMeta.statusClass}`}>{rmcMeta.statusText}</span>
                </div>
                <div className="vh-constraint-card-bot">
                  <span className="vh-ref-item">
                    <span className="vh-ref-kw">Normal:</span> Unconstrained (O/E ~ 1.0)
                  </span>
                  <span className="vh-ref-sep">·</span>
                  <span className="vh-ref-item">{rmcMeta.refDetail}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(VariantHeader);
