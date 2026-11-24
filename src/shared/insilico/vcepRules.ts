import type { CalibratedCall, EvidenceStrength } from "../thresholds/calibration.ts";
import { matchesThresholdBound, type VcepInsilicoRule, type VcepPp3Strength, type VcepToolKey, type VcepToolSpec } from "./vcepTypes.ts";
import { VCEP_REVEL_SINGLE_RULES } from "./vcepDataRevelSingle.ts";
import { VCEP_REVEL_MULTI_RULES } from "./vcepDataRevelMulti.ts";
import { VCEP_SPECIAL_RULES } from "./vcepDataSpecial.ts";

export * from "./vcepTypes.ts";

export const VCEP_REGISTRY_SNAPSHOT = {
  auditedAt: "2026-11-24T12:46:32.597910+00:00",
  source: "https://cspec.genome.network/cspec/",
  activeReleasedSpecs: 113,
  uniqueGenes: 110,
  geneLessSpecs: [{ cspecId: "GN015", version: "1.0", vcep: "Mitochondrial Diseases Variant Curation Expert Panel" }],
} as const;

export const ALL_VCEP_RULES: readonly VcepInsilicoRule[] = [
  ...VCEP_REVEL_SINGLE_RULES,
  ...VCEP_REVEL_MULTI_RULES,
  ...VCEP_SPECIAL_RULES,
];

const VCEP_BY_GENE = new Map<string, VcepInsilicoRule>(
  ALL_VCEP_RULES.map(rule => [rule.gene.toUpperCase(), rule]),
);

const PP3_STRENGTH_ORDER: readonly VcepPp3Strength[] = ["Strong", "Moderate", "Supporting"];
const STRENGTH_ORDER: readonly EvidenceStrength[] = ["VeryStrong", "Strong", "Moderate", "Supporting"];

function finite(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function codeFor(dir: "PP3" | "BP4", s: EvidenceStrength): CalibratedCall["code"] {
  if (dir === "PP3" && s === "VeryStrong") return "PP3_Strong";
  return (s === "Supporting" ? dir : `${dir}_${s}`) as CalibratedCall["code"];
}

/** Looks up the audited, version-pinned ClinGen VCEP rule for `gene`, or `null` when uncovered. */
export function lookupVcepInsilicoRule(gene: string | null | undefined): VcepInsilicoRule | null {
  if (!gene) return null;
  const key = gene.trim().toUpperCase();
  return key ? VCEP_BY_GENE.get(key) ?? null : null;
}

/** False when a VCEP rule evaluates without dbNSFP scores (excluded genes, DDX41, CEP290). */
export function vcepRuleRequiresDbnsfp(rule: VcepInsilicoRule | null | undefined): boolean {
  if (!rule || rule.rule.kind === "advisory") return true;
  if (rule.rule.kind === "exclude-missense") return false;
  return rule.rule.tools.some(t => t.tool === "revel" || t.tool === "bayesdel");
}

/** Evaluates a single tool's score against a VCEP's audited strength bounds (strongest band wins). */
export function evaluateVcepBand(spec: VcepToolSpec, score: number): CalibratedCall {
  for (const strength of PP3_STRENGTH_ORDER) {
    const bound = spec.pp3[strength];
    if (bound && matchesThresholdBound(score, bound, "PP3")) {
      return { code: codeFor("PP3", strength), direction: "PP3", strength };
    }
  }
  for (const strength of STRENGTH_ORDER) {
    const bound = spec.bp4[strength];
    if (bound && matchesThresholdBound(score, bound, "BP4")) {
      return { code: codeFor("BP4", strength), direction: "BP4", strength };
    }
  }
  return { code: "Indeterminate", direction: null, strength: null };
}

export interface VcepMissenseOutcome {
  outcome: "met" | "indeterminate" | "no-score" | "vcep-excluded";
  activeTool: VcepToolKey | null;
  activeScore: number | null;
  activeCall: CalibratedCall | null;
  skippedBefore: VcepToolKey[];
  runtimeNotes: string[];
}

function evalOrdered(
  tools: readonly VcepToolSpec[],
  scores: Partial<Record<VcepToolKey, number | null | undefined>>,
): VcepMissenseOutcome {
  const skippedBefore: VcepToolKey[] = [];
  for (const spec of tools) {
    const score = finite(scores[spec.tool]);
    if (score === null) {
      skippedBefore.push(spec.tool);
      continue;
    }
    const call = evaluateVcepBand(spec, score);
    return {
      outcome: call.direction === null ? "indeterminate" : "met",
      activeTool: spec.tool,
      activeScore: score,
      activeCall: call,
      skippedBefore,
      runtimeNotes: [],
    };
  }
  return { outcome: "no-score", activeTool: null, activeScore: null, activeCall: null, skippedBefore, runtimeNotes: [] };
}

function evalCombo(
  tools: readonly VcepToolSpec[],
  minAgree: number,
  scores: Partial<Record<VcepToolKey, number | null | undefined>>,
  requireAll: boolean,
): VcepMissenseOutcome {
  const scored = tools
    .map(spec => ({ spec, score: finite(scores[spec.tool]) }))
    .filter((x): x is { spec: VcepToolSpec; score: number } => x.score !== null);

  if ((requireAll && scored.length < tools.length) || scored.length < minAgree) {
    return {
      outcome: "no-score", activeTool: null, activeScore: null, activeCall: null, skippedBefore: [],
      runtimeNotes: [`VCEP requires ${requireAll ? "all" : `at least ${minAgree}`} of ${tools.map(t => t.tool.toUpperCase()).join(", ")} to score.`],
    };
  }
  const evaluated = scored.map(x => ({ ...x, call: evaluateVcepBand(x.spec, x.score) }));
  const pp3 = evaluated.filter(e => e.call.direction === "PP3");
  const bp4 = evaluated.filter(e => e.call.direction === "BP4");
  const winner = pp3.length >= minAgree ? pp3 : bp4.length >= minAgree ? bp4 : null;
  if (!winner) {
    return {
      outcome: "indeterminate", activeTool: null, activeScore: null, activeCall: null, skippedBefore: [],
      runtimeNotes: ["VCEP multi-tool threshold requirement was not met (tools disagreed or sat between bands)."],
    };
  }
  const agreedText = winner.map(w => `${w.spec.tool.toUpperCase()} ${w.spec.tool === "cadd" ? w.score.toFixed(1) : w.score.toFixed(3)}`).join(" + ");
  return {
    outcome: "met",
    activeTool: winner[0].spec.tool,
    activeScore: winner[0].score,
    activeCall: winner[0].call,
    skippedBefore: [],
    runtimeNotes: [`VCEP missense threshold matched via ${agreedText}.`],
  };
}

/** Evaluates a computable VCEP rule without falling back outside the VCEP's approved tools. */
export function evaluateVcepMissenseCall(
  rule: VcepInsilicoRule,
  scores: Partial<Record<VcepToolKey, number | null | undefined>>,
): VcepMissenseOutcome {
  switch (rule.rule.kind) {
    case "exclude-missense":
      return { outcome: "vcep-excluded", activeTool: null, activeScore: null, activeCall: null, skippedBefore: [], runtimeNotes: [] };
    case "ordered-tools":
      return evalOrdered(rule.rule.tools, scores);
    case "all-of":
      return evalCombo(rule.rule.tools, rule.rule.tools.length, scores, true);
    case "k-of-n":
      return evalCombo(rule.rule.tools, rule.rule.minAgree, scores, false);
    case "advisory":
      return { outcome: "no-score", activeTool: null, activeScore: null, activeCall: null, skippedBefore: [], runtimeNotes: [] };
  }
}
