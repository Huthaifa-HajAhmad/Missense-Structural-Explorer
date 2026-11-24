import React from "react";
import { ENGINE_STATE_LABELS } from "../../../shared/engineStatus";
import { formatEvidenceCode } from "../../../shared/thresholds";
import type { PredictorEvidence, PredictorReading } from "../../../shared/predictorEvidence";
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
  const roleText = { active: "sets PP3/BP4", skipped: "no score", disagrees: "points the other way", after: "not used for strength" } as const;
  return (
    <div className="prd-frow" data-testid="predictor-chain-row" data-outcome={primary.outcome}>
      <div className="prd-frow__label">
        <span className="prd-frow__name">Fixed order</span>
        <span className="prd-frow__sub">The first calibrated tool with a score sets PP3/BP4</span>
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
                title={`${r.name}: ${r.scoreText} — ${formatEvidenceCode(r.callLabel)} (${roleText[role]})`}
              >
                <i className="prd-tally__seg" aria-hidden="true" />
                <span className="prd-tally__name">{r.name}</span>
              </li>
            );
          })}
        </ol>
        <p className="prd-tally__key" data-testid="predictor-chain-key">
          {primary.activeTool === null
            ? (primary.outcome !== "withheld-base" ? "No calibrated tool scored this variant."
              : evidence.pending ? "Waiting for dbNSFP scores."
              : "The dbNSFP scores did not arrive; re-run the analysis to get PP3/BP4.")
            : `${chain.find(r => r.chainKey === primary.activeTool)?.name} answered${primary.skippedBefore.length ? ` after ${primary.skippedBefore.length} without a score` : ""}${primary.disagreeingTools.length ? ` · ${primary.disagreeingTools.length} ${primary.disagreeingTools.length === 1 ? "points" : "point"} the other way` : ""}.`}
        </p>
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
  const reading = primary.activeTool ? evidence.readings.find(r => r.chainKey === primary.activeTool) ?? null : null;
  const call = primary.activeCall;
  const pending = !reading && evidence.readings.some(r => r.chainKey !== null && r.availability.state === "pending");
  return (
    <div className="prd-frow" data-testid="predictor-primary-row" data-outcome={primary.outcome}>
      <div className="prd-frow__label">
        <span className="prd-frow__name">Primary tool</span>
        <span className="prd-frow__sub">{reading ? `${reading.name} · ClinGen, ${reading.cutpoints.source}` : CHAIN_ORDER_TEXT}</span>
      </div>
      <div className="prd-frow__body">
        {reading && call ? (
          <>
            <ScoreRuler reading={reading} thresholds="all" />
            <span className="prd-frow__note">
              <span className="prd-mono">{reading.scoreText}</span>{" "}
              {call.direction ? <>sits in the {formatEvidenceCode(call.code)} band</> : "sits between the PP3 and BP4 bands"}
            </span>
          </>
        ) : (
          <span className="prd-dim">
            {pending ? "Still being computed for this variant."
              : primary.outcome === "withheld-base" ? "The dbNSFP scores did not arrive, so the primary tool is not known."
              : "None of the calibrated tools scored this variant."}
          </span>
        )}
      </div>
      <div className="prd-frow__call">
        {call ? (
          call.direction ? <RowChip code={call.code} testId="predictor-primary-call" />
          : <span className="ev-tier" data-tone="neutral" data-testid="predictor-primary-call">Indeterminate</span>
        ) : (
          <span className="ev-tier" data-tone={pending ? "neutral" : "muted"} data-testid="predictor-primary-call">
            {pending ? ENGINE_STATE_LABELS.running : ENGINE_STATE_LABELS["no-result"]}
          </span>
        )}
      </div>
    </div>
  );
}
