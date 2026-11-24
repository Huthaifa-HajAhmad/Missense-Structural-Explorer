import React, { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Cpu, Info, ListChecks } from "lucide-react";
import { TabComponentProps } from "./types";
import { useSettings } from "../../context/SettingsContext";
import { ModelKnowledgeModal } from "../modals/ModelKnowledgeModal";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { formatEvidenceCode } from "../../shared/thresholds";
import {
  CAVEAT_TEXT,
  PREDICTOR_GROUP_LABEL,
  PREDICTOR_GROUP_NOTE,
  buildPredictorEvidence,
  groupReadings,
  informationalSummary,
  isReadingParticipatingInRule,
  predictorSummary,
  type PredictorEvidence,
  type PredictorReading,
} from "../../shared/predictorEvidence";
import { buildLadderEvidence } from "../../shared/ladderEvidence";
import { PredictorInformationalSummary } from "./PredictorInformationalSummary";
import { DecimalScore } from "./DecimalScore";
import { ScoreRuler } from "./predictors/ScoreRuler";
import { ChainRow, EngineChip, PrimaryToolRow } from "./predictors/PredictorFindingRows";
import { StrengthLadder } from "./predictors/StrengthLadder";
import { EvidenceViewTabs, EvidencePanel, InspectReadingButton, useEvidenceWorkspace } from './EvidenceWorkspace';
import { buildPredictorComparison } from '../../shared/evidenceComparison';
import EvidenceComparison from './EvidenceComparison';
import { evidenceTab } from '../../shared/evidenceTabs';

/**
 * In-silico predictors.
 *
 * ONE QUESTION: what do the computational predictors say about this substitution, and what did the
 * ACMG PP3/BP4 rule make of it? Three tiers, top to bottom — the same shape as Population Data:
 *
 *   1. THE FINDING — a header bar with the engine's recorded code; ONE summary line (engine record,
 *      the tool that set the call, and any disagreement in words); the STRENGTH LADDER (every tool on
 *      one shared axis of evidence strength, the variant's band marked; tools with only their authors'
 *      cut-point show a side, never a strength); then two rows: the fixed order of calibrated tools
 *      (REVEL → BayesDel noAF → AlphaMissense → ESM1b) with the one that answered marked, and that
 *      tool on its own ruler with its published bands (`predictors/PredictorFindingRows.tsx`).
 *   2. READINGS — one table, every tool a row: score, its position on its own axis with its
 *      cut-points drawn by provenance, and its call. Grouped by role: the calibrated tools in their
 *      fixed order, then the informational ones. This replaced a 4-tab card grid that showed one family at a time, so the
 *      tools a reviewer compares were never on screen together.
 *
 * INVARIANTS
 *   • Every number and call comes from `buildPredictorEvidence`; this file tests no score.
 *   • The engine's decision is READ from its criteria list; a code the payload does not carry is
 *     drawn dashed and called unconfirmed, never asserted.
 *   • A cut-point is always shown with its provenance — ClinGen, the authors', local, or none.
 *   • Each fact is stated once on the card: scores live in the table, the order in the chain row,
 *     the answering tool's band in its row. The summary line says what they mean together.
 */

const CUT_SOURCE_LABEL: Record<PredictorReading["cutpoints"]["kind"], string> = {
  calibrated: "ClinGen",
  authors: "Authors' cut",
  local: "Local marks",
  none: "No cut-point",
};

function LocalAgreementRow({ evidence, compact = false }: { evidence: PredictorEvidence; compact?: boolean }) {
  return <div data-testid="predictor-local-agreement">
    <header className="prd-hero__head prd-context-head">
      <h2 className="eyebrow">Local agreement / informational</h2>
      <span className="ev-tier" data-tone="muted">Context only / never sets PP3 / BP4</span>
    </header>
    <PredictorInformationalSummary evidence={evidence} headingLevel="h3" compact={compact} />
  </div>;
}

function CaveatChips({ reading }: { reading: PredictorReading }) {
  if (reading.caveats.length === 0) return null;
  return (
    <span className="prd-caveats ev-caveats">
      {reading.caveats.map(c => (
        <span key={c} className="ev-tier" data-tone="warning" title={CAVEAT_TEXT[c].detail}>
          {CAVEAT_TEXT[c].label}
        </span>
      ))}
    </span>
  );
}

function ReadingRow({
  reading,
  inActiveRule,
  onKnowledge,
  onAction,
  onTabChange,
  cutLines,
}: {
  reading: PredictorReading;
  inActiveRule: boolean;
  /** The cut-points in words ("PP3 ≥ 0.644 · 0.773 · 0.932"), so a number can be read off without a hover. */
  cutLines?: string[];
  onKnowledge: (key: string) => void;
  onAction: (action: NonNullable<PredictorReading["availability"]["action"]>) => void;
  onTabChange?: (tab: string) => void;
}) {
  const has = reading.score !== null || reading.availability.state === "available";
  const pending = reading.availability.state === "pending";
  return (
    <tr data-testid={`predictor-${reading.key}`} data-chain={reading.chainKey ?? undefined}>
      <th scope="row" className="prd-subject">
        <span className="prd-subject__line">
          <span className="prd-subject__name"><InspectReadingButton tab="predictors" readingKey={reading.key}>{reading.name}</InspectReadingButton></span>
          {reading.knowledgeKey && (
            <button
              type="button"
              className="prd-info"
              data-explanation-topic={reading.knowledgeKey}
              onClick={() => onKnowledge(reading.knowledgeKey as string)}
              aria-label={`About ${reading.name}`}
              title="Model details and citation"
            >
              <Info className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </span>
        <span className="prd-subject__note">{reading.description}</span>
        <CaveatChips reading={reading} />
        {reading.note && <span className="prd-subject__note prd-subject__fact">{reading.note}</span>}
        {reading.link && onTabChange && has && (
          <button type="button" className="prd-link" onClick={() => onTabChange(reading.link!.tab)}>
            {reading.link.label}
            <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </button>
        )}
      </th>
      <td className="prd-num">
        {has ? (
          <>
            <DecimalScore text={reading.scoreText} />
            {reading.unit && <span className="prd-unit">{reading.unit}</span>}
          </>
        ) : (
          <span className="prd-dim">—</span>
        )}
      </td>
      {has ? (
        <td className="prd-scale">
          <ScoreRuler reading={reading} thresholds="entry" />
          {/* A bare axis already shows there is no cut-point (the legend says so once); the
              caption is kept for every ruler that DRAWS a cut-point, since each carries its source. */}
          {reading.cutpoints.kind !== "none" && (
            <span className="prd-scale__source">
              {CUT_SOURCE_LABEL[reading.cutpoints.kind]}
              {reading.cutpoints.source ? ` · ${reading.cutpoints.source}` : ""}
            </span>
          )}
          {cutLines?.map(line => (
            <span key={line} className="prd-scale__cut">{line}</span>
          ))}
        </td>
      ) : (
        <td className="prd-reason prd-scale">
          {pending ? (
            <span className="prd-dim">Still being computed for this variant.</span>
          ) : (
            <>
              {reading.availability.reason ?? "No score reached this variant."}
              {reading.availability.action === "configure-alphagenome" ? (
                <>
                  {" "}
                  <button type="button" className="prd-link" onClick={() => onAction(reading.availability.action!)}>
                    Open connection settings
                  </button>
                </>
              ) : reading.availability.action === "retry" ? (
                " Re-run the analysis to ask again."
              ) : null}
            </>
          )}
        </td>
      )}
      <td className="prd-status">
        {has && reading.callLabel === "Informational" ? (
          // Not a call: plain text, so the column's chips are only the readings that make one.
          <span className="prd-call__plain">Informational</span>
        ) : has ? (
          <>
            <span
              className={`ev-tier${/^(PP3|BP4)/.test(reading.callLabel) ? " chip-code" : ""}`}
              data-tone={reading.callTone}
            >
              {formatEvidenceCode(reading.callLabel)}
            </span>
            {!inActiveRule && reading.calibrated && <span className="prd-call__sub">not counted</span>}
          </>
        ) : (
          <span className="ev-tier" data-tone={pending ? "neutral" : "muted"}>
            {pending ? ENGINE_STATE_LABELS.running : reading.availability.label ?? ENGINE_STATE_LABELS["no-result"]}
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * The models that never set PP3/BP4, explained for a reader who has not met them: per family, what it
 * measures, why it sits outside PP3/BP4, how to read its number, and this variant's scores.
 */
function InformationalCard({ evidence }: { evidence: PredictorEvidence }) {
  const families = informationalSummary(evidence);
  if (families.length === 0) return null;
  return (
    <section className="prd-card" aria-labelledby="prd-info-title" data-testid="predictor-informational">
      <div className="prd-hero__head">
        <h2 className="eyebrow" id="prd-info-title">
          <Info className="w-3.5 h-3.5" />
          Informational models · not counted
        </h2>
        <span className="ev-tier" data-tone="muted">Context only</span>
      </div>
      <p className="prd-info-lede">
        <strong>These scores add context but never change the PP3 / BP4 call.</strong> Each is a different
        kind of evidence, or has no published calibration saying what a given score means for
        pathogenicity. Read each against its own axis in the table below.
      </p>
      {families.map(f => (
        <div key={f.group} className="prd-fam" data-testid={`predictor-family-${f.group}`}>
          <div>
            <span className="prd-fam__name">{f.label}</span>
            <span className="prd-fam__sub">{f.headline}</span>
          </div>
          <div className="prd-fam__body">
            <details className="prd-family-guide" open>
              <summary>How to read {f.label.toLowerCase()}</summary>
              <p><b>What it measures.</b> {f.what}</p>
              <p><b>Why it is not counted.</b> {f.why}</p>
              <p><b>How to read it.</b> {f.read}</p>
            </details>
            <div className="prd-fam__scores">
              {f.readings.map(r => <span key={r.key}>
                <InspectReadingButton tab="predictors" readingKey={r.key}>{r.name}</InspectReadingButton>
                <span className="prd-mono">{r.score !== null ? r.scoreText : r.availability.label ?? ENGINE_STATE_LABELS['no-result']}</span>
                {r.score !== null && r.calibrated && <span>{formatEvidenceCode(r.callLabel)}</span>}
              </span>)}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

/**
 * The guard lives in a wrapper so every hook below runs on every render. The guard used to sit
 * between hooks, so a result that went from present to absent (a new query clearing the store)
 * rendered fewer hooks than the previous pass, and React threw "Rendered fewer hooks than expected".
 */
export function PredictorsTab(props: TabComponentProps) {
  if (!props.analysisState.result) return null;
  return <PredictorsTabContent {...props} />;
}

function PredictorsTabContent({ analysisState, onOpenSettings, onTabChange }: TabComponentProps) {
  const workspace = useEvidenceWorkspace('predictors');
  const { settings, openSettingsTab } = useSettings();
  const [knowledgeKey, setKnowledgeKey] = useState<string | null>(null);
  // Non-null: the PredictorsTab wrapper renders this only when a result exists.
  const result = analysisState.result!;

  const alphagenomeConfigured = settings.alphagenomeApiKey?.trim() ? true : undefined;
  const evidence = useMemo(() => buildPredictorEvidence({
    result,
    isLoading: analysisState.isLoading,
    // Tri-state: the browser can only attest to a key it holds; the server may hold its own.
    alphagenomeConfigured,
  }), [result, analysisState.isLoading, alphagenomeConfigured]);
  const summary = useMemo(() => predictorSummary(evidence), [evidence]);
  const ladder = useMemo(() => buildLadderEvidence({ result, predictor: evidence }), [result, evidence]);
  const cutLinesByKey = useMemo(() => new Map<string, string[]>([
    ...ladder.ladder.map(l => [l.key, l.cutLines] as [string, string[]]),
    ...ladder.directional.map(d => [d.key, [d.cutText]] as [string, string[]]),
  ]), [ladder]);
  const predictorModel = useMemo(() => buildPredictorComparison(evidence, ladder), [evidence, ladder]);

  const openConnections = () => {
    if (onOpenSettings) onOpenSettings();
    else openSettingsTab("connections");
  };

  return (
    <div data-evidence-screen className="prd-screen @container" data-comparison={workspace.comparison || undefined}>
      {knowledgeKey && (
        <ModelKnowledgeModal isOpen modelKey={knowledgeKey} onClose={() => setKnowledgeKey(null)} />
      )}

      <header>
        <h1 className="screen-title">{evidenceTab('predictors').label}</h1>
        <p className="screen-tab-description">
          What computational predictors say about this substitution, and which calibrated tool set
          the ACMG PP3/BP4 criterion.
        </p>
      </header>
      <EvidenceViewTabs tab="predictors" />
      <EvidencePanel tab="predictors">

      {/* ── 1. The finding ─────────────────────────────────────────────────────────────────── */}
      <section className="prd-card prd-hero" aria-labelledby="prd-finding-title" data-testid="predictor-finding">
        <div className="prd-hero__head">
          <span className="eyebrow" id="prd-finding-title">
            <Cpu className="w-3.5 h-3.5" />
            ACMG computational evidence · PP3 / BP4
          </span>
          <EngineChip evidence={evidence} />
        </div>

        <p className="prd-summary" data-tone={summary.tone} data-state={summary.state} data-testid="predictor-summary">
          {summary.tone === "warning" ? (
            <AlertTriangle className="prd-summary__icon w-3.5 h-3.5" aria-label="Needs reconciling" />
          ) : (
            <span className="prd-summary__dot" aria-hidden="true" />
          )}
          <span>
            <strong>{summary.lead}</strong>
            {summary.rest.map(sentence => ` ${sentence}`).join("")}
          </span>
        </p>

        {(!workspace.enabled || workspace.view === 'strength') && <StrengthLadder evidence={ladder} primaryKey={evidence.readings.find(r => (r.chainKey ?? (r.key === 'cadd' ? 'cadd' : null)) === evidence.primary.activeTool)?.key ?? null} />}

        {!workspace.enabled && <><ChainRow evidence={evidence} /><PrimaryToolRow evidence={evidence} /></>}

        {evidence.pending && (
          <div className="prd-hero__foot">
            <span role="status" className="prd-hero__pending">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              Some scores are still being computed; the rows marked below may fill in.
            </span>
          </div>
        )}
      </section>

      {/* ── 2. Informational models ─────────────────────────────────────────────────────────── */}
      {workspace.comparison && <EvidenceComparison tab="predictors" model={predictorModel} title="Where do the predictors agree?" description="Compare published evidence-strength bands; native scores appear at right. These readings are not criteria to add together." />}
      {workspace.comparison && <section className="prd-card" aria-label="How the engine read these predictors"><ChainRow evidence={evidence} /><PrimaryToolRow evidence={evidence} /></section>}
      {/* Local agreement is not the engine's reading, so it gets its own card rather than a row
          inside the engine card: its own note says these readings never change PP3 / BP4. */}
      {workspace.comparison && <section className="prd-card" aria-label="Local informational agreement"><LocalAgreementRow evidence={evidence} compact /></section>}
      {(!workspace.enabled || workspace.view === 'records') && <>
      <section className="prd-card" aria-label="Local informational agreement"><LocalAgreementRow evidence={evidence} /></section>
      <InformationalCard evidence={evidence} />

      {/* ── 3. Readings ────────────────────────────────────────────────────────────────────── */}
      <section className="prd-section" aria-labelledby="prd-readings-title">
        <h2 className="eyebrow" id="prd-readings-title">
          <ListChecks className="w-3.5 h-3.5" />
          Predictor readings
        </h2>
        <div className="prd-card prd-table-wrap">
          <table className="prd-table" data-testid="predictor-readings">
            <colgroup>
              <col className="prd-col-tool" />
              <col className="prd-col-score" />
              <col className="prd-col-scale" />
              <col className="prd-col-call" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Tool</th>
                <th scope="col" className="prd-num">Score</th>
                <th scope="col" title="The score on the tool's own axis, with its cut-points drawn by source">
                  Position on scale <span className="prd-head-sub"><i className="prd-legend__marker" aria-hidden="true" />this variant</span>
                </th>
                <th scope="col" className="prd-status">Call</th>
              </tr>
            </thead>
            {groupReadings(evidence.readings).map(({ group, rows }) => {
              const collapsible = group !== "primary";
              // One toggle semantics: the workspace state. Informational groups start collapsed.
              const open = !collapsible || workspace.expanded.includes(group);
              const scored = rows.filter(r => r.score !== null).length;
              return (
              <tbody key={group} data-group={group} data-collapsed={open ? undefined : "true"}>
                <tr className="prd-group">
                  <th colSpan={4} scope="rowgroup">
                    <span className="prd-group__inner">
                      <span className="prd-group__title">{PREDICTOR_GROUP_LABEL[group]}</span>
                      <span className="prd-group__meta">{PREDICTOR_GROUP_NOTE[group]}</span>
                      {collapsible && (
                        <button
                          type="button"
                          className="prd-group__toggle"
                          aria-expanded={open}
                          onClick={() => workspace.toggleGroup(group)}
                        >
                          {open ? "Hide" : `Show ${scored} of ${rows.length} scored`}
                        </button>
                      )}
                    </span>
                  </th>
                </tr>
                {rows.map(r => (
                  <ReadingRow
                    key={r.key}
                    reading={r}
                    inActiveRule={isReadingParticipatingInRule(r, evidence.primary)}
                    onKnowledge={setKnowledgeKey}
                    onAction={openConnections}
                    onTabChange={onTabChange}
                    cutLines={cutLinesByKey.get(r.key)}
                  />
                ))}
              </tbody>
              );
            })}
          </table>
          <div className="prd-table-foot" aria-label="Legend">
            <span className="prd-legend__item"><span className="prd-legend__swatch" aria-hidden="true"><i /><i /><i /></span>PP3 bands, deeper = stronger</span>
            <span className="prd-legend__item"><span className="prd-legend__swatch" data-side="benign" aria-hidden="true"><i /><i /><i /></span>BP4 bands</span>
            <span className="prd-legend__item"><i className="prd-legend__tick" />Authors' cut-point</span>
            <span className="prd-legend__item"><i className="prd-legend__tick" data-local />Local mark</span>
            <span className="prd-legend__item"><i className="prd-legend__axis" />No published cut-point</span>
            <span className="prd-legend__item"><i className="prd-legend__marker" />This variant</span>
          </div>
        </div>
      </section>
      </>}
      </EvidencePanel>
    </div>
  );
}

export default PredictorsTab;
