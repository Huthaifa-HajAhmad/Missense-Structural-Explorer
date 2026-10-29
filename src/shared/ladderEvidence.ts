/**
 * ladderEvidence.ts — the strength ladder and the rule trace behind it, for the Predictors tab and rail.
 *
 * ONE QUESTION: how strong is the evidence each tool gives this variant, on a scale every tool shares,
 * and which criteria did the engine record from it?
 *
 * It is what survives of the retired Score thresholds tab, which repeated the Predictors tab (same
 * readings, same vote, same rulers) and, around that, was a second classifier:
 *
 *   • It gave ΔΔG scores ACMG codes the engine never applies — FoldX a red PM1 chip (PM1 is a hotspot
 *     or functional-domain criterion; the engine reads it from UniProt sites), ThermoMPNN a green BP3
 *     chip (BP3 is an in-frame indel in a repeat). No ACMG/ClinGen rule takes a ΔΔG cut.
 *   • It gave gene constraint PP2 at missense Z ≥ 2.0 with a "strong ≥ 3.09" tier (PP2 has no Strong)
 *     and painted BP1 green for Z < 2 and for LOEUF ≥ 0.6. The engine's PP2 was then Z ≥ 3.09 AND
 *     o/e < 0.6 (uncalibrated); it is now the regional O/E with Chao et al. v3's calibrated edges. It
 *     never read LOEUF, and it no longer applies BP1 at all.
 *   • It rolled 20 heterogeneous, correlated scores into a "5–4 · Pathogenic concordance" verdict no
 *     rule computes, beside an engine that had voted 3–1 on a different set of tools.
 *
 * The ladder was the part worth keeping, so it moved here. Stability ΔΔG rows live in Energetics and
 * gene-constraint rows in the header bar; neither is an in-silico predictor, so neither is drawn here.
 *
 * INVARIANTS
 *   • In-silico readings, the vote and the engine's PP3/BP4 record come from `buildPredictorEvidence`
 *     — the Predictors tab's own model — so the tab, the ladder and the rail cannot count differently.
 *   • Every calibrated band comes from `calibration.ts`, the PP2 rule included (`regionalPp2Code`).
 *   • What the engine recorded is READ from its criteria list. Nothing here carries a code the engine
 *     did not apply.
 *   • A STRENGTH is only ever drawn for a tool with a ClinGen calibration. A tool with only its authors'
 *     cut-point gets a DIRECTION (benign side, between, pathogenic side), never a strength.
 */
import type { AnalysisResult } from "./contracts.ts";
import {
  CALIBRATION_SOURCES,
  PP3_BP4_CALIBRATION,
  STRENGTH_ORDER,
  calibratedCall,
  regionalPp2Code,
  type RegionalPp2Code,
  type CalibratedToolKey,
  type EvidenceStrength,
} from "./thresholds.ts";
import {
  buildPredictorEvidence,
  type EngineRecord,
  type PredictorEvidence,
  type PredictorReading,
} from "./predictorEvidence.ts";

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
  /** The cut-points in words, one line per side ("PP3 ≥ 0.644 · 0.773 · 0.932"). */
  cutLines: string[];
}

/** Which side of its authors' cut-point a score falls on. No strength is implied. */
export type DirectionSide = "benign" | "between" | "pathogenic";

export interface DirectionRow {
  key: string;
  name: string;
  /** Whose cut-point, e.g. "Li et al. 2022". */
  source: string;
  votes: boolean;
  side: DirectionSide | null;
  scoreText: string;
  availability: PredictorReading["availability"];
  /** The authors' cut-point in words ("≥ 0.5"). */
  cutText: string;
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

const SIDE_OF_SIGNAL: Record<PredictorReading["signal"], DirectionSide | null> = {
  pathogenic: "pathogenic",
  benign: "benign",
  vus: "between",
  unavailable: null,
};

/**
 * The ladder's rows and columns from the predictor model: the calibrated tools (strength), then the
 * tools that only have their authors' cut-point (direction). Together with the vote they are the
 * seven tools the engine counts plus ESM1b, phyloP and GERP++, which are calibrated but not counted.
 */
export function buildLadder(predictor: PredictorEvidence): { columns: LadderColumn[]; ladder: LadderRow[]; directional: DirectionRow[] } {
  const byKey = new Map(predictor.readings.map(r => [r.key, r]));
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
      cutLines: calibratedCutLines(tool),
    };
  });
  const directional: DirectionRow[] = predictor.readings
    .filter(r => r.cutpoints.kind === "authors")
    .map(r => ({
      key: r.key,
      name: r.name,
      source: r.cutpoints.source ?? "Authors",
      votes: r.votes,
      side: r.score === null ? null : SIDE_OF_SIGNAL[r.signal],
      scoreText: r.scoreText,
      availability: r.availability,
      cutText: r.cutpoints.marks.map(m => m.label.replace("-", "−")).join(" · "),
    }));
  return { columns, ladder, directional };
}

// ── Engine record for the criteria the ladder feeds ───────────────────────────────────────────

export interface ConstraintFacts {
  missenseZ: number | null;
  oeMis: number | null;
  pli: number | null;
  loeuf: number | null;
  /** O/E of the gnomAD regional interval holding the variant, the one PP2 input (calibration.ts). */
  regionalOe: number | null;
  /** Why there is or is not a regional O/E (constraintSource REGIONAL_STATUSES), when the payload says. */
  regionalStatus: string | null;
  /** The calibrated PP2 strength on that O/E; `null` assessed and below the band; `undefined` not assessable. */
  pp2Code: RegionalPp2Code | null | undefined;
  /** `pp2Code !== null` when assessable; `null` when not. */
  pp2RuleMet: boolean | null;
}

export interface LadderEngineRecord {
  known: boolean;
  /** PP3 / BP4 as `buildPredictorEvidence` reads it. */
  insilico: EngineRecord;
  /** The engine recorded PP2 (any strength). */
  pp2: boolean;
  /** The PP2 code as recorded ("PP2" / "PP2_Moderate"), or null. */
  pp2Code: string | null;
  /** PP2 recorded under the retired gene Z / o-e proxy (payload predates the calibrated rule). */
  pp2Stale: boolean;
  /** The payload carries a BP1 — only an earlier engine applied it automatically. */
  bp1Stale: boolean;
  /** Every computational code recorded, in display order. */
  codes: string[];
}

export interface LadderEvidence {
  predictor: PredictorEvidence;
  columns: LadderColumn[];
  ladder: LadderRow[];
  directional: DirectionRow[];
  constraint: ConstraintFacts;
  engine: LadderEngineRecord;
  /** Calibrated tools that reached a band, by side. */
  calibratedReached: { pp3: LadderRow[]; bp4: LadderRow[]; indeterminate: LadderRow[]; missing: LadderRow[] };
}

export interface LadderEvidenceInput {
  result: AnalysisResult;
  isLoading?: boolean;
  isModelLoading?: boolean;
  alphagenomeConfigured?: boolean;
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Same inputs as `buildPredictorEvidence`; pass `predictor` to reuse one already built. */
export function buildLadderEvidence(input: LadderEvidenceInput & { predictor?: PredictorEvidence }): LadderEvidence {
  const { result } = input;
  const predictor =
    input.predictor ??
    buildPredictorEvidence({
      result,
      isLoading: input.isLoading,
      isModelLoading: input.isModelLoading,
      alphagenomeConfigured: input.alphagenomeConfigured,
    });
  const r = result as any;
  const { columns, ladder, directional } = buildLadder(predictor);
  const calibratedReached = {
    pp3: ladder.filter(l => l.at?.startsWith("PP3")),
    bp4: ladder.filter(l => l.at?.startsWith("BP4")),
    indeterminate: ladder.filter(l => l.at === "none"),
    missing: ladder.filter(l => l.at === null),
  };

  // ── Gene constraint (PP2 input) ──
  const gc = result.gnomadConstraint ?? null;
  const missenseZ = finite(gc?.missense_z ?? r.misZ ?? r.gnomadMisZ);
  const oeMis = finite(gc?.oe_mis);
  const pli = finite(gc?.pli);
  const loeuf = finite(gc?.loeuf ?? r.loeuf ?? r.gnomadLoeuf);
  const regionalOe = finite(gc?.regionalConstraint?.oeRatio);
  const pp2Code = regionalPp2Code(regionalOe);
  const constraint: ConstraintFacts = {
    missenseZ, oeMis, pli, loeuf, regionalOe, regionalStatus: gc?.regionalStatus ?? null, pp2Code,
    pp2RuleMet: pp2Code === undefined ? null : pp2Code !== null,
  };

  // ── Engine record ──
  const criteria: Array<{ code?: string }> | null = (r.ruleBasedInsights?.acmgCriteria ?? r.insights?.acmgCriteria ?? null) as any;
  const has = (re: RegExp) => !!criteria?.some(c => typeof c?.code === "string" && re.test(c.code));
  const recordedPp2 = criteria?.find(c => typeof c?.code === "string" && /^PP2(_|$)/.test(c.code))?.code ?? null;
  const pp2 = recordedPp2 !== null;
  // A payload written before the calibrated rule carries no `pp2Code`; its PP2 came from gene Z.
  const pp2Stale = pp2 && gc !== null && gc.pp2Code === undefined;
  const bp1Stale = has(/^BP1(_|$)/);
  const codes = [predictor.engine.code, recordedPp2, bp1Stale ? "BP1" : null].filter((c): c is string => !!c);
  const engine: LadderEngineRecord = { known: criteria !== null, insilico: predictor.engine, pp2, pp2Code: recordedPp2, pp2Stale, bp1Stale, codes };

  return { predictor, columns, ladder, directional, constraint, engine, calibratedReached };
}

/** The PP2 rule the engine applies, for display: regional O/E edges and their source. */
export { REGIONAL_MISSENSE_CALIBRATION as PP2_RULE, REGIONAL_MISSENSE_SOURCE as PP2_SOURCE } from "./thresholds.ts";

/** Short words for why a variant has no regional O/E (constraintSource REGIONAL_STATUSES). */
export const REGIONAL_STATUS_WORDS: Record<string, string> = {
  "unverified-locus": "locus not verified",
  "transcript-mismatch": "transcript not in the release",
  "failed-qc": "interval failed QC",
  "invalid-data": "invalid interval data",
  "no-regions": "no intervals for this transcript",
  "outside-region": "outside every interval",
};
