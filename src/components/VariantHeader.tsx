import React from "react";
import { AnalysisResult } from "../types";

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

export default function VariantHeader({
  gene,
  variant,
  uniprotId,
  analysisResult,
}: VariantHeaderProps) {
  const clinvar       = analysisResult?.clinvar;
  const gnomad        = analysisResult?.gnomadConstraint;
  const predictorData = analysisResult?.predictorData;
  const conservation  = analysisResult?.conservationData;

  const clinvarClass  = clinvar?.classification
    ? clinvarBadgeClass(clinvar.classification)
    : null;

  const misZ          = gnomad?.missense_z ?? null;
  const amScore       = predictorData?.amPathogenicity ?? null;
  const amClass       = predictorData?.amClass ?? null;
  const revelScore    = conservation?.revel ?? null;

  return (
    <div className="variant-header" role="banner" aria-label="Active variant">
      {/* Tier 1 — Gene symbol (serif Display tier) */}
      <div className="variant-header-gene">{gene}</div>

      {/* Tier 2 — HGVS variant notation (monospace, secondary color) */}
      {variant && (
        <div className="variant-header-hgvs">{variant}</div>
      )}

      {/* Tier 3 — Verdict badges */}
      <div className="variant-header-badges">
        {/* ClinVar — clinical badge */}
        {clinvar?.classification && clinvarClass && (
          <span className={clinvarClass} title={`ClinVar: ${clinvar.classification}`}>
            <span style={{ opacity: 0.65, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              ClinVar
            </span>{" "}
            {clinvarShortLabel(clinvar.classification)}
          </span>
        )}

        {/* MIS Z — constraint badge */}
        {misZ !== null && (
          <span
            className={misZBadgeClass(misZ)}
            title={`Missense Z-score: ${misZ > 0 ? "+" : ""}${misZ}`}
          >
            <span style={{ opacity: 0.65, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Mis Z
            </span>{" "}
            {misZ > 0 ? `+${misZ.toFixed(2)}` : misZ.toFixed(2)}
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
