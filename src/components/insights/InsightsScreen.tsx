import React from "react";
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

function LaneRow({ lane, onOpenTab }: { lane: Lane; onOpenTab?: (tab: EvidenceTabId) => void }) {
  const label = `${lane.name}: ${lane.state === "read"
    ? lane.lean === "none" ? "no lean" : `leans ${lane.lean}`
    : lane.state === "pending" ? "still running" : "no reading"}${lane.counted ? `, counted as ${lane.code}` : ", not counted"}`;
  return (
    <div className="ins-lane" data-lane={lane.key}>
      <div>
        <span className="ins-lane__name">{lane.name}</span>
        <span className="ins-lane__links">
          {lane.links.map(l => (
            <button key={l.tab} type="button" className="ins-link" onClick={() => onOpenTab?.(l.tab)}>{l.label}</button>
          ))}
        </span>
      </div>
      <div>
        <div className="ins-strip" role="img" aria-label={label}>
          {lane.state === "read" && lane.lean !== "none" ? (
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
            {!lane.counted && lane.unconfirmed && <span className="ev-tier" data-tone="accent" style={{ borderStyle: "dashed" }}>Unconfirmed</span>}
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
  const gap = ev.gap;
  const tone = ev.tierIndex >= 3 ? "danger" : ev.tierIndex <= 1 ? "good" : "neutral";
  return (
    <div className="ins-screen" id="insights-screen">
      {/* 1 · The finding */}
      <section className="ins-card" aria-labelledby="ins-finding-h">
        <div className="ins-card__head">
          <h2 className="ins-label" id="ins-finding-h" style={{ margin: 0 }}>Where does the evidence leave this variant?</h2>
          {ev.weighting && <span className="ev-tier" data-tone="muted">Weighting: {ev.weighting}</span>}
        </div>
        <div className="ins-hero__body">
          <span><span className="ev-tier ev-tier--lg" data-tone={tone}>Rule-engine classification</span></span>
          <p className="ins-hero__figure">{ev.verdictText ?? "Not classified"}</p>
          <Prose className="ins-hero__finding"><strong>{ev.finding.headline}</strong> {ev.finding.rest}</Prose>
        </div>
        <div className="ins-tiers">
          <span className="ins-label">ACMG five-tier scale</span>
          <div className="ins-tiers__row" role="img" aria-label={`Tier: ${ev.tier ?? "not classified"}`}>
            {TIERS.map((t, i) => (
              <div key={t} className="ins-tier" data-active={i === ev.tierIndex ? "" : undefined} data-side={i === ev.tierIndex ? sideOf(i) : undefined}>{t}</div>
            ))}
          </div>
        </div>
        {gap && (
          <div className="ins-gap">
            {gap.options.length > 0 ? (
              <>
                <p className="ins-p"><span className="ins-strong">What would move it.</span> To reach <span className="ins-strong">{gap.target.toLowerCase()}</span> the engine needs one of these on top of what it has ({gap.have}):</p>
                <ul>{gap.options.map(o => <li key={o}>{o}</li>)}</ul>
              </>
            ) : (
              <p className="ins-p"><span className="ins-strong">What would move it.</span> {gap.sentence}</p>
            )}
            <p className="ins-p ins-dim" style={{ marginTop: 6 }}>Worked out by running the engine&apos;s own combining rule on each addition.</p>
          </div>
        )}
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
        <div className="ins-card__foot"><span><b>Rule:</b> Richards et al. 2015 combining table, the same function that produced the tier.</span></div>
      </section>

      {/* 2 · Evidence board */}
      <section className="ins-card" aria-labelledby="ins-board-h">
        <div className="ins-card__head">
          <h2 className="ins-label" id="ins-board-h" style={{ margin: 0 }}>Evidence board · every tab in one view</h2>
          <span className="ins-key"><span><i data-k="path" />pathogenic, counted</span><span><i data-k="ben" />benign, counted</span><span><i data-k="ctx" />leans, not counted</span></span>
        </div>
        <div className="ins-axis"><span />
          <div className="ins-axis__scale ins-label"><span>Benign ←</span><span>→ Pathogenic</span></div>
        </div>
        {ev.lanes.map(l => <LaneRow key={l.key} lane={l} onOpenTab={onOpenTab} />)}
        <div className="ins-card__foot"><span><b>Bar length</b> shows the strength of the code the engine recorded. Dashed bars have no code and carry no magnitude.</span></div>
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
                <div><span className="ev-tier chip-code" data-tone="accent" style={{ borderStyle: "dashed" }}>{p.code}</span> <span className="ins-dim">{ACMG_SOURCE_LABEL.ai_suggested}</span></div>
                <p className="ins-p">{p.reason}</p>
              </div>
            ))}
          </div>
          <div className="ins-card__foot"><span>The engine cannot compute {ev.proposals.map(p => p.code).join(", ")}, so nothing here has been checked against data.</span></div>
        </section>
      )}

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

      {/* 5 · Plain-language guide */}
      <details className="ins-card ins-details">
        <summary className="ins-card__head"><span className="ins-label">New to this? Plain-language guide</span><span className="ev-tier" data-tone="muted">optional</span></summary>
        <dl className="ins-rows">
          {ev.glossary.map(g => (<div key={g.term}><dt>{g.term}</dt><dd>{g.text}</dd></div>))}
        </dl>
      </details>

      {/* 6 · Written summary */}
      {narrative && (
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
  );
}

export default InsightsScreen;
