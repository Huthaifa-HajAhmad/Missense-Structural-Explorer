import React, { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Cpu, Info, ListChecks } from "lucide-react";
import { TabComponentProps } from "./types";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
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
  predictorSummary,
  type PredictorEvidence,
  type PredictorReading,
} from "../../shared/predictorEvidence";
import { buildLadderEvidence } from "../../shared/ladderEvidence";
import { ScoreRuler } from "./predictors/ScoreRuler";
import { StrengthLadder } from "./predictors/StrengthLadder";
import { EvidenceViewTabs, EvidencePanel, InspectReadingButton, useEvidenceWorkspace } from './EvidenceWorkspace';
import { buildPredictorComparison } from '../../shared/evidenceComparison';
const EvidenceComparison = React.lazy(() => import('./EvidenceComparison'));

/**
 * In-silico predictors.
 *
 * ONE QUESTION: what do the computational predictors say about this substitution, and what did the
 * ACMG PP3/BP4 rule make of it? Three tiers, top to bottom — the same shape as Population Data:
 *
 *   1. THE FINDING — a header bar with the engine's recorded code; ONE summary line (engine record,
 *      vote, calibrated reference, and any disagreement in words); the STRENGTH LADDER (every tool on
 *      one shared axis of evidence strength, the variant's band marked; tools with only their authors'
 *      cut-point show a side, never a strength); then two rows to compare, the vote as a tally bar
 *      and the calibrated single tool ClinGen recommends on its own ruler, each ending in the code
 *      it supports. The ladder replaced the Score thresholds tab, which repeated this one.
 *      This replaced a card that stated the count four times, REVEL's reading three times (one a full-width yellow banner) and every voter's score twice.
 *   2. READINGS — one table, every tool a row: score, its position on its own axis with its
 *      cut-points drawn by provenance, and its call. Grouped by role: the tools that vote, then the
 *      informational ones. This replaced a 4-tab card grid that showed one family at a time, so the
 *      tools a reviewer compares were never on screen together.
 *
 * INVARIANTS
 *   • Every number and call comes from `buildPredictorEvidence`; this file tests no score.
 *   • The engine's decision is READ from its criteria list; a code the payload does not carry is
 *     drawn dashed and called unconfirmed, never asserted.
 *   • A cut-point is always shown with its provenance — ClinGen, the authors', local, or none.
 *   • Each fact is stated once on the card: scores live in the table, the count in the tally bar,
 *     the reference's reading in its row. The summary line says what they mean together.
 */

const CUT_SOURCE_LABEL: Record<PredictorReading["cutpoints"]["kind"], string> = {
  calibrated: "ClinGen",
  authors: "Authors' cut",
  local: "Local marks",
  none: "No cut-point",
};

function EngineChip({ evidence }: { evidence: PredictorEvidence }) {
  const { engine, vote } = evidence;
  if (engine.known) {
    const code = engine.code;
    const tone = !code ? (engine.withheldByWeighting ? "muted" : "neutral") : code.startsWith("PP3") ? "danger" : "good";
    return (
      <span
        className={`ev-tier prd-verdict shrink-0${code ? " chip-code" : ""}`}
        data-tone={tone}
        data-testid="predictor-verdict"
        title={code ? "The in-silico criterion the engine recorded for this run" : "The engine recorded no PP3 or BP4 for this run"}
      >
        {code ? formatEvidenceCode(code) : "No PP3 / BP4"}
      </span>
    );
  }
  if (vote.code) {
    return (
      <span
        className="ev-tier prd-verdict chip-code shrink-0"
        data-tone="accent"
        data-testid="predictor-verdict"
        style={{ borderStyle: "dashed" }}
        title={`${vote.code} is what the vote supports — this payload carries no engine record to confirm it against`}
        aria-label={`${vote.code}, supported by the vote, unconfirmed by the engine record`}
      >
        {vote.code}
      </span>
    );
  }
  return (
    <span className="ev-tier prd-verdict shrink-0" data-tone="neutral" data-testid="predictor-verdict">
      No PP3 / BP4
    </span>
  );
}

const CALL_WORD = { path: "pathogenic", vus: "indeterminate", benign: "benign", none: "not scored" } as const;
type VoteCall = keyof typeof CALL_WORD;

/** The chip that closes a finding row: a code in its tone, or a plain word. */
function RowChip({ code, testId }: { code: string | null; testId: string }) {
  if (!code) return <span className="ev-tier" data-tone="neutral" data-testid={testId}>Neither</span>;
  const direction = code.startsWith("PP3") ? "danger" : code.startsWith("BP4") ? "good" : "neutral";
  return (
    <span className={`ev-tier${direction !== "neutral" ? " chip-code" : ""}`} data-tone={direction} data-testid={testId}>
      {formatEvidenceCode(code)}
    </span>
  );
}

/**
 * The vote as one bar: a segment per voting tool, grouped pathogenic → indeterminate → benign →
 * no score, the tool's name under its segment, and one key line with each group's count. Scores are NOT
 * repeated here; they live once, in the readings table. This replaced a strip of tinted boxes that
 * printed every voter's score a second time.
 */
function VoteRow({ evidence }: { evidence: PredictorEvidence }) {
  const { voters, vote } = evidence;
  const groups: Array<{ call: VoteCall; rows: PredictorReading[] }> = [
    { call: "path", rows: voters.pathogenic },
    { call: "vus", rows: voters.indeterminate },
    { call: "benign", rows: voters.benign },
    { call: "none", rows: voters.missing },
  ];
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  // Fixed tool order, the same the readings table uses, so a tool can be tracked between the two.
  const ordered = evidence.readings.filter(r => r.votes);
  const counted = vote.nVoting;
  return (
    <div className="prd-frow" data-testid="predictor-vote-row">
      <div className="prd-frow__label">
        <span className="prd-frow__name">Vote</span>
        <span className="prd-frow__sub">
          {counted} of {total} voting {total === 1 ? "tool" : "tools"} scored · plurality, uncalibrated
        </span>
      </div>
      <div className="prd-frow__body">
        {total === 0 ? (
          <span className="prd-dim">No voting tool is configured for this analysis.</span>
        ) : (
          <ol className="prd-tally" aria-label="Voting tools by call">
            {ordered.map(r => {
              const call: VoteCall = r.signal === "pathogenic" ? "path" : r.signal === "benign" ? "benign" : r.signal === "vus" ? "vus" : "none";
              return (
                <li key={r.key} className="prd-tally__tool" data-call={call} title={`${r.name}: ${r.scoreText} — ${r.callLabel}`}>
                  <i className="prd-tally__seg" aria-hidden="true" />
                  <span className="prd-tally__name">{r.name}</span>
                </li>
              );
            })}
          </ol>
        )}
        {total > 0 && (
          <p className="prd-tally__key" data-testid="predictor-vote-key">
            {groups
              .filter(g => g.rows.length > 0)
              .map(g => (
                <span key={g.call}>
                  <i className="prd-tally__swatch" data-call={g.call} aria-hidden="true" />
                  {g.rows.length} {CALL_WORD[g.call]}
                </span>
              ))}
          </p>
        )}
      </div>
      <div className="prd-frow__call">
        {vote.direction === "no-votes" ? (
          <span className="ev-tier" data-tone="muted" data-testid="predictor-vote-call">No votes</span>
        ) : (
          <RowChip code={vote.code} testId="predictor-vote-call" />
        )}
      </div>
    </div>
  );
}

/**
 * The calibrated single tool ClinGen recommends, on its own ruler with its published bands, beside
 * the vote so a disagreement is visible without a banner. When neither REVEL nor BayesDel has a
 * score the row says so, rather than disappearing — absence is a state.
 */
function ReferenceRow({ evidence }: { evidence: PredictorEvidence }) {
  const ref = evidence.reference;
  const reading = ref ? evidence.readings.find(r => r.key === ref.key) : null;
  const pending =
    !ref && evidence.readings.some(r => (r.key === "revel" || r.key === "bayesdel") && r.availability.state === "pending");
  return (
    <div className="prd-frow" data-testid="predictor-reference-row" data-relation={ref?.relation ?? "absent"}>
      <div className="prd-frow__label">
        <span className="prd-frow__name">Calibrated reference</span>
        <span className="prd-frow__sub">{ref ? `${ref.name} · ClinGen, ${ref.source}` : "REVEL, else BayesDel · ClinGen"}</span>
      </div>
      <div className="prd-frow__body">
        {ref && reading ? (
          <>
            <ScoreRuler reading={reading} thresholds="all" />
            <span className="prd-frow__note">
              <span className="prd-mono">{reading.scoreText}</span>{" "}
              {ref.call.direction ? <>sits in the {formatEvidenceCode(ref.call.code)} band</> : "sits between the PP3 and BP4 bands"}
            </span>
          </>
        ) : (
          <span className="prd-dim">
            {pending ? "Still being computed for this variant." : "Neither REVEL nor BayesDel scored this variant."}
          </span>
        )}
      </div>
      <div className="prd-frow__call">
        {ref ? (
          ref.call.direction ? (
            <RowChip code={ref.call.code} testId="predictor-reference-call" />
          ) : (
            <span className="ev-tier" data-tone="neutral" data-testid="predictor-reference-call">Indeterminate</span>
          )
        ) : (
          <span className="ev-tier" data-tone={pending ? "neutral" : "muted"} data-testid="predictor-reference-call">
            {pending ? ENGINE_STATE_LABELS.running : ENGINE_STATE_LABELS["no-result"]}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A score split at its decimal point, so a column mixing 0.231, 26.3, -4.00 and 7 lines up on the
 * point rather than on the last digit (right-aligning alone left the points staggered).
 */
function DecimalScore({ text }: { text: string }) {
  const dot = text.indexOf(".");
  const int = dot < 0 ? text : text.slice(0, dot);
  const frac = dot < 0 ? "" : text.slice(dot);
  return (
    <span className="prd-dec">
      <span className="prd-dec__int">{int}</span>
      <span className="prd-dec__frac">{frac}</span>
    </span>
  );
}

function CaveatChips({ reading }: { reading: PredictorReading }) {
  if (reading.caveats.length === 0) return null;
  return (
    <span className="prd-caveats">
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
  onKnowledge,
  onAction,
  onTabChange,
  cutLines,
}: {
  reading: PredictorReading;
  /** The cut-points in words ("PP3 ≥ 0.644 · 0.773 · 0.932"), so a number can be read off without a hover. */
  cutLines?: string[];
  onKnowledge: (key: string) => void;
  onAction: (action: NonNullable<PredictorReading["availability"]["action"]>) => void;
  onTabChange?: (tab: string) => void;
}) {
  const has = reading.score !== null;
  const pending = reading.availability.state === "pending";
  return (
    <tr data-testid={`predictor-${reading.key}`} data-votes={reading.votes || undefined}>
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
              {reading.availability.action === "configure-alphagenome" || reading.availability.action === "configure-gpn" ? (
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
            {!reading.votes && reading.calibrated && <span className="prd-call__sub">not counted</span>}
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
 * The models that do not vote, explained for a reader who has not met them: per family, what it
 * measures, why it sits outside PP3/BP4, how to read its number, and this variant's scores.
 */
function InformationalCard({ evidence }: { evidence: PredictorEvidence }) {
  const families = informationalSummary(evidence);
  if (families.length === 0) return null;
  return (
    <section className="prd-card" aria-labelledby="prd-info-title" data-testid="predictor-informational">
      <div className="prd-hero__head">
        <span className="eyebrow" id="prd-info-title">
          <Info className="w-3.5 h-3.5" />
          Informational models · not counted
        </span>
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
            <p><b>What it measures.</b> {f.what}</p>
            <p><b>Why it is not counted.</b> {f.why}</p>
            <p><b>How to read it.</b> {f.read}</p>
            <p className="prd-fam__scores">
              {f.readings.map(r => (
                <span key={r.key}>
                  {r.name}
                  <span className="prd-mono">{r.score !== null ? r.scoreText : "—"}</span>
                  {r.score !== null && r.calibrated && <span>· {formatEvidenceCode(r.callLabel)}</span>}
                </span>
              ))}
            </p>
          </div>
        </div>
      ))}
    </section>
  );
}

export function PredictorsTab({ analysisState, isBiophysicalLoading, onOpenSettings, onTabChange }: TabComponentProps) {
  const workspace = useEvidenceWorkspace('predictors');
  const isStructuralLoading = useVariantAnalysisStore(s => s.isStructuralLoading ?? false);
  const { settings, openSettingsTab } = useSettings();
  const [knowledgeKey, setKnowledgeKey] = useState<string | null>(null);
  const result = analysisState.result;
  if (!result) return null;

  const alphagenomeConfigured = settings.alphagenomeApiKey?.trim() ? true : undefined;
  const evidence = useMemo(() => buildPredictorEvidence({
    result,
    isLoading: analysisState.isLoading,
    isModelLoading: Boolean(isBiophysicalLoading || isStructuralLoading),
    // Tri-state: the browser can only attest to a key it holds; the server may hold its own.
    alphagenomeConfigured,
  }), [result, analysisState.isLoading, isBiophysicalLoading, isStructuralLoading, alphagenomeConfigured]);
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
    <div className="prd-screen @container">
      {knowledgeKey && (
        <ModelKnowledgeModal isOpen modelKey={knowledgeKey} onClose={() => setKnowledgeKey(null)} />
      )}

      <header>
        <h1 className="screen-title">Predictors</h1>
        <p className="screen-tab-description">
          What computational predictors say about this substitution, and how the ACMG PP3/BP4 rule
          counted them.
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

        {!workspace.comparison && <StrengthLadder evidence={ladder} referenceKey={evidence.reference?.key ?? null} />}

        <VoteRow evidence={evidence} />
        <ReferenceRow evidence={evidence} />

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
      {workspace.comparison && <React.Suspense fallback={<p>Loading predictor comparison…</p>}><EvidenceComparison tab="predictors" model={predictorModel} title="Where do the predictors agree?" description="Compare each tool’s published evidence-strength band. These are individual readings, not criteria to add together." /></React.Suspense>}
      {!workspace.comparison && <>
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
              const collapsible = group !== "vote";
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
