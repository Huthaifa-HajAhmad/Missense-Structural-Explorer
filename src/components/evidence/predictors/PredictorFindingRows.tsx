import React from "react";
import { ENGINE_STATE_LABELS } from "../../../shared/engineStatus";
import { PREDICTOR_TOOL_LABEL } from "../../../shared/insilico/primaryPredictor";
import { formatEvidenceCode } from "../../../shared/thresholds";
import { predictorUseLabel, type PredictorEvidence, type PredictorReading } from "../../../shared/predictorEvidence";
import { CHAIN_ORDER_TEXT } from "../../../shared/predictorSummary";
import { ScoreRuler } from "./ScoreRuler";

/**
 * The finding rows of the Predictors tab: the engine's recorded code, the fixed order of calibrated
 * tools (which one answered), and the answering tool on its own ruler with its published bands.
 * Every fact comes from `buildPredictorEvidence`; nothing here tests a score.
 */

export function EngineChip({ evidence }: { evidence: PredictorEvidence }) {
  const { engine, primary } = evidence;
  if (engine.known) {
    const code = engine.code;
    const tone = !code ? (engine.withheldByWeighting ? "muted" : "neutral") : code.startsWith("PP3") ? "danger" : "good";
    return (
      <span
        className={`ev-tier prd-verdict shrink-0${code ? " chip-code" : ""}`}
        data-tone={tone}
        data-testid="predictor-verdict"
        title={code ? "The in-silico criterion the engine recorded for this run" : "The engine recorded no PP3 or BP4 for this run"}
      >
        {code ? formatEvidenceCode(code) : "No PP3 / BP4"}
      </span>
    );
  }
  if (primary.code) {
    const code = formatEvidenceCode(primary.code);
    return (
      <span
        className="ev-tier prd-verdict chip-code shrink-0"
        data-tone="accent"
        data-testid="predictor-verdict"
        data-unconfirmed="true"
        title={`${code} is what the rule gives — this payload carries no engine record to confirm it against`}
        aria-label={`${code}, given by the rule, unconfirmed by the engine record`}
      >
        {code}
      </span>
    );
  }
  return (
    <span className="ev-tier prd-verdict shrink-0" data-tone="neutral" data-testid="predictor-verdict">
      No PP3 / BP4
    </span>
  );
}

/** The chip that closes a finding row: a code in its tone, or a plain word. */
function RowChip({ code, testId }: { code: string | null; testId: string }) {
  if (!code) return <span className="ev-tier" data-tone="neutral" data-testid={testId}>Neither</span>;
  const direction = code.startsWith("PP3") ? "danger" : code.startsWith("BP4") ? "good" : "neutral";
  return (
    <span className={`ev-tier${direction !== "neutral" ? " chip-code" : ""}`} data-tone={direction} data-testid={testId}>
      {formatEvidenceCode(code)}
    </span>
  );
}

type ChainCall = "path" | "benign" | "vus" | "none";
const CALL_OF: Record<PredictorReading["signal"], ChainCall> = { pathogenic: "path", benign: "benign", vus: "vus", unavailable: "none" };

/**
 * The fixed order as one bar: a segment per calibrated tool, in order, coloured by its own band.
 * The tool that set PP3/BP4 is marked; the tools before it had no score; the tools after it are
 * read only for the disagreement note.
 */
export function ChainRow({ evidence }: { evidence: PredictorEvidence }) {
  const { primary } = evidence;
  const chain = evidence.readings.filter(r => r.chainKey !== null);
  const disagreeing = new Set(primary.disagreeingTools.map(d => d.key));
  const roleOf = (r: PredictorReading) =>
    r.chainKey === primary.activeTool ? "active"
    : primary.skippedBefore.includes(r.chainKey!) ? "skipped"
    : disagreeing.has(r.chainKey!) ? "disagrees"
    : "after";
  const activeName = primary.activeTool
    ? (chain.find(r => r.chainKey === primary.activeTool)?.name ?? PREDICTOR_TOOL_LABEL[primary.activeTool])
    : null;
  const title = primary.vcepRule
    ? (primary.vcepApplied
      ? `ClinGen VCEP · ${primary.vcepRule.cspecId} v${primary.vcepRule.version}`
      : `Fixed order · VCEP advisory (${primary.vcepRule.cspecId} v${primary.vcepRule.version})`)
    : "Fixed order";
  // When the rule withheld the call, the reason is the line to read, not the general order sentence.
  const spliceReason = primary.spliceGate && "reason" in primary.spliceGate ? primary.spliceGate.reason : null;
  const withheldReason = primary.outcome === "blocked-spliceai" || primary.outcome === "withheld-spliceai" ? spliceReason : null;
  const sub = primary.vcepRule
    ? primary.vcepRule.summary
    : withheldReason ?? "The first calibrated tool with a score sets PP3/BP4";
  const keyText = (() => {
    if (primary.outcome === "vcep-excluded") return "Missense computational predictors excluded by ClinGen VCEP.";
    if (primary.criterionSource === "spliceai") {
      return `SpliceAI max Δ ${primary.activeScore?.toFixed(2) ?? ""} triggered splicing ${formatEvidenceCode(primary.code!)}.`;
    }
    if (primary.activeTool === null) {
      if (primary.outcome === "withheld-base") {
        return evidence.pending ? "Waiting for dbNSFP scores." : "The dbNSFP scores did not arrive; re-run the analysis to get PP3/BP4.";
      }
      if (primary.vcepNotes.length > 0 && primary.outcome === "indeterminate") return primary.vcepNotes[0];
      return "No calibrated tool scored this variant.";
    }
    return `${activeName} answered${primary.skippedBefore.length ? ` after ${primary.skippedBefore.length} without a score` : ""}${primary.disagreeingTools.length ? ` · ${primary.disagreeingTools.length} ${primary.disagreeingTools.length === 1 ? "points" : "point"} the other way` : ""}.`;
  })();
  return (
    <div className="prd-frow" data-testid="predictor-chain-row" data-outcome={primary.outcome}>
      <div className="prd-frow__label">
        <span className="prd-frow__name">{title}</span>
        <span className="prd-frow__sub">{sub}</span>
      </div>
      <div className="prd-frow__body">
        <ol className="prd-tally" aria-label={`Calibrated tools in order: ${CHAIN_ORDER_TEXT}`}>
          {chain.map(r => {
            const role = roleOf(r);
            return (
              <li
                key={r.key}
                className="prd-tally__tool"
                data-call={CALL_OF[r.signal]}
                data-role={role}
                title={`${r.name}: ${r.scoreText} — ${formatEvidenceCode(r.callLabel)} (${predictorUseLabel(r, primary)})`}
              >
                <i className="prd-tally__seg" aria-hidden="true" />
                <span className="prd-tally__name">{r.name}</span>
              </li>
            );
          })}
        </ol>
        <p className="prd-tally__key" data-testid="predictor-chain-key">{keyText}</p>
      </div>
      <div className="prd-frow__call">
        <RowChip code={primary.code} testId="predictor-chain-call" />
      </div>
    </div>
  );
}

/** The answering tool on its own ruler with its published bands. Absence is a state, not a gap. */
export function PrimaryToolRow({ evidence }: { evidence: PredictorEvidence }) {
  const { primary } = evidence;
  const reading = primary.activeTool === "cadd"
    ? evidence.readings.find(r => r.key === "cadd") ?? null
    : primary.activeTool && primary.activeTool !== "spliceai"
    ? evidence.readings.find(r => r.chainKey === primary.activeTool) ?? null
    : null;
  const call = primary.activeCall;
  const isSplicePrimary = primary.activeTool === "spliceai" && primary.activeScore !== null && primary.code !== null;
  const pending = !reading && !isSplicePrimary && evidence.readings.some(r => r.chainKey !== null && r.availability.state === "pending");
  const subLabel = isSplicePrimary
    ? (primary.vcepRule?.splice?.pp3Missense && primary.vcepRule.splice.pp3Missense !== "none"
      ? `SpliceAI · ${primary.vcepRule.vcep} (${primary.vcepRule.cspecId} v${primary.vcepRule.version})`
      : "SpliceAI · Walker 2023 splicing rule")
    : reading
    ? (primary.criterionSource === "vcep" && primary.vcepRule
      ? `${reading.name} · ${primary.vcepRule.vcep} (${primary.vcepRule.cspecId} v${primary.vcepRule.version})`
      : `${reading.name} · ClinGen, ${reading.cutpoints.source}`)
    : CHAIN_ORDER_TEXT;
  return (
    <div className="prd-frow" data-testid="predictor-primary-row" data-outcome={primary.outcome}>
      <div className="prd-frow__label">
        <span className="prd-frow__name">Primary tool</span>
        <span className="prd-frow__sub">{subLabel}</span>
      </div>
      <div className="prd-frow__body">
        {isSplicePrimary ? (
          <span className="prd-frow__note">
            <span className="prd-mono">SpliceAI max Δ {primary.activeScore!.toFixed(2)}</span>{" "}
            supports splicing {formatEvidenceCode(primary.code!)} (PP3 applied once when PVS1 is absent)
          </span>
        ) : reading && call ? (
          <>
            <ScoreRuler reading={reading} thresholds="all" />
            <span className="prd-frow__note">
              <span className="prd-mono">{reading.scoreText}</span>{" "}
              {call.direction ? <>sits in the {formatEvidenceCode(call.code)} band</> : "sits between the PP3 and BP4 bands"}
            </span>
          </>
        ) : (
          <span className="prd-dim">
            {primary.outcome === "vcep-excluded"
              ? (primary.vcepRule
                ? `${primary.vcepRule.vcep} (${primary.vcepRule.cspecId} v${primary.vcepRule.version}) excludes missense computational predictors.`
                : "Missense computational predictors excluded by ClinGen VCEP.")
              : primary.outcome === "indeterminate"
              ? (primary.vcepNotes[primary.vcepNotes.length - 1] ?? "VCEP multi-tool threshold requirement was not met (tools disagreed or sat between bands).")
              : pending ? "Still being computed for this variant."
              : primary.outcome === "withheld-base" ? "The dbNSFP scores did not arrive, so the primary tool is not known."
              : "None of the calibrated tools scored this variant."}
          </span>
        )}
      </div>
      <div className="prd-frow__call">
        {isSplicePrimary ? (
          <RowChip code={primary.code} testId="predictor-primary-call" />
        ) : call ? (
          call.direction ? <RowChip code={call.code} testId="predictor-primary-call" />
          : <span className="ev-tier" data-tone="neutral" data-testid="predictor-primary-call">Indeterminate</span>
        ) : primary.outcome === "indeterminate" ? (
          <span className="ev-tier" data-tone="neutral" data-testid="predictor-primary-call">Indeterminate</span>
        ) : (
          <span className="ev-tier" data-tone={pending ? "neutral" : "muted"} data-testid="predictor-primary-call">
            {primary.outcome === "vcep-excluded" ? "Excluded" : pending ? ENGINE_STATE_LABELS.running : ENGINE_STATE_LABELS["no-result"]}
          </span>
        )}
      </div>
    </div>
  );
}
