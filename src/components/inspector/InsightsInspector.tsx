import { expertPm1Specified, expertPm1StatusOf, type HotspotContext } from "../../shared/hotspotEvidence";
import { hotspotsSlot } from "../../shared/evidenceKeys";
import type { ContextLoad } from "../../stores/slices/evidenceContextSlice";
import React, { useMemo } from "react";
import { GitBranch, Bot, BookOpen, Sparkles, Pin } from "lucide-react";
import { AnalysisResult } from "../../types";
import { useVariantAnalysisStore } from "../../context/VariantAnalysisContext";
import { useFoldxRunState } from "../../hooks/useFoldxRunState";
import { formatEvidenceCode } from "../../shared/thresholds";
import { buildInsightsEvidence, criterionForLane } from "../../shared/insightsEvidence";
import { INSPECTOR_SECTIONS } from '../../lib/inspectorFocus';
import { narrativeAuthorshipOfResult } from "../../shared/narrativeEvidence";
import { isFallbackNarrative } from "../../services/pipeline/variantCache";
import { functionEvidenceInputFrom } from "../evidence/function/functionInput";
import { NarrativeProvenanceRow } from "./NarrativeProvenanceRow";
import { useReviewWorkspace } from '../review/ReviewWorkspace';
import { stabilityInputFor } from '../../shared/insightsSnapshot';
import type { EnergeticsData } from '../../types';

/**
 * Insights rail: how the case on screen was assembled.
 *
 * Renders from the SAME `buildInsightsEvidence` object as the tab, so the count, the tier and the
 * dropped proposals cannot differ between the two panes. It replaces a rail that counted the model's
 * proposals under "N Met" while the tier had used none of them, and that listed the live search box as
 * the directions the narrative had been written under.
 */
interface InsightsInspectorProps {
  analysisResult: AnalysisResult | null;
  isNarrativeLoading?: boolean;
  foldingEnergetics?: EnergeticsData | null;
  foldingDdG?: number | null;
  isEvidenceLoading?: boolean;
}

type StepState = "done" | "warn" | "idle";

function Step({ n, label, state = "done", children }: { n: number; label: string; state?: StepState; children: React.ReactNode }) {
  return (
    <li className="rail-step" data-state={state}>
      <span className="rail-step__n" aria-hidden="true">{n}</span>
      <div className="rail-step__body">
        <span className="rail-step__label">{label}</span>
        <div className="rail-step__value">{children}</div>
      </div>
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rail-kv__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export const InsightsInspector: React.FC<InsightsInspectorProps> = ({ analysisResult, isNarrativeLoading = false, foldingEnergetics, foldingDdG, isEvidenceLoading = false }) => {
  const userDirections = useVariantAnalysisStore(s => s.userDirections ?? "");
  const hotspotLoad = useVariantAnalysisStore(s => s.extraContexts[hotspotsSlot(analysisResult?.metadata?.gene || s.gene || null, analysisResult?.metadata?.uniprotId, analysisResult?.transcriptId)]) as ContextLoad<HotspotContext> | undefined;
  const expertPm1 = Boolean(hotspotLoad?.data && expertPm1Specified(hotspotLoad.data.cspec));
  const expertPm1Status = expertPm1StatusOf(hotspotLoad);
  const w = useReviewWorkspace('insights');
  const { isFolding, foldingStatus } = useFoldxRunState();

  const ev = useMemo(
    () => {
      if (!analysisResult) return null;
      return buildInsightsEvidence({ result: analysisResult, functionInput: functionEvidenceInputFrom(analysisResult),
        stability: stabilityInputFor(analysisResult, foldingEnergetics, foldingDdG, { isFolding, foldingStatus }),
        expertPm1Specified: expertPm1,
        expertPm1Status,
        isLoading: isEvidenceLoading || isFolding,
        narrativeDegraded: isFallbackNarrative(analysisResult.analysis, analysisResult.isFallback, analysisResult.fallbackReason) });
    },
    [expertPm1, expertPm1Status, analysisResult, foldingEnergetics, foldingDdG, isEvidenceLoading, isFolding, foldingStatus]
  );

  if (!analysisResult || !ev) {
    return (
      <div className="ins-rail">
        <p className="ins-p">Run a variant to see how its case was assembled.</p>
      </div>
    );
  }

  const authorship = narrativeAuthorshipOfResult(
    analysisResult,
    isFallbackNarrative(analysisResult.analysis, analysisResult.isFallback, analysisResult.fallbackReason)
  );
  const readCount = ev.lanes.filter(l => l.state === "read").length;
  const selected = ev.lanes.find(lane => lane.key === w.selected);

  return (
    <div className="ins-rail" data-testid="insights-rail">
      {(w.view === 'map' || selected) && <section className="review-selection" id={INSPECTOR_SECTIONS.evidenceReading} tabIndex={-1} aria-label="Selected evidence reading">
        <div className="review-selection__head"><span className="eyebrow"><Pin size={13} aria-hidden="true" />{selected ? 'Pinned reading' : 'Explore a reading'}</span>{selected && <button type="button" className="review-action" onClick={() => w.select(null)}>Clear selection</button>}</div>
        <div className="review-selection__body">
          {selected ? <><h3>{selected.name}</h3><p><strong>{selected.lead}</strong> {selected.rest}</p>
            <p>{selected.counted ? `Counted as ${selected.code}.` : selected.state === 'pending' ? 'Still running; no criterion recorded.' : 'No counted criterion for this area.'}</p>
            {selected.counted && <p>Recorded strength: {criterionForLane(ev, selected)?.strength ?? 'Strength unavailable'}.</p>}
            <button type="button" className="review-action" onClick={w.showSelected}>Show in evidence map</button></>
            : <p>Select an evidence area in the map to keep its reading here.</p>}
        </div>
      </section>}
      <section className="rail-section" aria-labelledby="ins-rail-trace">
        <h3 className="eyebrow" id="ins-rail-trace"><GitBranch className="w-3.5 h-3.5" />How the case was built</h3>
        <ol className="rail-steps" data-testid="insights-trace">
          <Step n={1} label="Evidence tabs read">
            {readCount} of {ev.lanes.length} areas returned a reading. Each row on the board is that tab&apos;s own recorded call.
          </Step>
          <Step n={2} label="Narrative">
            {authorship === "ai" ? "Written by the language model." : authorship === "rule-based" ? "Assembled from database evidence, not a model." : "No narrative yet."}{" "}
            {ev.proposals.length + ev.droppedEngineOwned.length > 0
              ? `It proposed ${ev.proposals.length + ev.droppedEngineOwned.length} ${ev.proposals.length + ev.droppedEngineOwned.length === 1 ? "criterion" : "criteria"}.`
              : "It proposed no criteria."}
          </Step>
          <Step n={3} label="How the verdict was combined">
            The engine&apos;s codes are kept.
            {ev.droppedEngineOwned.length > 0 && <> Left out, because the engine decides them: {ev.droppedEngineOwned.map(d => d.code).join(", ")}.</>}
            {ev.proposals.length > 0 && <> Listed, not counted: {ev.proposals.map(d => d.code).join(", ")}.</>}
          </Step>
          <Step n={4} label="Recorded criteria" state={ev.recordMismatch ? "warn" : "done"}>
            {ev.engineCodes.length
              ? <>{ev.engineCodes.map(c => formatEvidenceCode(c.code)).join(", ")}.</>
              : "No criterion recorded."}{" "}
            {ev.verdictText && <>Tier: {ev.verdictText}.</>}
            {ev.recordMismatch && <span className="rail-step__warn">The current combining rule gives a different tier: an earlier engine classified this payload.</span>}
          </Step>
        </ol>
        <p className="ins-p ins-dim">The prose is not checked against the criteria; only the criteria list is merged.</p>
      </section>

      <section className="rail-section" aria-labelledby="ins-rail-method">
        <h3 className="eyebrow" id="ins-rail-method"><Bot className="w-3.5 h-3.5" />Narrative method</h3>
        <NarrativeProvenanceRow analysisResult={analysisResult} isNarrativeLoading={isNarrativeLoading} />
        {ev.weighting && <dl className="rail-kv"><Row label="Weighting"><span>{ev.weighting}</span></Row></dl>}
      </section>

      {userDirections && <section className="rail-section" aria-labelledby="ins-rail-dir">
        <h3 className="eyebrow" id="ins-rail-dir"><Sparkles className="w-3.5 h-3.5" />Synthesis directions</h3>
        <p className="ins-p"><em>&ldquo;{userDirections}&rdquo;</em></p>
        <p className="ins-p ins-dim">This is what the search box holds now. The run does not record the directions it used, so it can differ from what the narrative saw.</p>
      </section>}

      <section className="rail-section" aria-labelledby="ins-rail-src">
        <h3 className="eyebrow" id="ins-rail-src"><BookOpen className="w-3.5 h-3.5" />Sources</h3>
        <dl className="rail-kv rail-kv--sources">
          <Row label="Combining rule"><span>Richards et al. 2015</span></Row>
          <Row label="PP3 / BP4"><span>ClinGen SVI · Pejaver et al. 2022</span></Row>
        </dl>
      </section>
    </div>
  );
};

export default React.memo(InsightsInspector);
