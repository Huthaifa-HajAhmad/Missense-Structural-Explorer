import { useState, useEffect, useMemo, useCallback, memo, lazy, Suspense } from "react";
import { Activity, AlertTriangle, ExternalLink, Info, ListChecks, Scale } from "lucide-react";
import { AnalysisState, EnergeticsData } from "../types";
import { useSettings } from "../context/SettingsContext";
import { ModelKnowledgeModal } from "./modals/ModelKnowledgeModal";
import { ENGINE_STATE_LABELS, type EnergyUnit } from "../shared/engineStatus";
import {
  AGREEMENT_CHIP,
  ENERGETICS_CAVEAT_TEXT,
  ENERGETICS_GROUP_LABEL,
  ENERGETICS_GROUP_NOTE,
  absenceText,
  buildEnergeticsEvidence,
  energeticsSummary,
  groupEnergeticsReadings,
  markText,
  DDG_AXIS,
  signedDdg,
  type EnergeticsEvidence,
  type EnergeticsReading,
} from "../shared/energeticsEvidence";
import { DdgRuler } from "./energetics/DdgRuler";
import { describeFoldxPhase, FOLDX_PHASES, type FoldxProgress } from "../shared/foldxPhase";
import { WorkspaceTabs } from './ui/WorkspaceTabs';
import type { EnergyEngineId } from '../shared/engineStatus';
import { energeticsComparisonFinding, energeticsComparisonCautions, returnedEnergyEstimates, type EnergeticsChartOptions } from '../shared/energeticsComparison';
import { requestInspectorFocus, INSPECTOR_SECTIONS } from '../lib/inspectorFocus';

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

interface EnergeticsViewProps {
  selectedEngine?: EnergyEngineId | null;
  /** Activating the current selection clears it with `null`. */
  onSelectEngine?: (key: EnergyEngineId | null) => void;
  isDark: boolean;
  classCard: string;
  classCardHeader: string;
  classCardTitle: string;
  classBorderSec: string;
  classTextBody: string;
  classTextMute: string;
  analysisState: AnalysisState;
  foldingDdG: number | null;
  foldingStatus: "success" | "failed" | "unavailable" | null;
  foldingEnergetics?: EnergeticsData | null;
  dynamut2Status?: "pending" | "unavailable" | "done" | null;
  ddmutStatus?: "pending" | "unavailable" | "done" | null;
  thermompnnStatus?: "pending" | "unavailable" | "done" | "error" | null;
  thermompnnError?: string | null;
  disruptionPredictor?: { level: "high" | "low" | "unknown"; reason: string; plddt: number | null } | null;
  isFolding?: boolean;
  /** Server-reported FoldX phase and age; absent sinks simply render the spinner as before. */
  foldingProgress?: FoldxProgress | null;
  foldingError?: string | null;
}

/**
 * Human-readable age of a run, from a duration the SERVER measured plus the time since the client
 * received it, so the number never mixes two clocks.
 */
function formatElapsed(elapsedMs: number | null): string | null {
  if (elapsedMs === null || !Number.isFinite(elapsedMs)) return null;
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * The FoldX run in progress. The stage comes from `progress.phase`, which the worker writes; the
 * one-second tick only advances the age between polls. An unreported phase says so rather than
 * guessing, and the hide control is offered only once a row has settled (it lives inside what it
 * hides, so offering it earlier left no progress surface and no way back).
 */
const ProgressPanel = memo(function ProgressPanel({
  onHidePendingEngines,
  progress,
  evidence,
  foldingStatus,
  canHidePending,
}: {
  onHidePendingEngines: () => void;
  progress: FoldxProgress | null;
  evidence: EnergeticsEvidence;
  foldingStatus: EnergeticsViewProps["foldingStatus"];
  canHidePending: boolean;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const view = describeFoldxPhase(progress?.phase);
  const elapsed = formatElapsed(
    progress && progress.elapsedMs !== null ? progress.elapsedMs + Math.max(0, nowMs - progress.receivedAt) : null
  );
  const queued = progress?.phase === "queued";
  const returned = evidence.readings.filter(reading => reading.ddg !== null).length;
  const outstandingEngineSummary = evidence.readings
    .filter(reading => reading.ddg === null)
    .map(reading => {
      const state = queued && reading.outcome.state === "running" ? "Pending" : ENGINE_STATE_LABELS[reading.outcome.state];
      return `${reading.name}: ${state.toLowerCase()}`;
    })
    .join(", ");
  const foldxFinished = foldingStatus === "success" || foldingStatus === "failed" || foldingStatus === "unavailable";
  const otherEnginesRunning = evidence.readings.filter(reading => reading.key !== "foldx" && reading.outcome.state === "running").length;
  const title = foldingStatus === "success"
    ? "FoldX score ready"
    : foldingStatus === "failed" || foldingStatus === "unavailable"
      ? "FoldX finished · collecting other engine results"
      : queued
        ? "Energetics job queued"
        : "Energetics calculations in progress";
  const currentActivity = foldxFinished
    ? otherEnginesRunning > 0
      ? `FoldX has finished. ${otherEnginesRunning} independent engine${otherEnginesRunning === 1 ? " is" : "s are"} still running.`
      : "FoldX has finished; the remaining results are being assembled."
    : queued
      ? "Waiting for a compute worker to start this job."
    : view?.detail ?? "The compute server has not reported a stage yet.";
  const repairNote = !foldxFinished && progress?.phase === "repairing"
    ? "FoldX does not report a percentage for structure repair. A first repair can take a few minutes; the repaired template is reused on later variants."
    : null;
  const queueNote =
    queued && progress?.queuePosition !== null && progress.queuePosition !== undefined
      ? progress.queuePosition === 0
        ? "Next in line"
        : `${progress.queuePosition} job${progress.queuePosition === 1 ? "" : "s"} ahead`
      : null;

  return (
    <section className="nrg-card nrg-progress" aria-label="Energetics run progress" data-testid="energetics-progress">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {returned} of {evidence.readings.length} engine scores returned. {outstandingEngineSummary || "All engine scores returned."} {currentActivity}
      </p>
      <div className="nrg-progress__head">
        <span className="nrg-progress__title">
          <Activity className="w-4 h-4" aria-hidden="true" />
          {title}
        </span>
        <span className="nrg-progress__meta">
          <span className="nrg-progress__count">{returned} of {evidence.readings.length} scores ready</span>
          {elapsed && <span className="nrg-mono">Elapsed: {elapsed}</span>}
          {queueNote && <span>{queueNote}</span>}
          {canHidePending && (
            <button
              type="button"
              className="nrg-btn"
              onClick={onHidePendingEngines}
              title="Collapses the still-running rows so the settled results are easier to read. This does not cancel or skip any calculation."
            >
              Hide pending engines
            </button>
          )}
        </span>
      </div>
      <ol className="nrg-progress__steps" aria-label="FoldX stages">
        {FOLDX_PHASES.map((phase, index) => {
          const stageNumber = index + 1;
          const stage = describeFoldxPhase(phase)!;
          const isActive = !foldxFinished && view?.stage === stageNumber;
          const isPast = foldxFinished || (Boolean(view) && view!.stage > stageNumber);
          return (
            <li
              key={phase}
              className="nrg-progress__step"
              data-foldx-stage={stageNumber}
              data-active={isActive ? "true" : "false"}
              data-past={isPast ? "true" : "false"}
              aria-current={isActive ? "step" : undefined}
            >
              {stageNumber}. {stage.label}
            </li>
          );
        })}
      </ol>
      <p className="nrg-progress__now">
        {foldxFinished ? "FoldX:" : queued ? "Queue:" : "Current stage:"}{" "}
        <strong>{currentActivity}</strong>
      </p>
      {repairNote && <p className="nrg-progress__note">{repairNote}</p>}
      <ul className="nrg-progress__engines" aria-label="Engine result status">
        {evidence.readings.map(reading => {
          const state = reading.outcome.state;
          const displayState = queued && state === "running" ? "pending" : state;
          const stateLabel = reading.ddg !== null
            ? "Ready"
            : queued && state === "running"
              ? "Pending"
              : ENGINE_STATE_LABELS[state];
          return (
            <li key={reading.key} className="nrg-progress__engine" data-state={displayState}>
              <span className="nrg-progress__engine-mark" aria-hidden="true" />
              <span className="nrg-progress__engine-copy">
                <span className="nrg-progress__engine-name">{reading.name}</span>
                <span className="nrg-progress__engine-state">{stateLabel}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
});

/** Engines as a tally: one segment per engine, grouped by call, each name once. */
const TALLY_GROUPS = [
  { call: "high", word: "destabilizing" },
  { call: "moderate", word: "moderately destabilizing" },
  { call: "neutral", word: "not destabilizing" },
  { call: "running", word: "running" },
  { call: "none", word: "no value" },
] as const;
type TallyCall = (typeof TALLY_GROUPS)[number]["call"];

function tallyCall(r: EnergeticsReading): TallyCall {
  if (r.outcome.state === "running") return "running";
  if (r.ddg === null || !r.counted) return "none";
  const id = r.outcome.risk?.id;
  return id === "high" ? "high" : id === "moderate" ? "moderate" : "neutral";
}

function EngineTally({ evidence }: { evidence: EnergeticsEvidence }) {
  const shown = evidence.readings.filter(r => !(r.outcome.state === "skipped"));
  const groups = TALLY_GROUPS.map(g => ({ ...g, rows: shown.filter(r => tallyCall(r) === g.call) })).filter(
    g => g.rows.length > 0
  );
  return (
    <div className="nrg-frow" data-testid="energetics-tally">
      <div className="nrg-frow__label">
        <span className="nrg-frow__name">Engines</span>
        {/* The tally's own vocabulary is the count that RETURNED vs the count that COUNTED — the
            same two numbers the summary sentence uses, so the tile and the sentence cannot disagree
            when an excluded FoldX value is on screen. */}
        <span className="nrg-frow__sub">
          {`${returnedEnergyEstimates(evidence)} of ${evidence.coverage.intended} engines returned a value`}
          {evidence.agreement.nCounted !== returnedEnergyEstimates(evidence) ? `, ${evidence.agreement.nCounted} counted in the agreement` : ""}
          {" · each judged on its own local mark"}
        </span>
      </div>
      <div className="nrg-frow__body">
        <ol className="nrg-tally" aria-label="Stability engines by call">
          {groups.map(g => (
            <li key={g.call} className="nrg-tally__group" data-call={g.call} style={{ flexGrow: g.rows.length }}>
              <ul className="nrg-tally__tools">
                {g.rows.map(r => (
                  <li key={r.key} className="nrg-tally__tool" title={`${r.name}: ${r.ddg !== null ? signedDdg(r.ddg) : r.outcome.label}`}>
                    <i className="nrg-tally__seg" aria-hidden="true" />
                    <span className="nrg-tally__name">{r.name}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <p className="nrg-tally__key" data-testid="energetics-tally-key">
          {groups.map(g => (
            <span key={g.call}>
              <i className="nrg-tally__swatch" data-call={g.call} aria-hidden="true" />
              {g.rows.length} {g.word}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

function StructureFact({ evidence }: { evidence: EnergeticsEvidence }) {
  const s = evidence.structure;
  if (!s || evidence.isFolding) {
    return (
      <div className="nrg-fact">
        <span className="nrg-fact__label">Structure</span>
        <span className="nrg-fact__value">{evidence.isFolding ? "Resolving…" : "—"}</span>
      </div>
    );
  }
  return (
    <div className="nrg-fact" data-testid="energetics-structure">
      <span className="nrg-fact__label">{s.label}</span>
      <span className="nrg-fact__value">
        {s.pdbId ? (
          <a href={`https://www.rcsb.org/structure/${s.pdbId}`} target="_blank" rel="noopener noreferrer" title={`Open ${s.pdbId} in RCSB PDB`}>
            {s.pdbId}
            {s.chainId ? `:${s.chainId}` : ""}
            <ExternalLink className="inline w-3 h-3 ml-1 -mt-0.5" aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          "Model"
        )}
      </span>
      <span className="nrg-fact__sub">
        {[
          s.resolution !== null ? `${s.resolution.toFixed(1)} Å` : null,
          s.source === "homolog" && s.identity !== null ? `${s.identity.toFixed(0)}% identity` : null,
          s.repair,
        ]
          .filter(Boolean)
          .join(" · ") || " "}
      </span>
    </div>
  );
}

function CaveatChips({ caveats, inline = false }: { caveats: EnergeticsReading["caveats"]; inline?: boolean }) {
  if (caveats.length === 0) return null;
  return (
    <span className={`nrg-caveats${inline ? " nrg-caveats--inline" : ""}`}>
      {caveats.map(c => (
        <span
          key={c}
          className="ev-tier"
          data-tone={c === "excluded" ? "muted" : "warning"}
          title={ENERGETICS_CAVEAT_TEXT[c].detail}
        >
          {ENERGETICS_CAVEAT_TEXT[c].label}
        </span>
      ))}
    </span>
  );
}

function ReadingRow({
  reading,
  unit,
  onKnowledge,
  selected,
  onSelect,
}: {
  reading: EnergeticsReading;
  unit: EnergyUnit;
  onKnowledge: (key: string) => void;
  selected: boolean;
  onSelect: (key: EnergyEngineId) => void;
}) {
  const has = reading.ddg !== null;
  const state = reading.outcome.state;
  const running = state === "running" || state === "skipped";
  const ddgText = has ? signedDdg(reading.ddg, unit).replace(/ (kcal|kJ)\/mol$/, "") : null;
  const isTitleCaveat = (c: EnergeticsReading["caveats"][number]) => reading.key === "rasp" && c === "rosetta-surrogate";
  const titleCaveats = reading.caveats.filter(isTitleCaveat);
  const detailCaveats = reading.caveats.filter(c => !isTitleCaveat(c));
  return (
    <tr data-testid={`energetics-${reading.key}`} data-state={state} data-selected={selected}>
      <th scope="row">
        <span className="nrg-subject__line">
          <button type="button" className="nrg-method-button" aria-pressed={selected} onClick={() => onSelect(reading.key)}>{reading.name}</button>
          <button
            type="button"
            className="nrg-info"
            onClick={() => onKnowledge(reading.knowledgeKey)}
            aria-label={`About ${reading.name}`}
            title="Method details and citation"
          >
            <Info className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <CaveatChips caveats={titleCaveats} inline />
        </span>
        <span className="nrg-subject__note">{reading.description}</span>
        <CaveatChips caveats={detailCaveats} />
        {reading.note && <span className="nrg-subject__note nrg-subject__fact">{reading.note}</span>}
      </th>
      <td className="nrg-num">
        {has ? (
          <>
            {ddgText}
            <span className="nrg-unit">{unit}</span>
          </>
        ) : (
          <span className="nrg-dim">—</span>
        )}
      </td>
      {has ? (
        <td className="nrg-scale">
          <DdgRuler reading={reading} unit={unit} />
        </td>
      ) : (
        <td className="nrg-scale nrg-reason">
          {running ? (
            <span className="nrg-dim">{reading.outcome.reason}</span>
          ) : (
            // The server's own error text stays in the inspector's disclosure; the row gives the reason.
            absenceText(reading)
          )}
        </td>
      )}
      <td className="nrg-status">
        {has ? (
          <>
            <span className="ev-tier" data-tone={reading.callTone}>
              {reading.callLabel ?? "—"}
            </span>
            {reading.counted && <span className="nrg-call__sub">local mark {markText(reading.strongMark, unit)}</span>}
          </>
        ) : (
          <span className="ev-tier" data-tone={running ? "neutral" : reading.outcome.tone === "danger" ? "danger" : reading.outcome.tone === "warn" ? "warning" : "muted"}>
            {reading.outcome.label || ENGINE_STATE_LABELS[state]}
          </span>
        )}
      </td>
    </tr>
  );
}

const EnergeticsView = memo(function EnergeticsView({
  selectedEngine = null,
  onSelectEngine,
  classCard,
  analysisState,
  foldingDdG,
  foldingStatus,
  foldingEnergetics,
  dynamut2Status,
  ddmutStatus,
  thermompnnStatus,
  thermompnnError = null,
  disruptionPredictor,
  isFolding = false,
  foldingProgress = null,
  foldingError = null,
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
  const { settings } = useSettings();
  const unit: EnergyUnit = settings.energyUnit === "kJ/mol" ? "kJ/mol" : "kcal/mol";
  const result = analysisState.result;

  const evidence = useMemo(
    () =>
      buildEnergeticsEvidence({
        foldingDdG,
        foldingStatus,
        foldingEnergetics: foldingEnergetics as Record<string, any> | null | undefined,
        dynamut2Status,
        ddmutStatus,
        thermompnnStatus,
        thermompnnError,
        foldingError,
        isFolding,
        plddt: disruptionPredictor?.plddt ?? result?.disruptionPredictor?.plddt ?? null,
        hidePending: hidePendingEngines,
      }),
    [
      foldingDdG, foldingStatus, foldingEnergetics, dynamut2Status, ddmutStatus, thermompnnStatus,
      thermompnnError, foldingError, isFolding, disruptionPredictor?.plddt, result?.disruptionPredictor?.plddt, hidePendingEngines,
    ]
  );

  if (!result) {
    return (
      <div className={`${classCard} nrg-scroll`} id="energetics-view">
        <div className="nrg-screen">
          <header className="nrg-header">
            <h1 className="screen-title">Energetics</h1>
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
  const medianText = agreement.median !== null ? signedDdg(agreement.median, unit) : null;
  const [medianNum, medianUnit] = medianText ? [medianText.replace(/ (kcal|kJ)\/mol$/, ""), unit] : ["—", ""];

  return (
    <div
      className={`${classCard} nrg-scroll`}
      id="energetics-view"
      role="region"
      aria-label="Energetics: predicted folding stability"
    >
      {knowledgeKey && <ModelKnowledgeModal isOpen modelKey={knowledgeKey} onClose={() => setKnowledgeKey(null)} />}
      <div className="nrg-screen">
        <header className="nrg-header">
          <h1 className="screen-title">Energetics</h1>
          <p className="screen-tab-description">
            How might this substitution change protein stability?
          </p>
          <p className="nrg-query"><strong>{result.metadata?.gene} {result.metadata?.variant}</strong><span>Estimates refer to this queried substitution.</span></p>
        </header>
        <div className="nrg-navigation">
          <WorkspaceTabs id="energetics" label="Energetics views" tabs={ENERGY_TABS} value={tab} onChange={setTab} />
          {selected && <button type="button" className="nrg-inspect-button" onClick={() => requestInspectorFocus(INSPECTOR_SECTIONS.stabilityMethod)}>Inspect {evidence.readings.find(r => r.key === selected)?.name} →</button>}
        </div>

        {isFolding && !hidePendingEngines && (
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
            <span className="ev-tier nrg-verdict" data-tone={chip.tone} data-testid="energetics-verdict">
              {chip.label}
            </span>
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
                : <><strong>{energeticsComparisonFinding(evidence)}</strong> {returnedEnergyEstimates(evidence)} of {evidence.coverage.intended} methods returned a value; {agreement.nCounted} counted.</>}
            </span>
          </p>

          {tab === 'records' && <EngineTally evidence={evidence} />}
          {tab === 'comparison' && energeticsComparisonCautions(evidence).map(note => <p className="nrg-comparison-caution" key={note}>{note}</p>)}

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

        {/* ── 2. Readings ──────────────────────────────────────────────────────────────────── */}
        {tab === 'records' && <section className="nrg-section" aria-labelledby="nrg-readings-title">
          <h2 className="eyebrow" id="nrg-readings-title">
            <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
            Engine readings
          </h2>
          <div className="nrg-card nrg-table-wrap">
            <table className="nrg-table" data-testid="energetics-readings">
              <colgroup>
                <col className="nrg-col-engine" />
                <col className="nrg-col-value" />
                <col />
                <col className="nrg-col-call" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Engine</th>
                  <th scope="col" className="nrg-num">ΔΔG</th>
                  <th scope="col" title={`Canonical ΔΔG on a shared ${markText(DDG_AXIS.min, unit)} to ${markText(DDG_AXIS.max, unit)} ${unit} axis, with the engine's own local marks dashed`}>
                    Position on ΔΔG axis
                  </th>
                  <th scope="col" className="nrg-status">Call</th>
                </tr>
              </thead>
              {groupEnergeticsReadings(evidence.readings).map(({ group, rows }) => (
                <tbody key={group} data-group={group}>
                  <tr className="nrg-group">
                    <th colSpan={4} scope="rowgroup">
                      <span className="nrg-group__inner">
                        <span className="nrg-group__title">{ENERGETICS_GROUP_LABEL[group]}</span>
                        <span className="nrg-group__meta">{ENERGETICS_GROUP_NOTE[group]}</span>
                      </span>
                    </th>
                  </tr>
                  {rows.map(r => (
                    <ReadingRow key={r.key} reading={r} unit={unit} onKnowledge={setKnowledgeKey} selected={selected === r.key} onSelect={selectEngine} />
                  ))}
                </tbody>
              ))}
            </table>
            <div className="nrg-table-foot" aria-label="Legend">
              <span className="nrg-legend__item">Positive = destabilizing; DynaMut2 and DDMut signs normalized</span>
              <span className="nrg-legend__item"><i className="nrg-legend__tick" />Local destabilizing mark (not published)</span>
              <span className="nrg-legend__item"><i className="nrg-legend__tick" data-side="stabilizing" />Local stabilizing mark</span>
              <span className="nrg-legend__item"><i className="nrg-legend__marker" />This variant</span>
              <span className="nrg-legend__item"><i className="nrg-legend__marker" data-off-scale />Beyond the axis</span>
            </div>
          </div>
        </section>}
        </div>
      </div>
    </div>
  );
});

export default EnergeticsView;
