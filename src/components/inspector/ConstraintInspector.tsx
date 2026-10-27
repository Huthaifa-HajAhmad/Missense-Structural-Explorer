import React, { useEffect, useMemo, useRef } from "react";
import { ArrowLeft, Database, Ruler } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { SectionLabel } from "./SectionLabel";
import { ConstraintMetric, ConstraintReference } from "../header/ConstraintTrack";
import {
  buildConstraintMetrics,
  buildConstraintProvenance,
  constraintSourceLabel,
  releaseTag,
  type ConstraintMetricKey,
} from "../header/constraintMetrics";
import { constraintMetricDomId } from "../header/constraintFocus";
import { buildHeadlineVariant } from "../header/variantHeaderModel";

/**
 * Gene constraint in the inspector: all three readings with their full tracks, where each track's
 * cut-points come from, the facts about this reading, and the source.
 *
 * Any page's rail gives way to it when the reader sends a reading here from the context strip's card
 * (`constraintFocus` in the store; `ViewInspector` does the swap). Constraint is gene-level context
 * that applies to every page, so it borrows the rail rather than owning a page. "Back" or Escape
 * returns the rail to the page, and focus to the chip that asked.
 *
 * The tracks are `ConstraintMetric` rows, unchanged from the strip's former Details panel.
 */
export function ConstraintInspector({
  analysisResult,
  gene,
  variant,
  uniprotId = "",
  focus,
  returnLabel,
  onBack,
}: {
  analysisResult: AnalysisResult | null;
  gene: string;
  variant: string;
  uniprotId?: string;
  /** The reading the reader opened: tinted, scrolled to and focused. */
  focus: ConstraintMetricKey | null;
  /** The rail the reader came from, named on the Back button. */
  returnLabel?: string;
  onBack?: () => void;
}) {
  const metrics = useMemo(() => buildConstraintMetrics(analysisResult), [analysisResult]);
  const provenance = useMemo(() => buildConstraintProvenance(analysisResult), [analysisResult]);
  const headlineVariant = useMemo(() => buildHeadlineVariant({ variant, uniprotId, analysisResult }), [variant, uniprotId, analysisResult]);
  const source = constraintSourceLabel(analysisResult);
  const rootRef = useRef<HTMLElement>(null);

  // Move focus to the reading the reader asked for, so a keyboard or screen-reader user lands on it.
  useEffect(() => {
    if (!focus) return;
    const row = rootRef.current?.querySelector<HTMLElement>(`#${constraintMetricDomId(focus)}`);
    row?.scrollIntoView?.({ block: "nearest" });
    row?.focus({ preventScroll: true });
  }, [focus]);

  return (
    <section
      ref={rootRef}
      className="cx-inspector"
      role="region"
      aria-label="Gene constraint reference ranges"
      data-testid="constraint-inspector"
      data-focus={focus ?? undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onBack) {
          e.stopPropagation();
          onBack();
        }
      }}
    >
      {onBack && (
        <button type="button" className="cx-back" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" />
          Back to {returnLabel ?? "the page"}
        </button>
      )}

      <p className="cx-scope">
        Gene-level context for <strong>{gene}</strong>. It does not classify {headlineVariant || "this variant"}.
      </p>

      <div className="vh-rail">
        <div className="vh-rail-head">
          <span className="vh-rail-title">Metric / value</span>
          <span className="vh-rail-axis" aria-hidden="true">
            <span>less depleted</span>
            <span>constrained →</span>
          </span>
        </div>
        <ul className="vh-metrics" role="list" aria-label={`${source} population constraint and reference ranges`}>
          {metrics.map((metric) => (
            <ConstraintMetric key={metric.key} metric={metric} id={constraintMetricDomId(metric.key)} focused={metric.key === focus} />
          ))}
        </ul>
      </div>

      <div className="cx-section">
        <SectionLabel Icon={Ruler}>Where the cut-points come from</SectionLabel>
        <ul className="cx-sources" role="list">
          {metrics.map((metric) => {
            const tag = releaseTag(metric, source);
            return (
              <li key={metric.key} className="cx-source" data-metric={metric.key} data-focused={metric.key === focus || undefined}>
                <span className="cx-source-name">
                  {metric.name}
                  {tag && <span className="vcs-chip-release">{tag}</span>}
                </span>
                <ConstraintReference metric={metric} />
              </li>
            );
          })}
        </ul>
        <p className="cx-note">
          Every track reads less depleted on the left and constrained on the right; LOEUF and O/E fall as constraint
          rises, so their axes are reversed.
        </p>
      </div>

      {provenance && (
        <div className="cx-section">
          <SectionLabel Icon={Database}>Source</SectionLabel>
          <dl className="rail-kv">
            <div className="rail-kv__row">
              <dt>Gene metrics</dt>
              <dd>
                <a href={provenance.geneHref} target="_blank" rel="noopener noreferrer" className="cx-link">
                  {provenance.geneSource}
                  <span className="vh-sr-only"> (opens in a new tab)</span>
                </a>
              </dd>
            </div>
            <div className="rail-kv__row">
              <dt>Assembly</dt>
              <dd className="cx-mono">{provenance.assembly}</dd>
            </div>
            <div className="rail-kv__row">
              <dt>Transcript</dt>
              <dd className="cx-mono">{provenance.transcript}</dd>
            </div>
            <div className="rail-kv__row">
              <dt>Selected as</dt>
              <dd>{provenance.selection}</dd>
            </div>
            {provenance.regionalSource && (
              <div className="rail-kv__row">
                <dt>Regional metrics</dt>
                <dd>{provenance.regionalSource}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </section>
  );
}

export default ConstraintInspector;
