import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, RotateCw, Search, Scissors } from "lucide-react";
import { AnalysisResult } from "../types";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { ConstraintMetric, MiniTrack } from "./header/ConstraintTrack";
import { useVariantHeaderModel, type VariantHeaderModel } from "./header/variantHeaderModel";
import { describeSplicePlacement } from "../shared/splicingEvidence";

interface VariantHeaderProps {
  gene: string;
  variant: string;
  uniprotId: string;
  analysisResult: AnalysisResult | null;
  onProvideAllele?: () => void;
}

/**
 * The variant CONTEXT strip: one 44px line under the top bar.
 *
 * The variant's identity moved into the top bar (`header/VariantIdentity.tsx`); what stays here is
 * context that applies to every evidence page:
 *
 *   Gene constraint  [Missense Z +1.09 ━●━ tolerant] [LOEUF 0.94 ━●━ Not LoF constrained] [Regional O/E —]  Details ▾   … notes · run state
 *
 * - Each metric is a chip with a micro-track: same axis, direction and bands as the full track.
 * - "Details" discloses the full tracks — cut-points, threshold numerals, reference text — in an
 *   anchored panel. A disclosure, not a modal: Escape or a click outside closes it and returns focus.
 * - The notes slot carries splice PROXIMITY as context (not an alert) and the numbering basis.
 * - The RUN STATE slot is fixed at the strip's end, so a degraded run (a fallback locus, a gnomAD
 *   outage) can never look like a clean one, and offers the re-run when one could help.
 *
 * Replaced a two-band 124px header plus a 52px top bar (176px) with 56 + 44 = 100px, and removed the
 * compact-on-scroll mode, which existed only because the old header was too tall to keep.
 */
function VariantHeader({ gene, variant, uniprotId, analysisResult, onProvideAllele }: VariantHeaderProps) {
  const model = useVariantHeaderModel({ gene, variant, uniprotId, analysisResult });
  const requestRerun = useVariantAnalysisStore((s) => s.requestRerun);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, close]);

  // A new variant starts with the panel closed.
  useEffect(() => setOpen(false), [gene, variant]);

  const { metrics } = model;

  /*
   * Proximity to a junction is CONTEXT, not a finding.
   *
   * This slot used to render a red "Splice alert" on the app's own ≤ 5 bp flag, which asserted an
   * effect the pipeline never measured. The resolver orients the distance when it can ("−7 donor"),
   * and `describeSplicePlacement` words it in that vocabulary; the tag says "Near splice site" and the
   * copy says distance alone is not evidence of a splicing effect.
   */
  const splicePlacement =
    analysisResult?.conservationData?.spliceProximity?.isNearSpliceSite
      ? describeSplicePlacement(analysisResult)
      : null;

  return (
    <div className="variant-header" role="region" aria-label="Variant context">
      {metrics.length > 0 && (
        <>
          <span className="vcs-title">
            Gene constraint <span className="vcs-source">· gnomAD v2</span>
          </span>
          {/* Explicit role: `list-style: none` drops list semantics in WebKit. */}
          <ul className="vcs-chips" role="list" aria-label="Gene constraint, gnomAD v2">
            {metrics.map((m) => (
              <li key={m.key} className="vcs-chip" title={m.tooltip}>
                <span className="vcs-chip-label">{m.label}</span>
                <span className="vcs-chip-value" data-tone={m.tone}>
                  {m.value}
                </span>
                <MiniTrack metric={m} />
                <span className="vcs-chip-verdict" data-tone={m.tone}>
                  {m.verdict}
                </span>
                <span className="vh-sr-only">{m.detail}</span>
              </li>
            ))}
          </ul>
          <button
            ref={buttonRef}
            type="button"
            className="vcs-details"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            Details
            <ChevronDown size={14} data-open={open || undefined} aria-hidden="true" />
          </button>
        </>
      )}

      <Notes model={model} splicePlacement={splicePlacement} onRerun={requestRerun} onProvideAllele={onProvideAllele} />

      {open && metrics.length > 0 && (
        <div ref={panelRef} id={panelId} className="vcs-panel" role="region" aria-label="Gene constraint reference ranges">
          <div className="vh-rail">
            <div className="vh-rail-head">
              <span className="vh-rail-title">
                Gene constraint <span className="vh-rail-source">· gnomAD v2</span>
              </span>
              <span className="vh-rail-axis" aria-hidden="true">
                <span>tolerant</span>
                <span>constrained →</span>
              </span>
            </div>
            <ul className="vh-metrics" role="list" aria-label="gnomAD v2 population constraint and normal ranges">
              {metrics.map((metric) => (
                <ConstraintMetric key={metric.key} metric={metric} />
              ))}
            </ul>
            <p className="vcs-panel-note">
              Gene-level constraint, not a call on this variant. Every track reads tolerant on the left and
              constrained on the right; LOEUF and O/E fall as constraint rises, so their axes are reversed.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** The strip's right end: splice proximity, numbering basis, then the fixed run-state slot. */
function Notes({ model, splicePlacement, onRerun, onProvideAllele }: { model: VariantHeaderModel; splicePlacement: { short: string; long: string } | null; onRerun: () => void; onProvideAllele?: () => void }) {
  const { modelledBasis, runState } = model;
  if (!splicePlacement && !modelledBasis && !runState) return null;
  return (
    <div className="vcs-notes">
      {splicePlacement && (
        <span
          className="vh-chip vh-chip--proximity"
          data-testid="splice-proximity-chip"
          title={`${splicePlacement.long}. Distance from a splice junction is context, not evidence of a splicing effect — see RNA splicing.`}
        >
          <Scissors className="vh-chip-icon" size={12} strokeWidth={1.75} aria-hidden="true" />
          <span className="vh-chip-value">{splicePlacement.short}</span>
          <span className="vh-chip-tag" data-tone="muted">
            Near splice site
          </span>
          <span className="vh-sr-only">
            Near a splice site: variant is {splicePlacement.long}. Distance is context, not evidence of a splicing effect.
          </span>
        </span>
      )}
      {modelledBasis && (
        <span className="variant-header-numbering-basis" data-testid="modelled-basis" title={modelledBasis.note ?? undefined}>
          modelled as {modelledBasis.modelled}
        </span>
      )}
      {runState && (
        <span className="vcs-runstate" role="status" title={runState.detail} data-testid="run-state" data-recovery-action={runState.recoveryAction ?? undefined}>
          <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
          <span className="vcs-runstate-label">{runState.label}</span>
          <span className="vh-sr-only">. {runState.detail}</span>
          {runState.recoveryAction === "provide-allele" && onProvideAllele && (
            <button type="button" className="vcs-runstate-action" onClick={onProvideAllele} aria-label="Provide nucleotide allele">
              <Search size={12} aria-hidden="true" />
              <span className="vcs-runstate-action-label" aria-hidden="true">Provide nucleotide allele</span>
              <span className="vcs-runstate-action-short" aria-hidden="true">Enter allele</span>
            </button>
          )}
          {runState.recoveryAction === "retry" && (
            <button type="button" className="vcs-runstate-action" onClick={onRerun}>
              <RotateCw size={12} aria-hidden="true" />
              Re-run
            </button>
          )}
        </span>
      )}
    </div>
  );
}

export default React.memo(VariantHeader);
