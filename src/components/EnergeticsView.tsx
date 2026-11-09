import { useState, useCallback, memo, lazy, Suspense } from "react";
import { Activity, AlertTriangle, Scale } from "lucide-react";
import { ModelKnowledgeModal } from "./modals/ModelKnowledgeModal";
import { ResearchGuideButton } from './knowledge/ResearchGuideButton';
import type { EnergyEngineId } from '../shared/engineStatus';
import { AGREEMENT_CHIP, energeticsSummary, signedDdg, signedDdgNumber } from "../shared/energeticsEvidence";
import { energeticsComparisonHeadline, energeticsComparisonFinding, energeticsComparisonCautions, returnedEnergyEstimates, type EnergeticsChartOptions } from '../shared/energeticsComparison';
import type { FoldxProgress } from "../shared/foldxPhase";
import { requestInspectorFocus, INSPECTOR_SECTIONS } from '../lib/inspectorFocus';
import { WorkspaceTabs } from './ui/WorkspaceTabs';
import { RetryDynamut2 } from "./energetics/RetryDynamut2";
import { ProgressPanel } from "./energetics/ProgressPanel";
import { EngineTally, StructureFact } from "./energetics/FindingFacts";
import { ReadingsTable } from "./energetics/ReadingsTable";
import { useEnergeticsEvidence, type EnergeticsContext, type EnergeticsRun } from "./energetics/useEnergeticsEvidence";

const EnergeticsComparison = lazy(() => import('./energetics/EnergeticsComparison'));
const ENERGY_TABS = [{ id: 'comparison', label: 'Comparison' }, { id: 'records', label: 'Engine records' }] as const;


/**
 * Energetics — predicted change in folding stability (ΔΔG).
 *
 * ONE QUESTION: do the stability engines predict that this substitution destabilizes the fold, and
 * how far do they agree? Comparison opens with a compact finding and an interactive dot plot.
 * Engine records retains the detailed Population/Predictors evidence shape:
 *
 *   1. THE FINDING — the agreement chip, the median ΔΔG with its range, one sentence saying what the
 *      engines say together (and where they disagree), the engines as a tally by call, the one
 *      principle a curator must not skip (destabilization ≠ pathogenicity; no ACMG input), and a fact
 *      strip ending in the engine record.
 *   2. READINGS — one table, every engine a row: canonical ΔΔG, its position on a shared axis with the
 *      engine's own LOCAL marks dashed, and its call. An engine with no value spans its reason.
 *
 * WHAT IT REPLACED
 *   • A "Calibrated probability of destabilization" gauge, a "90% conformal prediction interval" and a
 *     per-engine "P: 91% [81–97%]" breakdown. Their curves were typed by hand (tools/train_stacker.py
 *     fits nothing), so they are gone, not relabelled — see `shared/energeticsEvidence.ts`.
 *   • "Engine-specific calibrated cut-points" in the table foot: every mark is local.
 *   • A second, drifted copy of the method citations (DDMut cited to a 2022 DOI, ThermoMPNN to a
 *     vendor page, StabilityOracle to this repository). The info buttons open the shared table.
 *
 * INVARIANTS
 *   • Every number, state and call comes from `buildEnergeticsEvidence`; this file classifies nothing.
 *   • Comparison and Engine records share one evidence model and one selected method.
 */

interface EnergeticsViewProps extends EnergeticsRun {
  selectedEngine?: EnergyEngineId | null;
  /** Activating the current selection clears it with `null`. */
  onSelectEngine?: (key: EnergyEngineId | null) => void;
  classCard: string;
  analysisResult: EnergeticsContext | null;
  /** Server-reported FoldX phase and age; absent sinks simply render the spinner as before. */
  foldingProgress?: FoldxProgress | null;
}

const EnergeticsView = memo(function EnergeticsView({
  selectedEngine = null,
  onSelectEngine,
  classCard,
  analysisResult: result,
  foldingProgress = null,
  ...run
}: EnergeticsViewProps) {
  const [tab, setTab] = useState<'comparison' | 'records'>('comparison');
  const [chartOptions, setChartOptions] = useState<EnergeticsChartOptions>({ sort: 'method', countedOnly: false, showMarks: false });
  const [localSelection, setLocalSelection] = useState<EnergyEngineId | null>(null);
  const selected = onSelectEngine ? selectedEngine : localSelection;
  /** Activating the already-pinned method — from the chart, a row or a missing-method chip — clears the pin. */
  const selectEngine = (key: EnergyEngineId | null) => {
    const next = key !== null && key === selected ? null : key;
    (onSelectEngine ?? setLocalSelection)(next);
  };
  const [knowledgeKey, setKnowledgeKey] = useState<string | null>(null);
  /**
   * Presentation-only: collapses the rows of engines that are still running. It cannot change the
   * engine count (the old "Skip Slow Predictors" changed the reported method count while the
   * requests kept running).
   */
  const [hidePendingEngines, setHidePendingEngines] = useState(false);
  const handleHidePendingEngines = useCallback(() => setHidePendingEngines(true), []);
  const { evidence, unit } = useEnergeticsEvidence(run, result, hidePendingEngines);
  const { foldingEnergetics, dynamut2Status, foldingStatus } = run;

  if (!result) {
    return (
      <div className={`${classCard} nrg-scroll`} id="energetics-view">
        <div className="nrg-screen">
          <header className="nrg-header">
            <div className="nrg-header__row">
              <h1 className="screen-title">Energetics</h1>
              <ResearchGuideButton topic="energetics" label="How to read stability estimates" />
            </div>
            <p className="screen-tab-description">Predicted change in folding stability (ΔΔG) from six engines.</p>
          </header>
          <p className="nrg-dim">Run a variant to estimate its effect on folding stability.</p>
        </div>
      </div>
    );
  }

  const summary = energeticsSummary(evidence, unit);
  const { agreement } = evidence;
  const chip = AGREEMENT_CHIP[agreement.direction];
  const [medianNum, medianUnit] = agreement.median !== null ? [signedDdgNumber(agreement.median, unit), unit] : ["—", ""];

  return (
    <div
      className={`${classCard} nrg-scroll`}
      id="energetics-view"
      role="region"
      aria-label="Energetics: predicted folding stability"
    >
      {knowledgeKey && <ModelKnowledgeModal isOpen modelKey={knowledgeKey} onClose={() => setKnowledgeKey(null)} />}
      <div className="nrg-screen" data-view={tab}>
        <header className="nrg-header">
          <div className="nrg-header__row">
            <h1 className="screen-title">Energetics</h1>
            <ResearchGuideButton topic="energetics" label="How to read stability estimates" />
          </div>
          {tab === 'records' && <p className="screen-tab-description">
            How might this substitution change protein stability?
          </p>}
          <p className="nrg-query">Predicted effect of <strong>{result.metadata?.gene} {result.metadata?.variant}</strong> on folding stability</p>
        </header>
        <div className="nrg-navigation">
          <WorkspaceTabs id="energetics" label="Energetics views" tabs={ENERGY_TABS} value={tab} onChange={setTab} />
          <RetryDynamut2
            variant={result.metadata?.variant}
            uniprotId={result.metadata?.uniprotId ?? null}
            energetics={foldingEnergetics}
            status={dynamut2Status}
            onSubmitted={() => setHidePendingEngines(false)}
          />
          {selected && <button type="button" className="nrg-inspect-button" onClick={() => requestInspectorFocus(INSPECTOR_SECTIONS.stabilityMethod)}>Inspect {evidence.readings.find(r => r.key === selected)?.name} →</button>}
        </div>

        {run.isFolding && !hidePendingEngines && (
          <ProgressPanel
            onHidePendingEngines={handleHidePendingEngines}
            progress={foldingProgress}
            evidence={evidence}
            foldingStatus={foldingStatus}
            canHidePending={evidence.readings.some(reading => reading.ddg !== null)}
          />
        )}

        {/* ── 1. The finding ─────────────────────────────────────────────────────────────── */}
        <section className="nrg-card nrg-hero" data-compact={tab === 'comparison'} aria-labelledby="nrg-finding-title" data-testid="energetics-finding">
          <div className="nrg-hero__head">
            <span className="eyebrow" id="nrg-finding-title">
              <Activity className="w-3.5 h-3.5" aria-hidden="true" />
              Folding stability · ΔΔG
            </span>
            <div className="nrg-verdict-group">
              {tab === 'comparison'
                ? <h2 className="nrg-finding-heading" data-testid="energetics-verdict">{energeticsComparisonHeadline(evidence)}</h2>
                : <span className="ev-tier nrg-verdict" data-tone={chip.tone} data-testid="energetics-verdict">
                    {chip.label}
                  </span>}
              {agreement.provisional && (
                <span className="nrg-verdict-pending" data-testid="energetics-provisional">
                  Provisional · {evidence.running.length} still running
                </span>
              )}
            </div>
          </div>

          {tab === 'records' && <div className="nrg-hero__figure">
            <span className="nrg-hero__value" data-testid="energetics-median">
              {medianNum}
              {medianUnit && <span className="nrg-hero__unit">{medianUnit}</span>}
            </span>
            <span className="nrg-hero__label">
              {agreement.nCounted === 0
                ? "No counted ΔΔG"
                : agreement.nCounted === 1
                  ? "Single engine — not a median"
                  : `Median of ${agreement.nCounted} engines · range ${signedDdg(agreement.min, unit)} to ${signedDdg(agreement.max, unit)}`}
            </span>
          </div>}

          <p className="nrg-summary" data-tone={summary.tone} data-testid="energetics-summary">
            {summary.tone === "warning" ? (
              <AlertTriangle className="nrg-summary__icon w-3.5 h-3.5" aria-label="Needs reconciling" />
            ) : (
              <span className="nrg-summary__dot" aria-hidden="true" />
            )}
            <span>
              {tab === 'records' ? <><strong>{summary.lead}</strong>{summary.rest.map(sentence => ` ${sentence}`).join("")}</>
                : <><strong>{energeticsComparisonFinding(evidence)}</strong><span className="nrg-summary__coverage">{returnedEnergyEstimates(evidence)} of {evidence.coverage.intended} methods returned a value; {agreement.nCounted} counted.</span></>}
            </span>
          </p>

          {tab === 'records' && <EngineTally evidence={evidence} unit={unit} />}
          {tab === 'comparison' && energeticsComparisonCautions(evidence, unit).map(note => <p className="nrg-comparison-caution" key={note}>{note}</p>)}

          <p className="nrg-principle">
            <Scale className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {tab === 'comparison' ? 'These predictions describe folding stability, not whether a variant causes disease.' : <><strong>Destabilization is not pathogenicity.</strong> ΔΔG estimates misfolding risk only; a
              gain-of-function or interface variant can be pathogenic and stable. It feeds no ACMG criterion
              here, and no engine&apos;s mark is a published clinical cut-point.</>}
            </span>
          </p>

          {tab === 'records' && <div className="nrg-facts">
            <div className="nrg-fact">
              <span className="nrg-fact__label">Engines returned</span>
              <span className="nrg-fact__value">
                {returnedEnergyEstimates(evidence)} of {evidence.coverage.intended}
              </span>
              <span className="nrg-fact__sub">
                {evidence.running.length > 0 ? `${evidence.running.length} running` : `${evidence.missing.length} without a value`}
              </span>
            </div>
            <div className="nrg-fact">
              <span className="nrg-fact__label">Past own mark</span>
              <span className="nrg-fact__value">
                {agreement.destabilizing.length} of {agreement.nCounted}
              </span>
              <span className="nrg-fact__sub">
                {agreement.destabilizing.length ? agreement.destabilizing.map(r => r.name).join(", ") : "none"}
              </span>
            </div>
            <StructureFact evidence={evidence} />
            <div className="nrg-fact">
              <span className="nrg-fact__label">Engine record</span>
              <span className="nrg-fact__value">Not an ACMG input</span>
              <span className="nrg-fact__sub">Informational evidence</span>
            </div>
          </div>}
        </section>

        <div id={`energetics-panel-${tab}`} role="tabpanel" aria-labelledby={`energetics-tab-${tab}`} tabIndex={0}>
        {tab === 'comparison' && <Suspense fallback={<p role="status">Loading stability comparison…</p>}>
          <EnergeticsComparison evidence={evidence} unit={unit} selected={selected} onSelect={selectEngine} options={chartOptions} onOptions={setChartOptions} />
        </Suspense>}


        {tab === 'records' && <ReadingsTable evidence={evidence} unit={unit} selected={selected} onSelect={selectEngine} onKnowledge={setKnowledgeKey} />}
        </div>
      </div>
    </div>
  );
});

export default EnergeticsView;