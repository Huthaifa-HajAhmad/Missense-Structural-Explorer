/**
 * insightsEvidence.ts — the consolidated case for one variant, for the Insights tab and its rail.
 *
 * ONE QUESTION: after reading every evidence tab, where does the evidence leave this variant, and
 * what would move it?
 *
 * Insights is a consolidator. It adds no science: each lane below is the recorded call of a tab that
 * already has a pure model (`buildPredictorEvidence`, `buildFrequencyEvidence`, `buildSplicingEvidence`,
 * `buildFunctionEvidence`, the stability consensus). The only verdict is the rule engine's tier.
 *
 * INVARIANTS
 *   • No composite score. None of these tools is calibrated to be added, so nothing here sums or
 *     averages lanes. A lane is "counted" only when the ENGINE recorded a code for it.
 *   • The tier is the engine's record; when the record and the current combining rule disagree, that
 *     is stated (an earlier engine classified the payload), never silently resolved.
 *   • Model proposals never count. A proposal for a code the engine owns is dropped (see
 *     `ENGINE_OWNED_CODES`); one for a code the engine cannot compute is listed, dashed, uncounted.
 *   • "What would move it" is found by running the engine's own `classifyVariant` on hypothetical
 *     additions, so it cannot describe a rule the engine does not apply.
 *
 * Defects this replaced (doc/INSIGHTS_TAB_REVIEW.md): a verdict badge that listed model-proposed codes
 * the tier never used; a model PM2 shown beside an engine that had not fired it; prose "reconciled"
 * with rules it was never checked against.
 */
import type { AnalysisResult } from "./contracts.ts";
import { classifyVariant, codeWeight } from "./acmgClassifier.ts";
import {
  acmgCriteriaView,
  baseAcmgCode,
  partitionCriteria,
  type AcmgCriteriaView,
} from "./acmgCriteriaView.ts";
import { buildPredictorEvidence } from "./predictorEvidence.ts";
import { buildFrequencyEvidence, frequencyEvidenceInputFromResult } from "./frequencyEvidence.ts";
import { buildSplicingEvidence } from "./splicingEvidence.ts";
import { buildFunctionEvidence, type FunctionEvidenceInput } from "./functionEvidence.ts";
import { buildInterfacesEvidence, isStaleAssembly } from "./interfacesEvidence.ts";
import { THRESHOLDS, formatEvidenceCode } from "./thresholds.ts";
import { deriveNarrativeAuthorship, type NarrativeAuthorship } from "./narrativeAuthorship.ts";
import { NARRATIVE_PROMPT_EVIDENCE } from "./narrativeSynthesis.ts";

export type LaneKey =
  | "computational"
  | "population"
  | "splicing"
  | "function"
  | "stability"
  | "assembly"
  | "language-models";

export type Lean = "pathogenic" | "benign" | "none";

/** Evidence tab ids, as `EVIDENCE_SUB_ITEMS` names them. */
export type EvidenceTabId = "clinical" | "gene-disease" | "expression-models" | "function" | "predictors" | "alphagenome" | "splicing" | "structure" | "perturbation" | "interfaces";

export interface LaneLink { label: string; tab: EvidenceTabId }

export interface Lane {
  key: LaneKey;
  name: string;
  links: LaneLink[];
  /** Which way the tab's own call leans. `none` = no call, or a call that points nowhere. */
  lean: Lean;
  /** The engine recorded a code for this lane. Only counted lanes enter the tier. */
  counted: boolean;
  /** The code the engine recorded, e.g. "PP3", or null. */
  code: string | null;
  /** 1 Supporting, 2 Moderate, 3 Strong or above; 1 for an uncounted lane (a short tick, not a magnitude). */
  length: 1 | 2 | 3;
  /** The tab supports a code the engine did not record. */
  unconfirmed: boolean;
  state: "read" | "pending" | "absent";
  lead: string;
  rest: string;
}

export interface StabilityInput {
  verdict: string;
  enginesCounted: number;
  enginesDestabilizing: number;
}

export interface InsightsEvidenceInput {
  result: AnalysisResult;
  /** The function tab's own input assembly (`functionEvidenceInputFrom`), passed in to keep this module pure. */
  functionInput: FunctionEvidenceInput;
  /** The stability consensus the Energetics tab shows, from `computeStabilityConsensus`. */
  stability: StabilityInput | null;
  isLoading?: boolean;
  /**
   * The narrative is the pipeline's degraded rule-based report (`isFallbackNarrative`, a client service
   * this module may not import). A degraded run can never be AI-authored, whatever the payload says.
   */
  narrativeDegraded?: boolean;
}

export const TIERS = ["Benign", "Likely benign", "Uncertain", "Likely pathogenic", "Pathogenic"] as const;
export type TierLabel = (typeof TIERS)[number];

export function tierIndexOf(verdict: string): number {
  const v = verdict.toLowerCase();
  if (v.includes("likely benign")) return 1;
  if (v.includes("benign")) return 0;
  if (v.includes("likely pathogenic")) return 3;
  if (v.includes("pathogenic")) return 4;
  return 2;
}

export interface TierGap {
  side: "pathogenic" | "benign";
  target: TierLabel;
  /** Counted criteria on that side today, by strength. */
  have: string;
  /** Up to three smallest additions that reach the target tier, in words. */
  options: string[];
  /** The whole sentence a surface prints, so the tab and a report cannot word it differently. */
  sentence: string;
}

export interface Contrast { text: string }

export type CriterionState = "met" | "not met" | "withheld" | "not recorded";

/** One criterion the engine owns, with what happened to it. Plain strings, so a report can print it. */
export interface CriterionRow {
  code: string;
  /** Strength in this engine's own weighting (PM2 is recorded as Moderate here; ClinGen SVI 2020 says Supporting). */
  strength: string;
  state: CriterionState;
  reason: string;
  /** The evidence tab that owns the criterion, or null. */
  tab: EvidenceTabId | null;
}

export interface NarrativeFacts {
  authorship: NarrativeAuthorship;
  model: string | null;
  sent: readonly string[];
  notSent: readonly string[];
}

export interface NeededRow { code: string; title: string; text: string; tab: EvidenceTabId | null }

export interface InsightsEvidence {
  ready: boolean;
  pending: boolean;
  weighting: string | null;
  tier: TierLabel | null;
  tierIndex: number;
  /** Verbatim engine verdict string, for the chip. */
  verdictText: string | null;
  /** The engine's recorded tier differs from the combining rule run on its recorded codes. */
  recordMismatch: boolean;
  engineCodes: AcmgCriteriaView[];
  proposals: AcmgCriteriaView[];
  droppedEngineOwned: AcmgCriteriaView[];
  /** The verdict card's headline and its supporting sentence, worded once. */
  finding: { headline: string; rest: string };
  /** Every engine-owned criterion with its state; model proposals are never in this list. */
  criteria: CriterionRow[];
  narrative: NarrativeFacts;
  lanes: Lane[];
  gap: TierGap | null;
  agree: Contrast[];
  differ: Contrast[];
  needed: NeededRow[];
  glossary: Array<{ term: string; text: string }>;
}

// ── Strength vocabulary ──────────────────────────────────────────────────────────────────────────

const STRENGTH_WORD: Record<number, string> = { 8: "Very strong", 4: "Strong", 2: "Moderate", 1: "Supporting" };
const BENIGN_STRENGTH_WORD: Record<number, string> = { 8: "Stand-alone", 4: "Strong", 2: "Supporting" };

function suffixLength(code: string | null): 1 | 2 | 3 {
  if (!code) return 1;
  if (/_Strong|_VeryStrong/i.test(code)) return 3;
  if (/_Moderate/i.test(code)) return 2;
  return 1;
}

function countByStrength(codes: ReadonlyArray<{ code: string }>, side: "pathogenic" | "benign") {
  const out = new Map<number, number>();
  for (const c of codes) {
    const w = codeWeight(c.code);
    if ((side === "pathogenic" && w > 0) || (side === "benign" && w < 0)) {
      out.set(Math.abs(w), (out.get(Math.abs(w)) ?? 0) + 1);
    }
  }
  return out;
}

function describeStrengths(counts: Map<number, number>, side: "pathogenic" | "benign"): string {
  const words = side === "pathogenic" ? STRENGTH_WORD : BENIGN_STRENGTH_WORD;
  const parts = [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([w, n]) => `${n} ${words[w] ?? "criterion"}`);
  return parts.length ? parts.join(", ") : "none";
}

// ── The tier gap ─────────────────────────────────────────────────────────────────────────────────

/**
 * The smallest additions that would move the tier one step toward the side the counted evidence leans.
 * Found by running `classifyVariant` on hypothetical criteria, so the answer is the engine's own.
 */
export function computeTierGap(codes: ReadonlyArray<{ code: string; reason: string }>): TierGap | null {
  const current = tierIndexOf(classifyVariant([...codes]));
  const net = codes.reduce((sum, c) => sum + codeWeight(c.code), 0);
  const side: "pathogenic" | "benign" = net < 0 ? "benign" : "pathogenic";
  if (side === "pathogenic" ? current >= 4 : current <= 0) return null;
  // One step toward the side the counted evidence leans; from Uncertain that is Likely pathogenic or Likely benign.
  const tgt = side === "pathogenic" ? Math.max(current + 1, 3) : Math.min(current - 1, 1);
  const target = TIERS[tgt];
  const reached = (idx: number) => (side === "pathogenic" ? idx >= tgt : idx <= tgt);

  // Hypothetical additions: [code, word].
  const kinds: Array<[string, string, number]> = side === "pathogenic"
    ? [["PVS1", "Very strong", 1], ["PS3", "Strong", 2], ["PM5", "Moderate", 3], ["PP4", "Supporting", 4]]
    : [["BS3", "Strong", 2], ["BP2", "Supporting", 3]];
  const found: Array<{ total: number; text: string }> = [];
  const walk = (i: number, picked: number[]) => {
    if (i === kinds.length) {
      const added = picked.flatMap((n, k) => Array(n).fill({ code: kinds[k][0], reason: "hypothetical" }));
      if (!added.length) return;
      if (reached(tierIndexOf(classifyVariant([...codes, ...added])))) {
        const text = picked
          .map((n, k) => (n ? `${n} ${kinds[k][1]}` : null))
          .filter(Boolean)
          .join(" + ");
        found.push({ total: picked.reduce((a, b) => a + b, 0), text });
      }
      return;
    }
    for (let n = 0; n <= kinds[i][2]; n++) walk(i + 1, [...picked, n]);
  };
  walk(0, []);
  // Keep only additions no other addition is a strict subset of.
  const minimal = found
    .sort((a, b) => a.total - b.total || a.text.localeCompare(b.text))
    .filter((f, _i, all) => !all.some(o => o !== f && o.total < f.total && subsetOf(o.text, f.text)));
  const options = [...new Set(minimal.map(m => m.text))].slice(0, 3);

  const have = describeStrengths(countByStrength(codes, side), side);
  // Conflicting evidence: the combining rules return VUS whenever both sides reach a tier, so no
  // addition on this side can reach the target while the other side's criteria stand. Say so rather
  // than print an empty list.
  const sentence = options.length
    ? `To reach ${target.toLowerCase()} the engine needs one of these on top of what it has (${have}): ${options.join("; ")}.`
    : `The counted evidence conflicts (${have} on the ${side} side, and criteria on the other side also count), so adding ${side} criteria alone cannot reach ${target.toLowerCase()}; the conflict has to be resolved first.`;
  return { side, target, have, options, sentence };
}

function subsetOf(a: string, b: string): boolean {
  const parse = (t: string) => new Map(t.split(" + ").map(p => { const [n, ...w] = p.split(" "); return [w.join(" "), Number(n)] as const; }));
  const A = parse(a), B = parse(b);
  for (const [k, n] of A) if ((B.get(k) ?? 0) < n) return false;
  return true;
}

// ── Lane construction ────────────────────────────────────────────────────────────────────────────

function engineCodeFor(codes: ReadonlyArray<{ code: string }>, owned: string[]): string | null {
  return codes.find(c => owned.includes(baseAcmgCode(c.code)))?.code ?? null;
}

const CODE_LEAN = (code: string | null): Lean => {
  if (!code) return "none";
  const w = codeWeight(code);
  return w > 0 ? "pathogenic" : w < 0 ? "benign" : "none";
};

const oxfordList = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function supportPhrase(k: number, n: number): string {
  return k >= n ? `in all ${n} solved structures` : `in ${k} of ${n} solved structures`;
}

export function buildInsightsEvidence(input: InsightsEvidenceInput): InsightsEvidence {
  const { result, functionInput, stability, isLoading = false } = input;
  const weighting = result.metadata?.acmgWeighting ?? null;

  const view = acmgCriteriaView(result.insights?.acmgCriteria, result.ruleBasedInsights?.acmgCriteria);
  const { engine: engineCodes, proposals, droppedEngineOwned } = partitionCriteria(view);
  const recordedVerdict = result.ruleBasedInsights?.acmgVerdict ?? result.insights?.acmgVerdict ?? null;
  const computedVerdict = classifyVariant(engineCodes.map(c => ({ code: c.code, reason: c.reason })));
  const hasRecord = Boolean(result.ruleBasedInsights || result.insights);
  const verdictText = hasRecord ? (recordedVerdict ?? computedVerdict) : null;
  const tierIndex = verdictText ? tierIndexOf(verdictText) : 2;
  const recordMismatch = Boolean(recordedVerdict) && tierIndexOf(recordedVerdict!) !== tierIndexOf(computedVerdict);

  const lanes: Lane[] = [];

  // Computational ─ the vote is the shared rule; "counted" is what the engine recorded.
  const pe = buildPredictorEvidence({ result, isLoading });
  const peCode = pe.engine.code;
  const peCounted = Boolean(peCode) && ["PP3", "BP4"].includes(baseAcmgCode(peCode!));
  const voteLean: Lean = pe.vote.direction === "pathogenic" ? "pathogenic" : pe.vote.direction === "benign" ? "benign" : "none";
  const compLean: Lean = peCounted ? CODE_LEAN(peCode) : voteLean;
  const { nPathogenic: nP, nBenign: nB, nIndeterminate: nI, nVoting } = pe.vote;
  lanes.push({
    key: "computational",
    name: "Computational",
    links: [{ label: "In-silico predictors", tab: "predictors" }],
    lean: compLean,
    counted: peCounted,
    code: peCounted ? peCode : null,
    length: peCounted ? suffixLength(peCode) : 1,
    unconfirmed: !peCounted && Boolean(pe.vote.code) && pe.engine.known,
    state: pe.pending && nVoting === 0 ? "pending" : nVoting === 0 ? "absent" : "read",
    lead: nVoting === 0
      ? "No voting predictor returned a score."
      : `${nP} ${plural(nP, "predictor says", "predictors say")} damaging, ${nB} ${plural(nB, "says", "say")} tolerated, ${nI} ${plural(nI, "is", "are")} unsure.`,
    rest: nVoting === 0
      ? "Nothing is counted for this lane."
      : nP > 0 && nB > 0
        ? peCounted ? "Contested. The engine still recorded the plurality call." : "Contested, and the engine recorded no code."
        : peCounted ? "The engine recorded this call." : "The engine recorded no code for it.",
  });

  // Population ─ the frequency tab's own criterion and what the engine recorded.
  // Insights reads only the rule engine's criteria (not the narrative's), so that stays explicit.
  const fe = buildFrequencyEvidence(frequencyEvidenceInputFromResult(result, {
    engineCriteria: result.ruleBasedInsights?.acmgCriteria ?? null,
    acmgWeighting: weighting,
  }));
  const popCode = fe.applied.code;
  const popRead = fe.criterion.af !== null || fe.criterion.code === "PM2" || fe.criterion.code === "BS1" || fe.criterion.code === "BA1" || fe.criterion.code === "none";
  lanes.push({
    key: "population",
    name: "Population",
    links: [{ label: "Population data", tab: "clinical" }],
    lean: CODE_LEAN(popCode),
    counted: Boolean(popCode),
    code: popCode,
    length: 1,
    unconfirmed: fe.applied.suppressed,
    state: fe.hasPendingSource && !popRead ? "pending" : popRead ? "read" : "absent",
    lead: popCode
      ? `${fe.criterion.headline ?? fe.criterion.statement}.`
      : popRead
        ? "No frequency criterion applies."
        : "No frequency evidence was counted.",
    rest: popCode
      ? (fe.criterion.predicate ? `${fe.criterion.predicate[0].toUpperCase()}${fe.criterion.predicate.slice(1)}.` : "")
      : popRead
        ? (fe.criterion.predicate ? `The frequency read is ${fe.criterion.predicate}, so PM2, BS1 and BA1 are all unmet.` : "The frequency read meets none of PM2, BS1 or BA1.")
        : fe.hasProviderFault
          ? "A source failed to answer, so rarity (PM2) was not computed."
          : "Rarity (PM2) was not computed because no frequency was read.",
  });

  // Splicing ─ the engine never reads it (see SplicingTab), so it is context by construction.
  const sp = buildSplicingEvidence({ result, isLoading });
  const spState = sp.rule.state;
  const dsText = sp.rule.maxDs !== null ? sp.rule.maxDs.toFixed(2) : null;
  lanes.push({
    key: "splicing",
    name: "Splicing",
    links: [{ label: "RNA splicing", tab: "splicing" }],
    lean: spState === "pp3" ? "pathogenic" : spState === "bp4" ? "benign" : "none",
    counted: false,
    code: null,
    length: 1,
    unconfirmed: false,
    state: spState === "pending" ? "pending" : spState === "no-score" ? "absent" : "read",
    lead: spState === "pp3" ? `SpliceAI predicts a splicing change (max Δ ${dsText}).`
      : spState === "bp4" ? `No predicted effect on splicing (max Δ ${dsText}).`
      : spState === "between" ? `The splicing prediction sits between the cut-points (max Δ ${dsText}).`
      : spState === "pending" ? "The splicing prediction is still running."
      : "No splicing score was returned.",
    rest: spState === "no-score" || spState === "pending"
      ? "The engine does not read splicing."
      : `The ClinGen splicing rule reads ≥ ${THRESHOLDS.spliceai.splicingPp3.toFixed(2)} as PP3 and \u2264 ${THRESHOLDS.spliceai.splicingBp4Below.toFixed(2)} as BP4. The engine does not read splicing.`,
  });

  // Function ─ PM1.
  const fn = buildFunctionEvidence({ ...functionInput, engineCriteria: functionInput.engineCriteria ?? result.ruleBasedInsights?.acmgCriteria ?? null });
  const pm1Code = engineCodeFor(engineCodes, ["PM1"]);
  const fnMet = fn.verdict === "met";
  lanes.push({
    key: "function",
    name: "Protein function",
    links: [{ label: "Functional domains", tab: "function" }],
    lean: fnMet || pm1Code ? "pathogenic" : "none",
    counted: Boolean(pm1Code),
    code: pm1Code,
    length: suffixLength(pm1Code),
    unconfirmed: fnMet && !pm1Code,
    state: fn.availability.state === "running" ? "pending" : fn.verdict === "not-assessed" ? "absent" : "read",
    lead: fn.verdict === "met" ? "The residue sits in an experimentally evidenced functional site."
      : fn.verdict === "not-met" ? "The residue is not inside a curated functional site."
      : fn.verdict === "not-assessed" ? "Functional sites were not assessed for this run."
      : "PM1 is supported but withheld.",
    rest: fn.verdict === "not-met"
      ? "That is absence of annotation, not evidence of benignity."
      : fn.verdict === "not-assessed"
        ? fn.availability.reason
        : fn.verdict === "met" ? (fn.engineMismatch ?? "The engine recorded PM1.") : "The cap or weighting withheld it.",
  });

  // Stability ─ context: destabilisation is not pathogenicity.
  // Fold stability is a mechanistic observation, never a pathogenic/benign vote.
  const stabilityLean: Lean = "none";
  lanes.push({
    key: "stability",
    name: "Stability",
    links: [{ label: "Energetics", tab: "structure" }],
    lean: stabilityLean,
    counted: false,
    code: null,
    length: 1,
    unconfirmed: false,
    state: !stability || stability.enginesCounted === 0 ? (isLoading ? "pending" : "absent") : "read",
    lead: !stability || stability.enginesCounted === 0
      ? "No stability engine returned a value."
      : `${stability.enginesDestabilizing} of ${stability.enginesCounted} stability ${plural(stability.enginesCounted, "engine", "engines")} predict destabilisation.`,
    rest: "A looser fold can still be harmless, so the engine does not count stability.",
  });

  // Assembly ─ context. Read from the Interfaces & PPI model, so the lane and the tab say the same
  // thing. It used to read `isMultimer` alone: "UniProt records no complex" for a protein with NO
  // SUBUNIT record (not stated is not a monomer), and it never said whether the residue is at an
  // interface although the pipeline had already read the solved structures.
  const uf = result.uniprotFeatures;
  const asm = (result as any).multimerData ?? null;
  const ifc = buildInterfacesEvidence({
    result,
    assembly: asm,
    assemblyStatus: asm && !isStaleAssembly(asm) ? "ready" : isLoading ? "loading" : "ready",
    ppi: null,
    ppiStatus: "ready",
    shift: null,
    shiftLoading: false,
  });
  const ifcRead = Boolean(uf || (asm && !isStaleAssembly(asm)));
  const asmKind = ifc.assembly.kind;
  lanes.push({
    key: "assembly",
    name: "Assembly",
    links: [{ label: "Interfaces & PPI", tab: "interfaces" }],
    lean: "none",
    counted: false,
    code: null,
    length: 1,
    unconfirmed: false,
    state: ifcRead ? "read" : isLoading ? "pending" : "absent",
    lead: !ifcRead ? "UniProt's subunit record was not read."
      : ifc.interface.verdict === "at-interface"
        ? `${ifc.residueLabel} is at an interface: ${ifc.interface.observed ? `${supportPhrase(ifc.interface.observed.k, ifc.interface.observed.n)}` : "in the predicted complex only"}.`
        : asmKind === "unstated" ? "UniProt states no assembly for this protein."
        : asmKind === "monomer" ? "UniProt records this protein as a monomer."
        : `UniProt records a ${ifc.assembly.label.toLowerCase()}${ifc.assembly.qualifier ? ` (${ifc.assembly.qualifier.toLowerCase()})` : ""}.`,
    rest: !ifcRead ? ""
      : ifc.interface.verdict === "at-interface"
        ? `${ifc.assembly.kind === "unstated" ? "" : `${ifc.assembly.label}${ifc.assembly.qualifier ? ` (${ifc.assembly.qualifier.toLowerCase()})` : ""}. `}Contact is not disruption, and the engine does not read assembly.`
        : asmKind === "unstated" ? "Not stated is not a monomer. The engine does not read assembly."
        : ifc.interface.verdict === "not-at-interface" ? `${ifc.residueLabel} is not at any native interface in solved structures${ifc.interface.reference ? ` (0 of ${ifc.interface.reference.n})` : ""}${ifc.interface.fibril ? `; it touches another chain only in ${ifc.interface.fibril.k} of ${ifc.interface.fibril.n} amyloid fibril structures` : ""}. The engine does not read assembly.`
        : "The engine does not read assembly.",
  });

  // Protein and genome language models ─ informational readings, none of them voting.
  const lm = pe.readings.filter(r => (r.group === "protein-lm" || r.group === "genome") && r.score !== null);
  const lmP = lm.filter(r => r.callTone === "danger").length;
  const lmB = lm.filter(r => r.callTone === "good").length;
  lanes.push({
    key: "language-models",
    name: "Sequence models",
    links: [{ label: "AlphaGenome", tab: "alphagenome" }, { label: "Perturbation", tab: "perturbation" }],
    lean: lmP > lmB ? "pathogenic" : lmB > lmP ? "benign" : "none",
    counted: false,
    code: null,
    length: 1,
    unconfirmed: false,
    state: lm.length ? "read" : isLoading || pe.pending ? "pending" : "absent",
    lead: lm.length
      ? `${lm.length} ${plural(lm.length, "protein or genome model scored", "protein and genome models scored")} this variant; ${lmP} flag it and ${lmB} read it as tolerated.`
      : "No protein or genome model returned a score.",
    rest: "ESM1b has published calibrated bands; the other sequence models are informational. None votes in this engine.",
  });

  // Contrasts ─ generated from the lanes' own calls, never from a new score.
  const agree: Contrast[] = [];
  const differ: Contrast[] = [];
  const readLanes = lanes.filter(l => l.state === "read");
  for (const lean of ["pathogenic", "benign"] as const) {
    const same = readLanes.filter(l => l.lean === lean);
    if (same.length >= 2) agree.push({ text: `${oxfordList(same.map(l => l.name))} ${same.length === 2 ? "both" : "all"} point to ${lean}.` });
  }
  const silent = readLanes.filter(l => l.lean === "none");
  if (silent.length >= 2) agree.push({ text: `${oxfordList(silent.map(l => l.name))} provide context without an assessed clinical direction.` });

  if (nP > 0 && nB > 0) {
    const names = (rs: typeof pe.voters.pathogenic) => oxfordList(rs.slice(0, 3).map(r => r.name));
    differ.push({ text: `${names(pe.voters.benign)} ${pe.voters.benign.length === 1 ? "reads" : "read"} the change as tolerated while ${names(pe.voters.pathogenic)} ${pe.voters.pathogenic.length === 1 ? "reads" : "read"} it as damaging.` });
  }
  const path = readLanes.filter(l => l.lean === "pathogenic");
  const ben = readLanes.filter(l => l.lean === "benign");
  if (path.length && ben.length) {
    differ.push({ text: `${oxfordList(path.map(l => l.name))} ${path.length === 1 ? "leans" : "lean"} pathogenic while ${oxfordList(ben.map(l => l.name))} ${ben.length === 1 ? "leans" : "lean"} benign.` });
  }
  for (const l of readLanes) {
    if (l.lean !== "none" && !l.counted && !l.unconfirmed && tierIndex <= 2) {
      differ.push({ text: `${l.name} leans ${l.lean}, but the engine does not count it, so it does not move the tier.` });
    }
  }
  const countedLanes = lanes.filter(l => l.counted);
  if (countedLanes.length === 1 && hasRecord) {
    differ.push({ text: `Only one evidence area is counted (${countedLanes[0].name}). The tier rests on it alone.` });
  }

  // What is still needed.
  const needed: NeededRow[] = [
    { code: "PS3", title: "Lab evidence", text: "A functional assay of this exact change. The engine cannot compute PS3 and no assay data is held here.", tab: null },
    { code: "PP1, PS2", title: "Family evidence", text: "Whether the variant travels with disease in a family, or arose newly in an affected child. Ask the referring clinician.", tab: null },
  ];
  const pop = lanes.find(l => l.key === "population")!;
  if (pop.state !== "read") {
    needed.unshift({ code: "PM2", title: "Population rarity", text: "No frequency was counted for this run. Check gnomAD directly, then re-run.", tab: "clinical" });
  }

  // Criteria table ─ every code the engine owns, with what became of it.
  const laneOf = (key: LaneKey) => lanes.find(l => l.key === key)!;
  const strengthOf = (code: string) => {
    const w = codeWeight(code);
    const word = w > 0 ? STRENGTH_WORD[Math.abs(w)] : BENIGN_STRENGTH_WORD[Math.abs(w)];
    return word ?? "Not weighted";
  };
  const OWNERS: Array<[string, EvidenceTabId | null, LaneKey | null]> = [
    ["PVS1", null, null], ["PS1", null, null], ["PM1", "function", "function"], ["PM2", "clinical", "population"],
    ["PM4", null, null], ["PP2", null, null], ["PP3", "predictors", "computational"],
    ["BA1", "clinical", "population"], ["BS1", "clinical", "population"], ["BS2", "clinical", "population"],
    ["BP3", null, null], ["BP4", "predictors", "computational"],
  ];
  const DEFAULT_STRENGTH: Record<string, string> = { PVS1: "Very strong", PS1: "Strong", PM1: "Moderate", PM2: "Supporting", PM4: "Moderate", PP2: "Supporting", PP3: "Supporting", BA1: "Stand-alone", BS1: "Strong", BS2: "Strong", BP3: "Supporting", BP4: "Supporting" };
  const criteria: CriterionRow[] = OWNERS.map(([base, tab, laneKey]) => {
    const met = engineCodes.find(c => baseAcmgCode(c.code) === base);
    if (met) return { code: met.code, strength: strengthOf(met.code), state: "met" as const, reason: met.reason, tab };
    const lane = laneKey ? laneOf(laneKey) : null;
    const withheld = base === "PM2" && (fe.criterion.code === "withheld" || fe.applied.suppressed)
      || base === "PM1" && fn.verdict !== "met" && fn.verdict !== "not-met" && fn.verdict !== "not-assessed"
      || (base === "PP3" || base === "BP4") && lane?.unconfirmed && ((base === "PP3") === (lane.lean === "pathogenic"));
    if (withheld) return { code: base, strength: DEFAULT_STRENGTH[base], state: "withheld" as const, reason: lane?.lead ?? "Supported but not recorded by the engine.", tab };
    const notMetReason = hasRecord
      ? (lane && lane.state === "read" ? lane.lead : "The engine recorded no criterion for this code.")
      : "The variant has not been classified.";
    return { code: base, strength: DEFAULT_STRENGTH[base], state: (hasRecord ? "not met" : "not recorded") as CriterionState, reason: notMetReason, tab };
  });

  const finding = {
    headline: tierIndex >= 3 ? "The counted evidence points to disease-causing."
      : tierIndex <= 1 ? "The counted evidence points to harmless."
      : engineCodes.length ? "Not enough evidence either way yet." : "Nothing has been counted yet.",
    rest: !engineCodes.length
      ? "The rule engine recorded no criterion for this variant."
      : `The engine counted ${engineCodes.length} ${engineCodes.length === 1 ? "criterion" : "criteria"}: ${engineCodes.map(c => formatEvidenceCode(c.code)).join(", ")}.`
        + (proposals.length ? ` The model proposed ${proposals.map(p => p.code).join(", ")}, which the engine cannot compute, so ${proposals.length === 1 ? "it is" : "they are"} not counted.` : ""),
  };

  const narrative: NarrativeFacts = {
    authorship: deriveNarrativeAuthorship({
      analysis: result.analysis,
      isDegraded: Boolean(input.narrativeDegraded),
      declaredSource: (result.insights as { source?: string } | undefined)?.source,
    }),
    model: (result.insights as { model?: string } | undefined)?.model ?? null,
    sent: NARRATIVE_PROMPT_EVIDENCE.sent,
    notSent: NARRATIVE_PROMPT_EVIDENCE.notSent,
  };

  return {
    ready: hasRecord,
    pending: isLoading,
    weighting,
    tier: verdictText ? TIERS[tierIndex] : null,
    tierIndex,
    verdictText,
    recordMismatch,
    engineCodes,
    proposals,
    droppedEngineOwned,
    finding,
    criteria,
    narrative,
    lanes,
    gap: hasRecord ? computeTierGap(engineCodes.map(c => ({ code: c.code, reason: c.reason }))) : null,
    agree: agree.slice(0, 3),
    differ: differ.slice(0, 4),
    needed,
    glossary: glossaryFor(engineCodes, tierIndex),
  };
}

// ── Plain-language glossary ──────────────────────────────────────────────────────────────────────

const TIER_TEXT: Record<number, string> = {
  0: "Benign. The evidence is strong enough to call the change harmless.",
  1: "Likely benign. Most evidence says harmless, short of certainty.",
  2: "Variant of uncertain significance. The evidence is not enough to call it disease-causing or harmless. It is not a diagnosis.",
  3: "Likely pathogenic. Most evidence says it causes disease, short of certainty.",
  4: "Pathogenic. The evidence is strong enough to call the change disease-causing.",
};

const CODE_TEXT: Record<string, string> = {
  PVS1: "A change that should switch the gene off entirely, such as a premature stop. Very strong.",
  PS1: "The same amino-acid change is already known to cause disease.",
  PM1: "The residue sits in a functional site where changes are known to matter. Moderate.",
  PM2: "The change is very rare or absent in healthy population databases. Moderate.",
  PM4: "The change alters protein length. Moderate.",
  PP2: "Missense changes in this gene are a known cause of disease. Supporting.",
  PP3: "Computer models mostly agree the change is damaging. The weakest kind of evidence; several are needed together.",
  BA1: "The change is common in healthy people. Stand-alone benign.",
  BS1: "More common in healthy people than the disorder allows.",
  BS2: "Seen in healthy adults who carry two copies.",
  BP3: "An in-frame change in a repetitive region with no known function.",
  BP4: "Computer models mostly agree the change is harmless. Supporting.",
};

function glossaryFor(codes: ReadonlyArray<{ code: string }>, tierIndex: number) {
  const out = [{ term: "Tier", text: TIER_TEXT[tierIndex] }];
  for (const c of codes) {
    const t = CODE_TEXT[baseAcmgCode(c.code)];
    if (t && !out.some(o => o.term === c.code)) out.push({ term: c.code, text: t });
  }
  out.push({ term: "Stability (ΔΔG)", text: "How much the change loosens the protein fold. A looser fold can still be harmless, so it is context here, not a vote." });
  return out;
}
