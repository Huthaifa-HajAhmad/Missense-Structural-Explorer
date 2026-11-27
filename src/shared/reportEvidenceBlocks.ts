/**
 * reportEvidenceBlocks.ts — the Report's evidence readings: one block per Insights lane, plus the
 * predictor, frequency, stability and structure detail each lane's tab owns.
 *
 * The lane's sentence, chip and counted code come from the consolidator (`buildInsightsEvidence`); the
 * tables and facts come from the same builders the evidence tabs render, so the report cannot disagree
 * with a tab.
 */
import type { Lane, LaneKey } from "./insightsEvidence.ts";
import { formatEvidenceCode } from "./thresholds.ts";
import { CAVEAT_TEXT, buildPredictorEvidence, predictorUseLabel } from "./predictorEvidence.ts";
import { disagreementText } from "./predictorSummary.ts";
import { energeticsSummary, signedDdgNumber, type buildEnergeticsEvidence } from "./energeticsEvidence.ts";
import type { EnergyUnit } from "./engineStatus.ts";
import { buildFrequencyEvidence, formatAlleleFrequency, frequencySourceLabel, frequencyEvidenceInputFromResult } from "./frequencyEvidence.ts";
import { REPORT_SOURCES, blankBlock, type ReportBlock, type ReportChip, type ReportDocumentInput, type ReportLink } from "./reportModel.ts";
import { bold, joinText, sentence } from "./reportProse.ts";

type Energetics = ReturnType<typeof buildEnergeticsEvidence>;

function laneDraft(lane: Lane): string {
  return joinText([bold(sentence(lane.lead)), lane.rest ? sentence(lane.rest) : ""]);
}

function laneChips(lane: Lane): ReportChip[] {
  const chips: ReportChip[] = [];
  if (lane.counted && lane.code) {
    chips.push({ label: `${formatEvidenceCode(lane.code)} counted`, tone: lane.lean === "benign" ? "good" : "danger" });
  } else if (lane.unconfirmed) {
    chips.push({ label: "Unconfirmed", tone: "accent", dashed: true });
  } else if (lane.state === "read") {
    chips.push({ label: "Not counted", tone: "muted" });
  }
  if (lane.state === "pending") chips.push({ label: "Still running", tone: "muted" });
  if (lane.state === "absent") chips.push({ label: "No reading", tone: "muted" });
  return chips;
}

function laneLinks(lane: Lane): ReportLink[] {
  return lane.links.map(l => ({ label: l.label, tab: l.tab }));
}

export function laneBlock(key: LaneKey, input: ReportDocumentInput): ReportBlock {
  const b = blankBlock(key);
  const lane = input.insights?.lanes.find(l => l.key === key);
  if (!lane) {
    b.status = "absent";
    b.drafted = bold("No reading.") + " No analysis is loaded.";
    return b;
  }
  b.status = lane.state;
  b.chips = laneChips(lane);
  b.drafted = laneDraft(lane);
  b.reads = laneLinks(lane);
  b.counted = lane.counted && lane.code ? [lane.code] : [];
  return b;
}

export function computationalExtras(b: ReportBlock, input: ReportDocumentInput) {
  const { result } = input;
  if (!result) return;
  const pe = buildPredictorEvidence({ result, isLoading: Boolean(input.isLoading) });
  if (pe.primary.vcepRule) {
    const v = pe.primary.vcepRule;
    b.facts.push({ label: "ClinGen VCEP", value: `${v.vcep} (${v.cspecId} v${v.version}) — ${v.summary}` });
  }
  const rows = pe.readings
    .filter(r => r.availability.state === "available")
    .map(r => {
      return [
        r.name,
        `${r.scoreText}${r.unit ? ` ${r.unit}` : ""}`,
        formatEvidenceCode(r.callLabel),
        predictorUseLabel(r, pe.primary),
        `${r.cutpoints.source ?? "No published calibration"}; ${r.orientation === "higher" ? "higher" : "lower"} scores indicate ${r.group === "conservation" ? "greater evolutionary constraint" : "greater predicted impact"}${r.note ? `; ${r.note}` : ""}${r.caveats.length ? `; ${r.caveats.map(c => CAVEAT_TEXT[c].detail).join("; ")}` : ""}`,
      ];
    });
  if (rows.length) {
    b.table = { headers: ["Tool", "Score", "Reading", "Status", "Method and caveats"], rows, numeric: [1], detail: { column: 4, label: "Method" } };
    b.caption = "Scores are not probabilities; correlated tools are not independent evidence. Per-tool calibrated strengths describe each score, not the aggregate engine criterion.";
  }
  const disagreement = disagreementText(pe.primary);
  if (disagreement) b.warnings.push(disagreement);
  if (pe.primary.splicePp3Corroboration) b.warnings.push(pe.primary.splicePp3Corroboration);
  for (const note of pe.primary.vcepNotes) b.warnings.push(note);
  b.references = [...REPORT_SOURCES.slice(1, 3)];
}

export function populationExtras(b: ReportBlock, input: ReportDocumentInput) {
  const { result } = input;
  if (!result) return;
  // The report reads only the rule engine's criteria (not the narrative's), so that stays explicit.
  const fe = buildFrequencyEvidence(frequencyEvidenceInputFromResult(result, {
    engineCriteria: result.ruleBasedInsights?.acmgCriteria ?? null,
  }));
  const c = fe.criterion;
  if (c.absent) {
    b.facts.push({ label: "Allele frequency", value: "Not observed" });
    b.facts.push({ label: "Read from", value: frequencySourceLabel(fe) });
  } else if (c.af !== null) {
    b.facts.push({ label: "Allele frequency", value: formatAlleleFrequency(c.af), mono: true });
    b.facts.push({ label: "Read from", value: frequencySourceLabel(fe) });
  }
}

export function stabilityExtras(b: ReportBlock, energetics: Energetics, unit: EnergyUnit) {
  const rows = energetics.readings
    .filter(r => r.ddg !== null)
    .map(r => [r.name, signedDdgNumber(r.ddg, unit), r.callLabel ?? "Reading", r.counted ? "Counted in agreement" : "Not counted"]);
  if (rows.length) {
    b.table = { headers: ["Engine", `ΔΔG (${unit})`, "Call", "Role"], rows, numeric: [1] };
    const s = energeticsSummary(energetics, unit);
    // The lane keeps its own state and sentence when it read nothing (no engine counted), so the
    // report agrees with the Insights tab; the table still lists every returned value.
    if (b.status === "read") b.drafted = joinText([bold(sentence(s.lead)), s.rest.map(sentence).join(" ")]);
  }
  b.caption = "Positive ΔΔG means destabilising. Stability is not pathogenicity, and it is not an ACMG input.";
}

export function structureBlock(input: ReportDocumentInput, energetics: Energetics): ReportBlock {
  const b = blankBlock("structure");
  const { result } = input;
  const meta: any = result?.metadata ?? {};
  const s = energetics.structure;
  const hasModel = Boolean(meta.pdbId || meta.pdbSource || s);
  b.status = hasModel ? "read" : "absent";
  b.reads = [{ label: "Residue shifts & pockets", tab: "structure" }];
  if (!hasModel) {
    b.drafted = `${bold("No macromolecular model is loaded for this variant.")} Structural reasoning is not part of this report.`;
    return b;
  }
  const modelName = s?.pdbId ?? meta.pdbId ?? null;
  if (modelName) b.facts.push({ label: "Model", value: String(modelName), mono: true });
  if (meta.pdbSource) b.facts.push({ label: "Source", value: String(meta.pdbSource) });
  if (s?.chainId) b.facts.push({ label: "Chain", value: s.chainId, mono: true });
  if (typeof s?.resolution === "number") b.facts.push({ label: "Resolution", value: `${s.resolution.toFixed(2)} Å`, mono: true });
  if (typeof s?.identity === "number") b.facts.push({ label: "Identity to the canonical sequence", value: `${(s.identity * (s.identity <= 1 ? 100 : 1)).toFixed(0)}%`, mono: true });
  if (s?.repair) b.facts.push({ label: "Template repair", value: s.repair });
  if (typeof meta.residueIndex === "number") b.facts.push({ label: "Residue", value: `#${meta.residueIndex}`, mono: true });
  if (meta.wildType && meta.mutant) b.facts.push({ label: "Substitution", value: `${meta.wildType} → ${meta.mutant}`, mono: true });
  const mutant = input.foldingStatus === "success" ? "Built" : input.foldingStatus === "failed" ? "Failed" : input.foldingStatus === "unavailable" ? "Not built" : null;
  if (mutant) b.facts.push({ label: "Mutant model", value: mutant });
  const gaps = [
    typeof s?.resolution === "number" ? null : "resolution",
    s?.chainId ? null : "chain",
  ].filter(Boolean);
  b.drafted = gaps.length
    ? `The payload does not state the model's ${gaps.join(" or ")}, so this report does not either.`
    : "";
  return b;
}
