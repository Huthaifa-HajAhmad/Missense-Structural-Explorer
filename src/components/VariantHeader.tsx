import React, { useMemo } from "react";
import { AnalysisResult } from "../types";
import { parseVariantCoordinate } from "../shared/variantCoordinate";

interface VariantHeaderProps {
  gene: string;
  variant: string;
  uniprotId: string;
  analysisResult: AnalysisResult | null;
}

/** Maps a ClinVar classification string to a semantic CSS badge class */
function clinvarBadgeClass(classification: string): string {
  const c = classification.toLowerCase();
  if (c.includes("pathogenic") && !c.includes("benign")) return "cs-badge cs-badge-path";
  if (c.includes("benign")) return "cs-badge cs-badge-ben";
  if (c.includes("uncertain") || c.includes("vus") || c.includes("conflicting"))
    return "cs-badge cs-badge-vus";
  return "cs-badge cs-badge-muted";
}

/** Short display label for ClinVar classification */
function clinvarShortLabel(classification: string): string {
  const c = classification.toLowerCase();
  if (c === "pathogenic") return "Pathogenic";
  if (c === "likely pathogenic") return "Likely Path.";
  if (c === "pathogenic/likely pathogenic") return "Path./Likely Path.";
  if (c === "benign") return "Benign";
  if (c === "likely benign") return "Likely Benign";
  if (c === "benign/likely benign") return "Benign/Likely Benign";
  if (c.includes("uncertain") || c.includes("vus")) return "VUS";
  if (c.includes("conflicting")) return "Conflicting";
  return classification;
}

/** Format missense Z score for badge label */
function misZBadgeClass(z: number): string {
  if (z >= 3.09) return "cs-badge cs-badge-path";
  if (z >= 2.0) return "cs-badge cs-badge-vus";
  return "cs-badge cs-badge-muted";
}

/** Format AlphaMissense / REVEL score badge class */
function amBadgeClass(score: number | null, amClass: string | null): string {
  if (score === null) return "cs-badge cs-badge-muted";
  const cls = (amClass ?? "").toLowerCase();
  if (cls.includes("pathogenic")) return "cs-badge cs-badge-path";
  if (cls.includes("benign")) return "cs-badge cs-badge-ben";
  return "cs-badge cs-badge-vus";
}

function VariantHeader({
  gene,
  variant,
  uniprotId,
  analysisResult,
}: VariantHeaderProps) {
  const gnomad        = analysisResult?.gnomadConstraint;
  const predictorData = analysisResult?.predictorData;
  const conservation  = analysisResult?.conservationData;

  const misZ          = gnomad?.missense_z ?? null;
  const loeuf         = gnomad?.loeuf ?? null;
  const hasRegionalData = gnomad?.hasRegionalData ?? false;
  const regional      = gnomad?.regionalConstraint ?? null;
  const amScore       = predictorData?.amPathogenicity ?? null;
  const amClass       = predictorData?.amClass ?? null;
  const revelScore    = conservation?.revel ?? null;

  // Retrieve transcript metadata from top level or predictorData
  const transcriptId  = analysisResult?.transcriptId ?? predictorData?.transcriptId ?? null;
  const isManeSelect  = analysisResult?.isManeSelect ?? predictorData?.isManeSelect ?? false;
  const isManePlusClinical = analysisResult?.isManePlusClinical ?? predictorData?.isManePlusClinical ?? false;
  const isCanonical   = analysisResult?.isCanonical ?? predictorData?.isCanonical ?? false;
  const maneRefSeqId  = analysisResult?.maneRefSeqId ?? predictorData?.maneRefSeqId ?? null;
  const displayTranscriptId = maneRefSeqId ?? transcriptId;

  const formattedVariant = useMemo(() => {
    if (!variant) return "";
    try {
      return parseVariantCoordinate(variant).hgvsp3;
    } catch {
      return variant;
    }
  }, [variant]);

  return (
    <div className="variant-header" role="banner" aria-label="Active variant">
      {/* Tier 1 — Gene symbol (serif Display tier) */}
      <div className="variant-header-gene">{gene}</div>

      {/* Tier 2 — HGVS variant notation (monospace, secondary color) */}
      {formattedVariant && (
        <div className="variant-header-hgvs">{formattedVariant}</div>
      )}

      {/* Tier 3 — Verdict badges */}
      <div className="variant-header-badges">
        {/* Transcript Badge */}
        {displayTranscriptId && (
          <span
            className={
              isManeSelect
                ? "cs-badge cs-badge-ben"
                : isManePlusClinical
                ? "cs-badge cs-badge-mag"
                : isCanonical
                ? "cs-badge cs-badge-vus"
                : "cs-badge cs-badge-muted"
            }
            title={`Transcript: ${displayTranscriptId}${
              isManeSelect
                ? " (MANE Select / clinical gold standard)"
                : isManePlusClinical
                ? " (MANE Plus Clinical)"
                : isCanonical
                ? " (Ensembl Canonical)"
                : " (Alternative / Fallback)"
            }`}
          >
            <span style={{ opacity: 0.65, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Transcript
            </span>{" "}
            {displayTranscriptId}
          </span>
        )}

        {/* Splice Junction Badge */}
        {conservation?.spliceProximity?.isNearSpliceSite && (
          <span
            className="cs-badge cs-badge-path font-bold animate-pulse"
            title={`Splice Junction Proximity: Variant is located ${conservation.spliceProximity.distance} bp from the nearest exon-intron boundary.`}
          >
            <span style={{ opacity: 0.65, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Splice Junction
            </span>{" "}
            {conservation.spliceProximity.distance} bp adjacent
          </span>
        )}

        {/* MIS Z — gene-level constraint badge (gnomAD v2) */}
        {misZ !== null && (
          <span
            className={misZBadgeClass(misZ)}
            title={`gnomAD v2 Gene Missense Z-score: ${misZ > 0 ? "+" : ""}${misZ}`}
          >
            <span style={{ opacity: 0.65, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Mis Z (gnomAD v2)
            </span>{" "}
            {misZ > 0 ? `+${misZ.toFixed(2)}` : misZ.toFixed(2)}
          </span>
        )}

        {/* LOEUF — gene loss-of-function intolerance badge (gnomAD v2) */}
        {loeuf !== null && (
          <span
            className={
              loeuf < 0.35
                ? "cs-badge cs-badge-path" // Pathogenic red
                : loeuf < 1.0
                ? "cs-badge cs-badge-vus" // VUS yellow
                : "cs-badge cs-badge-ben" // Benign green
            }
            title={`gnomAD v2 Loss-of-function Observed/Expected Upper bound Fraction (LOEUF): ${loeuf.toFixed(2)}. Lower values (typically < 0.35) indicate strong intolerance to loss-of-function variants.`}
          >
            <span style={{ opacity: 0.65, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              LOEUF (gnomAD v2)
            </span>{" "}
            {loeuf.toFixed(2)}
          </span>
        )}

        {/* RMC — subgenic regional missense constraint badge (gnomAD v2) */}
        {hasRegionalData ? (
          regional && (
            <span
              className={regional.isConstrained ? "cs-badge cs-badge-path" : "cs-badge cs-badge-ben"}
              title={`gnomAD v2 Regional Missense Constraint (RMC): ${
                regional.isConstrained 
                  ? `Subgenic Constrained (O/E = ${regional.oeRatio ?? "N/A"}${regional.pValue != null ? `, p = ${regional.pValue}` : ""}${regional.regionText ? `, Residues: ${regional.regionText}` : ""})` 
                  : "This residue position is not within a subgenic constrained region."
              }`}
            >
              <span style={{ opacity: 0.65, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                RMC (gnomAD v2)
              </span>{" "}
              {regional.isConstrained 
                ? (regional.oeRatio !== null ? `O/E ${regional.oeRatio.toFixed(2)}` : "Constrained")
                : "Unconstrained"}
            </span>
          )
        ) : (
          <span
            className="cs-badge cs-badge-muted"
            title="No Regional Missense Constraint (RMC) data is available for this gene in gnomAD v2 (either did not pass QC or gene has no regional constraint blocks)."
          >
            <span style={{ opacity: 0.65, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              RMC (gnomAD v2)
            </span>{" "}
            No RMC Data
          </span>
        )}

        {/* AlphaMissense score */}
        {amScore !== null && (
          <span
            className={amBadgeClass(amScore, amClass)}
            title={`AlphaMissense: ${amScore.toFixed(3)}${amClass ? ` (${amClass})` : ""}`}
          >
            <span style={{ opacity: 0.65, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              AM
            </span>{" "}
            {amScore.toFixed(3)}
          </span>
        )}

        {/* REVEL score */}
        {revelScore !== null && (
          <span
            className={
              revelScore >= 0.75
                ? "cs-badge cs-badge-path"
                : revelScore < 0.15
                ? "cs-badge cs-badge-ben"
                : "cs-badge cs-badge-vus"
            }
            title={`REVEL: ${revelScore.toFixed(3)}`}
          >
            <span style={{ opacity: 0.65, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              REVEL
            </span>{" "}
            {revelScore.toFixed(3)}
          </span>
        )}

        {/* AlphaGenome AVI score */}
        {conservation?.alphagenome?.aviPhred !== null && conservation?.alphagenome?.aviPhred !== undefined && (
          <span
            className={
              conservation.alphagenome.aviPhred >= 25.0
                ? "cs-badge cs-badge-path"
                : conservation.alphagenome.aviPhred <= 8.0
                ? "cs-badge cs-badge-ben"
                : "cs-badge cs-badge-vus"
            }
            title={`AlphaGenome AVI: ${conservation.alphagenome.aviPhred.toFixed(1)} Phred (${(conservation.alphagenome.acmgStrength ?? "indeterminate").replace(/_/g, " ")}${conservation.alphagenome.topModality ? `, Top modality: ${conservation.alphagenome.topModality}` : ""})`}
          >
            <span style={{ opacity: 0.65, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              AVI
            </span>{" "}
            {conservation.alphagenome.aviPhred.toFixed(1)}
          </span>
        )}

        {/* Genomic Coordinates — neutral identifier, no clinical valence */}
        {predictorData?.gnomadVariantId && (
          <span className="cs-badge cs-badge-muted" title={`Genomic: ${predictorData.gnomadVariantId}`}>
            <span style={{ opacity: 0.65, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Genomic
            </span>{" "}
            {predictorData.gnomadVariantId}
          </span>
        )}

        {/* UniProt ID — neutral identifier, no clinical valence */}
        {uniprotId && (
          <span className="cs-badge cs-badge-muted" title={`UniProt: ${uniprotId}`}>
            <span style={{ opacity: 0.65, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              UniProt
            </span>{" "}
            {uniprotId}
          </span>
        )}
      </div>
    </div>
  );
}

export default React.memo(VariantHeader);
