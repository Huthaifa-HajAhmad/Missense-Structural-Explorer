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
import {
  CALIBRATION_SOURCES,
  PP3_BP4_CALIBRATION,
  calibratedCall,
  formatEvidenceCode,
  type CalibratedToolKey,
} from "./calibration.ts";

const fmtCut = (n: number) => (Math.abs(n) >= 10 ? n.toFixed(1) : Number(n.toFixed(3)).toString());

/**
 * A row whose status, cut-point text and painted band all come from the published PP3/BP4
 * calibration — the same table the evaluators and the Predictors tab read. These rows used to carry
 * their own hand-written numbers (REVEL ≥ 0.75 "strong", AlphaMissense ≥ 0.983, CADD ≥ 25 "strong",
 * BayesDel ≤ −0.0404), which disagreed with the published bands and with each other.
 */
function calibratedRow(
  key: string,
  name: string,
  tool: CalibratedToolKey,
  value: number | null,
  display: string,
  window: { min: number; max: number },
  category: 1 | 3 = 1,
): GuidelinesRow {
  const bands = PP3_BP4_CALIBRATION[tool];
  const call = calibratedCall(tool, value);
  const high = bands.orientation === "higher";
  const pp3Sup = bands.pp3.Supporting;
  const bp4Sup = bands.bp4.Supporting;
  const pathOp = high ? "≥" : "≤";
  const benOp = high ? "≤" : "≥";
  const strongerPp3 = (["Moderate", "Strong", "VeryStrong"] as const)
    .filter(s => bands.pp3[s] !== undefined)
    .map(s => `${s === "VeryStrong" ? "very strong" : s.toLowerCase()} ${pathOp} ${fmtCut(bands.pp3[s] as number)}`);
  const status: GuidelinesStatus =
    call === null ? "none"
    : call.direction === "PP3" ? (call.strength === "Supporting" ? "path" : "path_strong")
    : call.direction === "BP4" ? "benign"
    : "vus";
  const segments: GuidelinesBand["segments"] = [];
  const clamp = (n: number) => Math.max(window.min, Math.min(window.max, n));
  if (high) {
    if (bp4Sup !== undefined) segments.push({ from: window.min, to: clamp(bp4Sup), tone: "benign" });
    segments.push({ from: clamp(bp4Sup ?? window.min), to: clamp(pp3Sup ?? window.max), tone: "gray" });
    if (pp3Sup !== undefined) segments.push({ from: clamp(pp3Sup), to: window.max, tone: "path" });
  } else {
    if (pp3Sup !== undefined) segments.push({ from: window.min, to: clamp(pp3Sup), tone: "path" });
    segments.push({ from: clamp(pp3Sup ?? window.min), to: clamp(bp4Sup ?? window.max), tone: "gray" });
    if (bp4Sup !== undefined) segments.push({ from: clamp(bp4Sup), to: window.max, tone: "benign" });
  }
  const ticks = [...Object.values(bands.pp3), ...Object.values(bands.bp4)]
    .filter((n): n is number => typeof n === "number" && n >= window.min && n <= window.max)
    .sort((a, b) => a - b);
  return {
    key, category, name, value, display,
    benignText: bp4Sup !== undefined ? `${benOp} ${fmtCut(bp4Sup)}` : "No BP4 band",
    pathText: pp3Sup !== undefined
      ? `${pathOp} ${fmtCut(pp3Sup)}${strongerPp3.length ? ` (${strongerPp3.join(", ")})` : ""}`
      : "No PP3 band",
    acmgCode: `PP3 / BP4 · ${CALIBRATION_SOURCES[bands.source].short}`,
    status,
    matchLabel: call === null ? "No data" : call.direction === null ? "Indeterminate" : formatEvidenceCode(call.code),
    band: { min: window.min, max: window.max, segments, ticks },
  };
}

/** A scored row with no published clinical cut-point: shown, never classified. */
function informationalRow(key: string, name: string, value: number | null, display: string, note: string): GuidelinesRow {
  return {
    key, category: 1, name, value, display,
    benignText: "No published cut-point", pathText: note, acmgCode: "Info / -",
    status: "none",
    matchLabel: value !== null ? "Informational" : "No data",
    band: null,
  };
}

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
  rows.push(calibratedRow("revel", "REVEL", "revel", revelVal, revelVal?.toFixed(3) ?? "—", { min: 0, max: 1 }));
  rows.push(calibratedRow("am", "AlphaMissense", "alphaMissense", amVal, amVal?.toFixed(3) ?? (amCls ?? "—"), { min: 0, max: 1 }));
  rows.push(calibratedRow("cadd", "CADD PHRED", "cadd", caddVal, caddVal?.toFixed(1) ?? "—", { min: 0, max: 40 }));
  rows.push(calibratedRow("bayesdel", "BayesDel (noAF)", "bayesdel", bayesdelVal, bayesdelVal?.toFixed(3) ?? "—", { min: -1, max: 1 }));

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

  rows.push(informationalRow("eigen", "Eigen PHRED", eigenVal, eigenVal?.toFixed(1) ?? "—", "Genome-wide functional score"));
  rows.push(informationalRow("dann", "DANN", dannVal, dannVal?.toFixed(3) ?? "—", "Genome-wide functional score"));

  // popEVE publishes deleterious cut-points only (Orenbuch 2025): ≤ −4.617 moderate, ≤ −5.056 high.
  const popeveStatus: GuidelinesStatus = popeveVal !== null
    ? (popeveVal <= THRESHOLDS.popEve.severePathogenic ? "path_strong" : popeveVal <= THRESHOLDS.popEve.pathogenic ? "path" : "vus")
    : "none";
  rows.push({
    key: "popeve", category: 1, name: "popEVE",
    value: popeveVal, display: popeveVal?.toFixed(3) ?? "—",
    benignText: "No benign cut-point published", pathText: "≤ −4.617 (highly ≤ −5.056)", acmgCode: "PP3 · Orenbuch 2025",
    status: popeveStatus,
    matchLabel: popeveStatus === "path_strong" ? "Highly deleterious" : popeveStatus === "path" ? "Deleterious" : popeveStatus === "vus" ? "Below cut-point" : "No data",
    band: { min: -8, max: 0, segments: [
      { from: -8, to: -4.617, tone: "path" }, { from: -4.617, to: 0, tone: "gray" }
    ], ticks: [-5.056, -4.617] }
  });

  rows.push(calibratedRow("esm", "ESM1b", "esm1b", esmVal, esmVal?.toFixed(2) ?? "—", { min: -25, max: 5 }));

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
  rows.push(calibratedRow("gerp", "GERP++ RS", "gerp", gerpVal, gerpVal?.toFixed(2) ?? "—", { min: -12.3, max: 6.2 }, 3));
  rows.push(calibratedRow("phylop", "phyloP", "phylop", phylopVal, phylopVal?.toFixed(2) ?? "—", { min: -20, max: 10 }, 3));

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
