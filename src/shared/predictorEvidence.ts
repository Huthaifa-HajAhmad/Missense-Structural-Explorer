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
 *   • The PP3/BP4 call comes from `decidePrimaryInsilico`, the function the engine itself calls:
 *     the first tool with a score in the fixed order REVEL → BayesDel noAF → AlphaMissense → ESM1b.
 *   • What the engine recorded is READ from its criteria list, never inferred from that call.
 *   • A cut-point is drawn only with its provenance: ClinGen-calibrated, the authors' own, local, or
 *     none. An uncalibrated cut-point is never presented as a calibrated one.
 */
import { candidateCaddNote, decideCandidateCadd, validCaddScore } from "./candidateScores.ts";
import type { AnalysisResult } from "./contracts.ts";
import {
  CALIBRATION_SOURCES,
  PP3_BP4_CALIBRATION,
  THRESHOLDS,
  calibratedCall,
  calibrationBands,
  evaluatePopEve,
  formatEvidenceCode,
  type CalibratedCall,
  type CalibratedToolKey,
  type CalibrationBand,
  type PredictorSignal,
} from "./thresholds.ts";
import {
  CHAIN_TOOL_LABEL,
  decidePrimaryInsilico,
  primaryInsilicoInputFromResult,
  type ChainToolKey,
  type PrimaryInsilicoDecision,
} from "./insilico/primaryPredictor.ts";
import { resolveSourceAvailability, type EvidenceAvailability } from "./evidenceAvailability.ts";
import { ENGINE_STATE_LABELS } from "./engineStatus.ts";
import { classifyClinvar } from "./clinvarClassification.ts";
import { fmtPercentAbove } from "./alphagenomeEvidence.ts";

/** The canonical absence word — the engine-status vocabulary, not a local synonym. */
const NO_RESULT = ENGINE_STATE_LABELS["no-result"];

export type PredictorGroup = "primary" | "severity" | "genome" | "conservation";

export const PREDICTOR_GROUP_LABEL: Record<PredictorGroup, string> = {
  primary: "Calibrated tools, in order",
  severity: "Cross-gene severity",
  genome: "Genome-wide models",
  conservation: "Conservation",
};

export const PREDICTOR_GROUP_NOTE: Record<PredictorGroup, string> = {
  primary: "The first one with a score sets PP3/BP4",
  severity: "Informational · not counted",
  genome: "Informational · not counted",
  conservation: "Constraint, not pathogenicity · not counted",
};

export type Caveat =
  | "includes-alphamissense"
  | "rank-not-probability"
  | "no-benign-cut";

export const CAVEAT_TEXT: Record<Caveat, { label: string; detail: string }> = {
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
  /** Its place in the fixed PP3/BP4 order, or `null` for a tool that is shown but never sets PP3/BP4. */
  chainKey: ChainToolKey | null;
  score: number | null;
  scoreText: string;
  /** Range of candidate scores when an ambiguous locus agrees on one call; `score` stays `null`. */
  scoreRange?: [number, number] | null;
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
  /** The reading's direction: its calibrated band, or its authors' cut-point, or "vus" with no call. */
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
    action: "configure-alphagenome" | "retry" | null;
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
  /** The rule gives a code the engine did not record, under a weighting that withholds it. */
  withheldByWeighting: boolean;
}

export interface PredictorEvidence {
  readings: PredictorReading[];
  /** The PP3/BP4 decision from the fixed order of calibrated tools — the engine's own function. */
  primary: PrimaryInsilicoDecision;
  engine: EngineRecord;
  /** Readings still being computed. */
  pending: boolean;
}

export interface PredictorEvidenceInput {
  result: AnalysisResult;
  /** The analysis itself is still in flight: any missing score may yet arrive. */
  isLoading?: boolean;
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

export function buildPredictorEvidence({ result, isLoading = false, alphagenomeConfigured }: PredictorEvidenceInput): PredictorEvidence {
  const r = result as any;
  const pd = result.predictorData ?? null;
  const cd = result.conservationData ?? null;
  const refusals = cd?.assemblyRefusals ?? null;

  const cadd = validCaddScore(pd?.caddPhred);
  const candidateCaddList = pd?.locusResolution?.failureKind === "multiple-candidates" ? pd.locusResolution.candidates : null;
  const caddDecision = cadd === null ? decideCandidateCadd(candidateCaddList) : null;
  const am = finite(pd?.amPathogenicity);
  const amClass = pd?.amClass ?? null;
  const revel = finite(cd?.revel);
  const bayesdel = finite(cd?.bayesdel);
  const popeve = finite(cd?.popeve);
  const esm1b = finite(cd?.esm1b);
  const gerp = finite(cd?.gerp);
  const phylop = finite(cd?.phylop);
  const scorecons = finite(cd?.scorecons);
  const alphagenome = cd?.alphagenome ?? null;
  const avi = finite(alphagenome?.aviPhred);

  const primary = decidePrimaryInsilico(
    primaryInsilicoInputFromResult({
      gene: result.metadata?.gene ?? null,
      predictorData: pd,
      conservationData: cd,
      serviceStatus: result.serviceStatus,
    }),
  );
  const signalOf = (call: CalibratedCall | null): PredictorSignal =>
    call === null ? "unavailable" : call.direction === "PP3" ? "pathogenic" : call.direction === "BP4" ? "benign" : "vus";

  const dbSource = cd?.source || "dbNSFP via MyVariant.info";
  const vepSource = pd?.source || "Ensembl VEP";

  const absent = (reason: string | null = null, label: string | null = null): PredictorReading["availability"] =>
    isLoading ? { state: "pending", label: ENGINE_STATE_LABELS.running, reason: null, action: null } : { state: "absent", label: label ?? NO_RESULT, reason, action: null };
  const present: PredictorReading["availability"] = { state: "available", label: null, reason: null, action: null };
  const avail = (score: number | null, reason?: string | null) => (score !== null ? present : absent(reason ?? null));

  /**
   * A provider budget expiry is not a completed miss.
   *
   * `modelStatus` is the only record of whether a model answered, was still in flight, or ran out of
   * time. Without it a timed-out lookup rendered exactly like "the provider has no score for this
   * variant" — the distinction the Predictors screen must make. The label and the retry action come
   * from here so the table, the agreement card and the inspector all say the same thing.
   */
  type ConservationStatusKey = keyof NonNullable<NonNullable<AnalysisResult["conservationData"]>["modelStatus"]>;
  const statusOf = (model: ConservationStatusKey) => cd?.modelStatus?.[model] ?? null;
  const runningAvailability: PredictorReading["availability"] = {
    state: "pending", label: ENGINE_STATE_LABELS.running, reason: null, action: null,
  };
  const timedOutAvailability: PredictorReading["availability"] = {
    state: "absent",
    label: "Timed out",
    reason: "The provider did not answer before the analysis budget ended.",
    action: "retry",
  };
  const statusAware = (
    score: number | null,
    model: ConservationStatusKey,
    fallback: () => PredictorReading["availability"],
  ): PredictorReading["availability"] => {
    if (score !== null) return present;
    const status = statusOf(model);
    if (isLoading || status === "pending") return runningAvailability;
    if (status === "timeout") return timedOutAvailability;
    return fallback();
  };
  const availFor = (score: number | null, model: ConservationStatusKey, reason: string | null = null) =>
    statusAware(score, model, () => absent(reason));

  const fromAvailability = (a: EvidenceAvailability, action: PredictorReading["availability"]["action"]): PredictorReading["availability"] => {
    if (a.hasValue) return present;
    if (isLoading || a.state === "pending") return runningAvailability;
    return {
      state: "absent",
      label: a.label,
      reason: a.reason,
      action: a.action === "configure-credentials" ? action : a.action === "retry" ? "retry" : null,
    };
  };

  const readings: PredictorReading[] = [];

  // ── Calibrated tools, in the fixed PP3/BP4 order ──
  const calibratedReading = (
    key: string,
    name: string,
    tool: CalibratedToolKey,
    score: number | null,
    decimals: number,
    extra: Partial<PredictorReading>,
    statusKey: ConservationStatusKey | null = null,
  ) => {
    const call = calibratedCall(tool, score);
    const { label, tone } = callFromCalibrated(call);
    readings.push({
      key,
      name,
      description: "",
      group: "primary",
      chainKey: null,
      score,
      scoreText: fmt(score, decimals),
      unit: null,
      scale: { min: 0, max: 1 },
      orientation: PP3_BP4_CALIBRATION[tool].orientation,
      cutpoints: calibratedCutpoints(tool),
      signal: signalOf(call),
      calibrated: call,
      callLabel: score === null ? NO_RESULT : label,
      callTone: score === null ? "muted" : tone,
      caveats: [],
      note: null,
      availability: statusKey ? availFor(score, statusKey) : avail(score),
      source: dbSource,
      knowledgeKey: null,
      link: null,
      ...extra,
    });
  };

  calibratedReading("revel", CHAIN_TOOL_LABEL.revel, "revel", revel, 3, {
    chainKey: "revel",
    description: "Ensemble of 13 missense predictors; no allele-frequency feature.",
    knowledgeKey: "revel",
  }, "base");
  calibratedReading("bayesdel", CHAIN_TOOL_LABEL.bayesdel, "bayesdel", bayesdel, 3, {
    chainKey: "bayesdel",
    description: "Naïve-Bayes combination of deleteriousness scores — the build without allele frequency.",
    scale: { min: -1.3, max: 0.8 },
    knowledgeKey: "bayesdel",
  }, "base");
  calibratedReading("am", CHAIN_TOOL_LABEL.alphaMissense, "alphaMissense", am, 3, {
    chainKey: "alphaMissense",
    description: "Protein language and structure model, weakly labelled from primate and human population variants.",
    note: amClass ? `AlphaMissense's own label: ${amClass.replace(/_/g, " ")}` : null,
    source: vepSource,
    knowledgeKey: "am",
  });
  calibratedReading("esm", CHAIN_TOOL_LABEL.esm1b, "esm1b", esm1b, 2, {
    chainKey: "esm1b",
    description: "Protein language model log-likelihood ratio (Brandes et al. 2023).",
    unit: "LLR",
    scale: { min: -25, max: 5 },
    knowledgeKey: "esm1b",
  }, "base");

  // ── CADD: calibrated bands are shown, but it is not in the fixed order ──
  const caddExtra: Partial<PredictorReading> = (() => {
    if (!caddDecision) {
      return {
        source: vepSource,
        note: candidateCaddNote(candidateCaddList),
      };
    }
    if (caddDecision.kind === "agreed" || caddDecision.kind === "indeterminate") {
      const { label, tone } = callFromCalibrated(caddDecision.calibrated);
      return {
        score: null,
        scoreText: caddDecision.scoreText,
        scoreRange: caddDecision.range,
        signal: caddDecision.signal,
        calibrated: caddDecision.calibrated,
        callLabel: label,
        callTone: tone,
        availability: present,
        source: caddDecision.source,
        note: candidateCaddNote(candidateCaddList, caddDecision),
      };
    }
    return {
      score: null,
      scoreText: "—",
      signal: "unavailable",
      calibrated: null,
      callLabel: caddDecision.availabilityLabel,
      callTone: "muted",
      availability: {
        state: "absent",
        label: caddDecision.availabilityLabel,
        reason: caddDecision.availabilityReason,
        action: null,
      },
      source: caddDecision.kind === "disagree"
        ? caddDecision.source
        : caddDecision.sources.length
          ? caddDecision.sources.join(" / ")
          : vepSource,
      note: candidateCaddNote(candidateCaddList, caddDecision),
    };
  })();

  calibratedReading("cadd", "CADD", "cadd", cadd, 1, {
    group: "genome",
    description: "Genome-wide deleteriousness from about 100 annotations, conservation among them.",
    unit: "PHRED",
    scale: { min: 0, max: 50 },
    knowledgeKey: "cadd",
    ...caddExtra,
  });

  {
    const signal = evaluatePopEve(popeve);
    const popAvail = resolveSourceAvailability({ source: "popEVE", refusals, value: popeve, status: null });
    readings.push({
      key: "popeve",
      name: "popEVE",
      description: "EVE and ESM-1v on one proteome-wide scale, calibrated with human population data.",
      group: "severity",
      chainKey: null,
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
      availability: statusAware(popeve, "popeve", () => fromAvailability(popAvail, null)),
      source: "popEVE precomputed tracks (evemodel.org)",
      knowledgeKey: "popeve",
      link: null,
    });
  }

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
      chainKey: null,
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
              pct !== null ? `Higher than ${fmtPercentAbove(pct)} of possible single-nucleotide changes` : null,
              alphagenome?.topModality ? `largest feature: ${alphagenome.topModality}` : null,
            ].filter(Boolean).join(" · ") || null
          : null,
      availability: statusAware(avi, "alphagenome", () => aviAvailabilityFor(fromAvailability(aviAvail, "configure-alphagenome"), alphagenome?.message ?? null)),
      source: "Google DeepMind AlphaGenome",
      knowledgeKey: "alphagenome",
      link: { tab: "alphagenome", label: "Open AlphaGenome" },
    });
  }

  // ── Conservation (informational) ──
  const conservation = (key: string, name: string, tool: CalibratedToolKey, score: number | null, scale: { min: number; max: number }, description: string) => {
    const call = calibratedCall(tool, score);
    const { label, tone } = callFromCalibrated(call);
    readings.push({
      key,
      name,
      description,
      group: "conservation",
      chainKey: null,
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
      availability: availFor(score, "base"),
      source: dbSource,
      knowledgeKey: key,
      link: null,
    });
  };
  conservation("phylop", "phyloP", "phylop", phylop, { min: -20, max: 10 }, "Base-wise conservation across the vertebrate alignment.");
  conservation("gerp", "GERP++", "gerp", gerp, { min: -12.3, max: 6.2 }, "Rejected substitutions at this base across mammals (RS).");
  readings.push({
    key: "scorecons",
    name: "Residue conservation",
    description: "How conserved this amino-acid position is across UniRef90 protein homologues (ScoreCons, 0 variable – 1 fully conserved).",
    group: "conservation",
    chainKey: null,
    score: scorecons,
    scoreText: fmt(scorecons, 2),
    unit: null,
    scale: { min: 0, max: 1 },
    orientation: "higher",
    cutpoints: NO_CUTS,
    signal: scorecons === null ? "unavailable" : "vus",
    calibrated: null,
    callLabel: scorecons === null ? NO_RESULT : "Informational",
    callTone: "muted",
    caveats: [],
    note: null,
    availability: statusAware(scorecons, "scorecons", () =>
      absent("ProtVar has no conservation score for this residue. It scores canonical UniProt positions only.", "No score")),
    source: "ProtVar (VarSite ScoreCons)",
    knowledgeKey: "scorecons",
    link: null,
  });

  // ── What the engine recorded ──
  const engineCriteria: Array<{ code?: string; reason?: string }> | null =
    (r.ruleBasedInsights?.acmgCriteria ?? r.insights?.acmgCriteria ?? null) as any;
  const weighting: string | null = r.metadata?.acmgWeighting ?? null;
  const recorded = engineCriteria?.find(c => typeof c?.code === "string" && /^(PP3|BP4)(_|$)/i.test(c.code)) ?? null;
  // The engine's own gates (`criteria.ts`): conservative weighting keeps a computational code only when
  // ClinVar's classification points the same way.
  const clinvarClass = classifyClinvar(result.clinvar?.classification);
  const corroborated = primary.direction === "PP3" ? clinvarClass === "plp" : primary.direction === "BP4" && clinvarClass === "blb";
  const weightingSuppresses = weighting === "strict-structural" || (weighting === "conservative" && !corroborated);
  const engine: EngineRecord = {
    known: engineCriteria !== null,
    code: recorded?.code ?? null,
    reason: recorded?.reason ?? null,
    weighting,
    withheldByWeighting: engineCriteria !== null && !recorded && primary.code !== null && weightingSuppresses,
  };

  return {
    readings,
    primary,
    engine,
    pending: readings.some(x => x.availability.state === "pending"),
  };
}

/** Readings grouped for the table, in display order. Empty groups are dropped. */
export function groupReadings(readings: PredictorReading[]): Array<{ group: PredictorGroup; rows: PredictorReading[] }> {
  const order: PredictorGroup[] = ["primary", "severity", "genome", "conservation"];
  return order
    .map(group => ({ group, rows: readings.filter(x => x.group === group) }))
    .filter(g => g.rows.length > 0);
}

export { predictorFinding, predictorSummary, type PredictorSummary } from "./predictorSummary.ts";


// ── Informational models: what they are, why they never set PP3/BP4 ──────────────────────────
//
// Each family states (a) what it measures, (b) why it is outside PP3/BP4, and (c) how to read it —
// in plain words, from the same readings the table renders.

export type InformationalGroup = Exclude<PredictorGroup, "primary">;

export const INFORMATIONAL_FAMILY: Record<InformationalGroup, { what: string; why: string; read: string }> = {
  severity: {
    what: "popEVE places every possible missense change in the human proteome on one scale, so a variant can be compared with variants in other genes. It combines an evolutionary model (EVE) and a protein language model (ESM-1v), adjusted with human population data.",
    why: "Its authors publish cut-points for deleterious changes only, so it can point one way but never the other. It also uses population data, which PM2 and BS1 already count.",
    read: "More negative means more severe. At or below −4.617 the authors call the change deleterious, and at or below −5.056 highly deleterious. A score above these is not a benign call.",
  },
  genome: {
    what: "Models that score a variant from DNA context rather than protein sequence alone: a rank of regulatory and splicing impact, a language model over a vertebrate alignment, or a combination of existing annotations.",
    why: "PP3/BP4 comes from one calibrated tool chosen in advance, not from a count. CADD has a published calibration but was not chosen, and it already uses conservation; the others are ranks with no ClinGen calibration.",
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
  const groups: InformationalGroup[] = ["severity", "genome", "conservation"];
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

/**
 * The shared copy for the local-agreement summary, so the tab card and the inspector rail hold the
 * same wording and cannot drift apart. Descriptive agreement is never ACMG evidence or a combined
 * pathogenicity score.
 */
export const LOCAL_AGREEMENT_COPY = {
  descriptive: "Descriptive agreement only. Correlated models are not independent evidence; these readings never change PP3 / BP4.",
  /** A calibrated tool's own code (CADD's PP3) is a published band, not a criterion here. */
  calibratedBand: "(published band, not counted)",
  /** Conservation and genome-wide scores have a direction, but no published band. */
  noBand: "No published band",
};

/**
 * The local agreement in words, plus the rows the caller may pin.
 *
 * The named field `descriptive` is what the shared
 * component renders; the `lead`/`tail` arrays remain the composed copy for callers that need one
 * string, so the wording cannot drift even though the chrome differs. Absent readings are stated
 * only when they exist — "none" is not a finding.
 */
export function localPredictorAgreement(evidence: PredictorEvidence) {
  const rows = evidence.readings.filter(r => r.chainKey === null);
  const scoredRows = rows.filter(r => r.score !== null);
  const unclassified = scoredRows.filter(r => !r.calibrated);
  const missing = rows.filter(r => r.score === null);
  const descriptive = `${scoredRows.length} of ${rows.length} informational readings scored. ${LOCAL_AGREEMENT_COPY.descriptive}`;
  return {
    total: rows.length,
    scored: scoredRows.length,
    descriptive,
    lead: [descriptive],
    tail: [
      ...(unclassified.length ? [`${LOCAL_AGREEMENT_COPY.noBand}: ${unclassified.map(r => r.name).join(", ")}.`] : []),
      ...(missing.length ? [`Not scored: ${missing.map(r => `${r.name} (${r.availability.label})`).join(", ")}.`] : []),
    ],
    // A calibrated informational tool keeps its published code only as a band name: naming it is not
    // counting it, and the section above says so. The code is formatted here, not in the renderer,
    // so the tab and the inspector cannot show `PP3_Moderate` in one place and `PP3 Moderate` in another.
    calibrated: scoredRows.filter(r => r.calibrated).map(r => ({
      reading: r,
      label: `${formatEvidenceCode(r.callLabel)} ${LOCAL_AGREEMENT_COPY.calibratedBand}`,
    })),
    unclassified,
    missing,
  };
}
