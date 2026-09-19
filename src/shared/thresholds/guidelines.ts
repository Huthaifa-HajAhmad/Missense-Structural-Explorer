/**
 * guidelines.ts — Threshold Guide row model.
 *
 * The Threshold Guide tab (23 metrics × ACMG cut-points) and the Evidence
 * inspector's calibration pane must never disagree: both render from this one
 * builder. Previously the status logic lived in an IIFE inside
 * `GuidelinesTab.tsx`, so the inspector could not summarise the table without
 * duplicating — and drifting from — its cut-point logic.
 *
 * Each row also carries an optional display `band`: the score axis window, the
 * benign/grey/pathogenic zones painted on it, and the named cut-point ticks.
 * The table draws these as micro tracks under the score; the inspector uses
 * the same data for its live match roll-up.
 */
import type { AnalysisResult, EnergeticsData } from "../contracts.ts";
import { THRESHOLDS } from "./constants.ts";

export type GuidelinesStatus = "path_strong" | "path" | "benign" | "neutral" | "vus" | "none";

export type GuidelinesGroup = "path" | "benign" | "vus" | "info" | "nodata";

export interface GuidelinesBand {
  /** Display window of the score axis. */
  min: number;
  max: number;
  /** Zones painted left-to-right on the track. */
  segments: { from: number; to: number; tone: "benign" | "gray" | "path" }[];
  /** Named cut-points drawn as ticks on the track. */
  ticks: number[];
}

export interface GuidelinesRow {
  key: string;
  category: 1 | 2 | 3;
  name: string;
  value: number | null;
  display: string;
  benignText: string;
  pathText: string;
  acmgCode: string;
  status: GuidelinesStatus;
  matchLabel: string;
  band: GuidelinesBand | null;
}

export interface GuidelinesSummary {
  total: number;
  pathSupporting: GuidelinesRow[];
  benignSupporting: GuidelinesRow[];
  vus: GuidelinesRow[];
  informational: GuidelinesRow[];
  noData: GuidelinesRow[];
}

export interface GuidelinesInput {
  result: AnalysisResult;
  foldingDdG: number | null;
  foldingEnergetics?: EnergeticsData | null;
}

/** Roll a row status up into its summary group. */
export function guidelinesGroup(row: GuidelinesRow): GuidelinesGroup {
  if (row.value === null || row.value === undefined) return "nodata";
  if (row.status === "path_strong" || row.status === "path") return "path";
  if (row.status === "benign" || row.status === "neutral") return "benign";
  if (row.status === "vus") return "vus";
  return "info"; // scored but informational-only (no calibrated cut-point)
}

export function summarizeGuidelinesRows(rows: GuidelinesRow[]): GuidelinesSummary {
  const summary: GuidelinesSummary = {
    total: rows.length,
    pathSupporting: [],
    benignSupporting: [],
    vus: [],
    informational: [],
    noData: []
  };
  for (const row of rows) {
    switch (guidelinesGroup(row)) {
      case "path": summary.pathSupporting.push(row); break;
      case "benign": summary.benignSupporting.push(row); break;
      case "vus": summary.vus.push(row); break;
      case "info": summary.informational.push(row); break;
      default: summary.noData.push(row);
    }
  }
  return summary;
}

export function buildGuidelinesRows({ result, foldingDdG, foldingEnergetics }: GuidelinesInput): GuidelinesRow[] {
  const caddVal = result.predictorData?.caddPhred ?? null;
  const revelVal = result.conservationData?.revel ?? null;
  const amVal = result.predictorData?.amPathogenicity ?? null;
  const amCls = result.predictorData?.amClass ?? null;
  const bayesdelVal = result.conservationData?.bayesdel ?? null;
  const metarnnVal = result.conservationData?.metarnn ?? null;
  const clinpredVal = result.conservationData?.clinpred ?? null;
  const eigenVal = result.conservationData?.eigenPhred ?? null;
  const dannVal = result.conservationData?.dann ?? null;
  const popeveVal = result.conservationData?.popeve ?? null;
  const esmVal = result.conservationData?.esm1b ?? null;
  const vesmVal = result.esmcEval?.llr ?? null;

  const foldxVal = foldingDdG ?? null;
  const dynamut2Val = result.dynamut2 ?? foldingEnergetics?.dynamut2 ?? null;
  const ddmutVal = result.ddmut ?? foldingEnergetics?.ddmut ?? null;
  const raspVal = result.rasp ?? foldingEnergetics?.rasp ?? null;
  const thermompnnVal = foldingEnergetics?.thermompnn ?? result.thermompnn ?? null;

  const gerpVal = result.conservationData?.gerp ?? null;
  const phylopVal = result.conservationData?.phylop ?? null;
  const misZVal = (result as any)?.misZ ?? (result as any)?.gnomadMisZ ?? null;
  const loeufVal = (result as any)?.loeuf ?? (result as any)?.gnomadLoeuf ?? null;

  const kcal = (v: number | null) => (v !== null && v !== undefined ? `${v.toFixed(2)} kcal/mol` : "—");

  const rows: GuidelinesRow[] = [];

  // ── Category 1: In-silico pathogenicity & machine learning ──
  const revelStatus = revelVal !== null ? (revelVal >= 0.75 ? "path_strong" : revelVal >= 0.5 ? "path" : revelVal < 0.15 ? "benign" : "vus") : "none";
  rows.push({
    key: "revel", category: 1, name: "REVEL",
    value: revelVal, display: revelVal?.toFixed(3) ?? "—",
    benignText: "< 0.15", pathText: ">= 0.50 (strong >= 0.75)", acmgCode: "PP3 / BP4",
    status: revelStatus,
    matchLabel: revelStatus === "path_strong" ? "Strong Path." : revelStatus === "path" ? "Path. Supp." : revelStatus === "benign" ? "Benign" : "VUS",
    band: { min: 0, max: 1, segments: [
      { from: 0, to: 0.15, tone: "benign" }, { from: 0.15, to: 0.5, tone: "gray" }, { from: 0.5, to: 1, tone: "path" }
    ], ticks: [0.15, 0.5, 0.75] }
  });

  const amStatus = (amCls?.toLowerCase().includes("pathogenic") || (amVal !== null && amVal >= 0.983)) ? "path_strong" : (amCls?.toLowerCase().includes("benign") || (amVal !== null && amVal <= 0.063)) ? "benign" : "vus";
  rows.push({
    key: "am", category: 1, name: "AlphaMissense",
    value: amVal, display: amVal?.toFixed(3) ?? "—",
    benignText: "<= 0.063", pathText: ">= 0.983 (supp >= 0.564)", acmgCode: "PP3 / BP4",
    status: amVal !== null || amCls !== null ? amStatus : "none",
    matchLabel: amStatus === "path_strong" ? "Pathogenic" : amStatus === "benign" ? "Benign" : "VUS",
    band: { min: 0, max: 1, segments: [
      { from: 0, to: 0.063, tone: "benign" }, { from: 0.063, to: 0.983, tone: "gray" }, { from: 0.983, to: 1, tone: "path" }
    ], ticks: [0.063, 0.564, 0.983] }
  });

  const caddStatus = caddVal !== null ? (caddVal >= 25 ? "path_strong" : caddVal >= 20 ? "path" : caddVal <= 10 ? "benign" : "vus") : "none";
  rows.push({
    key: "cadd", category: 1, name: "CADD PHRED",
    value: caddVal, display: caddVal?.toFixed(1) ?? "—",
    benignText: "<= 10.0", pathText: ">= 20.0 (strong >= 25)", acmgCode: "PP3 / BP4",
    status: caddStatus,
    matchLabel: caddStatus === "path_strong" ? "Strong Path." : caddStatus === "path" ? "Path. Supp." : caddStatus === "benign" ? "Benign" : "Moderate",
    band: { min: 0, max: 30, segments: [
      { from: 0, to: 10, tone: "benign" }, { from: 10, to: 20, tone: "gray" }, { from: 20, to: 30, tone: "path" }
    ], ticks: [10, 20, 25] }
  });

  const bayesdelStatus = bayesdelVal !== null ? (bayesdelVal >= 0.133 ? "path" : bayesdelVal <= -0.0404 ? "benign" : "vus") : "none";
  rows.push({
    key: "bayesdel", category: 1, name: "BayesDel (noAF)",
    value: bayesdelVal, display: bayesdelVal?.toFixed(3) ?? "—",
    benignText: "<= -0.0404", pathText: ">= 0.133", acmgCode: "PP3 / BP4",
    status: bayesdelStatus,
    matchLabel: bayesdelStatus === "path" ? "Pathogenic" : bayesdelStatus === "benign" ? "Benign" : "VUS",
    band: { min: -1, max: 1, segments: [
      { from: -1, to: -0.0404, tone: "benign" }, { from: -0.0404, to: 0.133, tone: "gray" }, { from: 0.133, to: 1, tone: "path" }
    ], ticks: [-0.0404, 0.133] }
  });

  const metarnnStatus = metarnnVal !== null ? (metarnnVal >= 0.5 ? "path" : "benign") : "none";
  rows.push({
    key: "metarnn", category: 1, name: "MetaRNN",
    value: metarnnVal, display: metarnnVal?.toFixed(3) ?? "—",
    benignText: "< 0.50", pathText: ">= 0.50", acmgCode: "PP3 / BP4",
    status: metarnnStatus,
    matchLabel: metarnnStatus === "path" ? "Deleterious" : "Tolerated",
    band: { min: 0, max: 1, segments: [
      { from: 0, to: 0.5, tone: "benign" }, { from: 0.5, to: 1, tone: "path" }
    ], ticks: [0.5] }
  });

  const clinpredStatus = clinpredVal !== null ? (clinpredVal >= 0.5 ? "path" : "benign") : "none";
  rows.push({
    key: "clinpred", category: 1, name: "ClinPred",
    value: clinpredVal, display: clinpredVal?.toFixed(3) ?? "—",
    benignText: "< 0.50", pathText: ">= 0.50", acmgCode: "PP3 / BP4",
    status: clinpredStatus,
    matchLabel: clinpredStatus === "path" ? "Deleterious" : "Tolerated",
    band: { min: 0, max: 1, segments: [
      { from: 0, to: 0.5, tone: "benign" }, { from: 0.5, to: 1, tone: "path" }
    ], ticks: [0.5] }
  });

  const eigenStatus = eigenVal !== null ? (eigenVal >= 4.0 ? "path" : "benign") : "none";
  rows.push({
    key: "eigen", category: 1, name: "Eigen PHRED",
    value: eigenVal, display: eigenVal?.toFixed(1) ?? "—",
    benignText: "< 4.0", pathText: ">= 4.0", acmgCode: "PP3 / BP4",
    status: eigenStatus,
    matchLabel: eigenStatus === "path" ? "Pathogenic" : "Benign",
    band: { min: 0, max: 20, segments: [
      { from: 0, to: 4, tone: "benign" }, { from: 4, to: 20, tone: "path" }
    ], ticks: [4] }
  });

  const dannStatus = dannVal !== null ? (dannVal >= 0.96 ? "path" : dannVal <= 0.5 ? "benign" : "vus") : "none";
  rows.push({
    key: "dann", category: 1, name: "DANN",
    value: dannVal, display: dannVal?.toFixed(3) ?? "—",
    benignText: "<= 0.50", pathText: ">= 0.96", acmgCode: "PP3 / BP4",
    status: dannStatus,
    matchLabel: dannStatus === "path" ? "Pathogenic" : dannStatus === "benign" ? "Benign" : "Moderate",
    band: { min: 0, max: 1, segments: [
      { from: 0, to: 0.5, tone: "benign" }, { from: 0.5, to: 0.96, tone: "gray" }, { from: 0.96, to: 1, tone: "path" }
    ], ticks: [0.5, 0.96] }
  });

  const popeveStatus = popeveVal !== null ? (popeveVal < 0 ? (popeveVal <= -4.617 ? "path_strong" : popeveVal <= -2.0 ? "path" : popeveVal >= -1.0 ? "benign" : "vus") : (popeveVal >= 0.75 ? "path_strong" : popeveVal <= 0.25 ? "benign" : "vus")) : "none";
  rows.push({
    key: "popeve", category: 1, name: "popEVE",
    value: popeveVal, display: popeveVal?.toFixed(3) ?? "—",
    benignText: "<= 0.25 (LLR >= -1.0)", pathText: ">= 0.75 (LLR <= -4.617 severe)", acmgCode: "PP3 / BP4",
    status: popeveStatus,
    matchLabel: popeveStatus === "path_strong" ? "Severe Path." : popeveStatus === "path" ? "Pathogenic" : popeveStatus === "benign" ? "Benign" : "VUS",
    // Two-sided calibration: strongly negative LLR and high positive scores are both pathogenic.
    band: { min: -6, max: 1, segments: [
      { from: -6, to: -2, tone: "path" }, { from: -2, to: -1, tone: "gray" }, { from: -1, to: 0.25, tone: "benign" }, { from: 0.25, to: 0.75, tone: "gray" }, { from: 0.75, to: 1, tone: "path" }
    ], ticks: [-4.617, -2, -1, 0.25, 0.75] }
  });

  const esmStatus = esmVal !== null ? (esmVal <= THRESHOLDS.esm1b.pathogenic ? "path" : esmVal >= THRESHOLDS.esm1b.benign ? "benign" : "vus") : "none";
  rows.push({
    key: "esm", category: 1, name: "ESM-1b",
    value: esmVal, display: esmVal?.toFixed(2) ?? "—",
    benignText: ">= -5.0", pathText: "<= -7.5", acmgCode: "Info / -",
    status: esmStatus,
    matchLabel: esmStatus === "path" ? "Deleterious" : esmStatus === "benign" ? "Tolerated" : "Neutral",
    band: { min: -14, max: 0, segments: [
      { from: -14, to: -7.5, tone: "path" }, { from: -7.5, to: -5, tone: "gray" }, { from: -5, to: 0, tone: "benign" }
    ], ticks: [-7.5, -5] }
  });

  /**
   * This value comes from `esmcEval`, so it is ESMC-6B's masked-marginal ΔLLR —
   * not "VESM-150M", and with no published pathogenic/benign cut-point on its own
   * scale. It was previously tested against ESM-1b's -5.0/-2.0 pair and badged
   * Deleterious/Tolerated. The score is still shown, but classified as
   * informational rather than against another model's threshold.
   */
  const esmcLlr = vesmVal;
  rows.push({
    key: "esmc", category: 1, name: "ESMC-6B",
    value: esmcLlr, display: esmcLlr?.toFixed(2) ?? "—",
    benignText: "No calibrated cut-point", pathText: "Model-native scale", acmgCode: "Info / -",
    status: "none",
    matchLabel: esmcLlr !== null ? "Informational" : "No data",
    band: null
  });

  // ── Category 2: Biophysical & structural energetics ──
  const foldxStatus = foldxVal !== null ? (foldxVal > 1.5 ? "path_strong" : foldxVal > 0.5 ? "path" : foldxVal >= -0.5 ? "benign" : "neutral") : "none";
  rows.push({
    key: "foldx", category: 2, name: "FoldX ΔΔG",
    value: foldxVal, display: kcal(foldxVal),
    benignText: "-0.5 to +0.5", pathText: "> 0.50 (severe > 1.50)", acmgCode: "PM1 / BP3",
    status: foldxStatus,
    matchLabel: foldxStatus === "path_strong" ? "Severe Destab." : foldxStatus === "path" ? "Destab." : foldxStatus === "benign" ? "Neutral" : "Stabilizing",
    band: { min: -3, max: 3, segments: [
      { from: -3, to: 0.5, tone: "benign" }, { from: 0.5, to: 3, tone: "path" }
    ], ticks: [-0.5, 0.5, 1.5] }
  });

  const dynamut2Status = dynamut2Val !== null ? (dynamut2Val <= -1.0 ? "path" : "benign") : "none";
  rows.push({
    key: "dynamut2", category: 2, name: "DynaMut2 ΔΔG",
    value: dynamut2Val, display: kcal(dynamut2Val),
    benignText: "> -1.0", pathText: "<= -1.0 kcal/mol", acmgCode: "PM1 / BP3",
    status: dynamut2Status,
    matchLabel: dynamut2Status === "path" ? "Destabilizing" : "Neutral",
    band: { min: -3, max: 1, segments: [
      { from: -3, to: -1, tone: "path" }, { from: -1, to: 1, tone: "benign" }
    ], ticks: [-1] }
  });

  const ddmutStatus = ddmutVal !== null ? (ddmutVal <= -1.0 ? "path" : "benign") : "none";
  rows.push({
    key: "ddmut", category: 2, name: "DDMut ΔΔG",
    value: ddmutVal, display: kcal(ddmutVal),
    benignText: "> -1.0", pathText: "<= -1.0 kcal/mol", acmgCode: "PM1 / BP3",
    status: ddmutStatus,
    matchLabel: ddmutStatus === "path" ? "Destabilizing" : "Neutral",
    band: { min: -3, max: 1, segments: [
      { from: -3, to: -1, tone: "path" }, { from: -1, to: 1, tone: "benign" }
    ], ticks: [-1] }
  });

  const raspStatus = raspVal !== null ? (raspVal > 0.5 ? "path" : "benign") : "none";
  rows.push({
    key: "rasp", category: 2, name: "RaSP ΔΔG",
    value: raspVal, display: kcal(raspVal),
    benignText: "-0.5 to +0.5", pathText: "> 0.50 kcal/mol", acmgCode: "PM1 / BP3",
    status: raspStatus,
    matchLabel: raspStatus === "path" ? "Destabilizing" : "Neutral",
    band: { min: -3, max: 3, segments: [
      { from: -3, to: 0.5, tone: "benign" }, { from: 0.5, to: 3, tone: "path" }
    ], ticks: [0.5] }
  });

  const thermompnnStatus = thermompnnVal !== null ? (thermompnnVal >= 1.0 ? "path" : "benign") : "none";
  rows.push({
    key: "thermompnn", category: 2, name: "ThermoMPNN ΔΔG°",
    value: thermompnnVal, display: kcal(thermompnnVal),
    benignText: "< 1.00", pathText: ">= +1.00 kcal/mol", acmgCode: "PM1 / BP3",
    status: thermompnnStatus,
    matchLabel: thermompnnStatus === "path" ? "Destabilizing" : "Neutral",
    band: { min: -2, max: 3, segments: [
      { from: -2, to: 1, tone: "benign" }, { from: 1, to: 3, tone: "path" }
    ], ticks: [1] }
  });

  // ── Category 3: Evolutionary conservation & population intolerance ──
  const gerpStatus = gerpVal !== null ? (gerpVal >= 2.0 ? "path" : "benign") : "none";
  rows.push({
    key: "gerp", category: 3, name: "GERP++ RS",
    value: gerpVal, display: gerpVal?.toFixed(2) ?? "—",
    benignText: "< 2.00", pathText: ">= 2.00 (conserved)", acmgCode: "PP3 / BP4",
    status: gerpStatus,
    matchLabel: gerpStatus === "path" ? "Conserved" : "Neutral",
    band: { min: -4, max: 7, segments: [
      { from: -4, to: 2, tone: "benign" }, { from: 2, to: 7, tone: "path" }
    ], ticks: [2] }
  });

  const phylopStatus = phylopVal !== null ? (phylopVal >= 1.5 ? "path" : "benign") : "none";
  rows.push({
    key: "phylop", category: 3, name: "phyloP 100-way",
    value: phylopVal, display: phylopVal?.toFixed(2) ?? "—",
    benignText: "< 1.50", pathText: ">= 1.50 (conserved)", acmgCode: "PP3 / BP4",
    status: phylopStatus,
    matchLabel: phylopStatus === "path" ? "Conserved" : "Variable",
    band: { min: -2, max: 10, segments: [
      { from: -2, to: 1.5, tone: "benign" }, { from: 1.5, to: 10, tone: "path" }
    ], ticks: [1.5] }
  });

  const misZStatus = misZVal !== null ? (misZVal >= 3.09 ? "path_strong" : misZVal >= 2.0 ? "path" : "benign") : "none";
  rows.push({
    key: "misZ", category: 3, name: "gnomAD Missense Z",
    value: misZVal, display: misZVal?.toFixed(2) ?? "—",
    benignText: "< 2.00", pathText: ">= 2.00 (strong >= 3.09)", acmgCode: "PP2 / BP1",
    status: misZStatus,
    matchLabel: misZStatus === "path_strong" ? "Depleted (Strong)" : misZStatus === "path" ? "Constrained" : "Unconstrained",
    band: { min: -2, max: 6, segments: [
      { from: -2, to: 2, tone: "benign" }, { from: 2, to: 6, tone: "path" }
    ], ticks: [2, 3.09] }
  });

  const loeufStatus = loeufVal !== null ? (loeufVal < 0.35 ? "path_strong" : loeufVal < 0.60 ? "path" : "benign") : "none";
  rows.push({
    key: "loeuf", category: 3, name: "gnomAD LOEUF",
    value: loeufVal, display: loeufVal?.toFixed(2) ?? "—",
    benignText: ">= 0.60", pathText: "< 0.35 (mod < 0.60)", acmgCode: "PP2 / BP1",
    status: loeufStatus,
    matchLabel: loeufStatus === "path_strong" ? "Severe Intolerant" : loeufStatus === "path" ? "Mod. Intolerant" : "Tolerated",
    band: { min: 0, max: 2, segments: [
      { from: 0, to: 0.35, tone: "path" }, { from: 0.35, to: 0.6, tone: "gray" }, { from: 0.6, to: 2, tone: "benign" }
    ], ticks: [0.35, 0.6] }
  });

  return rows;
}

/** Horizontal position, in percent of the band, for a value on its track. */
export function guidelinesBandPct(value: number, band: GuidelinesBand): number {
  const span = band.max - band.min;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((value - band.min) / span) * 100));
}
