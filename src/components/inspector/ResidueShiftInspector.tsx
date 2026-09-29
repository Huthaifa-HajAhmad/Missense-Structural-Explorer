import React, { useMemo, useState } from "react";
import { AlertTriangle, BookOpen, Check, Copy, Database, GitBranch, MessageSquareText, RotateCw, Ruler } from "lucide-react";
import type { AnalysisResult, PocketResult } from "../../types";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";
import { useResidueContextEvidence } from "../../lib/useResidueContextEvidence";
import {
  deriveBiochemicalNarrative,
  findNarrativeDiscrepancies,
  type BiochemicalNarrative
} from "../../shared/residueShiftEvidence";
import type { ResidueContextEvidence } from "../../shared/residueContextEvidence";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";

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
 * ResidueShiftInspector — the Evidence Lineage rail for Residue Shifts & Pockets.
 *
 * The tab states WHAT the readings are; the rail states HOW they were reached: a five-step trace
 * (pair → scales → burial → pocket → engine record), the app's own cut-points with this variant's
 * band marked, the model-written narrative (labelled as such and checked against the scales),
 * method notes and sources.
 *
 * It replaced a rail with seven boxed sections that repeated the tab's numbers (the "4 of 4 axes"
 * summary appeared three times), printed the pocket score as "23%" where the tab printed
 * "23 / 100", showed a constant "curated ligand / cofactor" as a lookup, cited "IUPAC
 * classification" and a "van der Waals volume table" for a hand-made scale, and had no burial
 * step at all. Built from the same `useResidueContextEvidence` model as the tab.
 */

function buildCopyText(params: {
  gene?: string | null;
  variant?: string | null;
  narrative: BiochemicalNarrative;
  model: ResidueContextEvidence;
}): string {
  const { gene, variant, narrative, model } = params;
  const header = [gene, variant].filter(Boolean).join(" ") || "Variant";
  const lines = [`${header}: residue shifts and pockets`, ""];
  lines.push(`${model.finding.headline} ${model.finding.detail}`);
  lines.push("");
  for (const row of model.properties ?? []) {
    const unit = row.unit ? ` ${row.unit}` : "";
    lines.push(
      `- ${row.label}: ${row.wildTypeNative ?? row.wildTypeValue} → ${row.mutantNative ?? row.mutantValue}${unit} (${Math.round(row.absoluteDelta)}% of the scale; ${row.plainChange})`
    );
  }
  if (model.backbone) lines.push(`- ${model.backbone.title} ${model.backbone.body}`);
  lines.push("");
  for (const step of model.trace) lines.push(`${step.label}: ${step.value}${step.sub ? ` (${step.sub})` : ""}`);
  lines.push("");
  lines.push(
    `Model narrative: ${
      narrative.prose ?? (narrative.state === "loading" ? "synthesis in progress." : `not available (${narrative.reasonLabel ?? "no narrative returned"}).`)
    }`
  );
  return lines.join("\n");
}

function Step({ n, label, value, sub, state }: { n: number; label: string; value: string; sub: string | null; state: string }) {
  return (
    <li className="rsx-step" data-state={state}>
      <span className="rsx-step__n" aria-hidden="true">{n}</span>
      <div className="rsx-step__body">
        <span className="rsx-step__label">{label}</span>
        <span className="rsx-step__value">{value}</span>
        {sub && <span className="rsx-step__sub">{sub}</span>}
      </div>
    </li>
  );
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
  const { model, shift } = useResidueContextEvidence({
    result: analysisResult,
    computedPocket,
    isPocketLoading,
    pocketError,
    isBiophysicalLoading
  });

  const narrative = useMemo(
    () =>
      deriveBiochemicalNarrative(analysisResult?.insights?.biochemicalShift, {
        isLoading: isNarrativeLoading,
        fallbackReason: analysisResult?.fallbackReason,
        providerDetail: analysisResult?.providerDetail,
        attemptedModels: analysisResult?.attemptedModels,
        retryable: analysisResult?.fallbackRetryable
      }),
    [
      analysisResult?.insights?.biochemicalShift,
      analysisResult?.fallbackReason,
      analysisResult?.providerDetail,
      analysisResult?.attemptedModels,
      analysisResult?.fallbackRetryable,
      isNarrativeLoading
    ]
  );
  const discrepancies = useMemo(() => findNarrativeDiscrepancies(narrative.prose, shift.contrast), [narrative.prose, shift.contrast]);

  if (!analysisResult) {
    return <p className="rsx-rail rsx-prose--muted">Waiting for the variant analysis.</p>;
  }

  const copyHint =
    copyState === "failed" ? "Copy failed: the clipboard is unavailable here" : copyState === "copied" ? "Copied" : "Copy the interpretation";

  // Clipboard writes reject when the document is unfocused or permission is denied.
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        buildCopyText({ gene: analysisResult.metadata?.gene, variant: analysisResult.metadata?.variant, narrative, model })
      );
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1800);
  };

  const cutGroups = model.cuts.reduce<Record<string, typeof model.cuts>>((acc, cut) => {
    (acc[cut.group] ??= []).push(cut);
    return acc;
  }, {});
  const canRetryPocket = (model.pocket.status === "error" || model.pocket.status === "unavailable") && !!onRetryPocket;

  return (
    <div className="rsx-rail" data-testid="residue-shift-rail">
      {/* ── 1. Trace ── */}
      <section
        className="rsx-rsec"
        id={INSPECTOR_SECTIONS.residueShiftPocket}
        tabIndex={-1}
        aria-labelledby="rsx-rail-trace"
      >
        <h3 className="eyebrow" id="rsx-rail-trace">
          <span>
            <GitBranch className="w-3.5 h-3.5" aria-hidden="true" />
            Trace
          </span>
          <button type="button" className="rsx-info" onClick={handleCopy} title={copyHint} aria-label={copyHint}>
            {copyState === "copied" ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>
        </h3>
        <ol className="rsx-steps" data-testid="residue-trace">
          {model.trace.map((step, i) => (
            <Step key={step.label} n={i + 1} {...step} />
          ))}
        </ol>
        {canRetryPocket && (
          <button
            type="button"
            className="rsx-button"
            disabled={isPocketLoading}
            onClick={() => {
              void onRetryPocket!();
            }}
          >
            <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
            Retry pocket detection
          </button>
        )}
      </section>

      {/* ── 2. Cut-points ── */}
      <section className="rsx-rsec" aria-labelledby="rsx-rail-cuts">
        <h3 className="eyebrow" id="rsx-rail-cuts">
          <span>
            <Ruler className="w-3.5 h-3.5" aria-hidden="true" />
            Cut-points · this app&apos;s own
          </span>
        </h3>
        <div className="rsx-cuts" data-testid="residue-cuts">
          {Object.entries(cutGroups).map(([group, cuts]) => (
            <div className="rsx-cuts__group" key={group}>
              <span className="rsx-cuts__title">{group}</span>
              {cuts.map(cut => (
                <div className="rsx-cut" key={cut.rule} data-active={cut.active || undefined}>
                  <span className="rsx-cut__rule">{cut.rule}</span>
                  {cut.here ? <span className="rsx-cut__here">{cut.here}</span> : <span />}
                </div>
              ))}
            </div>
          ))}
          <p className="rsx-cuts__foot">None of these is a published classification; they are drawn dashed on the tab.</p>
        </div>
      </section>

      {/* ── 3. Model narrative ── */}
      <section
        className="rsx-rsec"
        id={INSPECTOR_SECTIONS.residueShiftNarrative}
        tabIndex={-1}
        aria-labelledby="rsx-rail-narrative"
      >
        <h3 className="eyebrow" id="rsx-rail-narrative">
          <span>
            <MessageSquareText className="w-3.5 h-3.5" aria-hidden="true" />
            Model narrative
          </span>
        </h3>
        {narrative.state === "loading" ? (
          <p className="rsx-prose rsx-prose--muted" role="status">{ENGINE_STATE_LABELS.running}</p>
        ) : narrative.prose ? (
          <>
            <p className="rsx-prose" data-testid="residue-narrative">{narrative.prose}</p>
            <p className="rsx-prose rsx-prose--muted">
              Written by a language model.{" "}
              {discrepancies.length === 0 ? "Checked against the scales: no disagreement." : "Checked against the scales:"}
            </p>
            {discrepancies.map(d => (
              <p key={d.axisKey} className="rsx-disagree">
                <AlertTriangle className="w-3 h-3 inline-block mr-1" aria-hidden="true" />
                The narrative describes a change in {d.axisLabel.toLowerCase()}, but the scales hold that axis flat ({d.values}).
              </p>
            ))}
          </>
        ) : (
          <>
            <p className="rsx-prose">
              <strong className="rsx-step__value">{narrative.reasonLabel ?? ENGINE_STATE_LABELS["no-result"]}</strong>
            </p>
            <p className="rsx-prose rsx-prose--muted">{narrative.detail}</p>
            {narrative.diagnostics && <p className="rsx-prose rsx-prose--muted rsx-mono">{narrative.diagnostics}</p>}
            {onRetryNarrative && narrative.retryable && (
              <button
                type="button"
                className="rsx-button"
                disabled={isNarrativeLoading}
                onClick={() => {
                  void onRetryNarrative();
                }}
              >
                <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                Write the narrative again
              </button>
            )}
          </>
        )}
      </section>

      {/* ── 4. Method ── */}
      <section className="rsx-rsec" aria-labelledby="rsx-rail-method">
        <h3 className="eyebrow" id="rsx-rail-method">
          <span>
            <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
            Method
          </span>
        </h3>
        <ul className="rsx-notes">
          {model.notes.map(note => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>

      {/* ── 5. Sources ── */}
      <section className="rsx-rsec" aria-labelledby="rsx-rail-sources">
        <h3 className="eyebrow" id="rsx-rail-sources">
          <span>
            <Database className="w-3.5 h-3.5" aria-hidden="true" />
            Sources
          </span>
        </h3>
        <ul className="rsx-refs" data-testid="residue-sources">
          {model.sources.map(src => (
            <li key={src.doi}>
              {src.citation}{" "}
              <a href={`https://doi.org/${src.doi}`} target="_blank" rel="noopener noreferrer">
                doi:{src.doi}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default React.memo(ResidueShiftInspector);
