import React, { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Box,
  Check,
  ChevronDown,
  Copy,
  Database,
  ExternalLink,
  Info,
  Ruler,
  RotateCw,
  Sparkles
} from "lucide-react";
import type { AnalysisResult, PocketResult } from "../../types";
import { resolveResidueShiftModel } from "../../lib/residueShiftModel";
import { useResidueScalesLoading } from "../../lib/residueScalesLoading";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";
import { METRIC_EXPLANATIONS } from "../evidence/MetricExplanations";
import { SectionLabel } from "./SectionLabel";
import {
  PROPERTY_SCALE_DEFINITIONS,
  deriveBiochemicalNarrative,
  derivePocketNarrative,
  findNarrativeDiscrepancies,
  rankContrastRowsByMagnitude,
  type BiochemicalNarrative,
  type NarrativeState,
  type PocketNarrative
} from "../../shared/residueShiftEvidence";

/**
 * P2Rank's citation is owned by the metric-explanation registry, which is where
 * every other predictor's paper is declared. Reading it from there keeps the DOI
 * out of this component and means a corrected citation propagates everywhere.
 */
const P2RANK_EXPLANATION = METRIC_EXPLANATIONS.p2rank;

interface ResidueShiftInspectorProps {
  analysisResult: AnalysisResult | null;
  computedPocket?: PocketResult | null;
  isPocketLoading?: boolean;
  pocketError?: string | null;
  isBiophysicalLoading?: boolean;
  isNarrativeLoading?: boolean;
  onRetryPocket?: () => void | Promise<void>;
  /** Re-runs AI narrative synthesis for this variant. */
  onRetryNarrative?: () => void | Promise<void>;
}

/**
 * Companion pane for the "Residue Shifts & Pockets" evidence tab.
 *
 * Division of labour — the main column owns the decisive quantities (the 0–100
 * property tracks and the P2Rank KPI cards). This pane owns the interpretation
 * that makes those quantities legible to a reader who is not a structural
 * biologist:
 *
 *   1. Biochemical shift narrative — the AI prose, relocated here from the main
 *      column so the numbers keep the reading order
 *   2. Derived interpretation      — the deterministic reading of the scales
 *   3. Scale reference             — what each axis and each 0–100 anchor means
 *   4. P2Rank cavity interpretation— plain-language reading of the pocket KPIs
 *   5. Glossary & limitations      — what the numbers do and do not license
 *   6. Provenance
 *
 * Every label, band and sentence comes from src/shared/residueShiftEvidence.ts, the
 * same module the main tab derives its classification from, so the two panes
 * cannot disagree about the same variant.
 */

const NARRATIVE_BADGE_CLASS: Record<NarrativeState, string> = {
  ready: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  loading: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  unavailable: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
  absent: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20"
};

const TONE_CLASS: Record<PocketNarrative["badgeTone"], string> = {
  neutral: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
  accent: "bg-cs-accent-clay/10 text-cs-accent-clay border-cs-accent-clay/25",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  danger: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
};

/**
 * Tones for the degradation-reason chip, keyed by the shared vocabulary's own tone words.
 * "neutral" is a setup state (no key configured) and "bad" is a failure (key rejected); only
 * "warn" is transient. Mapping them here rather than hard-coding amber in the markup is what
 * keeps this chip consistent with the report bar's status strip.
 */
const REASON_TONE_CLASS: Record<"neutral" | "warn" | "bad", string> = {
  neutral: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25",
  bad: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25"
};

/** Direction glyphs stay textual here: the sidebar is too narrow for marker tracks. */
function deltaGlyph(delta: number): string {
  if (delta > 0) return "\u2191";
  if (delta < 0) return "\u2193";
  return "=";
}

function buildCopyText(params: {
  gene?: string | null;
  variant?: string | null;
  narrative: BiochemicalNarrative;
  summary: string;
  axisLines: string[];
  pocket: PocketNarrative;
}): string {
  const { gene, variant, narrative, summary, axisLines, pocket } = params;
  const header = [gene, variant].filter(Boolean).join(" ") || "Variant";
  const lines = [`${header} \u2014 residue shift & cavity interpretation`, ""];

  lines.push("Biochemical shift (AI synthesis):");
  lines.push(
    narrative.prose ??
      (narrative.state === "loading"
        ? "Synthesis in progress \u2014 no narrative yet."
        : `Not available \u2014 ${narrative.reasonLabel ?? "no AI narrative was returned"}. ` +
          "The interpretation below is derived from the residue property scales.")
  );
  lines.push("");
  lines.push("Derived from the 0\u2013100 property scales:");
  lines.push(summary);
  lines.push(...axisLines);
  lines.push("");
  lines.push(`P2Rank cavity: ${pocket.headline}`);
  if (pocket.plainLanguage) lines.push(pocket.plainLanguage);
  if (pocket.bottomLine) lines.push(pocket.bottomLine);

  return lines.join("\n");
}

export const ResidueShiftInspector: React.FC<ResidueShiftInspectorProps> = ({
  analysisResult,
  computedPocket = null,
  isPocketLoading = false,
  pocketError = null,
  isBiophysicalLoading = false,
  isNarrativeLoading = false,
  onRetryPocket,
  onRetryNarrative
}) => {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [isScaleReferenceOpen, setIsScaleReferenceOpen] = useState(false);

  /*
   * Read through the shared hook rather than the raw `isBiophysicalLoading` prop:
   * the main column passes `analysisState.isLoading`, and using a different flag
   * here let the two panes describe the same missing datum differently.
   */
  const areScalesLoading = useResidueScalesLoading(isBiophysicalLoading);

  /*
   * One expression for the copy button's tooltip and its accessible name. They
   * were written out twice, so a change to the failure copy had to be made in two
   * places or the tooltip and the announced label would diverge.
   */
  const copyHint =
    copyState === "failed"
      ? "Copy failed — the clipboard is unavailable in this context"
      : "Copy the full residue-shift interpretation";

  const metadata = analysisResult?.metadata;
  const variantResidueIndex = metadata?.residueIndex ?? null;

  /**
   * The same resolver the main tab and the Insights radar call, so all three
   * surfaces describe one substitution with one set of axis labels.
   */
  const model = useMemo(
    () =>
      resolveResidueShiftModel({
        wildType: metadata?.wildType,
        mutant: metadata?.mutant,
        variant: metadata?.variant
      }),
    [metadata?.wildType, metadata?.mutant, metadata?.variant]
  );
  const contrast = model.contrast;

  const narrative = useMemo(
    () =>
      deriveBiochemicalNarrative(analysisResult?.insights?.biochemicalShift, {
        isLoading: isNarrativeLoading,
        fallbackReason: analysisResult?.fallbackReason,
        providerDetail: analysisResult?.providerDetail,
        attemptedModels: analysisResult?.attemptedModels,
        retryable: analysisResult?.fallbackRetryable,
      }),
    [
      analysisResult?.insights?.biochemicalShift,
      analysisResult?.fallbackReason,
      analysisResult?.providerDetail,
      analysisResult?.attemptedModels,
      analysisResult?.fallbackRetryable,
      isNarrativeLoading,
    ]
  );

  const discrepancies = useMemo(
    () => findNarrativeDiscrepancies(narrative.prose, contrast),
    [narrative.prose, contrast]
  );

  const pocket = useMemo(
    () => derivePocketNarrative(computedPocket, { isLoading: isPocketLoading, error: pocketError, variantResidueIndex }),
    [computedPocket, isPocketLoading, pocketError, variantResidueIndex]
  );

  if (!analysisResult) {
    return <div className="text-xs text-cs-text-muted italic p-2">Awaiting variant analysis data...</div>;
  }

  /**
   * Clipboard writes reject when the document is not focused or the permission is
   * denied. The promise used to have no rejection path, which surfaced as an
   * unhandled rejection and left the button looking like it had succeeded.
   */
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        buildCopyText({
          gene: metadata?.gene,
          variant: metadata?.variant,
          narrative,
          summary: contrast?.summary ?? "Property scales unavailable for this substitution.",
          axisLines: (contrast?.rows ?? []).map(
            row =>
              `- ${row.label}: ${row.wildTypeValue} \u2192 ${row.mutantValue} (${row.deltaLabel}, ${row.magnitudeLabel} ${row.direction}; ${row.plainChange})`
          ),
          pocket
        })
      );
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1800);
  };

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. Biochemical shift narrative ── */}
      {/*
        Focus target for the main column's "open the interpretation" control.
        `tabIndex={-1}` makes it focusable without joining the tab order, and the
        `role`/`aria-label` give the programmatic focus move something to announce
        — a bare div announces nothing, which is what the focus move was for.
        The ring matters as much: `outline-none` alone left a keyboard user with a
        silent scroll and no indicator of where they had landed.
      */}
      <div
        id={INSPECTOR_SECTIONS.residueShiftNarrative}
        tabIndex={-1}
        role="region"
        aria-label="Biochemical shift narrative"
        className="flex flex-col gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
      >
        <div className="flex items-center justify-between gap-2">
          <SectionLabel Icon={Activity}>Biochemical Shift Narrative</SectionLabel>
          <button
            type="button"
            onClick={handleCopy}
            className={`p-1 rounded border transition-colors cursor-pointer shrink-0 ${
              copyState === "failed"
                ? "border-rose-500/40 text-rose-500"
                : "border-cs-border text-cs-text-muted hover:text-cs-accent-clay hover:border-cs-accent-clay/40"
            }`}
            title={copyHint}
            aria-label={copyHint}
          >
            {copyState === "copied" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className={`inline-block text-[9.5px] font-mono font-bold uppercase px-2 py-0.5 rounded border ${
                NARRATIVE_BADGE_CLASS[narrative.state] ?? NARRATIVE_BADGE_CLASS.absent
              }`}
            >
              {narrative.badge}
            </span>
            {/* The *why*, when the server classified it. Without this the reader only
                learned that synthesis had failed, never whether retrying could help. The tone
                comes from the shared vocabulary, not from this component. */}
            {narrative.reasonLabel && (
              <span
                className={`inline-block text-[9.5px] font-mono uppercase px-2 py-0.5 rounded border ${
                  REASON_TONE_CLASS[narrative.reasonTone ?? "warn"]
                }`}
              >
                {narrative.reasonLabel}
              </span>
            )}
          </div>

          {narrative.state === "loading" ? (
            <div className="space-y-1.5 pt-0.5" role="status" aria-busy="true">
              <div className="h-2.5 rounded animate-pulse bg-cs-bg-subtle" />
              <div className="h-2.5 rounded animate-pulse bg-cs-bg-subtle w-5/6" />
              <div className="h-2.5 rounded animate-pulse bg-cs-bg-subtle w-2/3" />
            </div>
          ) : narrative.prose ? (
            <p className="text-[11.5px] leading-relaxed text-cs-text-primary">{narrative.prose}</p>
          ) : (
            <>
              <p className="text-[10.5px] leading-relaxed text-cs-text-secondary">{narrative.detail}</p>
              {narrative.diagnostics && (
                <p className="text-[9.5px] font-mono leading-relaxed text-cs-text-muted break-words">
                  {narrative.diagnostics}
                </p>
              )}
              {onRetryNarrative && narrative.retryable && (
                <button
                  type="button"
                  onClick={() => {
                    // `void`: the handler is typed `void | Promise<void>` and React
                    // discards a returned promise, so a rejection would be unhandled.
                    void onRetryNarrative();
                  }}
                  disabled={isNarrativeLoading}
                  className="mt-0.5 px-2.5 py-1 rounded border border-cs-accent-clay/30 bg-cs-accent-clay/10 text-cs-accent-clay font-mono text-[10px] font-semibold inline-flex items-center gap-1.5 hover:bg-cs-accent-clay/20 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RotateCw className={`w-3 h-3 ${isNarrativeLoading ? "animate-spin" : ""}`} />
                  Re-synthesize the narrative
                </button>
              )}
            </>
          )}
        </div>

        {/* ── Prose/scale reconciliation ── */}
        {discrepancies.length > 0 && (
          <div className="p-3 rounded-lg border border-amber-500/25 bg-cs-bg-warning space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-[10.5px] text-cs-text-primary">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>Prose and scales disagree</span>
            </div>
            {discrepancies.map(discrepancy => (
              <p key={discrepancy.axisKey} className="text-[10.5px] text-cs-text-secondary leading-relaxed">
                The narrative describes a change in <strong>{discrepancy.axisLabel.toLowerCase()}</strong>, while the scales
                hold that axis flat ({discrepancy.values}) for this pair. Both are shown so you can weigh them; the scales
                are fixed descriptors, not ground truth, and the prose is a model summary.
              </p>
            ))}
          </div>
        )}
      </div>

      {/* ── 2. Derived interpretation ── */}
      <div className="flex flex-col gap-3">
        <SectionLabel Icon={Sparkles}>Derived Interpretation</SectionLabel>

        {contrast ? (
          <>
            <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2">
              <p className="text-[11px] leading-relaxed text-cs-text-primary">{contrast.summary}</p>
            </div>

            <div className="rounded-lg border border-cs-border bg-cs-surface-2 divide-y divide-cs-border-subtle">
              {/* Same ranking as the main column's tracks, so the two panes the shared module
                  exists to keep consistent do not list the same four axes in different orders. */}
              {rankContrastRowsByMagnitude(contrast.rows).map(row => (
                <div key={row.key} className="p-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10.5px] text-cs-text-secondary truncate">{row.label}</span>
                    <span className="font-mono text-[10.5px] font-semibold text-cs-text-primary shrink-0 tabular-nums">
                      {row.wildTypeValue} <span className="opacity-50">&rarr;</span> {row.mutantValue}
                      <span className="ml-1.5 text-cs-accent-clay">
                        {deltaGlyph(row.delta)} {row.deltaLabel}
                      </span>
                    </span>
                  </div>
                  <p className="text-[10px] text-cs-text-muted leading-snug">
                    {row.direction === "unchanged"
                      ? `Unchanged on this axis \u2014 both residues sit at ${row.wildTypeValue} of 100.`
                      : `${row.magnitudeLabel} change on this scale: the side chain becomes ${row.plainChange}.`}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-cs-text-muted shrink-0 mt-0.5" />
            <p className="text-[10.5px] text-cs-text-muted leading-relaxed">
              {areScalesLoading
                ? "Residue property scales are still being assembled for this substitution."
                : "The wild-type or variant residue could not be resolved to a property scale, so no derived interpretation is available."}
            </p>
          </div>
        )}
      </div>

      {/* ── 3. Scale reference ── */}
      <div className="flex flex-col gap-2">
        {/* A disclosure summary, not a heading: a <button> may only contain phrasing
            content, so the label is a styled span rather than the shared <h3>. */}
        <button
          type="button"
          onClick={() => setIsScaleReferenceOpen(open => !open)}
          aria-expanded={isScaleReferenceOpen}
          className="flex items-center justify-between gap-2 w-full cursor-pointer group"
        >
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <Ruler className="w-3.5 h-3.5 text-cs-accent-clay" />
            How To Read These Scales
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-cs-text-muted transition-transform ${isScaleReferenceOpen ? "rotate-180" : ""}`}
          />
        </button>

        {isScaleReferenceOpen && (
          <div className="space-y-2">
            {PROPERTY_SCALE_DEFINITIONS.map(definition => (
              <div key={definition.key} className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10.5px] font-semibold text-cs-text-primary">{definition.label}</span>
                  <span className="font-mono text-[9px] text-cs-text-muted shrink-0">
                    {definition.lowAnchor} 0 &middot; 100 {definition.highAnchor}
                  </span>
                </div>
                <p className="text-[10px] text-cs-text-secondary leading-relaxed">{definition.rationale}</p>
                <p className="text-[9.5px] text-cs-text-muted font-mono">{definition.source}</p>
              </div>
            ))}
            <p className="text-[10px] text-cs-text-muted leading-relaxed px-0.5">
              The scales are fixed descriptors of the residue pair. They are not calibrated to any clinical outcome, so a
              &ldquo;marked&rdquo; change means a large move on the axis &mdash; not a large effect on the protein.
            </p>
          </div>
        )}
      </div>

      {/* ── 4. P2Rank cavity interpretation ── */}
      <div
        id={INSPECTOR_SECTIONS.residueShiftPocket}
        tabIndex={-1}
        role="region"
        aria-label="P2Rank cavity interpretation"
        className="flex flex-col gap-3 pt-1 border-t border-cs-border-subtle rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
      >
        <div className="flex items-center justify-between gap-2">
          <SectionLabel Icon={Box}>P2Rank Cavity Interpretation</SectionLabel>
          <span
            className={`text-[9.5px] font-mono font-bold uppercase px-2 py-0.5 rounded border shrink-0 ${
              TONE_CLASS[pocket.badgeTone]
            }`}
          >
            {pocket.badge || "Standby"}
          </span>
        </div>

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
          <span className="text-[11px] font-bold text-cs-text-primary block">{pocket.headline}</span>

          {pocket.plainLanguage && (
            <p className="text-[10.5px] leading-relaxed text-cs-text-secondary">{pocket.plainLanguage}</p>
          )}

          {pocket.bottomLine && (
            <p className="text-[10.5px] leading-relaxed text-cs-text-primary pt-1.5 border-t border-cs-border-subtle">
              {pocket.bottomLine}
            </p>
          )}

          {(pocket.status === "error" || pocket.status === "unavailable") && onRetryPocket && (
            <button
              type="button"
              onClick={() => {
                // `void`: the handler is typed `void | Promise<void>` and React
                // discards a returned promise, so a rejection would be unhandled.
                void onRetryPocket();
              }}
              disabled={isPocketLoading}
              className="mt-1 px-2.5 py-1 rounded border border-cs-accent-clay/30 bg-cs-accent-clay/10 text-cs-accent-clay font-mono text-[10px] font-semibold inline-flex items-center gap-1.5 hover:bg-cs-accent-clay/20 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCw className="w-3 h-3" />
              Retry pocket detection
            </button>
          )}
        </div>

        {pocket.status === "success" && (
          <>
            <div className="rounded-lg border border-cs-border bg-cs-surface-2 divide-y divide-cs-border-subtle">
              <div className="p-2.5 flex items-start justify-between gap-2">
                <span className="text-[10.5px] text-cs-text-secondary">Proximity</span>
                <span className="text-right min-w-0">
                  <span className="block font-mono text-[10.5px] font-semibold text-cs-text-primary">
                    {pocket.proximity.label}
                  </span>
                  <span className="block font-mono text-[9.5px] text-cs-text-muted">
                    {pocket.proximity.distance !== null ? `${pocket.proximity.distance.toFixed(2)} \u00c5` : "no distance"}
                  </span>
                </span>
              </div>
              <div className="p-2.5 flex items-start justify-between gap-2">
                <span className="text-[10.5px] text-cs-text-secondary">Ranking index</span>
                <span className="text-right min-w-0">
                  <span className="block font-mono text-[10.5px] font-semibold text-cs-text-primary">
                    {pocket.ranking.label}
                  </span>
                  <span className="block font-mono text-[9.5px] text-cs-text-muted">
                    {pocket.ranking.score !== null ? `${pocket.ranking.score}%` : "not reported"}
                  </span>
                </span>
              </div>
              <div className="p-2.5 flex items-start justify-between gap-2">
                <span className="text-[10.5px] text-cs-text-secondary">Cavity size</span>
                <span className="text-right min-w-0">
                  <span className="block font-mono text-[10.5px] font-semibold text-cs-text-primary">
                    {pocket.volume.isMeasured ? pocket.volume.label : "Volume not reported"}
                  </span>
                  <span className="block font-mono text-[9.5px] text-cs-text-muted">
                    {pocket.volume.isMeasured && pocket.volume.volume !== null
                      ? `${pocket.volume.volume.toLocaleString()} \u00c5\u00b3`
                      : pocket.volume.surfacePoints !== null
                        ? `${pocket.volume.surfacePoints} surface pts`
                        : "no size reported"}
                  </span>
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[10.5px]">
              <div className="flex justify-between items-center">
                <span className="text-cs-text-secondary">Lining residues returned</span>
                <span className="font-mono font-semibold text-cs-text-primary">{pocket.lining.count}</span>
              </div>
              {pocket.lining.nearest && (
                <div className="flex justify-between items-center">
                  <span className="text-cs-text-secondary">Nearest lining residue</span>
                  <span className="font-mono text-cs-text-primary">
                    {pocket.lining.nearest.name}
                    {pocket.lining.nearest.index} &middot; {pocket.lining.nearest.distance.toFixed(1)} &Aring;
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-cs-text-secondary">Variant residue lines cavity</span>
                <span className="font-mono text-cs-text-primary">{pocket.lining.includesVariantResidue ? "Yes" : "No"}</span>
              </div>
            </div>

            <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1">
              <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block">
                Curated Ligand / Cofactor
              </span>
              <p className="text-[10.5px] text-cs-text-primary">
                {pocket.cofactor.name ?? "None recorded"}
              </p>
              <p className="text-[10px] text-cs-text-muted leading-relaxed">{pocket.cofactor.detail}</p>
            </div>
          </>
        )}
      </div>

      {/* ── 5. Glossary ── */}
      <div className="flex flex-col gap-2">
        <SectionLabel Icon={Info}>Reading The Pocket Numbers</SectionLabel>
        <div className="rounded-lg border border-cs-border bg-cs-surface-2 divide-y divide-cs-border-subtle">
          {pocket.glossary.map(entry => (
            <div key={entry.term} className="p-2.5 space-y-0.5">
              <span className="text-[10.5px] font-semibold text-cs-text-primary block">{entry.term}</span>
              <p className="text-[10px] text-cs-text-muted leading-relaxed">{entry.meaning}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── 6. Limitations ── */}
      {pocket.caveats.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel Icon={AlertTriangle}>Limitations</SectionLabel>
          <ul className="m-0 pl-4 space-y-1.5 list-disc">
            {pocket.caveats.map(caveat => (
              <li key={caveat} className="text-[10px] text-cs-text-secondary leading-relaxed">
                {caveat}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 7. Provenance ── */}
      <div className="flex flex-col gap-2">
        <SectionLabel Icon={Database}>Provenance</SectionLabel>
        <div className="p-2.5 rounded-lg border border-cs-border bg-cs-surface-2 space-y-1 text-[10.5px]">
          <div className="flex justify-between items-center gap-2">
            <span className="font-semibold text-cs-text-primary">P2Rank</span>
            <span className="font-mono text-[9.5px] text-cs-text-muted">Krivak &amp; Hoksza 2018</span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="font-semibold text-cs-text-primary">Hydropathy scale</span>
            <span className="font-mono text-[9.5px] text-cs-text-muted">Kyte &amp; Doolittle 1982</span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="font-semibold text-cs-text-primary">Side-chain volume</span>
            <span className="font-mono text-[9.5px] text-cs-text-muted">van der Waals volume table</span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span className="font-semibold text-cs-text-primary">Polarity / charge class</span>
            <span className="font-mono text-[9.5px] text-cs-text-muted">IUPAC classification</span>
          </div>
          <a
            href={P2RANK_EXPLANATION.paperUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-cs-accent-clay hover:underline pt-1"
          >
            <span>{P2RANK_EXPLANATION.paperTitle}</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ResidueShiftInspector);
