import React from "react";
import type { InsightsEvidence, Lane, EvidenceTabId } from "../../shared/insightsEvidence";
import { criterionForLane } from "../../shared/insightsEvidence";
import { formatEvidenceCode } from "../../shared/thresholds";

/**
 * The evidence map: one row per evidence area, with a small diverging chart of the engine's call.
 *
 * The chart is a fixed-width column so a bar's length reads against tick marks, one per ACMG strength
 * step (supporting, moderate, strong or above). Rows the engine never counts sit in their own group
 * below the rows that can carry a criterion, so a reader does not look for a vote that cannot exist.
 */
interface Props {
  evidence: InsightsEvidence;
  selected: string | null;
  onSelect: (key: string) => void;
  onOpenTab?: (tab: EvidenceTabId) => void;
}

function laneLabel(lane: Lane): string {
  const reading = lane.state === "read"
    ? lane.lean === "none" ? "no lean" : `leans ${lane.lean}`
    : lane.state === "pending" ? "live inputs still running" : "no reading";
  return `${lane.name}: ${reading}${lane.counted ? `, counted as ${lane.code}` : ", not counted"}`;
}

function LaneChart({ lane }: { lane: Lane }) {
  // No bar when the live inputs are unavailable: the label says "no reading", so the chart must agree.
  const hasBar = lane.state !== "absent" && (lane.counted || lane.state === "read") && lane.lean !== "none";
  return (
    <div className="ins-strip" role="img" aria-label={laneLabel(lane)} data-empty={hasBar ? undefined : ""}>
      {hasBar && <span className="ins-bar" data-lean={lane.lean} data-counted={lane.counted ? "true" : "false"} data-steps={lane.counted ? lane.length : undefined} />}
    </div>
  );
}

function LaneChips({ lane, strength }: { lane: Lane; strength?: string }) {
  if (lane.counted && lane.code) {
    return <><span className="ev-tier chip-code" data-tone={lane.lean === "benign" ? "good" : "danger"}>{formatEvidenceCode(lane.code)}</span>{strength && <span className="ins-dim">{strength}</span>}</>;
  }
  if (lane.unconfirmed) return <span className="ev-tier" data-tone="accent" data-unconfirmed="true">Unconfirmed</span>;
  if (lane.state === "pending") return <span className="ev-tier" data-tone="muted">Running</span>;
  // A context row is never counted, and its group heading already says so.
  if (lane.state === "read" && !lane.contextOnly) return <span className="ev-tier" data-tone="muted">Not counted</span>;
  return null;
}

function LaneRow({ lane, strength, selected, onSelect, onOpenTab }: { lane: Lane; strength?: string; selected: boolean; onSelect: () => void; onOpenTab?: (tab: EvidenceTabId) => void }) {
  return (
    <div className="ins-lane" data-lane={lane.key} data-selected={selected || undefined}>
      <div className="ins-lane__head">
        <button type="button" id={`ins-lane-${lane.key}`} className="ins-lane__name" aria-pressed={selected} onClick={onSelect}>{lane.name}</button>
        <span className="ins-lane__links">
          {lane.links.map(l => <button key={l.tab} type="button" className="ins-link" onClick={() => onOpenTab?.(l.tab)}>{l.label}</button>)}
        </span>
      </div>
      <LaneChart lane={lane} />
      <p className="ins-lane__line">
        <span className="ins-lane__chips"><LaneChips lane={lane} strength={strength} /></span>
        <strong>{lane.lead}</strong> {lane.rest}
      </p>
    </div>
  );
}

export function InsightsEvidenceMap({ evidence: ev, selected, onSelect, onOpenTab }: Props) {
  const row = (l: Lane) => (
    <LaneRow key={l.key} lane={l} strength={criterionForLane(ev, l)?.strength} selected={selected === l.key} onSelect={() => onSelect(l.key)} onOpenTab={onOpenTab} />
  );
  const criterionLanes = ev.lanes.filter(l => !l.contextOnly);
  const contextLanes = ev.lanes.filter(l => l.contextOnly);
  return (
    <>
      <section className="ins-card" aria-labelledby="ins-board-h">
        <div className="ins-card__head">
          <h2 className="ins-label" id="ins-board-h">Evidence direction</h2>
          <span className="ins-key"><span><i data-k="path" />pathogenic, counted</span><span><i data-k="ben" />benign, counted</span><span><i data-k="ctx" />leans, not counted</span></span>
        </div>
        <div className="ins-axis" aria-hidden="true">
          <span />
          <div className="ins-axis__scale"><span>← Benign</span><span>Pathogenic →</span></div>
          <span />
        </div>
        {criterionLanes.map(row)}
        {contextLanes.length > 0 && (
          <div role="group" aria-labelledby="ins-ctx-h" className="ins-lane-group">
            <h3 className="ins-lane-group__head" id="ins-ctx-h">Context the engine never counts</h3>
            {contextLanes.map(row)}
          </div>
        )}
        <div className="ins-card__foot"><span><b>Ticks</b> mark one strength step each: supporting, moderate, strong or above. The scale is ordinal, not a probability. A dashed bar has no code and no magnitude; a faded track means no reading or no lean. The areas are not independent votes and are never summed: the tier comes from the Richards et al. 2015 combining table.</span></div>
      </section>

      {(ev.agree.length > 0 || ev.differ.length > 0) && (
        <section className="ins-card" aria-labelledby="ins-cmp-h">
          <div className="ins-card__head"><h2 className="ins-label" id="ins-cmp-h">Compare and contrast</h2></div>
          <div className="ins-two">
            <div>
              <h3>Where the evidence agrees</h3>
              {ev.agree.length ? <ul>{ev.agree.map(a => <li key={a.text}>{a.text}</li>)}</ul> : <p className="ins-p ins-dim">No agreement identified between the available evidence areas.</p>}
            </div>
            <div>
              <h3>Where it pulls apart</h3>
              {ev.differ.length ? <ul>{ev.differ.map(a => <li key={a.text}>{a.text}</li>)}</ul> : <p className="ins-p ins-dim">No disagreement identified among the available readings. Missing evidence can still change this picture.</p>}
            </div>
          </div>
          <div className="ins-card__foot"><span>These comparisons describe available readings, including uncounted context. Only recorded criteria enter the classification; no new score is made.</span></div>
        </section>
      )}
    </>
  );
}
