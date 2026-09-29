/**
 * thresholdEvidence.ts — one model of the Score thresholds tab, for the tab and its rail.
 *
 * ONE QUESTION: which published cut-points decide this variant's computational ACMG criteria, where
 * does the variant sit on each, and what did the engine record?
 *
 * It replaced `thresholds/guidelines.ts`, whose row builder was a second classifier:
 *
 *   • It gave ΔΔG scores ACMG codes the engine never applies — FoldX a red PM1 chip (PM1 is a hotspot
 *     or functional-domain criterion; the engine reads it from UniProt sites), ThermoMPNN a green BP3
 *     chip (BP3 is an in-frame indel in a repeat). No ACMG/ClinGen rule takes a ΔΔG cut.
 *   • It gave gene constraint PP2 at missense Z ≥ 2.0 with a "strong ≥ 3.09" tier (PP2 has no Strong)
 *     and painted BP1 green for Z < 2 and for LOEUF ≥ 0.6. The engine's PP2 is Z ≥ 3.09 AND
 *     o/e < 0.6; it never read LOEUF; and it no longer applies BP1 at all.
 *   • It rolled 20 heterogeneous, correlated scores into a "5–4 · Pathogenic concordance" verdict no
 *     rule computes, beside an engine that had voted 3–1 on a different set of tools.
 *   • It re-tested RaSP at FoldX's 0.5 while every other surface uses RaSP's 1.0, painted a
 *     stabilising ΔΔG benign green, and dropped the AF / ClinVar caveats on MetaRNN and ClinPred.
 *
 * INVARIANTS
 *   • In-silico readings, the vote and the engine's PP3/BP4 record come from `buildPredictorEvidence`
 *     — the Predictors tab's own model — so the two tabs cannot count differently.
 *   • Every calibrated band comes from `calibration.ts`; every ΔΔG from `toCanonicalDdg` and the
 *     engine descriptors in `engineStatus.ts`; the PP2 rule from `isPp2Constrained`.
 *   • What the engine recorded is READ from its criteria list. A ΔΔG, LOEUF or conservation score
 *     carries no code here unless the engine applied one.
 *   • Every cut-point says what kind it is: ClinGen-calibrated, the authors', a local mark, or none.
 */
import type { AnalysisResult, EnergeticsData } from "./contracts.ts";
import {
  CALIBRATION_SOURCES,
  PP3_BP4_CALIBRATION,
  STRENGTH_ORDER,
  THRESHOLDS,
  calibratedCall,
  formatEvidenceCode,
  isPp2Constrained,
  type CalibratedToolKey,
  type EvidenceStrength,
} from "./thresholds.ts";
import {
  buildPredictorEvidence,
  type EngineRecord,
  type PredictorEvidence,
  type PredictorReading,
} from "./predictorEvidence.ts";
import { ENGINE_STATE_LABELS, getEngine, toCanonicalDdg, type EnergyEngineId } from "./engineStatus.ts";

const NO_RESULT = ENGINE_STATE_LABELS["no-result"];

// ── ClinGen point scale (reference) ────────────────────────────────────────────────────────────

/** Tavtigian et al. 2020, Hum Mutat 41:1734. Pathogenic positive, benign negative. */
export const CLINGEN_POINTS: Record<EvidenceStrength, number> = {
  Supporting: 1,
  Moderate: 2,
  Strong: 4,
  VeryStrong: 8,
};

/** Tavtigian 2020 class bands on the summed points: P ≥ 10, LP 6–9, VUS 0–5, LB −1…−6, B ≤ −7. */
export const CLINGEN_CLASS_BANDS: ReadonlyArray<{ id: "B" | "LB" | "VUS" | "LP" | "P"; label: string; min: number | null; max: number | null }> = [
  { id: "B", label: "Benign", min: null, max: -7 },
  { id: "LB", label: "Likely benign", min: -6, max: -1 },
  { id: "VUS", label: "Uncertain", min: 0, max: 5 },
  { id: "LP", label: "Likely pathogenic", min: 6, max: 9 },
  { id: "P", label: "Pathogenic", min: 10, max: null },
];

export const TAVTIGIAN_2020 = {
  short: "Tavtigian et al. 2020",
  citation: "Tavtigian SV, et al. Fitting a naturally scaled point system to the ACMG/AMP variant classification guidelines. Hum Mutat 2020;41:1734–1737.",
  doi: "10.1002/humu.24088",
};

export const RICHARDS_2015 = {
  short: "Richards et al. 2015",
  citation: "Richards S, et al. Standards and guidelines for the interpretation of sequence variants. Genet Med 2015;17:405–424.",
  doi: "10.1038/gim.2015.30",
};

// ── Strength ladder ────────────────────────────────────────────────────────────────────────────

/** A column of the ladder: one ClinGen strength on one side, or the indeterminate middle. */
export interface LadderColumn {
  id: string;
  direction: "BP4" | "PP3" | null;
  strength: EvidenceStrength | null;
  /** Signed ClinGen points (Tavtigian 2020); 0 for the middle. */
  points: number;
  label: string;
}

export interface LadderRow {
  key: string;
  name: string;
  source: string;
  /** Counted by the engine's PP3/BP4 vote. */
  votes: boolean;
  /** Column ids this tool's published calibration can reach. */
  reachable: string[];
  /** Column id the variant reached, or `null` with no score. */
  at: string | null;
  scoreText: string;
  availability: PredictorReading["availability"];
}

const LADDER_TOOLS: Array<{ key: string; tool: CalibratedToolKey }> = [
  { key: "revel", tool: "revel" },
  { key: "cadd", tool: "cadd" },
  { key: "bayesdel", tool: "bayesdel" },
  { key: "am", tool: "alphaMissense" },
  { key: "esm", tool: "esm1b" },
  { key: "phylop", tool: "phylop" },
  { key: "gerp", tool: "gerp" },
];

const STRENGTH_WORD: Record<EvidenceStrength, string> = {
  Supporting: "Supporting",
  Moderate: "Moderate",
  Strong: "Strong",
  VeryStrong: "Very strong",
};

const colId = (direction: "BP4" | "PP3", strength: EvidenceStrength) => `${direction}:${strength}`;

/** Columns from the union of strengths the calibrated tools publish, BP4 strongest → PP3 strongest. */
function ladderColumns(): LadderColumn[] {
  const has = (side: "pp3" | "bp4", s: EvidenceStrength) => LADDER_TOOLS.some(t => PP3_BP4_CALIBRATION[t.tool][side][s] !== undefined);
  const benign = STRENGTH_ORDER.filter(s => has("bp4", s)).map<LadderColumn>(s => ({
    id: colId("BP4", s), direction: "BP4", strength: s, points: -CLINGEN_POINTS[s], label: STRENGTH_WORD[s],
  }));
  const path = [...STRENGTH_ORDER].reverse().filter(s => has("pp3", s)).map<LadderColumn>(s => ({
    id: colId("PP3", s), direction: "PP3", strength: s, points: CLINGEN_POINTS[s], label: STRENGTH_WORD[s],
  }));
  return [...benign, { id: "none", direction: null, strength: null, points: 0, label: "Neither" }, ...path];
}

// ── Readings ───────────────────────────────────────────────────────────────────────────────────

export type ThresholdGroup = "vote" | "calibrated" | "constraint" | "stability" | "uncalibrated";

export const THRESHOLD_GROUP_LABEL: Record<ThresholdGroup, string> = {
  vote: "Counted by the PP3/BP4 vote",
  calibrated: "Calibrated, not counted",
  constraint: "Gene constraint",
  stability: "Stability ΔΔG",
  uncalibrated: "No published cut-point",
};

export const THRESHOLD_GROUP_NOTE: Record<ThresholdGroup, string> = {
  vote: "Plurality of calls decides PP3 or BP4, at Supporting strength",
  calibrated: "ClinGen bands exist; the engine does not vote these",
  constraint: "PP2 input · the same for every variant in the gene",
  stability: "Not an ACMG input · marks are local",
  uncalibrated: "Shown, never classified",
};

export interface ThresholdRow {
  reading: PredictorReading;
  group: ThresholdGroup;
  /** The cut-points in words, one line per side ("PP3 ≥ 0.644 · 0.773 · 0.932"). */
  cutLines: string[];
  /** What kind of cut-point, and whose ("ClinGen · Pejaver et al. 2022", "Local mark"). */
  cutSource: string | null;
}

const fmtCut = (n: number) => {
  const s = Math.abs(n) >= 10 ? n.toFixed(1) : Number(n.toFixed(3)).toString();
  return s.replace("-", "−");
};

/** "PP3 ≥ 0.644 · 0.773 · 0.932" / "BP4 ≤ 0.290 · 0.183 · …", weakest first, or "No PP3 band". */
export function calibratedCutLines(tool: CalibratedToolKey): string[] {
  const b = PP3_BP4_CALIBRATION[tool];
  const high = b.orientation === "higher";
  const line = (side: "pp3" | "bp4") => {
    const code = side === "pp3" ? "PP3" : "BP4";
    const vals = [...STRENGTH_ORDER].reverse().map(s => b[side][s]).filter((v): v is number => v !== undefined);
    if (vals.length === 0) return `No ${code} band`;
    const op = (side === "pp3") === high ? "≥" : "≤";
    return `${code} ${op} ${vals.map(fmtCut).join(" · ")}`;
  };
  return [line("pp3"), line("bp4")];
}

const CALIBRATED_TOOL_BY_KEY: Record<string, CalibratedToolKey> = Object.fromEntries(LADDER_TOOLS.map(t => [t.key, t.tool]));

function cutSourceOf(r: PredictorReading): string | null {
  switch (r.cutpoints.kind) {
    case "calibrated": return `ClinGen · ${r.cutpoints.source}`;
    case "authors": return `Authors' cut${r.cutpoints.source ? ` · ${r.cutpoints.source}` : ""}`;
    case "local": return "Local mark · no published cut-point";
    default: return null;
  }
}

function predictorRow(r: PredictorReading, group: ThresholdGroup): ThresholdRow {
  const tool = CALIBRATED_TOOL_BY_KEY[r.key];
  const cutLines = tool
    ? calibratedCutLines(tool)
    : r.cutpoints.marks.length
      ? [r.cutpoints.marks.map(m => m.label.replace("-", "−")).join(" · ") + (r.caveats.includes("no-benign-cut") ? ", no benign cut" : "")]
      : [];
  return { reading: r, group, cutLines, cutSource: cutSourceOf(r) };
}

// ── Gene constraint ───────────────────────────────────────────────────────────────────────────

export interface ConstraintFacts {
  missenseZ: number | null;
  oeMis: number | null;
  pli: number | null;
  loeuf: number | null;
  /** The engine's PP2 rule on these values; `null` when an input is missing. */
  pp2RuleMet: boolean | null;
}

// ── Engine record for the criteria these cut-points feed ──────────────────────────────────────

export interface ThresholdEngineRecord {
  known: boolean;
  /** PP3 / BP4 as `buildPredictorEvidence` reads it. */
  insilico: EngineRecord;
  /** The engine recorded PP2. */
  pp2: boolean;
  /** The payload carries a BP1 — only an earlier engine applied it automatically. */
  bp1Stale: boolean;
  /** Every computational code recorded, in display order. */
  codes: string[];
}

export interface ThresholdEvidence {
  predictor: PredictorEvidence;
  columns: LadderColumn[];
  ladder: LadderRow[];
  rows: ThresholdRow[];
  constraint: ConstraintFacts;
  engine: ThresholdEngineRecord;
  /** Calibrated tools that reached a band, by side. */
  calibratedReached: { pp3: LadderRow[]; bp4: LadderRow[]; indeterminate: LadderRow[]; missing: LadderRow[] };
  stability: { scored: number; total: number; destabilising: ThresholdRow[] };
}

export interface ThresholdEvidenceInput {
  result: AnalysisResult;
  /** FoldX ΔΔG, canonical sign (positive = destabilising). */
  foldingDdG?: number | null;
  foldingEnergetics?: EnergeticsData | null;
  isLoading?: boolean;
  isModelLoading?: boolean;
  /** The biophysical pipeline (FoldX, BioSig, ThermoMPNN) is still running. */
  isStabilityLoading?: boolean;
  alphagenomeConfigured?: boolean;
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const STABILITY_DESCRIPTION: Record<EnergyEngineId, string> = {
  foldx: "Empirical force field with side-chain repacking on the predicted structure.",
  dynamut2: "Normal-mode dynamics combined with a trained stability model (BioSig).",
  ddmut: "Graph and transformer network over atomic density (BioSig).",
  rasp: "Precomputed Rosetta-trained stability profile for a curated protein set.",
  thermompnn: "ProteinMPNN embeddings trained on large experimental stability sets.",
  stabilityoracle: "Geometric graph transformer over wild-type and mutant structures.",
};

export function buildThresholdEvidence(input: ThresholdEvidenceInput): ThresholdEvidence {
  const { result, foldingEnergetics = null, isLoading = false, isStabilityLoading = false } = input;
  const predictor = buildPredictorEvidence({
    result,
    isLoading,
    isModelLoading: input.isModelLoading,
    alphagenomeConfigured: input.alphagenomeConfigured,
  });
  const byKey = new Map(predictor.readings.map(r => [r.key, r]));
  const r = result as any;

  // ── Ladder ──
  const columns = ladderColumns();
  const ladder: LadderRow[] = LADDER_TOOLS.map(({ key, tool }) => {
    const reading = byKey.get(key)!;
    const b = PP3_BP4_CALIBRATION[tool];
    const reachable = [
      ...STRENGTH_ORDER.filter(s => b.bp4[s] !== undefined).map(s => colId("BP4", s)),
      "none",
      ...STRENGTH_ORDER.filter(s => b.pp3[s] !== undefined).map(s => colId("PP3", s)),
    ];
    const call = calibratedCall(tool, reading.score);
    const at = call === null ? null : call.direction && call.strength ? colId(call.direction, call.strength) : "none";
    return {
      key,
      name: reading.name,
      source: CALIBRATION_SOURCES[b.source].short,
      votes: reading.votes,
      reachable,
      at,
      scoreText: reading.scoreText,
      availability: reading.availability,
    };
  });
  const calibratedReached = {
    pp3: ladder.filter(l => l.at?.startsWith("PP3")),
    bp4: ladder.filter(l => l.at?.startsWith("BP4")),
    indeterminate: ladder.filter(l => l.at === "none"),
    missing: ladder.filter(l => l.at === null),
  };

  // ── Rows: in-silico ──
  const rows: ThresholdRow[] = [];
  for (const reading of predictor.readings) {
    if (reading.votes) rows.push(predictorRow(reading, "vote"));
  }
  for (const key of ["esm", "phylop", "gerp"]) {
    const reading = byKey.get(key);
    if (reading) rows.push(predictorRow(reading, "calibrated"));
  }

  // ── Rows: gene constraint ──
  const gc = result.gnomadConstraint ?? null;
  const missenseZ = finite(gc?.missense_z ?? r.misZ ?? r.gnomadMisZ);
  const oeMis = finite(gc?.oe_mis);
  const pli = finite(gc?.pli);
  const loeuf = finite(gc?.loeuf ?? r.loeuf ?? r.gnomadLoeuf);
  const pp2RuleMet = isPp2Constrained(missenseZ, oeMis) ?? (typeof gc?.isPP2Constrained === "boolean" && missenseZ === null ? gc.isPP2Constrained : null);
  const constraint: ConstraintFacts = { missenseZ, oeMis, pli, loeuf, pp2RuleMet };
  const gnomadAvail = (v: number | null): PredictorReading["availability"] =>
    v !== null ? { state: "available", label: null, reason: null, action: null }
    : isLoading ? { state: "pending", label: ENGINE_STATE_LABELS.running, reason: null, action: null }
    : { state: "absent", label: NO_RESULT, reason: gc ? "gnomAD reports no value for this gene." : "gnomAD gene constraint did not reach this analysis.", action: null };
  const base = (over: Partial<PredictorReading> & Pick<PredictorReading, "key" | "name" | "score">): PredictorReading => ({
    description: "",
    group: "conservation",
    votes: false,
    scoreText: "—",
    unit: null,
    scale: { min: 0, max: 1 },
    orientation: "higher",
    cutpoints: { kind: "none", source: null, bands: [], marks: [] },
    signal: over.score === null ? "unavailable" : "vus",
    calibrated: null,
    callLabel: NO_RESULT,
    callTone: "muted",
    caveats: [],
    note: null,
    availability: gnomadAvail(over.score),
    source: "gnomAD v4 gene constraint",
    knowledgeKey: null,
    link: null,
    ...over,
  });
  const PP2 = THRESHOLDS.pp2Constraint;
  rows.push({
    group: "constraint",
    cutLines: [`PP2 needs Z ≥ ${PP2.missenseZ} and o/e < ${PP2.oeMisBelow}`],
    cutSource: "Engine rule · local proxy",
    reading: base({
      key: "misZ",
      name: "Missense Z",
      description: "Depletion of missense variants in the gene versus expectation.",
      score: missenseZ,
      scoreText: missenseZ !== null ? missenseZ.toFixed(2) : "—",
      scale: { min: -2, max: 6 },
      cutpoints: { kind: "local", source: null, bands: [], marks: [{ value: PP2.missenseZ, side: "path", label: `≥ ${PP2.missenseZ}` }] },
      note: oeMis !== null ? `Missense o/e ${oeMis.toFixed(2)}` : null,
      callLabel: missenseZ === null ? NO_RESULT : pp2RuleMet === true ? "PP2 rule met" : pp2RuleMet === false ? "PP2 not met" : "o/e missing",
      callTone: missenseZ === null ? "muted" : pp2RuleMet === true ? "danger" : "neutral",
      knowledgeKey: "misZ",
    }),
  });
  rows.push({
    group: "constraint",
    cutLines: ["< 0.6 constrained"],
    cutSource: "gnomAD guidance · not read by the engine",
    reading: base({
      key: "loeuf",
      name: "LOEUF",
      description: "Loss-of-function constraint. Context for the gene, not missense evidence.",
      score: loeuf,
      scoreText: loeuf !== null ? loeuf.toFixed(2) : "—",
      scale: { min: 0, max: 2 },
      orientation: "lower",
      cutpoints: { kind: "authors", source: "gnomAD", bands: [], marks: [{ value: 0.6, side: "path", label: "< 0.6" }] },
      note: pli !== null ? `pLI ${pli.toFixed(2)}` : null,
      callLabel: loeuf === null ? NO_RESULT : "Context only",
      callTone: "muted",
      knowledgeKey: "loeuf",
    }),
  });

  // ── Rows: stability (canonical sign, positive = destabilising) ──
  const e = foldingEnergetics as any;
  const raw: Array<[EnergyEngineId, number | null]> = [
    ["foldx", finite(input.foldingDdG)],
    ["dynamut2", finite(r.dynamut2 ?? e?.dynamut2)],
    ["ddmut", finite(r.ddmut ?? e?.ddmut)],
    ["rasp", finite(r.rasp ?? e?.rasp)],
    ["thermompnn", finite(e?.thermompnn ?? r.thermompnn)],
  ];
  const stabilityRows: ThresholdRow[] = raw.map(([id, value]) => {
    const eng = getEngine(id);
    // FoldX arrives canonical already (`foldingDdG`); the others are the provider's raw value.
    const ddg = id === "foldx" ? value : toCanonicalDdg(id, value);
    const marks = id === "foldx"
      ? [
          { value: eng.stabilizingCut, side: "benign" as const, label: `${fmtCut(eng.stabilizingCut)}` },
          { value: eng.supportingCut, side: "path" as const, label: `+${fmtCut(eng.supportingCut)}` },
          { value: eng.strongCut, side: "path" as const, label: `+${fmtCut(eng.strongCut)}` },
        ]
      : [{ value: eng.strongCut, side: "path" as const, label: `+${fmtCut(eng.strongCut)}` }];
    const call =
      ddg === null ? NO_RESULT
      : ddg >= eng.strongCut ? "Destabilising"
      : ddg <= eng.stabilizingCut ? "Stabilising"
      : id === "foldx" && ddg > eng.supportingCut ? "Mildly destabilising"
      : "Below mark";
    const reading: PredictorReading = {
      key: id,
      name: eng.name,
      description: STABILITY_DESCRIPTION[id],
      group: "conservation",
      votes: false,
      score: ddg,
      scoreText: ddg === null ? "—" : ddg.toFixed(2),
      unit: "kcal/mol",
      scale: { min: -3, max: 3 },
      orientation: "higher",
      cutpoints: { kind: "local", source: null, bands: [], marks },
      signal: ddg === null ? "unavailable" : "vus",
      calibrated: null,
      callLabel: call,
      callTone: ddg === null ? "muted" : "neutral",
      caveats: [],
      note: null,
      availability:
        ddg !== null ? { state: "available", label: null, reason: null, action: null }
        : isLoading || isStabilityLoading ? { state: "pending", label: ENGINE_STATE_LABELS.running, reason: null, action: null }
        : { state: "absent", label: NO_RESULT, reason: "No value reached this analysis; the Energetics view says why.", action: null },
      source: eng.name,
      knowledgeKey: id === "foldx" ? "foldxDdG" : id,
      link: null,
    };
    const cut = marks.map(m => (m.value > 0 ? `+${fmtCut(m.value)}` : fmtCut(m.value))).join(" · ");
    return {
      reading,
      group: "stability",
      cutLines: [`${cut} kcal/mol`],
      cutSource: "Local mark · no published cut-point",
    };
  });
  rows.push(...stabilityRows);

  // ── Rows: no published cut-point ──
  for (const reading of predictor.readings) {
    if (!reading.votes && reading.cutpoints.kind !== "calibrated" && reading.key !== "consurf") {
      rows.push(predictorRow(reading, "uncalibrated"));
    }
  }

  // ── Engine record ──
  const criteria: Array<{ code?: string }> | null = (r.ruleBasedInsights?.acmgCriteria ?? r.insights?.acmgCriteria ?? null) as any;
  const has = (re: RegExp) => !!criteria?.some(c => typeof c?.code === "string" && re.test(c.code));
  const pp2 = has(/^PP2(_|$)/);
  const bp1Stale = has(/^BP1(_|$)/);
  const codes = [predictor.engine.code, pp2 ? "PP2" : null, bp1Stale ? "BP1" : null].filter((c): c is string => !!c);
  const engine: ThresholdEngineRecord = { known: criteria !== null, insilico: predictor.engine, pp2, bp1Stale, codes };

  return {
    predictor,
    columns,
    ladder,
    rows,
    constraint,
    engine,
    calibratedReached,
    stability: {
      scored: stabilityRows.filter(s => s.reading.score !== null).length,
      total: stabilityRows.length,
      destabilising: stabilityRows.filter(s => s.reading.callLabel === "Destabilising"),
    },
  };
}

/** Rows grouped for the table, in display order; empty groups dropped. */
export function groupThresholdRows(rows: ThresholdRow[]): Array<{ group: ThresholdGroup; rows: ThresholdRow[] }> {
  const order: ThresholdGroup[] = ["vote", "calibrated", "constraint", "stability", "uncalibrated"];
  return order.map(group => ({ group, rows: rows.filter(x => x.group === group) })).filter(g => g.rows.length > 0);
}

/** A list in words: "CADD and phyloP", "REVEL, CADD and phyloP". */
function names(list: Array<{ name: string }>): string {
  const n = list.map(l => l.name);
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/**
 * The finding in words. The lead says what the engine recorded (or that the payload carries no
 * record); the rest says where the calibrated tools landed and what the other cut-points decide.
 */
export function thresholdFinding(ev: ThresholdEvidence): { lead: string; rest: string[] } {
  const { engine, predictor, calibratedReached: c, constraint } = ev;
  const vote = predictor.vote;
  let lead: string;
  if (!engine.known) {
    lead = vote.code
      ? `The vote supports ${vote.code}; this result carries no engine record to confirm it`
      : "This result carries no engine record, and the vote supports neither PP3 nor BP4";
  } else {
    const insilico = engine.insilico.code
      ? `${formatEvidenceCode(engine.insilico.code)}${engine.insilico.code === "PP3" || engine.insilico.code === "BP4" ? " at Supporting strength" : ""} from the in-silico vote`
      : engine.insilico.withheldByWeighting
        ? `no in-silico criterion (the ${engine.insilico.weighting} weighting withholds the vote's ${vote.code})`
        : "no in-silico criterion";
    const others = engine.pp2 ? " and PP2 from gene constraint" : ", and no other computational criterion";
    lead = `The engine applied ${insilico}${others}`;
  }
  const scoredCal = ev.ladder.length - c.missing.length;
  const parts: string[] = [];
  if (c.pp3.length) parts.push(`${names(c.pp3)} ${c.pp3.length === 1 ? "reaches" : "reach"} a PP3 band`);
  if (c.bp4.length) parts.push(`${names(c.bp4)} ${c.bp4.length === 1 ? "reaches" : "reach"} BP4`);
  if (c.indeterminate.length) parts.push(`${c.indeterminate.length} ${c.indeterminate.length === 1 ? "is" : "are"} indeterminate`);
  const calSentence =
    scoredCal === 0
      ? `None of the ${ev.ladder.length} ClinGen-calibrated tools has a score yet.`
      : `Of the ${ev.ladder.length} ClinGen-calibrated tools, ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}` : parts[0]}${c.missing.length ? `; ${c.missing.length} ${c.missing.length === 1 ? "has" : "have"} no result` : ""}.`;
  const rest = [calSentence];
  if (!engine.pp2) {
    rest.push(
      constraint.missenseZ === null
        ? "Gene constraint did not reach this analysis, so PP2 could not be tested; stability ΔΔG decides no criterion."
        : "The gene-constraint and stability cut-points below decide nothing for this variant.",
    );
  }
  return { lead: `${lead}.`, rest };
}

/**
 * The one disagreement a curator must reconcile, or `null`: the calibrated reference (REVEL, else
 * BayesDel) reads the other way from the vote, or reaches a band the vote does not.
 */
export function thresholdDisagreement(ev: ThresholdEvidence): string | null {
  const ref = ev.predictor.reference;
  const vote = ev.predictor.vote;
  if (!ref || !ref.call.direction) return null;
  if (ref.relation !== "opposes" && ref.relation !== "no-vote") return null;
  const uncalibrated = ev.predictor.voters[vote.code === "PP3" ? "pathogenic" : "benign"].filter(v => v.cutpoints.kind !== "calibrated");
  const calibrated = ev.predictor.voters[vote.code === "PP3" ? "pathogenic" : "benign"].filter(v => v.cutpoints.kind === "calibrated");
  const band = formatEvidenceCode(ref.call.code);
  if (!vote.code) return `${ref.name}, the calibrated reference, reads ${band} on its own, which the vote does not reflect.`;
  const rests = [
    calibrated.length ? names(calibrated) : null,
    uncalibrated.length ? `${names(uncalibrated)}, ${uncalibrated.length === 1 ? "an uncalibrated tool" : "uncalibrated tools"}${uncalibrated.some(u => u.caveats.includes("uses-af")) ? " that use allele frequency" : ""}` : null,
  ].filter(Boolean).join(" plus ");
  return `${ref.name}, the calibrated reference, reads ${band}. The vote's ${vote.code} rests on ${rests}.`;
}
