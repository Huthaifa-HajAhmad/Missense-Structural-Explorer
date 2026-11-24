import React, { useEffect } from "react";
import { ReviewNavigation, useReviewWorkspace } from "../review/ReviewWorkspace";
import type { InsightsEvidence, EvidenceTabId, CriterionRow } from "../../shared/insightsEvidence";
import { TIERS, NO_RECORD_REASON } from "../../shared/insightsEvidence";
import { ACMG_SOURCE_LABEL } from "../../shared/acmgCriteriaView";
import { formatEvidenceCode } from "../../shared/thresholds";
import { Prose } from "../ui/Prose";
import { InsightsEvidenceMap } from "./InsightsEvidenceMap";

export interface InsightsNarrative {
  paragraphs: string[];
  /** The narrative's own section the excerpt was taken from. */
  sourceSection: string | null;
  truncated: boolean;
  isAi: boolean;
  model: string | undefined;
  /** The evidence changed after the narrative was written (`narrativeFreshness` is "outdated"). */
  outdated: boolean;
}

interface Props {
  evidence: InsightsEvidence;
  narrative: InsightsNarrative | null;
  onOpenTab?: (tab: EvidenceTabId) => void;
  onOpenReport?: () => void;
}

const sideOf = (i: number): "pathogenic" | "benign" | undefined => (i >= 3 ? "pathogenic" : i <= 1 ? "benign" : undefined);

function Finding({ ev }: { ev: InsightsEvidence }) {
  const tone = ev.tierIndex >= 3 ? "danger" : ev.tierIndex <= 1 ? "good" : "neutral";
  return (
    <section className="ins-finding" aria-labelledby="ins-finding-h">
      <h2 className="ins-label ins-finding__label" id="ins-finding-h" data-tone={tone}>Rule-engine classification</h2>
      <div className="ins-hero__body">
        <p className="ins-hero__figure">{ev.verdictText ?? "Not classified"}</p>
        {ev.tier && (
          <div className="ins-tiers" role="img" aria-label={`ACMG tier ${ev.tierIndex + 1} of 5: ${ev.tier}`}>
            {TIERS.map((t, i) => (
              <span key={t} className="ins-tier" aria-current={i === ev.tierIndex ? "true" : undefined} data-side={i === ev.tierIndex ? sideOf(i) : undefined}>{t}</span>
            ))}
          </div>
        )}
        <Prose className="ins-hero__finding"><strong>{ev.finding.headline}</strong> {ev.finding.rest}</Prose>
        {ev.candidateAlleles && (
          <p className="ins-p ins-dim">
            This protein change can come from {ev.candidateAlleles} nucleotide alleles.{" "}
            {ev.candidateFrequencyRead
              ? "Population frequency was read for each, and a frequency criterion counts only when every allele supports it."
              : "Population frequency: at least one allele has no reading, so no frequency criterion is applied."}
          </p>
        )}
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
    </section>
  );
}

function GapsView({ ev, onOpenTab }: { ev: InsightsEvidence; onOpenTab?: (tab: EvidenceTabId) => void }) {
  const gap = ev.gap;
  return <>
    <header className="ins-view-heading"><h2>What evidence is still needed?</h2><p>Missing evidence and hypothetical additions are research questions, not criteria already met.</p></header>
    {gap && <section className="ins-gap" aria-label="What would move the classification">
      <h3>What would move it</h3>
      {gap.options.length > 0 ? <>
        <p className="ins-p">The engine counts {gap.have} today. Any one of these additions reaches <strong>{gap.target.toLowerCase()}</strong>:</p>
        <ul>{gap.options.map(o => <li key={o}>{o}</li>)}</ul>
        {gap.examples.length > 0 && <dl className="ins-gap__examples">{gap.examples.map(e => <div key={e.strength}><dt>{e.strength}</dt><dd>{e.codes}</dd></div>)}</dl>}
      </> : <p className="ins-p">{gap.sentence}</p>}
      <p className="ins-dim">Hypothetical additions evaluated by the engine’s own combining rule.</p>
    </section>}
    <section className="ins-card" aria-labelledby="ins-need-h">
      <div className="ins-card__head"><h2 className="ins-label" id="ins-need-h">Still needed to decide</h2></div>
      <dl className="ins-rows">
        {ev.needed.map(n => (
          <div key={n.code}>
            <dt>{n.title} <span className="ins-dim ins-mono">({n.code})</span></dt>
            <dd>{n.text}{n.tab && <> <button type="button" className="ins-link" onClick={() => onOpenTab?.(n.tab!)}>Open tab</button></>}</dd>
          </div>
        ))}
      </dl>
    </section>
  </>;
}

function RecordsView({ ev, onOpenTab }: { ev: InsightsEvidence; onOpenTab?: (tab: EvidenceTabId) => void }) {
  // Codes with nothing to say beyond "not recorded" share one row, so the met and withheld rows stand out.
  const bare = (c: CriterionRow) => c.state === "not met" && c.reason === NO_RECORD_REASON;
  const rows = ev.criteria.filter(c => !bare(c));
  const silent = ev.criteria.filter(bare);
  return <>
    <section className="ins-records" aria-labelledby="ins-records-h">
      <header className="ins-view-heading"><h2 id="ins-records-h">Criterion records</h2><p>Every criterion the engine owns, including withheld and missing records. Only recorded criteria enter the classification.</p></header>
      <div className="ins-record-table-wrap"><table className="ins-record-table"><thead><tr><th scope="col">Criterion</th><th scope="col">Engine state</th><th scope="col">Recorded reason</th></tr></thead>
        <tbody>
          {rows.map(c => <tr key={c.code} data-state={c.state}><th scope="row"><span className="ins-mono">{formatEvidenceCode(c.code)}</span><small>{c.strength}</small></th><td>{c.state}</td><td>{c.reason}{c.tab && <button type="button" className="ins-link" onClick={() => onOpenTab?.(c.tab!)}>Open source tab</button>}</td></tr>)}
          {silent.length > 0 && <tr data-state="not met"><th scope="row">No criterion recorded</th><td>not met</td><td className="ins-mono">{silent.map(c => formatEvidenceCode(c.code)).join(", ")}</td></tr>}
        </tbody>
      </table></div>
    </section>

    {/* Model proposals for codes the engine cannot compute: listed, never counted. */}
    {ev.proposals.length > 0 && (
      <section className="ins-card" aria-labelledby="ins-prop-h">
        <div className="ins-card__head"><h2 className="ins-label" id="ins-prop-h">Proposed by the model · not counted</h2></div>
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

    <details className="ins-card ins-details">
      <summary className="ins-card__head"><span className="ins-label">New to this? Plain-language guide</span><span className="ev-tier" data-tone="muted">optional</span></summary>
      <dl className="ins-rows">{ev.glossary.map(g => (<div key={g.term}><dt>{g.term}</dt><dd>{g.text}</dd></div>))}</dl>
    </details>
  </>;
}

function SummaryView({ ev, narrative, onOpenReport }: { ev: InsightsEvidence; narrative: InsightsNarrative | null; onOpenReport?: () => void }) {
  if (!narrative) {
    return <section className="ins-view-heading"><h2>No written summary yet</h2><p>The evidence map and criterion records are available independently. Generate an optional summary from Report.</p><button type="button" className="ins-link" onClick={onOpenReport}>Open the full report</button></section>;
  }
  return (
    <section className="ins-card" aria-labelledby="ins-sum-h">
      <div className="ins-card__head">
        <h2 className="ins-label" id="ins-sum-h">Written interpretation</h2>
        <span className="ins-card__chips">
          {narrative.truncated && <span className="ins-label">Excerpt — continues</span>}
          <span className="ev-tier" data-tone="muted">{narrative.isAi ? "AI-written" : "Rule-based"}</span>
        </span>
      </div>
      {narrative.outdated && (
        <div className="ins-callout" data-tone="warning" role="note">
          <p><strong>This summary describes earlier evidence.</strong> The evidence changed after it was written, so it can disagree with the map and the records. Regenerate it from the Report before you rely on it.</p>
        </div>
      )}
      <div className="ins-prose">
        {narrative.sourceSection && <p className="ins-label">{narrative.sourceSection}</p>}
        {narrative.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      </div>
      <div className="ins-card__foot">
        {!narrative.isAi
          ? <span>Rule-based synthesis — assembled from retrieved database evidence, not from a language model.</span>
          : <>
              <span>{`AI-synthesised${narrative.model ? ` by ${narrative.model}` : ""} — condensed for this view; the Report holds the complete text.`}</span>
              {narrative.outdated
                ? <span>The model saw an earlier version of this evidence.</span>
                : <span><b>Shown to the model:</b> {ev.narrative.sent.join(", ")}. <b>Not shown:</b> {ev.narrative.notSent.join(", ")}.</span>}
            </>}
        <button type="button" className="ins-link" onClick={onOpenReport}>{narrative.truncated ? "Read the full narrative in the Report" : "Open the full report"}</button>
      </div>
    </section>
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
  return (
    <div className="ins-screen" id="insights-screen">
      <Finding ev={ev} />
      <ReviewNavigation tab="insights" workspace={w} />
      <div role="tabpanel" id={`review-insights-panel-${w.view}`} aria-labelledby={`review-insights-tab-${w.view}`}>
        {w.view === 'map' && <InsightsEvidenceMap evidence={ev} selected={w.selected} onSelect={key => w.select(key)} onOpenTab={onOpenTab} />}
        {w.view === 'gaps' && <GapsView ev={ev} onOpenTab={onOpenTab} />}
        {w.view === 'records' && <RecordsView ev={ev} onOpenTab={onOpenTab} />}
        {w.view === 'summary' && <SummaryView ev={ev} narrative={narrative} onOpenReport={onOpenReport} />}
      </div>
    </div>
  );
}

export default InsightsScreen;
