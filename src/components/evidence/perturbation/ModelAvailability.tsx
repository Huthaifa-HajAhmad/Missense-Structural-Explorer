import React from "react";
import { AlertTriangle } from "lucide-react";
import { ENTROPY_MARKS } from "../../../shared/modelCalibration";
import type { LmReading, ModelAction, PerturbationEvidence, ReadingAvailability } from "../../../shared/perturbationEvidence";

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

/** One recovery contract for the model notices and the standalone readings table. */
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

/**
 * What changes how one model's reading should be trusted, in the engine's own codes (never matched from
 * its error text). SaProt used to get a sequence-only note while its near-flat distribution, the reason
 * its reading is noise, went unsaid.
 */
function caveatClauses(l: LmReading, mut: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  if (l.caveats.includes("fallback-model")) {
    const causes = [l.serviceNote, l.fallbackReason ? `${l.family} could not run on this server` : null].filter(Boolean);
    parts.push(<>was produced by {l.name} instead{causes.length ? `, because ${causes.join(" and ")}` : ""}, so its row describes the model that ran</>);
  }
  if (l.caveats.includes("inferred-model")) parts.push(<>was not named in the payload, so its row is taken from your settings, not from what ran</>);
  if (l.caveats.includes("sequence-only")) parts.push(<>had no structure token at this residue and read it from sequence alone</>);
  if (l.caveats.includes("flat") && l.entropy !== null) {
    parts.push(<>spreads its probability almost evenly over the 20 residues ({l.entropy.toFixed(2)} of {ENTROPY_MARKS.ceiling.toFixed(2)} bits): it has no preference to read, and its rank is set aside</>);
  }
  if (l.caveats.includes("probability-floor")) {
    parts.push(<>did not return {mut} among its tokens, so its probability is the 1e-9 floor and ΔLLR is bounded by it, not measured</>);
  }
  return parts;
}

/** The sentence after the model's name: its caveats, or why it has no result. */
function NoticeSentence({ lm, parts, onAction }: { lm: LmReading; parts: React.ReactNode[]; onAction: (action: ModelAction) => void }) {
  if (lm.availability.state !== "computed") return <AvailabilityMessage a={lm.availability} onAction={onAction} />;
  return <>{parts.map((p, i) => <React.Fragment key={i}>{i > 0 && "; it "}{p}</React.Fragment>)}{parts.length > 0 && "."}</>;
}

const SETTINGS_PROMPT = {
  billing: "Open connection settings to add credits or another token",
  auth: "Open connection settings to replace the token"
} as const;

/**
 * One notice per model that needs the reader's attention: a caveat on its reading, a service message, an
 * engine diagnostic, or a missing result with its way to recover. Models with nothing to say get no notice.
 */
function ModelNotice({ lm, mut, onAction }: { lm: LmReading; mut: string; onAction: (action: ModelAction) => void }) {
  const ok = lm.availability.state === "computed";
  const parts = ok ? caveatClauses(lm, mut) : [];
  // A fallback's service note is already the cause named in its caveat.
  const serviceNote = lm.caveats.includes("fallback-model") ? null : lm.serviceNote;
  if (ok && parts.length === 0 && !serviceNote && lm.diagnostics.length === 0) return null;
  const code = lm.remoteFailure?.code;
  const settingsPrompt = code === "billing" || code === "auth" ? SETTINGS_PROMPT[code] : null;
  return (
    <div className="ptb-callout" data-tone={ok || lm.availability.state === "failed" ? "warning" : "neutral"} data-testid={`ptb-caveat-${lm.id}`}>
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <div>
        <p>
          <strong>{lm.family}</strong> <NoticeSentence lm={lm} parts={parts} onAction={onAction} />
          {serviceNote && <> {serviceNote}.</>}
          {settingsPrompt && <> <button type="button" className="ptb-link" onClick={() => onAction("settings")}>{settingsPrompt}</button></>}
        </p>
        {lm.diagnostics.length > 0 && <ul aria-label={`${lm.family} engine notes`}>
          {lm.diagnostics.map(d => <li key={d.tier}><strong>{d.tier}:</strong> {d.text}</li>)}
        </ul>}
      </div>
    </div>
  );
}

/** The model notices in one place, so a failed model's recovery action is never hidden behind a disclosure. */
export function ModelNotices({ evidence, onAction }: { evidence: PerturbationEvidence; onAction: (action: ModelAction) => void }) {
  const mut = evidence.residues.mutLabel || "the variant residue";
  return <section aria-label="Model notices" className="ptb-notices">
    {evidence.lms.map(lm => <ModelNotice key={lm.id} lm={lm} mut={mut} onAction={onAction} />)}
  </section>;
}

export function StatusChip({ a }: { a: Pick<ReadingAvailability, "state" | "label"> }) {
  return (
    <span className="ev-tier" data-tone={a.state === "pending" ? "neutral" : a.state === "failed" ? "warning" : "muted"}>
      {a.label}
    </span>
  );
}
