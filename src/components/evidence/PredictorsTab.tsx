import React, { useState } from "react";
import { AlertTriangle, ArrowRight, Cpu, Info, ListChecks, Scale } from "lucide-react";
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
  predictorFinding,
  type PredictorEvidence,
  type PredictorReading,
} from "../../shared/predictorEvidence";
import { ScoreRuler } from "./predictors/ScoreRuler";

/**
 * In-silico predictors.
 *
 * ONE QUESTION: what do the computational predictors say about this substitution, and what did the
 * ACMG PP3/BP4 rule make of it? Three tiers, top to bottom — the same shape as Population Data:
 *
 *   1. THE FINDING — the engine's recorded code, the pathogenic–benign count, the finding sentence,
 *      the vote strip (every voting tool, coloured by its call), and the calibrated single-tool
 *      reading ClinGen recommends, stated beside the vote whenever the two disagree.
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
        className={`ev-tier pop-verdict shrink-0${code ? " chip-code" : ""}`}
        data-tone={tone}
        data-testid="predictor-verdict"
        title={code ? "The in-silico criterion the engine recorded for this run" : "The engine recorded no PP3 or BP4 for this run"}
      >
        {code ?? "No PP3 / BP4"}
      </span>
    );
  }
  if (vote.code) {
    return (
      <span
        className="ev-tier pop-verdict chip-code shrink-0"
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
    <span className="ev-tier pop-verdict shrink-0" data-tone="neutral" data-testid="predictor-verdict">
      No PP3 / BP4
    </span>
  );
}

function Fact({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="pop-fact">
      <dt className="pop-fact__label">{label}</dt>
      <dd className="pop-fact__value">
        {children}
        {sub && <span className="pop-fact__sub">{sub}</span>}
      </dd>
    </div>
  );
}

/** Every voting tool as one cell, pathogenic → indeterminate → benign → no score. */
function VoteStrip({ evidence }: { evidence: PredictorEvidence }) {
  const { voters } = evidence;
  const ordered: Array<{ r: PredictorReading; call: "path" | "vus" | "benign" | "none" }> = [
    ...voters.pathogenic.map(r => ({ r, call: "path" as const })),
    ...voters.indeterminate.map(r => ({ r, call: "vus" as const })),
    ...voters.benign.map(r => ({ r, call: "benign" as const })),
    ...voters.missing.map(r => ({ r, call: "none" as const })),
  ];
  if (ordered.length === 0) return null;
  const word = { path: "pathogenic", vus: "indeterminate", benign: "benign", none: "no score" };
  return (
    <div className="prd-vote">
      <ol className="prd-vote__strip" aria-label="Voting tools by call">
        {ordered.map(({ r, call }) => (
          <li
            key={r.key}
            className="prd-vote__cell"
            data-call={call}
            title={`${r.name}: ${r.scoreText} — ${r.callLabel}`}
          >
            <span className="prd-vote__name">{r.name}</span>
            <span className="prd-vote__score">{r.scoreText}</span>
            <span className="sr-only">, {word[call]}</span>
          </li>
        ))}
      </ol>
      <div className="prd-vote__legend" aria-hidden="true">
        <span><i className="prd-key" data-call="path" />Pathogenic {evidence.vote.nPathogenic}</span>
        <span><i className="prd-key" data-call="vus" />Indeterminate {evidence.vote.nIndeterminate}</span>
        <span><i className="prd-key" data-call="benign" />Benign {evidence.vote.nBenign}</span>
        {voters.missing.length > 0 && <span><i className="prd-key" data-call="none" />No score {voters.missing.length}</span>}
      </div>
    </div>
  );
}

function ReferenceCallout({ evidence }: { evidence: PredictorEvidence }) {
  const ref = evidence.reference;
  if (!ref || (ref.relation !== "opposes" && ref.relation !== "indeterminate")) return null;
  const band = ref.call.direction ? `the ${formatEvidenceCode(ref.call.code)} band` : "its indeterminate range";
  return (
    <p className="pop-callout" data-tone={ref.relation === "opposes" ? "warning" : "neutral"} data-testid="reference-callout">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>
        <strong>{ref.name}</strong>, a calibrated tool ClinGen recommends using on its own, reads{" "}
        <span className="pop-mono">{ref.score.toFixed(3)}</span> — {band} ({ref.source}).{" "}
        {ref.relation === "opposes"
          ? `It points the other way from the vote. ClinGen advises one pre-specified calibrated tool over a count of correlated ones.`
          : `On its own it would support neither PP3 nor BP4; the vote's ${evidence.vote.code} rests on uncalibrated or weaker tools.`}
      </span>
    </p>
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
}: {
  reading: PredictorReading;
  onKnowledge: (key: string) => void;
  onAction: (action: NonNullable<PredictorReading["availability"]["action"]>) => void;
  onTabChange?: (tab: string) => void;
}) {
  const has = reading.score !== null;
  const pending = reading.availability.state === "pending";
  return (
    <tr data-testid={`predictor-${reading.key}`} data-votes={reading.votes || undefined}>
      <th scope="row" className="pop-subject prd-subject">
        <span className="prd-subject__line">
          <span className="pop-subject__name">{reading.name}</span>
          {reading.knowledgeKey && (
            <button
              type="button"
              className="prd-info"
              onClick={() => onKnowledge(reading.knowledgeKey as string)}
              aria-label={`About ${reading.name}`}
              title="Model details and citation"
            >
              <Info className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </span>
        <span className="pop-subject__note">{reading.description}</span>
        <CaveatChips reading={reading} />
        {reading.note && <span className="pop-subject__note prd-subject__fact">{reading.note}</span>}
        {reading.link && onTabChange && has && (
          <button type="button" className="prd-link" onClick={() => onTabChange(reading.link!.tab)}>
            {reading.link.label}
            <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </button>
        )}
      </th>
      <td className="pop-num prd-score">
        {has ? (
          <>
            {reading.scoreText}
            {reading.unit && <span className="prd-unit">{reading.unit}</span>}
          </>
        ) : (
          <span className="pop-dim">—</span>
        )}
      </td>
      {has ? (
        <td className="prd-scale">
          <ScoreRuler reading={reading} />
          <span className="prd-scale__source">
            {CUT_SOURCE_LABEL[reading.cutpoints.kind]}
            {reading.cutpoints.source ? ` · ${reading.cutpoints.source}` : ""}
          </span>
        </td>
      ) : (
        <td className="pop-reason prd-scale">
          {pending ? (
            <span className="pop-dim">Still being computed for this variant.</span>
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
      <td className="pop-status prd-call">
        {has ? (
          <>
            <span
              className={`ev-tier${/^(PP3|BP4)/.test(reading.callLabel) ? " chip-code" : ""}`}
              data-tone={reading.callTone}
            >
              {formatEvidenceCode(reading.callLabel)}
            </span>
            {!reading.votes && reading.calibrated?.direction && <span className="prd-call__sub">not counted</span>}
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

export function PredictorsTab({ analysisState, isBiophysicalLoading, onOpenSettings, onTabChange }: TabComponentProps) {
  const isStructuralLoading = useVariantAnalysisStore(s => s.isStructuralLoading ?? false);
  const { settings, openSettingsTab } = useSettings();
  const [knowledgeKey, setKnowledgeKey] = useState<string | null>(null);
  const result = analysisState.result;
  if (!result) return null;

  const evidence = buildPredictorEvidence({
    result,
    isLoading: analysisState.isLoading,
    isModelLoading: Boolean(isBiophysicalLoading || isStructuralLoading),
    // Tri-state: the browser can only attest to a key it holds; the server may hold its own.
    alphagenomeConfigured: settings.alphagenomeApiKey?.trim() ? true : undefined,
  });
  const { vote, engine, reference } = evidence;
  const finding = predictorFinding(evidence);
  const informational = evidence.readings.filter(r => !r.votes && r.score !== null).length;

  const openConnections = () => {
    if (onOpenSettings) onOpenSettings();
    else openSettingsTab("connections");
  };

  return (
    <div className="pop-screen prd-screen @container">
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

      {/* ── 1. The finding ─────────────────────────────────────────────────────────────────── */}
      <section className="pop-card pop-hero" aria-labelledby="prd-finding-title" data-testid="predictor-finding">
        <div className="pop-hero__body">
          <div className="pop-hero__top">
            <span className="eyebrow" id="prd-finding-title">
              <Cpu className="w-3.5 h-3.5" />
              ACMG computational evidence · PP3 / BP4
            </span>
            <EngineChip evidence={evidence} />
          </div>

          <div className="pop-hero__figure">
            <span className="figure-headline" title="Pathogenic calls – benign calls among the voting tools">
              {vote.nPathogenic}–{vote.nBenign}
            </span>
            <span className="pop-hero__figure-label">
              pathogenic–benign calls among {vote.nVoting} voting {vote.nVoting === 1 ? "tool" : "tools"}
              {vote.nIndeterminate > 0 ? ` · ${vote.nIndeterminate} indeterminate` : ""}
            </span>
          </div>

          <p className="detail-prose pop-hero__finding">
            <strong>{finding.headline}</strong>
            {" — "}
            {finding.predicate}.
          </p>

          <VoteStrip evidence={evidence} />
          <ReferenceCallout evidence={evidence} />

          {engine.withheldByWeighting && (
            <p className="pop-callout" data-tone="warning">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                The vote supports {vote.code}, but the engine recorded no in-silico criterion — the{" "}
                {engine.weighting} weighting withholds it.
              </span>
            </p>
          )}
        </div>

        <dl className="pop-facts">
          <Fact label="Rule" sub="counted once each · Supporting strength">
            Pathogenic vs benign calls
          </Fact>
          <Fact
            label="Calibrated reference"
            sub={reference ? reference.source : "REVEL and BayesDel both absent"}
          >
            {reference ? (
              <>
                {reference.name} <span className="pop-mono">{reference.score.toFixed(3)}</span>
                {" → "}
                <span className="pop-mono">{reference.call.direction ? formatEvidenceCode(reference.call.code) : "indeterminate"}</span>
              </>
            ) : (
              "None"
            )}
          </Fact>
          <Fact label="Not counted" sub="language models · genome-wide · conservation">
            {informational} informational {informational === 1 ? "score" : "scores"}
          </Fact>
          <Fact label="Engine record" sub={engine.weighting ? `${engine.weighting} weighting` : undefined}>
            {engine.known ? (engine.code ?? "No PP3 / BP4") : "Not in payload"}
          </Fact>
        </dl>

        {evidence.pending && (
          <div role="status" className="pop-callout pop-callout--banner" data-tone="warning">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Some scores are still being computed for this variant; the rows marked below may fill in.</span>
          </div>
        )}
      </section>

      {/* ── 2. Readings ────────────────────────────────────────────────────────────────────── */}
      <section className="pop-section" aria-labelledby="prd-readings-title">
        <h2 className="eyebrow" id="prd-readings-title">
          <ListChecks className="w-3.5 h-3.5" />
          Predictor readings
        </h2>
        <div className="pop-card pop-table-wrap">
          <table className="pop-table prd-table" data-testid="predictor-readings">
            <thead>
              <tr>
                <th scope="col">Tool</th>
                <th scope="col" className="pop-num">Score</th>
                <th scope="col" title="The score on the tool's own axis, with its cut-points drawn by source">Position on scale</th>
                <th scope="col" className="pop-status">Call</th>
              </tr>
            </thead>
            {groupReadings(evidence.readings).map(({ group, rows }) => (
              <tbody key={group} data-group={group}>
                <tr className="pop-group">
                  <th colSpan={4} scope="rowgroup">
                    <span className="pop-group__title">{PREDICTOR_GROUP_LABEL[group]}</span>
                    <span className="pop-group__meta">{PREDICTOR_GROUP_NOTE[group]}</span>
                  </th>
                </tr>
                {rows.map(r => (
                  <ReadingRow
                    key={r.key}
                    reading={r}
                    onKnowledge={setKnowledgeKey}
                    onAction={openConnections}
                    onTabChange={onTabChange}
                  />
                ))}
              </tbody>
            ))}
          </table>
          <div className="pop-table-foot prd-legend">
            <span className="prd-legend__item"><Scale className="w-3.5 h-3.5" aria-hidden="true" />Bands: PP3 red, BP4 green, deeper = stronger</span>
            <span className="prd-legend__item"><i className="prd-legend__tick" />Authors' cut-point</span>
            <span className="prd-legend__item"><i className="prd-legend__tick" data-local />Local mark</span>
            <span className="prd-legend__item"><i className="prd-legend__marker" />This variant</span>
          </div>
        </div>
      </section>
    </div>
  );
}

export default PredictorsTab;
