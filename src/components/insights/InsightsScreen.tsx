import React, { useEffect } from "react";
import { ReviewNavigation, useReviewWorkspace } from "../review/ReviewWorkspace";
import type { InsightsEvidence, Lane, EvidenceTabId } from "../../shared/insightsEvidence";
import { TIERS } from "../../shared/insightsEvidence";
import { ACMG_SOURCE_LABEL } from "../../shared/acmgCriteriaView";
import { NARRATIVE_PROMPT_EVIDENCE } from "../../shared/narrativeSynthesis";
import { formatEvidenceCode } from "../../shared/thresholds";
import { Prose } from "../ui/Prose";

export interface InsightsNarrative {
  paragraphs: string[];
  /** The narrative's own section the excerpt was taken from. */
  sourceSection: string | null;
  truncated: boolean;
  isAi: boolean;
  model: string | undefined;
}

interface Props {
  evidence: InsightsEvidence;
  narrative: InsightsNarrative | null;
  onOpenTab?: (tab: EvidenceTabId) => void;
  onOpenReport?: () => void;
}

const LEN: Record<1 | 2 | 3, string> = { 1: "14%", 2: "26%", 3: "38%" };

const sideOf = (i: number): "pathogenic" | "benign" | undefined => (i >= 3 ? "pathogenic" : i <= 1 ? "benign" : undefined);

function CodeChip({ code, tone }: { code: string; tone: "danger" | "good" | "muted" }) {
  return <span className="ev-tier chip-code" data-tone={tone}>{formatEvidenceCode(code)}</span>;
}

function LaneRow({ lane, strength, selected, onSelect, onOpenTab }: { lane: Lane; strength?: string; selected: boolean; onSelect: () => void; onOpenTab?: (tab: EvidenceTabId) => void }) {
  const label = `${lane.name}: ${lane.state === "read"
    ? lane.lean === "none" ? "no lean" : `leans ${lane.lean}`
    : lane.state === "pending" ? "still running" : "no reading"}${lane.counted ? `, counted as ${lane.code}` : ", not counted"}`;
  return (
    <div className="ins-lane" data-lane={lane.key} data-selected={selected || undefined}>
      <div>
        <button type="button" id={`ins-lane-${lane.key}`} className="ins-lane__name" aria-pressed={selected} onClick={onSelect}>{lane.name}</button>
        <span className="ins-lane__links">
          {lane.links.map(l => (
            <button key={l.tab} type="button" className="ins-link" onClick={() => onOpenTab?.(l.tab)}>{l.label}</button>
          ))}
        </span>
      </div>
      <div>
        <div className="ins-strip" role="img" aria-label={label}>
          {(lane.counted || lane.state === "read") && lane.lean !== "none" ? (
            <span
              className="ins-bar"
              data-lean={lane.lean}
              data-counted={lane.counted ? "true" : "false"}
              style={{ ["--ins-len" as string]: lane.counted ? LEN[lane.length] : "10%" }}
            />
          ) : (
            <span className="ins-dot" />
          )}
        </div>
        <p className="ins-lane__line">
          <span className="ins-lane__chips">
            {lane.counted && lane.code && <CodeChip code={lane.code} tone={lane.lean === "benign" ? "good" : "danger"} />}
            {lane.counted && strength && <span className="ins-dim">{strength}</span>}
            {!lane.counted && lane.unconfirmed && <span className="ev-tier" data-tone="accent" data-unconfirmed="true">Unconfirmed</span>}
            {!lane.counted && !lane.unconfirmed && lane.state === "read" && <span className="ev-tier" data-tone="muted">Not counted</span>}
            {lane.state === "pending" && <span className="ev-tier" data-tone="muted">Running</span>}
          </span>
          <strong>{lane.lead}</strong> {lane.rest}
        </p>
      </div>
    </div>
  );
}

export function InsightsScreen({ evidence: ev, narrative, onOpenTab, onOpenReport }: Props) {
  const w = useReviewWorkspace('insights');
  useEffect(() => {
    if (!w.reveal || !w.selected || w.view !== 'map') return;
    document.getElementById(`ins-lane-${w.selected}`)?.focus({ preventScroll: true });
    document.getElementById(`ins-lane-${w.selected}`)?.scrollIntoView?.({ block: 'nearest' });
    w.finishReveal();
  }, [w.reveal, w.selected, w.view]);
  const gap = ev.gap;
  const tone = ev.tierIndex >= 3 ? "danger" : ev.tierIndex <= 1 ? "good" : "neutral";
  return (
    <div className="ins-screen" id="insights-screen">
      {/* 1 · The finding */}
      <section className="ins-finding" aria-labelledby="ins-finding-h">
        <div className="ins-card__head">
          <h2 className="ins-label" id="ins-finding-h">The consolidated case</h2>
          {ev.weighting && <span className="ev-tier" data-tone="muted">Weighting: {ev.weighting}</span>}
        </div>
        <div className="ins-hero__body">
          <span><span className="ev-tier ev-tier--lg" data-tone={tone}>Rule-engine classification</span></span>
          <p className="ins-hero__figure">{ev.verdictText ?? "Not classified"}</p>
          <Prose className="ins-hero__finding"><strong>{ev.finding.headline}</strong> {ev.finding.rest}</Prose>
        </div>
        {ev.droppedEngineOwned.length > 0 && (
          <div className="ins-callout">
            <p>
              <strong>The model proposed {ev.droppedEngineOwned.map(d => d.code).join(", ")}, and it is left out.</strong>{" "}
              The engine decides {ev.droppedEngineOwned.length === 1 ? "that code" : "those codes"} from data the model was not shown, so a proposal there cannot outrank &ldquo;not met&rdquo;.
            </p>
          </div>
        )}
        {ev.recordMismatch && (
          <div className="ins-callout" data-tone="warning">
            <p><strong>The recorded tier and the current rule disagree.</strong> This payload was classified by an earlier engine. Re-run the variant to refresh it.</p>
          </div>
        )}
        <details className="ins-method"><summary>Classification scale and combining rule</summary>        <div className="ins-tiers">
          <span className="ins-label">ACMG five-tier scale</span>
          <div className="ins-tiers__row" role="img" aria-label={`Tier: ${ev.tier ?? "not classified"}`}>
            {TIERS.map((t, i) => (
              <div key={t} className="ins-tier" data-active={i === ev.tierIndex ? "" : undefined} data-side={i === ev.tierIndex ? sideOf(i) : undefined}>{t}</div>
            ))}
          </div>
        </div>
<p>Richards et al. 2015 combining table, the same function that produced the tier. The areas below are not independent votes and are never summed.</p></details>
      </section>

      <ReviewNavigation tab="insights" workspace={w} />
      <div role="tabpanel" id={`review-insights-panel-${w.view}`} aria-labelledby={`review-insights-tab-${w.view}`}>
      {w.view === 'map' && <>
      {/* 2 · Evidence board */}
      <section className="ins-card" aria-labelledby="ins-board-h">
        <div className="ins-card__head">
          <h2 className="ins-label" id="ins-board-h">Evidence direction</h2>
          <span className="ins-key"><span><i data-k="path" />pathogenic, counted</span><span><i data-k="ben" />benign, counted</span><span><i data-k="ctx" />leans, not counted</span></span>
        </div>
        <div className="ins-axis"><span />
          <div className="ins-axis__scale ins-label"><span>Benign ←</span><span>→ Pathogenic</span></div>
        </div>
        {ev.lanes.map(l => <LaneRow key={l.key} lane={l} strength={ev.criteria.find(c => c.code === l.code)?.strength} selected={w.selected === l.key} onSelect={() => w.select(l.key)} onOpenTab={onOpenTab} />)}
        <div className="ins-card__foot"><span><b>Bar length:</b> supporting, moderate, or strong and above. The exact recorded strength is labelled; the scale is ordinal, not a probability. Dashed bars have no code and carry no magnitude.</span></div>
      </section>

      {/* 3 · Compare and contrast */}
      {(ev.agree.length > 0 || ev.differ.length > 0) && (
        <section className="ins-card" aria-labelledby="ins-cmp-h">
          <div className="ins-card__head"><h2 className="ins-label" id="ins-cmp-h" style={{ margin: 0 }}>Compare and contrast</h2></div>
          <div className="ins-two">
            <div>
              <h3>Where the evidence agrees</h3>
              {ev.agree.length ? <ul>{ev.agree.map(a => <li key={a.text}>{a.text}</li>)}</ul> : <p className="ins-p ins-dim">No two areas point the same way.</p>}
            </div>
            <div>
              <h3>Where it pulls apart</h3>
              {ev.differ.length ? <ul>{ev.differ.map(a => <li key={a.text}>{a.text}</li>)}</ul> : <p className="ins-p ins-dim">Nothing conflicts.</p>}
            </div>
          </div>
          <div className="ins-card__foot"><span>Each line comes from the tabs&apos; own recorded calls. No new score is made.</span></div>
        </section>
      )}

      {/* Model proposals for codes the engine cannot compute: listed, never counted. */}
      {ev.proposals.length > 0 && (
        <section className="ins-card" aria-labelledby="ins-prop-h">
          <div className="ins-card__head">
            <h2 className="ins-label" id="ins-prop-h" style={{ margin: 0 }}>Proposed by the model · not counted</h2>
          </div>
          <div className="ins-proposals">
            {ev.proposals.map(p => (
              <div className="ins-proposal" key={p.code}>
                <div><span className="ev-tier chip-code" data-tone="accent" data-unconfirmed="true">{p.code}</span> <span className="ins-dim">{ACMG_SOURCE_LABEL.ai_suggested}</span></div>
                <p className="ins-p">{p.reason}</p>
              </div>
            ))}
          </div>
          <div className="ins-card__foot"><span>The engine cannot compute {ev.proposals.map(p => p.code).join(", ")}, so nothing here has been checked against data.</span></div>
        </section>
      )}

      {gap && <section className="ins-gap" aria-label="What would move the classification">
        <h3>What would move it</h3>
        {gap.options.length > 0 ? <><p className="ins-p">To reach <strong>{gap.target.toLowerCase()}</strong>, the engine needs one of these in addition to {gap.have}:</p><ul>{gap.options.map(o => <li key={o}>{o}</li>)}</ul></> : <p className="ins-p">{gap.sentence}</p>}
        <p className="ins-dim">Hypothetical additions evaluated by the engine’s own combining rule.</p>
      </section>}
      {/* 4 · Still needed */}
      <section className="ins-card" aria-labelledby="ins-need-h">
        <div className="ins-card__head"><h2 className="ins-label" id="ins-need-h" style={{ margin: 0 }}>Still needed to decide</h2></div>
        <dl className="ins-rows">
          {ev.needed.map(n => (
            <div key={n.code}>
              <dt>{n.title} <span className="ins-dim ins-mono">({n.code})</span></dt>
              <dd>{n.text}{n.tab && <> <button type="button" className="ins-link" onClick={() => onOpenTab?.(n.tab!)}>Open tab</button></>}</dd>
            </div>
          ))}
        </dl>
      </section>

      </>}
      {w.view === 'records' && <section className="ins-records" aria-labelledby="ins-records-h">
        <header className="ins-view-heading"><h2 id="ins-records-h">Criterion records</h2><p>Every criterion the engine owns, including withheld and missing records. Only recorded criteria enter the classification.</p></header>
        <div className="ins-record-table-wrap"><table className="ins-record-table"><thead><tr><th scope="col">Criterion</th><th scope="col">Engine state</th><th scope="col">Recorded reason</th></tr></thead>
          <tbody>{ev.criteria.map(c => <tr key={c.code}><th scope="row"><span className="ins-mono">{formatEvidenceCode(c.code)}</span><small>{c.strength}</small></th><td>{c.state}</td><td>{c.reason}{c.tab && <button type="button" className="ins-link" onClick={() => onOpenTab?.(c.tab!)}>Open source tab</button>}</td></tr>)}</tbody>
        </table></div>
      </section>}
      {w.view === 'summary' && !narrative && <section className="ins-view-heading"><h2>No written summary yet</h2><p>The evidence map and criterion records are available independently. Generate an optional summary from Report.</p><button type="button" className="ins-link" onClick={onOpenReport}>Open the full report</button></section>}
      {/* 5 · Plain-language guide */}
      {w.view === "records" && <details className="ins-card ins-details">
        <summary className="ins-card__head"><span className="ins-label">New to this? Plain-language guide</span><span className="ev-tier" data-tone="muted">optional</span></summary>
        <dl className="ins-rows">
          {ev.glossary.map(g => (<div key={g.term}><dt>{g.term}</dt><dd>{g.text}</dd></div>))}
        </dl>
      </details>}

      {/* 6 · Written summary */}
      {w.view === "summary" && narrative && (
        <section className="ins-card" aria-labelledby="ins-sum-h">
          <div className="ins-card__head">
            <h2 className="ins-label" id="ins-sum-h" style={{ margin: 0 }}>Clinical summary</h2>
            <span className="ins-card__chips">
              {narrative.truncated && <span className="ins-label">Excerpt — continues</span>}
              <span className="ev-tier" data-tone="muted">{narrative.isAi ? "AI-written" : "Rule-based"}</span>
            </span>
          </div>
          <div className="ins-prose">
            {narrative.sourceSection && <p className="ins-label">{narrative.sourceSection}</p>}
            {narrative.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
          </div>
          <div className="ins-card__foot">
            {narrative.isAi
              ? <>
                  <span>{`AI-synthesised${narrative.model ? ` by ${narrative.model}` : ""} — condensed for this view; the Report holds the complete text.`}</span>
                  <span><b>Shown to the model:</b> {NARRATIVE_PROMPT_EVIDENCE.sent.join(", ")}. <b>Not shown:</b> {NARRATIVE_PROMPT_EVIDENCE.notSent.join(", ")}.</span>
                </>
              : <span>Rule-based synthesis — assembled from retrieved database evidence, not from a language model.</span>}
            <button type="button" className="ins-link" onClick={onOpenReport}>{narrative.truncated ? "Read the full narrative in the Report" : "Open the full report"}</button>
          </div>
        </section>
      )}
      </div>
    </div>
  );
}

export default InsightsScreen;
