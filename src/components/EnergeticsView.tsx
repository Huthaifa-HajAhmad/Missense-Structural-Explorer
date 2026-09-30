import { useState, useEffect, useMemo, useCallback, memo } from "react";
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
  signedDdg,
  type EnergeticsEvidence,
  type EnergeticsReading,
} from "../shared/energeticsEvidence";
import { DdgRuler } from "./energetics/DdgRuler";
import { describeFoldxPhase, FOLDX_PHASES, type FoldxProgress } from "../shared/foldxPhase";

/**
 * Energetics — predicted change in folding stability (ΔΔG).
 *
 * ONE QUESTION: do the stability engines predict that this substitution destabilizes the fold, and
 * how far do they agree? Three tiers, top to bottom — the Population/Predictors shape:
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
 *   • Each fact is stated once: values in the table, the count in the tally, meaning in the sentence.
 */

interface EnergeticsViewProps {
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
  canHidePending,
}: {
  onHidePendingEngines: () => void;
  progress: FoldxProgress | null;
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
  const queueNote =
    queued && progress?.queuePosition !== null && progress.queuePosition !== undefined
      ? progress.queuePosition === 0
        ? "Next in line"
        : `${progress.queuePosition} job${progress.queuePosition === 1 ? "" : "s"} ahead`
      : null;

  return (
    <section className="nrg-card nrg-progress" aria-live="polite" data-testid="energetics-progress">
      <div className="nrg-progress__head">
        <span className="nrg-progress__title">
          <Activity className="w-4 h-4" aria-hidden="true" />
          FoldX is running
        </span>
        <span className="nrg-progress__meta">
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
      <ol className="nrg-progress__steps">
        {FOLDX_PHASES.map((phase, index) => {
          const stageNumber = index + 1;
          const stage = describeFoldxPhase(phase)!;
          const isActive = view?.stage === stageNumber;
          const isPast = Boolean(view) && view!.stage > stageNumber;
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
        Current stage:{" "}
        <strong>{view ? view.detail : "not reported by the compute server yet."}</strong>
      </p>
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
        <span className="nrg-frow__sub">{evidence.coverage.label} returned a value · each judged on its own local mark</span>
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

function CaveatChips({ reading }: { reading: EnergeticsReading }) {
  if (reading.caveats.length === 0) return null;
  return (
    <span className="nrg-caveats">
      {reading.caveats.map(c => (
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
}: {
  reading: EnergeticsReading;
  unit: EnergyUnit;
  onKnowledge: (key: string) => void;
}) {
  const has = reading.ddg !== null;
  const state = reading.outcome.state;
  const running = state === "running" || state === "skipped";
  const ddgText = has ? signedDdg(reading.ddg, unit).replace(/ (kcal|kJ)\/mol$/, "") : null;
  return (
    <tr data-testid={`energetics-${reading.key}`} data-state={state}>
      <th scope="row">
        <span className="nrg-subject__line">
          <span className="nrg-subject__name">{reading.name}</span>
          <button
            type="button"
            className="nrg-info"
            onClick={() => onKnowledge(reading.knowledgeKey)}
            aria-label={`About ${reading.name}`}
            title="Method details and citation"
          >
            <Info className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </span>
        <span className="nrg-subject__note">{reading.description}</span>
        <CaveatChips reading={reading} />
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
            {reading.counted && <span className="nrg-call__sub">local mark +{reading.strongMark}</span>}
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
        plddt: disruptionPredictor?.plddt ?? null,
        hidePending: hidePendingEngines,
      }),
    [
      foldingDdG, foldingStatus, foldingEnergetics, dynamut2Status, ddmutStatus, thermompnnStatus,
      thermompnnError, foldingError, isFolding, disruptionPredictor?.plddt, hidePendingEngines,
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
            Predicted change in folding stability (ΔΔG, positive = destabilizing) from six engines, each
            judged on its own mark.
          </p>
        </header>

        {isFolding && !hidePendingEngines && (
          <ProgressPanel
            onHidePendingEngines={handleHidePendingEngines}
            progress={foldingProgress}
            canHidePending={evidence.coverage.computed > 0}
          />
        )}

        {/* ── 1. The finding ─────────────────────────────────────────────────────────────── */}
        <section className="nrg-card nrg-hero" aria-labelledby="nrg-finding-title" data-testid="energetics-finding">
          <div className="nrg-hero__head">
            <span className="eyebrow" id="nrg-finding-title">
              <Activity className="w-3.5 h-3.5" aria-hidden="true" />
              Folding stability · ΔΔG
            </span>
            <span className="ev-tier nrg-verdict" data-tone={chip.tone} data-testid="energetics-verdict">
              {chip.label}
            </span>
          </div>

          <div className="nrg-hero__figure">
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
          </div>

          <p className="nrg-summary" data-tone={summary.tone} data-testid="energetics-summary">
            {summary.tone === "warning" ? (
              <AlertTriangle className="nrg-summary__icon w-3.5 h-3.5" aria-label="Needs reconciling" />
            ) : (
              <span className="nrg-summary__dot" aria-hidden="true" />
            )}
            <span>
              <strong>{summary.lead}</strong>
              {summary.rest.map(sentence => ` ${sentence}`).join("")}
            </span>
          </p>

          <EngineTally evidence={evidence} />

          <p className="nrg-principle">
            <Scale className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              <strong>Destabilization is not pathogenicity.</strong> ΔΔG estimates misfolding risk only; a
              gain-of-function or interface variant can be pathogenic and stable. It feeds no ACMG criterion
              here, and no engine&apos;s mark is a published clinical cut-point.
            </span>
          </p>

          <div className="nrg-facts">
            <div className="nrg-fact">
              <span className="nrg-fact__label">Engines returned</span>
              <span className="nrg-fact__value">
                {evidence.coverage.computed} of {evidence.coverage.intended}
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
          </div>
        </section>

        {/* ── 2. Readings ──────────────────────────────────────────────────────────────────── */}
        <section className="nrg-section" aria-labelledby="nrg-readings-title">
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
                  <th scope="col" title="Canonical ΔΔG on a shared −3 to +5 kcal/mol axis, with the engine's own local marks dashed">
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
                    <ReadingRow key={r.key} reading={r} unit={unit} onKnowledge={setKnowledgeKey} />
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
        </section>
      </div>
    </div>
  );
});

export default EnergeticsView;
