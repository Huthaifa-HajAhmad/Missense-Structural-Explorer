import React, { useMemo, useCallback, useState } from "react";
import { AnalysisResult, AlphaGenomeAviData } from "../types";
import { parseVariantCoordinate } from "../shared/variantCoordinate";
import { evaluateAlphaGenomeAvi } from "../shared/thresholds";
import { ExternalLink, Copy, Check } from "lucide-react";

interface VariantHeaderProps {
  gene: string;
  variant: string;
  uniprotId: string;
  analysisResult: AnalysisResult | null;
}

// ─────────────────────────────────────────────
// Pure classifier helpers (used & retained)
// ─────────────────────────────────────────────

/** Maps Missense Z-score to a semantic badge modifier class */
function misZBadgeClass(z: number): string {
  if (z >= 3.09) return "vh-pill vh-pill--path";
  if (z >= 2.0)  return "vh-pill vh-pill--warn";
  return "vh-pill vh-pill--muted";
}

/** Maps LOEUF to a semantic badge modifier class */
function loeufBadgeClass(v: number): string {
  if (v < 0.35) return "vh-pill vh-pill--path";
  if (v < 1.0)  return "vh-pill vh-pill--warn";
  return "vh-pill vh-pill--ben";
}

// ─────────────────────────────────────────────
// Small utility sub-components
// ─────────────────────────────────────────────

/** Copy-to-clipboard icon button with transient checkmark feedback */
function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      // Clipboard access denied (non-HTTPS or permission blocked) — fail silently
    });
  }, [text]);

  return (
    <button
      type="button"
      className="vh-icon-btn"
      onClick={handleCopy}
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
    >
      {copied
        ? <Check size={11} strokeWidth={2.5} />
        : <Copy size={11} strokeWidth={2} />}
    </button>
  );
}

/** AlphaGenome AVI pill (functional impact, Phred-scaled) */
function AlphaGenomePill({ alphagenome }: { alphagenome: AlphaGenomeAviData }) {
  if (alphagenome?.aviPhred === null || alphagenome?.aviPhred === undefined) return null;
  const signal = evaluateAlphaGenomeAvi(alphagenome);
  const mod = signal === "pathogenic" ? "vh-pill--path" : signal === "benign" ? "vh-pill--ben" : "vh-pill--warn";
  const strengthLabel = (alphagenome.acmgStrength ?? "indeterminate").replace(/_/g, " ");
  const tooltip = `AlphaGenome AVI: ${alphagenome.aviPhred.toFixed(1)} Phred — ${strengthLabel}${alphagenome.topModality ? ` (${alphagenome.topModality})` : ""}`;

  return (
    <span className={`vh-pill ${mod}`} title={tooltip}>
      <span className="vh-pill-label">AVI</span>
      <span className="vh-pill-value">{alphagenome.aviPhred.toFixed(1)}</span>
      {strengthLabel && strengthLabel !== "indeterminate" && (
        <span className="vh-tag">{strengthLabel}</span>
      )}
    </span>
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
  const misZ           = gnomad?.missense_z ?? null;
  const loeuf          = gnomad?.loeuf ?? null;
  const hasRegionalData = gnomad?.hasRegionalData ?? false;
  const regional       = gnomad?.regionalConstraint ?? null;

  // Transcript / lineage metadata
  const transcriptId       = analysisResult?.transcriptId ?? predictorData?.transcriptId ?? null;
  const isManeSelect       = analysisResult?.isManeSelect ?? predictorData?.isManeSelect ?? false;
  const isManePlusClinical = analysisResult?.isManePlusClinical ?? predictorData?.isManePlusClinical ?? false;
  const isCanonical        = analysisResult?.isCanonical ?? predictorData?.isCanonical ?? false;
  const maneRefSeqId       = analysisResult?.maneRefSeqId ?? predictorData?.maneRefSeqId ?? null;
  const displayTranscriptId = maneRefSeqId ?? transcriptId;

  // Genomic coordinate identifier (display-ready VCF-like string)
  const genomicId = predictorData?.gnomadVariantId ?? null;

  // HGVS formatted variant notation
  const formattedVariant = useMemo(() => {
    if (!variant) return "";
    try { return parseVariantCoordinate(variant).hgvsp3; }
    catch { return variant; }
  }, [variant]);

  // Transcript tier badge modifier — explicit if/else for readability
  let transcriptMod: string;
  if (isManeSelect)           transcriptMod = "vh-pill--ben";
  else if (isManePlusClinical) transcriptMod = "vh-pill--mag";
  else if (isCanonical)        transcriptMod = "vh-pill--warn";
  else                         transcriptMod = "vh-pill--muted";

  // Transcript tier sub-tag label
  let transcriptTierLabel: string | null;
  if (isManeSelect)            transcriptTierLabel = "MANE Select";
  else if (isManePlusClinical) transcriptTierLabel = "MANE+Clin";
  else if (isCanonical)        transcriptTierLabel = "Ensembl Canonical";
  else                         transcriptTierLabel = null;

  // Transcript pill tooltip
  let transcriptSuffix: string;
  if (isManeSelect)            transcriptSuffix = " (MANE Select — clinical gold standard)";
  else if (isManePlusClinical) transcriptSuffix = " (MANE Plus Clinical)";
  else if (isCanonical)        transcriptSuffix = " (Ensembl Canonical)";
  else                         transcriptSuffix = " (Alternative / Fallback)";
  const transcriptTitle = `Transcript: ${displayTranscriptId}${transcriptSuffix}`;

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
            Transcript · Genomic Coordinates · UniProt
            ────────────────────────────────────── */}
        {(displayTranscriptId || genomicId || uniprotId) && (
          <div className="variant-header-group" aria-label="Lineage and identifiers">
            {/* Transcript */}
            {displayTranscriptId && (
              <span className={`vh-pill ${transcriptMod}`} title={transcriptTitle}>
                <span className="vh-pill-label">Transcript</span>
                <span className="vh-pill-value">{displayTranscriptId}</span>
                {transcriptTierLabel && <span className="vh-tag">{transcriptTierLabel}</span>}
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
                  href={`https://www.uniprot.org/uniprotkb/${uniprotId}/entry`}
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
          </div>
        )}

        {/* ──────────────────────────────────────
            Cluster B: Gene & Regional Constraint (gnomAD v2)
            Mis Z · LOEUF · RMC
            ────────────────────────────────────── */}
        {gnomad != null && (
          <div className="variant-header-group" aria-label="Gene and regional constraint">

            {/* Missense Z */}
            {misZ !== null && (
              <span
                className={misZBadgeClass(misZ)}
                title={`gnomAD v2 Missense Z-score: ${misZ > 0 ? "+" : ""}${misZ.toFixed(2)}. Values ≥ 3.09 indicate strong regional missense intolerance.`}
              >
                <span className="vh-pill-label">Mis Z</span>
                <span className="vh-pill-value">{misZ > 0 ? `+${misZ.toFixed(2)}` : misZ.toFixed(2)}</span>
                <span className="vh-tag">gnomAD v2</span>
              </span>
            )}

            {/* LOEUF */}
            {loeuf !== null && (
              <span
                className={loeufBadgeClass(loeuf)}
                title={`gnomAD v2 LOEUF (Loss-of-function Observed/Expected Upper bound Fraction): ${loeuf.toFixed(2)}. Values < 0.35 indicate strong haploinsufficiency intolerance.`}
              >
                <span className="vh-pill-label">LOEUF</span>
                <span className="vh-pill-value">{loeuf.toFixed(2)}</span>
                <span className="vh-tag">gnomAD v2</span>
              </span>
            )}

            {/* Regional Missense Constraint */}
            {hasRegionalData ? (
              regional && (
                <span
                  className={regional.isConstrained ? "vh-pill vh-pill--path" : "vh-pill vh-pill--ben"}
                  title={`gnomAD v2 Regional Missense Constraint (RMC): ${
                    regional.isConstrained
                      ? `Subgenic Constrained (O/E = ${regional.oeRatio ?? "N/A"}${regional.pValue != null ? `, p = ${regional.pValue}` : ""}${regional.regionText ? `, Residues: ${regional.regionText}` : ""})`
                      : "This residue is not within a subgenic constrained region."
                  }`}
                >
                  <span className="vh-pill-label">RMC</span>
                  <span className="vh-pill-value">
                    {regional.isConstrained
                      ? (regional.oeRatio !== null ? `O/E ${regional.oeRatio.toFixed(2)}` : "Constrained")
                      : "Unconstrained"}
                  </span>
                  <span className="vh-tag">gnomAD v2</span>
                </span>
              )
            ) : (
              <span
                className="vh-pill vh-pill--muted"
                title="No Regional Missense Constraint (RMC) data available for this gene in gnomAD v2 (did not pass QC or gene has no constraint blocks)."
              >
                <span className="vh-pill-label">RMC</span>
                <span className="vh-pill-value">No Data</span>
                <span className="vh-tag">gnomAD v2</span>
              </span>
            )}
          </div>
        )}

        {/* ──────────────────────────────────────
            Cluster C: Functional Signals & Splicing
            AlphaGenome AVI · Splice Junction Proximity
            ────────────────────────────────────── */}
        {(conservation?.alphagenome || conservation?.spliceProximity?.isNearSpliceSite) && (
          <div className="variant-header-group" aria-label="Functional and splicing signals">

            {/* AlphaGenome AVI */}
            {conservation?.alphagenome && (
              <AlphaGenomePill alphagenome={conservation.alphagenome} />
            )}

            {/* Splice Junction Proximity */}
            {conservation?.spliceProximity?.isNearSpliceSite && (
              <span
                className="vh-pill vh-pill--path vh-pill--pulse"
                title={`Splice Junction Proximity: Variant is ${conservation.spliceProximity.distance} bp from the nearest exon-intron boundary.`}
              >
                <span className="vh-pill-label">Splice Junction</span>
                <span className="vh-pill-value">{conservation.spliceProximity.distance} bp</span>
                <span className="vh-tag">adjacent</span>
              </span>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

export default React.memo(VariantHeader);
