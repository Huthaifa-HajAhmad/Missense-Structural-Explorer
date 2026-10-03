/**
 * predictorEvidence.ts — one model of the in-silico evidence, for the Predictors tab and its rail.
 *
 * ONE QUESTION: what do the computational predictors say, and what did the ACMG engine make of it?
 *
 * The tab and the Evidence Lineage rail both render from `buildPredictorEvidence`, so they cannot
 * report different calls, counts or criteria for one variant — the failure the previous revision
 * had three times over:
 *
 *   • the consensus card computed a verdict with a MAJORITY rule while the engine applied PP3 on a
 *     PLURALITY, so the tab could print "Conflicting evidence" beside an applied PP3;
 *   • each specialist card re-derived its own badge from local literals (the AlphaMissense card read
 *     0.983 while the vote read the class label; the popEVE bar passed its two cut-points swapped and
 *     painted a "Deleterious" score green);
 *   • the engine raised PP3 to Moderate/Strong from AlphaGenome alone, which no surface reported.
 *
 * INVARIANTS
 *   • Every call comes from `evaluators.ts` / `calibration.ts`; nothing here re-tests a score.
 *   • The vote comes from `insilicoVoteOutcome`, the function the engine itself calls.
 *   • What the engine recorded is READ from its criteria list, never inferred from the vote.
 *   • A cut-point is drawn only with its provenance: ClinGen-calibrated, the authors' own, local, or
 *     none. An uncalibrated cut-point is never presented as a calibrated one.
 */
import type { AnalysisResult } from "./contracts.ts";
import {
  CALIBRATION_SOURCES,
  PP3_BP4_CALIBRATION,
  THRESHOLDS,
  calibratedCall,
  calibrationBands,
  countPredictorConcordance,
  formatEvidenceCode,
  insilicoVoteOutcome,
  type CalibratedCall,
  type CalibratedToolKey,
  type CalibrationBand,
  type InsilicoVoteOutcome,
  type PredictorSignal,
} from "./thresholds.ts";
import { resolveSourceAvailability, type EvidenceAvailability } from "./evidenceAvailability.ts";
import { ENGINE_STATE_LABELS } from "./engineStatus.ts";

/** The canonical absence word — the engine-status vocabulary, not a local synonym. */
const NO_RESULT = ENGINE_STATE_LABELS["no-result"];

export type PredictorGroup = "vote" | "protein-lm" | "genome" | "conservation";

export const PREDICTOR_GROUP_LABEL: Record<PredictorGroup, string> = {
  vote: "Voting tools",
  "protein-lm": "Protein language models",
  genome: "Genome-wide models",
  conservation: "Conservation",
};

export const PREDICTOR_GROUP_NOTE: Record<PredictorGroup, string> = {
  vote: "Counted by the PP3/BP4 rule",
  "protein-lm": "Informational · not counted",
  genome: "Informational · not counted",
  conservation: "Constraint, not pathogenicity · not counted",
};

export type Caveat =
  | "uses-af"
  | "clinvar-trained"
  | "includes-alphamissense"
  | "rank-not-probability"
  | "no-benign-cut"
  | "fallback-model";

export const CAVEAT_TEXT: Record<Caveat, { label: string; detail: string }> = {
  "uses-af": {
    label: "Uses gnomAD AF",
    detail:
      "Allele frequency is one of its input features. Combined with PM2/BS1, population frequency is counted twice (Pejaver 2022 permits free combination only for tools without an AF feature).",
  },
  "clinvar-trained": {
    label: "ClinVar-trained",
    detail: "Trained on ClinVar labels, so its call on a variant already in ClinVar is partly circular.",
  },
  "includes-alphamissense": {
    label: "Contains AlphaMissense",
    detail: "AlphaMissense is one of the AVI's input features, and it already appears in this panel on its own.",
  },
  "rank-not-probability": {
    label: "Rank, not probability",
    detail: "The AVI Phred is −10·log10 of the variant's tail quantile among all possible hg38 SNVs — a rank. No ClinGen calibration of it exists.",
  },
  "no-benign-cut": {
    label: "No benign cut-point",
    detail: "The authors publish deleterious cut-points only, so a score above them is not a benign call.",
  },
  "fallback-model": {
    label: "Fallback model",
    detail: "The preferred engine did not answer; this score was served by a fallback model.",
  },
};

/** How a drawn cut-point is sourced. The UI states this beside every ruler. */
export type CutpointKind = "calibrated" | "authors" | "local" | "none";

export interface CutMark {
  value: number;
  side: "path" | "benign";
  label: string;
}

export interface PredictorReading {
  key: string;
  name: string;
  /** One line: what the model is. */
  description: string;
  group: PredictorGroup;
  /** Counted by the PP3/BP4 rule. */
  votes: boolean;
  score: number | null;
  scoreText: string;
  unit: string | null;
  scale: { min: number; max: number };
  orientation: "higher" | "lower";
  cutpoints: {
    kind: CutpointKind;
    /** e.g. "Pejaver et al. 2022", "Orenbuch et al. 2025 (authors)". */
    source: string | null;
    bands: CalibrationBand[];
    marks: CutMark[];
  };
  /** The vote signal (for voters) or the calibrated call (for calibrated informational tools). */
  signal: PredictorSignal;
  calibrated: CalibratedCall | null;
  /** The chip text: "PP3_Moderate", "BP4", "Indeterminate", "Pathogenic", "Informational"… */
  callLabel: string;
  callTone: "danger" | "good" | "neutral" | "muted";
  caveats: Caveat[];
  /** A secondary fact worth a line: the authors' class, the served model, a fallback reason. */
  note: string | null;
  availability: {
    state: "available" | "pending" | "absent";
    label: string | null;
    reason: string | null;
    action: "configure-alphagenome" | "configure-gpn" | "retry" | null;
  };
  source: string;
  knowledgeKey: string | null;
  link: { tab: string; label: string } | null;
}

export interface EngineRecord {
  /** The payload carries the engine's criteria list at all. */
  known: boolean;
  /** "PP3", "BP4", "PP3_Moderate"… as the engine recorded it, or `null`. */
  code: string | null;
  reason: string | null;
  weighting: string | null;
  /** The vote supports a code the engine did not record, under a weighting that withholds it. */
  withheldByWeighting: boolean;
}

export interface CalibratedReference {
  key: "revel" | "bayesdel";
  name: string;
  score: number;
  call: CalibratedCall;
  bands: CalibrationBand[];
  source: string;
  /** How the calibrated reading relates to the vote's direction. */
  relation: "agrees" | "opposes" | "indeterminate" | "no-vote";
}

export interface PredictorEvidence {
  readings: PredictorReading[];
  vote: InsilicoVoteOutcome;
  voters: { pathogenic: PredictorReading[]; benign: PredictorReading[]; indeterminate: PredictorReading[]; missing: PredictorReading[] };
  engine: EngineRecord;
  reference: CalibratedReference | null;
  /** Readings still being computed. */
  pending: boolean;
  /** Concordance's own list of skipped sources (with build-gate reasons). */
  unavailable: string[];
}

export interface PredictorEvidenceInput {
  result: AnalysisResult;
  /** The analysis itself is still in flight: any missing score may yet arrive. */
  isLoading?: boolean;
  /** Only the model-served scores (language models, structure-conditioned) are still in flight. */
  isModelLoading?: boolean;
  /** Whether the browser holds an AlphaGenome key. `undefined` = cannot know. */
  alphagenomeConfigured?: boolean;
}

// ── formatting ────────────────────────────────────────────────────────────────────────────────

function fmt(value: number | null, decimals: number): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value.toFixed(decimals);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const SIGNAL_LABEL: Record<PredictorSignal, string> = {
  pathogenic: "Pathogenic",
  benign: "Benign",
  vus: "Indeterminate",
  unavailable: NO_RESULT,
};

const SIGNAL_TONE: Record<PredictorSignal, PredictorReading["callTone"]> = {
  pathogenic: "danger",
  benign: "good",
  vus: "neutral",
  unavailable: "muted",
};

function callFromCalibrated(call: CalibratedCall | null): { label: string; tone: PredictorReading["callTone"] } {
  if (call === null) return { label: NO_RESULT, tone: "muted" };
  if (call.direction === "PP3") return { label: call.code, tone: "danger" };
  if (call.direction === "BP4") return { label: call.code, tone: "good" };
  return { label: "Indeterminate", tone: "neutral" };
}

function calibratedCutpoints(tool: CalibratedToolKey): PredictorReading["cutpoints"] {
  return {
    kind: "calibrated",
    source: CALIBRATION_SOURCES[PP3_BP4_CALIBRATION[tool].source].short,
    bands: calibrationBands(tool),
    marks: [],
  };
}

const NO_CUTS: PredictorReading["cutpoints"] = { kind: "none", source: null, bands: [], marks: [] };

/**
 * A reference-base refusal is not a provider fault and re-running cannot fix it.
 *
 * AlphaGenome answers `INVALID_ARGUMENT` (gRPC code 3) when the submitted REF allele differs from
 * the GRCh38 base at that position. The generic resolver files that under "Provider error" with
 * "Re-run the analysis to ask again", and the raw gRPC string reached the table. The truthful
 * reading is a coordinate/allele mismatch — worth stating, because it can mean the variant was
 * submitted on the other strand or on another build.
 */
export function aviAvailabilityFor(
  availability: PredictorReading["availability"],
  message: string | null,
): PredictorReading["availability"] {
  if (availability.state !== "absent" || !message) return availability;
  const m = /reference base does not match the expected reference base:?\s*([ACGTN])/i.exec(message);
  if (!m) return availability;
  const submitted = /:([ACGTN])>[ACGTN]/i.exec(message)?.[1]?.toUpperCase() ?? null;
  return {
    state: "absent",
    label: ENGINE_STATE_LABELS["not-covered"],
    reason:
      `AlphaGenome declined this coordinate: the GRCh38 reference base here is ${m[1].toUpperCase()}` +
      (submitted ? `, but the variant gives ${submitted}` : "") +
      ". Check the allele's strand and genome build; re-running will not change this.",
    action: null,
  };
}

// ── builder ───────────────────────────────────────────────────────────────────────────────────

export function buildPredictorEvidence({ result, isLoading = false, isModelLoading = false, alphagenomeConfigured }: PredictorEvidenceInput): PredictorEvidence {
  const r = result as any;
  const pd = result.predictorData ?? null;
  const cd = result.conservationData ?? null;
  const refusals = cd?.assemblyRefusals ?? null;

  const cadd = finite(pd?.caddPhred);
  const am = finite(pd?.amPathogenicity);
  const amClass = pd?.amClass ?? null;
  const revel = finite(cd?.revel);
  const bayesdel = finite(cd?.bayesdel);
  const metarnn = finite(cd?.metarnn);
  const clinpred = finite(cd?.clinpred);
  const popeve = finite(cd?.popeve);
  const esm1b = finite(cd?.esm1b);
  const eigen = finite(cd?.eigenPhred);
  const dann = finite(cd?.dann);
  const gerp = finite(cd?.gerp);
  const phylop = finite(cd?.phylop);
  const consurf = finite(cd?.consurf);
  const gpn = finite(cd?.gpnStar);
  const alphagenome = cd?.alphagenome ?? null;
  const avi = finite(alphagenome?.aviPhred);
  const esm2 = finite(r.esm2Eval?.llr ?? r.esm2?.llr);
  const esmc = finite(r.esmcEval?.llr);
  const esmcProvenance: string | null = typeof r.esmcEval?.provenance === "string" ? r.esmcEval.provenance : null;
  const saprot = finite(r.saprotEval?.llr);
  const saprotProvenance: string | null = typeof r.saprotEval?.provenance === "string" ? r.saprotEval.provenance : null;
  const saprotFallback: string | null = typeof r.saprotEval?.fallbackReason === "string" ? r.saprotEval.fallbackReason : null;

  const concordance = countPredictorConcordance(cadd, revel, am, amClass, bayesdel, esm1b, {
    metarnn,
    clinpred,
    eigenPhred: eigen,
    dann,
    popeve,
    esm2Llr: esm2,
    saprotLlr: saprot,
    vesmLlr: esmc,
    esmcLabel: esmcProvenance,
    gpnStar: gpn,
    alphagenome,
    assemblyRefusals: refusals,
    alphagenomeConfigured,
  });
  const vote = insilicoVoteOutcome(concordance);

  const dbSource = cd?.source || "dbNSFP via MyVariant.info";
  const vepSource = pd?.source || "Ensembl VEP";

  const absent = (reason: string | null = null, label: string | null = null): PredictorReading["availability"] =>
    isLoading ? { state: "pending", label: ENGINE_STATE_LABELS.running, reason: null, action: null } : { state: "absent", label: label ?? NO_RESULT, reason, action: null };
  const present: PredictorReading["availability"] = { state: "available", label: null, reason: null, action: null };
  const avail = (score: number | null, reason?: string | null) => (score !== null ? present : absent(reason ?? null));
  const modelAvail = (score: number | null): PredictorReading["availability"] =>
    score !== null ? present
    : isLoading || isModelLoading ? { state: "pending", label: ENGINE_STATE_LABELS.running, reason: null, action: null }
    : { state: "absent", label: NO_RESULT, reason: null, action: null };

  const fromAvailability = (a: EvidenceAvailability, action: PredictorReading["availability"]["action"]): PredictorReading["availability"] => {
    if (a.hasValue) return present;
    if (isLoading || a.state === "pending") return { state: "pending", label: ENGINE_STATE_LABELS.running, reason: null, action: null };
    return {
      state: "absent",
      label: a.label,
      reason: a.reason,
      action: a.action === "configure-credentials" ? action : a.action === "retry" ? "retry" : null,
    };
  };

  const readings: PredictorReading[] = [];

  // ── Voting tools, calibrated first ──
  const calibratedVoter = (
    key: string,
    name: string,
    tool: CalibratedToolKey,
    score: number | null,
    decimals: number,
    extra: Partial<PredictorReading>,
  ) => {
    const call = calibratedCall(tool, score);
    const { label, tone } = callFromCalibrated(call);
    readings.push({
      key,
      name,
      description: "",
      group: "vote",
      votes: true,
      score,
      scoreText: fmt(score, decimals),
      unit: null,
      scale: { min: 0, max: 1 },
      orientation: PP3_BP4_CALIBRATION[tool].orientation,
      cutpoints: calibratedCutpoints(tool),
      signal: concordance.signals[key] ?? "unavailable",
      calibrated: call,
      callLabel: score === null ? NO_RESULT : label,
      callTone: score === null ? "muted" : tone,
      caveats: [],
      note: null,
      availability: avail(score),
      source: dbSource,
      knowledgeKey: null,
      link: null,
      ...extra,
    });
  };

  calibratedVoter("revel", "REVEL", "revel", revel, 3, {
    description: "Ensemble of 13 missense predictors; no allele-frequency feature.",
    knowledgeKey: "revel",
  });
  calibratedVoter("bayesdel", "BayesDel", "bayesdel", bayesdel, 3, {
    description: "Naïve-Bayes combination of deleteriousness scores — the build without allele frequency.",
    scale: { min: -1.3, max: 0.8 },
    knowledgeKey: "bayesdel",
  });
  calibratedVoter("am", "AlphaMissense", "alphaMissense", am, 3, {
    description: "Protein language and structure model, weakly labelled from primate and human population variants.",
    note: amClass ? `AlphaMissense's own label: ${amClass.replace(/_/g, " ")}` : null,
    source: vepSource,
    knowledgeKey: "am",
  });
  calibratedVoter("cadd", "CADD", "cadd", cadd, 1, {
    description: "Genome-wide deleteriousness from about 100 annotations, conservation among them.",
    unit: "PHRED",
    scale: { min: 0, max: 50 },
    source: vepSource,
    knowledgeKey: "cadd",
  });

  // ── Voting tools with the authors' own cut-points ──
  const authorVoter = (
    key: string,
    name: string,
    score: number | null,
    cut: number,
    extra: Partial<PredictorReading>,
  ) => {
    const signal = concordance.signals[key] ?? "unavailable";
    readings.push({
      key,
      name,
      description: "",
      group: "vote",
      votes: true,
      score,
      scoreText: fmt(score, 3),
      unit: null,
      scale: { min: 0, max: 1 },
      orientation: "higher",
      cutpoints: {
        kind: "authors",
        source: null,
        bands: [],
        marks: [{ value: cut, side: "path", label: `≥ ${cut}` }],
      },
      signal,
      calibrated: null,
      callLabel: SIGNAL_LABEL[signal],
      callTone: SIGNAL_TONE[signal],
      caveats: ["uses-af", "clinvar-trained"],
      note: null,
      availability: avail(score),
      source: dbSource,
      knowledgeKey: null,
      link: null,
      ...extra,
    });
  };
  authorVoter("metarnn", "MetaRNN", metarnn, THRESHOLDS.metaRnn.pathogenic, {
    description: "Recurrent network over 16 scores, 8 conservation measures and gnomAD allele frequency.",
    knowledgeKey: "metarnn",
    cutpoints: { kind: "authors", source: "Li et al. 2022", bands: [], marks: [{ value: THRESHOLDS.metaRnn.pathogenic, side: "path", label: "≥ 0.5" }] },
  });
  authorVoter("clinpred", "ClinPred", clinpred, THRESHOLDS.clinPred.pathogenic, {
    description: "Random forest and gradient boosting over existing scores and gnomAD allele frequency.",
    knowledgeKey: "clinpred",
    cutpoints: { kind: "authors", source: "Alirezaie et al. 2018", bands: [], marks: [{ value: THRESHOLDS.clinPred.pathogenic, side: "path", label: "≥ 0.5" }] },
  });

  {
    const signal = concordance.signals.popeve ?? "unavailable";
    const popAvail = resolveSourceAvailability({ source: "popEVE", refusals, value: popeve, status: null });
    readings.push({
      key: "popeve",
      name: "popEVE",
      description: "EVE and ESM-1v on one proteome-wide scale, calibrated with human population data.",
      group: "vote",
      votes: true,
      score: popeve,
      scoreText: fmt(popeve, 3),
      unit: null,
      scale: { min: -8, max: 0 },
      orientation: "lower",
      cutpoints: {
        kind: "authors",
        source: "Orenbuch et al. 2025",
        bands: [],
        marks: [
          { value: THRESHOLDS.popEve.severePathogenic, side: "path", label: "≤ −5.056 highly" },
          { value: THRESHOLDS.popEve.pathogenic, side: "path", label: "≤ −4.617" },
        ],
      },
      signal,
      calibrated: null,
      callLabel: signal === "pathogenic" ? (popeve !== null && popeve <= THRESHOLDS.popEve.severePathogenic ? "Highly deleterious" : "Deleterious") : signal === "vus" ? "Above cut-point" : NO_RESULT,
      callTone: signal === "pathogenic" ? "danger" : signal === "vus" ? "neutral" : "muted",
      caveats: ["no-benign-cut"],
      note: null,
      availability: popeve !== null ? present : fromAvailability(popAvail, null),
      source: "popEVE precomputed tracks (evemodel.org)",
      knowledgeKey: "popeve",
      link: null,
    });
  }

  // ── Protein language models (informational) ──
  {
    const call = calibratedCall("esm1b", esm1b);
    const { label, tone } = callFromCalibrated(call);
    readings.push({
      key: "esm",
      name: "ESM1b",
      description: "Protein language model log-likelihood ratio (Brandes et al. 2023).",
      group: "protein-lm",
      votes: false,
      score: esm1b,
      scoreText: fmt(esm1b, 2),
      unit: "LLR",
      scale: { min: -25, max: 5 },
      orientation: "lower",
      cutpoints: calibratedCutpoints("esm1b"),
      signal: concordance.signals.esm ?? "unavailable",
      calibrated: call,
      callLabel: esm1b === null ? NO_RESULT : label,
      callTone: esm1b === null ? "muted" : tone,
      caveats: [],
      note: null,
      availability: avail(esm1b),
      source: dbSource,
      knowledgeKey: null,
      link: null,
    });
  }

  const uncalibratedLm = (
    key: string,
    name: string,
    score: number | null,
    extra: Partial<PredictorReading>,
  ) => {
    readings.push({
      key,
      name,
      description: "",
      group: "protein-lm",
      votes: false,
      score,
      scoreText: fmt(score, 2),
      unit: "LLR",
      scale: { min: -25, max: 5 },
      orientation: "lower",
      cutpoints: NO_CUTS,
      signal: score === null ? "unavailable" : "vus",
      calibrated: null,
      callLabel: score === null ? NO_RESULT : "Informational",
      callTone: "muted",
      caveats: [],
      note: null,
      availability: modelAvail(score),
      source: "",
      knowledgeKey: null,
      link: null,
      ...extra,
    });
  };
  uncalibratedLm("esm2_3b", "ESM-2", esm2, {
    description: "Protein language model masked-marginal LLR.",
    source: "Meta FAIR ESM-2",
    knowledgeKey: "esm2",
  });
  uncalibratedLm("vesm", esmcProvenance && /vesm/i.test(esmcProvenance) ? "VESM" : esmcProvenance && /esmc/i.test(esmcProvenance) ? "ESMC" : "ESMC / VESM", esmc, {
    description: "Protein language model LLR — ESMC when the remote tier answers, VESM when the local sidecar does.",
    note: esmcProvenance ? `Served by ${esmcProvenance}` : null,
    source: esmcProvenance ?? "ESMC (remote) or VESM (local sidecar)",
    knowledgeKey: "vesm",
  });
  uncalibratedLm("saprot", "SaProt", saprot, {
    description: "Structure-aware protein language model over Foldseek 3Di tokens from the predicted structure.",
    scale: { min: -20, max: 5 },
    caveats: saprotFallback ? ["fallback-model"] : [],
    note: saprotFallback ? `Fallback: ${saprotFallback}` : saprotProvenance ? `Served by ${saprotProvenance}` : null,
    source: saprotProvenance ?? "SaProt",
    knowledgeKey: "saprot",
  });

  // ── Genome-wide models (informational) ──
  {
    const aviAvail = resolveSourceAvailability({
      source: "alphagenome",
      refusals,
      value: avi,
      status: alphagenome?.status ?? null,
      configured: alphagenomeConfigured,
      message: alphagenome?.message ?? null,
    });
    const pct = finite(alphagenome?.topPercentile);
    readings.push({
      key: "alphagenome",
      name: "AlphaGenome AVI",
      description: "Composite variant-impact rank across AlphaGenome's 18 features.",
      group: "genome",
      votes: false,
      score: avi,
      scoreText: fmt(avi, 1),
      unit: "rank-Phred",
      scale: { min: 0, max: 60 },
      orientation: "higher",
      cutpoints: NO_CUTS,
      signal: avi === null ? "unavailable" : "vus",
      calibrated: null,
      callLabel: avi === null ? NO_RESULT : "Informational",
      callTone: "muted",
      caveats: ["rank-not-probability", "includes-alphamissense"],
      note:
        avi !== null
          ? [
              pct !== null ? `Top ${pct < 0.1 ? pct.toFixed(3) : pct.toFixed(2)}% of all possible SNVs` : null,
              alphagenome?.topModality ? `largest feature: ${alphagenome.topModality}` : null,
            ].filter(Boolean).join(" · ") || null
          : null,
      availability: aviAvailabilityFor(fromAvailability(aviAvail, "configure-alphagenome"), alphagenome?.message ?? null),
      source: "Google DeepMind AlphaGenome",
      knowledgeKey: "alphagenome",
      link: { tab: "alphagenome", label: "Open AlphaGenome" },
    });
  }
  {
    const status = cd?.gpnStarStatus ?? (gpn !== null ? "live" : null);
    const gpnAvail = resolveSourceAvailability({
      source: "gpn-star",
      refusals,
      value: gpn,
      status,
      message: cd?.gpnStarMessage ?? null,
      configured: status === "token_required" ? false : undefined,
    });
    readings.push({
      key: "gpn_star",
      name: "GPN-Star",
      description: "Genomic language model over a vertebrate alignment.",
      group: "genome",
      votes: false,
      score: gpn,
      scoreText: fmt(gpn, 2),
      unit: "LLR",
      scale: { min: -10, max: 2 },
      orientation: "lower",
      cutpoints: {
        kind: "local",
        source: null,
        bands: [],
        marks: [
          { value: THRESHOLDS.gpnStar.pathogenic, side: "path", label: "−2.5" },
          { value: THRESHOLDS.gpnStar.benign, side: "benign", label: "0" },
        ],
      },
      signal: gpn === null ? "unavailable" : "vus",
      calibrated: null,
      callLabel: gpn === null ? NO_RESULT : "Informational",
      callTone: "muted",
      caveats: [],
      note: null,
      availability: fromAvailability(gpnAvail, "configure-gpn"),
      source: "Song lab GPN-Star",
      knowledgeKey: "gpn_star",
      link: null,
    });
  }
  readings.push({
    key: "eigen",
    name: "Eigen",
    description: "Unsupervised spectral combination of genome-wide annotations.",
    group: "genome",
    votes: false,
    score: eigen,
    scoreText: fmt(eigen, 2),
    unit: "PHRED",
    scale: { min: 0, max: 20 },
    orientation: "higher",
    cutpoints: NO_CUTS,
    signal: eigen === null ? "unavailable" : "vus",
    calibrated: null,
    callLabel: eigen === null ? NO_RESULT : "Informational",
    callTone: "muted",
    caveats: [],
    note: null,
    availability: avail(eigen),
    source: dbSource,
    knowledgeKey: "eigen",
    link: null,
  });
  readings.push({
    key: "dann",
    name: "DANN",
    description: "Deep neural network trained on the CADD data set.",
    group: "genome",
    votes: false,
    score: dann,
    scoreText: fmt(dann, 3),
    unit: null,
    scale: { min: 0, max: 1 },
    orientation: "higher",
    cutpoints: NO_CUTS,
    signal: dann === null ? "unavailable" : "vus",
    calibrated: null,
    callLabel: dann === null ? NO_RESULT : "Informational",
    callTone: "muted",
    caveats: [],
    note: null,
    availability: avail(dann),
    source: dbSource,
    knowledgeKey: "dann",
    link: null,
  });

  // ── Conservation (informational) ──
  const conservation = (key: string, name: string, tool: CalibratedToolKey, score: number | null, scale: { min: number; max: number }, description: string) => {
    const call = calibratedCall(tool, score);
    const { label, tone } = callFromCalibrated(call);
    readings.push({
      key,
      name,
      description,
      group: "conservation",
      votes: false,
      score,
      scoreText: fmt(score, 2),
      unit: null,
      scale,
      orientation: "higher",
      cutpoints: calibratedCutpoints(tool),
      signal: score === null ? "unavailable" : "vus",
      calibrated: call,
      callLabel: score === null ? NO_RESULT : label,
      callTone: score === null ? "muted" : tone,
      caveats: [],
      note: null,
      availability: avail(score),
      source: dbSource,
      knowledgeKey: null,
      link: null,
    });
  };
  conservation("phylop", "phyloP", "phylop", phylop, { min: -20, max: 10 }, "Base-wise conservation across the vertebrate alignment.");
  conservation("gerp", "GERP++", "gerp", gerp, { min: -12.3, max: 6.2 }, "Rejected substitutions at this base across mammals (RS).");
  readings.push({
    key: "consurf",
    name: "ConSurf",
    description: "Residue conservation grade (1 variable – 9 conserved) from a homologue alignment.",
    group: "conservation",
    votes: false,
    score: consurf,
    scoreText: consurf !== null ? String(Math.round(consurf)) : "—",
    unit: "grade",
    scale: { min: 1, max: 9 },
    orientation: "higher",
    cutpoints: NO_CUTS,
    signal: consurf === null ? "unavailable" : "vus",
    calibrated: null,
    callLabel: consurf === null ? NO_RESULT : "Informational",
    callTone: "muted",
    caveats: [],
    note: null,
    availability: consurf !== null
      ? present
      : absent("ConSurf-DB returned no grade for this protein.", "No grade"),
    source: "ConSurf-DB",
    knowledgeKey: null,
    link: null,
  });

  const voterRows = readings.filter(x => x.votes);
  const voters = {
    pathogenic: voterRows.filter(x => x.signal === "pathogenic"),
    benign: voterRows.filter(x => x.signal === "benign"),
    indeterminate: voterRows.filter(x => x.signal === "vus"),
    missing: voterRows.filter(x => x.signal === "unavailable"),
  };

  // ── What the engine recorded ──
  const engineCriteria: Array<{ code?: string; reason?: string }> | null =
    (r.ruleBasedInsights?.acmgCriteria ?? r.insights?.acmgCriteria ?? null) as any;
  const weighting: string | null = r.metadata?.acmgWeighting ?? null;
  const recorded = engineCriteria?.find(c => typeof c?.code === "string" && /^(PP3|BP4)(_|$)/i.test(c.code)) ?? null;
  const weightingSuppresses = weighting === "strict-structural" || weighting === "conservative";
  const engine: EngineRecord = {
    known: engineCriteria !== null,
    code: recorded?.code ?? null,
    reason: recorded?.reason ?? null,
    weighting,
    withheldByWeighting: engineCriteria !== null && !recorded && vote.code !== null && weightingSuppresses,
  };

  // ── The calibrated single-tool reading ClinGen recommends ──
  let reference: CalibratedReference | null = null;
  const refTool = revel !== null ? ("revel" as const) : bayesdel !== null ? ("bayesdel" as const) : null;
  if (refTool) {
    const score = (refTool === "revel" ? revel : bayesdel) as number;
    const call = calibratedCall(refTool, score) as CalibratedCall;
    const relation: CalibratedReference["relation"] =
      vote.code === null ? "no-vote"
      : call.direction === null ? "indeterminate"
      : (call.direction === vote.code) ? "agrees"
      : "opposes";
    reference = {
      key: refTool,
      name: refTool === "revel" ? "REVEL" : "BayesDel",
      score,
      call,
      bands: calibrationBands(refTool),
      source: CALIBRATION_SOURCES[PP3_BP4_CALIBRATION[refTool].source].short,
      relation,
    };
  }

  return {
    readings,
    vote,
    voters,
    engine,
    reference,
    pending: readings.some(x => x.availability.state === "pending"),
    unavailable: concordance.unavailable,
  };
}

/** Readings grouped for the table, in display order. Empty groups are dropped. */
export function groupReadings(readings: PredictorReading[]): Array<{ group: PredictorGroup; rows: PredictorReading[] }> {
  const order: PredictorGroup[] = ["vote", "protein-lm", "genome", "conservation"];
  return order
    .map(group => ({ group, rows: readings.filter(x => x.group === group) }))
    .filter(g => g.rows.length > 0);
}

/**
 * The finding in words: the headline and its predicate, as the Population tab words its own.
 * Never says more than the vote and the engine record do.
 */
export function predictorFinding(evidence: PredictorEvidence): { headline: string; predicate: string } {
  const { vote } = evidence;
  const tail = vote.nIndeterminate > 0 ? `, with ${vote.nIndeterminate} indeterminate` : "";
  switch (vote.direction) {
    case "no-votes":
      return {
        headline: "No voting tool scored this variant",
        predicate: "so the in-silico rule has nothing to count and no PP3 or BP4 is supported",
      };
    case "tie":
      return {
        headline: vote.nPathogenic === 0 ? "No voting tool reached a call" : "The vote is split",
        predicate:
          vote.nPathogenic === 0
            ? `all ${vote.nVoting} scored voting tools sit in their indeterminate range, so neither PP3 nor BP4 is supported`
            : `${vote.nPathogenic} pathogenic against ${vote.nBenign} benign${tail}, so the rule supports neither PP3 nor BP4`,
      };
    case "pathogenic":
      return {
        headline: "Pathogenic calls outnumber benign",
        predicate: `${vote.nPathogenic} to ${vote.nBenign}${tail}, so the engine's plurality rule supports PP3 at Supporting strength`,
      };
    case "benign":
      return {
        headline: "Benign calls outnumber pathogenic",
        predicate: `${vote.nBenign} to ${vote.nPathogenic}${tail}, so the engine's plurality rule supports BP4 at Supporting strength`,
      };
  }
}

/**
 * The finding card's one summary line: what the engine recorded, how the vote relates to it, and
 * what the calibrated reference reads beside it — the three facts a curator needs, said ONCE.
 *
 * It replaced a card that stated the count four times (figure, caption, finding sentence, legend)
 * and REVEL's reading three times (a full-width yellow banner, a meta line, the table), while never
 * saying in words when the engine record and the current rule disagreed (only the rail did).
 *
 * `tone` is "warning" exactly when a curator must reconcile two readings: the calibrated reference
 * reaches a band the vote does not, the weighting withheld the vote's code, or the payload's record
 * differs from what the current rule gives.
 */
export interface PredictorSummary {
  tone: "warning" | "neutral";
  /** The bold sentence, ending in a full stop. */
  lead: string;
  /** Plain sentences after it, each ending in a full stop. */
  rest: string[];
  /** Which engine situation produced the lead — pinned by tests, used for `data-state`. */
  state: "recorded" | "unconfirmed" | "withheld" | "stale" | "none";
}

export function predictorSummary(evidence: PredictorEvidence): PredictorSummary {
  const { vote, engine, reference } = evidence;
  const code = (c: string) => formatEvidenceCode(c);
  const count =
    vote.direction === "pathogenic" ? `${vote.nPathogenic} to ${vote.nBenign}`
    : vote.direction === "benign" ? `${vote.nBenign} to ${vote.nPathogenic}`
    : null;

  // What the calibrated reference reads, relative to the vote. `joinable` is the short clause
  // that can close the lead; `sentence` is the same fact standing alone.
  let refClause: { joinable: string | null; sentence: string; disagrees: boolean; advice: string | null } | null = null;
  if (reference) {
    const ref = `${reference.name}, the calibrated reference,`;
    const band = reference.call.direction ? code(reference.call.code) : null;
    switch (reference.relation) {
      case "agrees":
        refClause = { joinable: `, and ${ref} agrees (${band})`, sentence: `${ref} agrees: ${band}.`, disagrees: false, advice: null };
        break;
      case "opposes":
        refClause = {
          joinable: `, but ${ref} reads ${band}`,
          sentence: `${ref} reads ${band}, the other way from the vote.`,
          disagrees: true,
          advice: "ClinGen advises one pre-specified calibrated tool over a count of correlated ones.",
        };
        break;
      case "indeterminate":
        refClause = {
          joinable: null,
          sentence: `${ref} sits between its bands, so on its own it supports neither PP3 nor BP4; the vote's ${vote.code} rests on uncalibrated or weaker tools.`,
          disagrees: false,
          advice: null,
        };
        break;
      case "no-vote":
        refClause = band
          ? {
              joinable: null,
              sentence: `${ref} reads ${band} on its own, which the vote does not reflect.`,
              disagrees: true,
              advice: "With the vote split, read that one calibrated tool by itself, as ClinGen advises, rather than counting correlated ones.",
            }
          : { joinable: null, sentence: `${ref} also sits between its bands.`, disagrees: false, advice: null };
        break;
    }
  } else if (vote.direction !== "no-votes") {
    // REVEL and BayesDel both vote, so with no votes at all their absence is already said.
    const pending = evidence.readings.some(x => (x.key === "revel" || x.key === "bayesdel") && x.availability.state === "pending");
    refClause = {
      joinable: null,
      sentence: pending
        ? "The calibrated reference (REVEL, else BayesDel) is still being computed."
        : "Neither REVEL nor BayesDel scored this variant, so there is no calibrated reading to set beside the vote.",
      disagrees: false,
      advice: null,
    };
  }

  const finish = (state: PredictorSummary["state"], clause: string, extra: string[], forceWarn: boolean, joinRef: boolean): PredictorSummary => {
    const join = joinRef && refClause?.joinable;
    const lead = `${clause}${join ? refClause!.joinable : ""}.`;
    const rest = [...extra, ...(join || !refClause ? [] : [refClause.sentence]), ...(refClause?.advice ? [refClause.advice] : [])];
    return { tone: forceWarn || refClause?.disagrees ? "warning" : "neutral", lead, rest, state };
  };

  // 1. No engine record in the payload: the vote's code is shown, and called unconfirmed.
  if (!engine.known) {
    if (vote.code) {
      return finish("unconfirmed", `The vote supports ${vote.code}, ${count}`, ["This result carries no engine record to confirm it against."], false, true);
    }
    return finish("none", noCriterion(vote), [], false, false);
  }

  // 2. The weighting withheld the vote's code.
  if (engine.withheldByWeighting) {
    return finish(
      "withheld",
      `The vote supports ${vote.code}, ${count}, but the engine recorded no in-silico criterion`,
      [`The ${engine.weighting} ACMG weighting withholds it.`],
      true,
      false,
    );
  }

  // 3. The record differs from what the current rule gives: an earlier engine classified it.
  if ((engine.code ?? null) !== vote.code) {
    const recorded = engine.code ? `recorded ${code(engine.code)}` : "recorded no PP3 or BP4";
    const current = vote.code ? `${vote.code}${count ? ` (${count})` : ""}` : "neither PP3 nor BP4";
    return finish(
      "stale",
      `The engine ${recorded} where the current rule gives ${current}`,
      ["This result was classified by an earlier engine; re-run the analysis to refresh it."],
      true,
      false,
    );
  }

  // 4. The record matches the vote.
  if (engine.code) {
    return finish("recorded", `The engine recorded ${code(engine.code)} from a ${count} vote`, [], false, true);
  }
  return finish("none", noCriterion(vote), [], false, false);
}

/** The lead when the vote supports no criterion: why, in one clause. */
function noCriterion(vote: InsilicoVoteOutcome): string {
  if (vote.direction === "no-votes") return "No PP3 or BP4: no voting tool scored this variant";
  if (vote.nPathogenic === 0) {
    return `No PP3 or BP4: all ${vote.nVoting} scored voting ${vote.nVoting === 1 ? "tool sits" : "tools sit"} in their indeterminate range`;
  }
  const tail = vote.nIndeterminate > 0 ? `, with ${vote.nIndeterminate} indeterminate` : "";
  return `No PP3 or BP4: the vote is split, ${vote.nPathogenic} pathogenic against ${vote.nBenign} benign${tail}`;
}


// ── Informational models: what they are, why they do not vote ────────────────────────────────
//
// The three non-voting families used to appear only as grouped rows in the readings table, with a
// four-word note ("Informational · not counted"). A researcher who has not met a protein language
// model or a Phred-scaled composite had no way to learn what the number means or why it is not in the
// vote. Each family now states (a) what it measures, (b) why it is outside PP3/BP4, and (c) how to
// read it — in plain words, from the same readings the table renders.

export type InformationalGroup = Exclude<PredictorGroup, "vote">;

export const INFORMATIONAL_FAMILY: Record<InformationalGroup, { what: string; why: string; read: string }> = {
  "protein-lm": {
    what: "Trained on millions of natural protein sequences to learn which amino acids evolution tolerates at each position. The score is a log-likelihood ratio (LLR): how much less likely the substituted residue is than the original.",
    why: "Only ESM1b has a published evidence calibration, and ClinGen has not adopted any language model for PP3/BP4, so none is counted.",
    read: "More negative means the change is less expected by the model. Scores from different models are not on the same scale.",
  },
  genome: {
    what: "Models that score a variant from DNA context rather than protein sequence alone: a rank of regulatory and splicing impact, a language model over a vertebrate alignment, or a combination of existing annotations.",
    why: "They are ranks or unsupervised combinations, not probabilities, and no ClinGen calibration exists. Some already contain predictors that vote, so counting them would count the same evidence twice.",
    read: "Compare a score with its own axis only. A high rank says the variant stands out among all possible changes, not that it causes disease.",
  },
  conservation: {
    what: "How strongly evolution has kept this position the same across species. A conserved base or residue is under selective constraint.",
    why: "Constraint is not pathogenicity, and ClinGen caps PP3 and PM1 together at Strong because a predictor already scores the position a critical site sits in.",
    read: "Higher means more conserved. A conserved site makes a harmful change more plausible but does not show that this substitution is harmful.",
  },
};

export interface InformationalFamilySummary {
  group: InformationalGroup;
  label: string;
  what: string;
  why: string;
  read: string;
  readings: PredictorReading[];
  scored: number;
  total: number;
  /** One factual line: how many scored, and how many carry a published call. */
  headline: string;
}

export function informationalSummary(evidence: PredictorEvidence): InformationalFamilySummary[] {
  const groups: InformationalGroup[] = ["protein-lm", "genome", "conservation"];
  return groups
    .map(group => {
      const readings = evidence.readings.filter(r => r.group === group);
      const scored = readings.filter(r => r.score !== null).length;
      const withCall = readings.filter(r => r.score !== null && r.calibrated !== null).length;
      const tail =
        scored === 0
          ? "no score reached this variant"
          : withCall === 0
            ? "none has a published cut-point, so none makes a call"
            : `${withCall} ${withCall === 1 ? "has" : "have"} a published cut-point`;
      return {
        group,
        label: PREDICTOR_GROUP_LABEL[group],
        ...INFORMATIONAL_FAMILY[group],
        readings,
        scored,
        total: readings.length,
        headline: `${scored} of ${readings.length} scored · ${tail}`,
      };
    })
    .filter(f => f.total > 0);
}
