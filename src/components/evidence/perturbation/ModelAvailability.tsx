import React from "react";
import type { ModelAction, PerturbationEvidence, ReadingAvailability } from "../../../shared/perturbationEvidence";
import { ResearchGuideButton } from "../../knowledge/ResearchGuideButton";

export function AvailabilityCell({
  a,
  colSpan,
  onAction
}: {
  a: ReadingAvailability;
  colSpan: number;
  onAction: (action: ModelAction) => void;
}) {
  return <td className="ptb-reason" colSpan={colSpan}><AvailabilityMessage a={a} onAction={onAction} /></td>;
}

/** One recovery contract for the model disclosure and the standalone readings table. */
function AvailabilityMessage({ a, onAction }: {
  a: ReadingAvailability;
  onAction: (action: ModelAction) => void;
}) {
  return (
    <>
      {a.state === "pending" ? <span className="ptb-dim">Still being computed for this variant.</span> : a.reason}
      {a.action && a.state !== "pending" && (
        <span className="ptb-actions">
          {a.action === "switch-saprot-35m" && (
            <button type="button" className="ptb-link" onClick={() => onAction("switch-saprot-35m")}>Run SaProt 35M instead</button>
          )}
          {(a.action === "retry" || a.action === "switch-saprot-35m") && (
            <button type="button" className="ptb-link" onClick={() => onAction("retry")}>Re-run</button>
          )}
          {a.action === "settings" && (
            <button type="button" className="ptb-link" onClick={() => onAction("settings")}>Open connection settings</button>
          )}
        </span>
      )}
    </>
  );
}

/** Provenance and recovery are unique content, even when numeric readings are deduplicated. */
export function ModelSupport({ evidence, onAction }: {
  evidence: PerturbationEvidence;
  onAction: (action: ModelAction) => void;
}) {
  return <section aria-label="Model provenance and recovery">
    {evidence.lms.map(lm => <div key={lm.id} className="ptb-model-record">
      <h3>{lm.family} <StatusChip a={lm.availability} /></h3>
      <p>{lm.description} <ResearchGuideButton topic={/vesm/i.test(lm.servedBy ?? '') ? 'vesm' : lm.id} label={`About ${lm.name}`} iconOnly /></p>
      {lm.servedBy && <p>Served by {lm.servedBy}</p>}
      <p>Scoring: {lm.scoringMethod === 'masked-marginal' ? 'the residue is hidden, then the model scores all 20 amino acids there' : lm.scoringMethod === 'wild-type-marginal' ? 'the model reads the normal sequence with the residue present, then scores all 20 amino acids there' : lm.scoringMethod ?? 'not recorded by this engine'}.</p>
      {lm.serviceNote && <p>
        {lm.serviceNote}.{' '}
        {(lm.remoteFailure?.code === 'billing' || lm.remoteFailure?.code === 'auth') && (
          <button type="button" className="ptb-link" onClick={() => onAction('settings')}>
            {lm.remoteFailure.code === 'billing' ? 'Open connection settings to add credits or another token' : 'Open connection settings to replace the token'}
          </button>
        )}
      </p>}
      {lm.diagnostics.length > 0 && <ul aria-label={`${lm.family} engine notes`}>
        {lm.diagnostics.map(d => <li key={d.tier}><strong>{d.tier}:</strong> {d.text}</li>)}
      </ul>}
      {lm.availability.state !== 'computed' && <p className="ptb-reason"><AvailabilityMessage a={lm.availability} onAction={onAction} /></p>}
    </div>)}
  </section>;
}

export function StatusChip({ a }: { a: Pick<ReadingAvailability, "state" | "label"> }) {
  return (
    <span className="ev-tier" data-tone={a.state === "pending" ? "neutral" : a.state === "failed" ? "warning" : "muted"}>
      {a.label}
    </span>
  );
}
