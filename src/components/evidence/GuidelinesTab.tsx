import React from "react";
import { AlertTriangle, ArrowRight, ListChecks, Scale } from "lucide-react";
import { TabComponentProps } from "./types";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { useSettings } from "../../context/SettingsContext";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { formatEvidenceCode } from "../../shared/thresholds";
import { CAVEAT_TEXT } from "../../shared/predictorEvidence";
import {
  THRESHOLD_GROUP_LABEL,
  THRESHOLD_GROUP_NOTE,
  buildThresholdEvidence,
  groupThresholdRows,
  thresholdDisagreement,
  thresholdFinding,
  type LadderColumn,
  type LadderRow,
  type ThresholdEvidence,
  type ThresholdRow,
} from "../../shared/thresholdEvidence";
import { ScoreRuler } from "./predictors/ScoreRuler";

/**
 * Score thresholds.
 *
 * ONE QUESTION: which published cut-points decide this variant's computational ACMG criteria, where
 * does the variant sit on each, and what did the engine record? Three tiers, the Population Data shape:
 *
 *   1. THE FINDING — the engine's computational codes in the head bar; one summary line; the STRENGTH
 *      LADDER (every ClinGen-calibrated tool on one shared axis of evidence strength, the variant's
 *      band marked); the calibrated reference's disagreement with the vote, when there is one; and a
 *      four-cell fact strip (vote, gene constraint, stability, engine record).
 *   2. READINGS — one flat table grouped by what each cut-point decides, each row with its own ruler,
 *      its cut-points in words with their provenance, and its reading.
 *
 * It replaced a screen that was a second classifier: a "5–4 · Pathogenic concordance" verdict over
 * 20 correlated scores, PM1 / BP3 chips on ΔΔG rows and PP2 / BP1 chips on gene constraint that the
 * engine never applied, two columns that repeated each other, beige boxed rows in a nested scroller,
 * and a fact strip whose CSS classes no longer existed (so its lines ran together).
 *
 * INVARIANTS
 *   • Every number, band and call comes from `buildThresholdEvidence`; this file tests no score.
 *   • The engine's decisions are READ from its criteria list; an unrecorded code is drawn dashed.
 *   • Red and green are only ever an ACMG code or a calibrated band.
 */

function EngineChips({ ev }: { ev: ThresholdEvidence }) {
  const { engine, predictor } = ev;
  if (!engine.known) {
    const code = predictor.vote.code;
    return code ? (
      <span
        className="ev-tier chip-code gt-verdict"
        data-tone="accent"
        style={{ borderStyle: "dashed" }}
        data-testid="threshold-engine"
        title={`${code} is what the vote supports; this result carries no engine record to confirm it`}
      >
        {code}
      </span>
    ) : (
      <span className="ev-tier gt-verdict" data-tone="neutral" data-testid="threshold-engine">No engine record</span>
    );
  }
  if (engine.codes.length === 0) {
    return <span className="ev-tier gt-verdict" data-tone="neutral" data-testid="threshold-engine">No computational code</span>;
  }
  return (
    <span className="gt-verdicts" data-testid="threshold-engine">
      {engine.codes.map(code => (
        <span
          key={code}
          className="ev-tier chip-code gt-verdict"
          data-tone={code.startsWith("B") ? "good" : "danger"}
          title={code === "BP1" ? "Recorded by an earlier engine; BP1 is no longer applied automatically" : "Recorded by the rule engine"}
        >
          {formatEvidenceCode(code)}
        </span>
      ))}
    </span>
  );
}

/**
 * The strength ladder: one row per ClinGen-calibrated tool, one column per evidence strength
 * (BP4 strongest … neither … PP3 strongest) headed by its Tavtigian points, the variant's dot in the
 * band it reached. Cells a tool's calibration cannot reach are hatched. Tools on different raw scales
 * become comparable, and a disagreement between them shows without a sentence.
 */
function StrengthLadder({ ev }: { ev: ThresholdEvidence }) {
  const { columns, ladder } = ev;
  const referenceKey = ev.predictor.reference?.key ?? null;
  const describe = ladder
    .map(l => {
      const col = columns.find(c => c.id === l.at);
      return `${l.name}: ${l.at === null ? "no result" : col?.direction ? `${col.direction} ${col.label}` : "neither"}`;
    })
    .join("; ");
  const style = { gridTemplateColumns: `var(--gt-ladder-name) repeat(${columns.length}, minmax(0, 1fr))` } as React.CSSProperties;
  const nBenign = columns.filter(c => c.direction === "BP4").length;
  const nPath = columns.filter(c => c.direction === "PP3").length;
  return (
    <div className="gt-ladder" role="img" aria-label={`Strength ladder. ${describe}.`} data-testid="strength-ladder">
      <div className="gt-ladder__row gt-ladder__head" style={style} aria-hidden="true">
        <span />
        {columns.map((c: LadderColumn) => (
          <span key={c.id} className="gt-ladder__col" data-dir={c.direction ?? "none"}>
            {c.label}
            <b>{c.points > 0 ? `+${c.points}` : c.points === 0 ? "0" : `−${Math.abs(c.points)}`}</b>
          </span>
        ))}
      </div>
      {ladder.map((l: LadderRow) => (
        <div key={l.key} className="gt-ladder__row" style={style} aria-hidden="true" data-testid={`ladder-${l.key}`} data-at={l.at ?? "none-scored"}>
          <span className="gt-ladder__name">
            {l.name}
            <small>
              {l.source}
              {l.key === referenceKey ? " · reference" : !l.votes ? " · not counted" : ""}
            </small>
          </span>
          {l.at === null ? (
            <span className="gt-ladder__absent">
              {l.availability.state === "pending" ? ENGINE_STATE_LABELS.running : l.availability.reason ?? `${ENGINE_STATE_LABELS["no-result"]} for this variant`}
            </span>
          ) : (
            columns.map((c, i) => {
              const reach = l.reachable.includes(c.id);
              const rank = c.direction === "BP4" ? nBenign - i : c.direction === "PP3" ? i - nBenign : 0;
              return (
                <span
                  key={c.id}
                  className="gt-ladder__cell"
                  data-dir={c.direction ?? "none"}
                  data-rank={rank}
                  data-unreachable={!reach || undefined}
                  data-here={l.at === c.id || undefined}
                >
                  {l.at === c.id && <i className="gt-ladder__dot" />}
                </span>
              );
            })
          )}
        </div>
      ))}
      <div className="gt-ladder__sides" style={{ gridTemplateColumns: `var(--gt-ladder-name) ${nBenign}fr 1fr ${nPath}fr` }} aria-hidden="true">
        <span />
        <span>← BP4 benign</span>
        <span>indeterminate</span>
        <span>PP3 pathogenic →</span>
      </div>
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="gt-fact">
      <dt>{label}</dt>
      <dd>
        <span className="gt-fact__value">{value}</span>
        {sub && <span className="gt-fact__sub">{sub}</span>}
      </dd>
    </div>
  );
}

function Facts({ ev }: { ev: ThresholdEvidence }) {
  const { predictor, constraint, stability, engine } = ev;
  const vote = predictor.vote;
  const missing = predictor.voters.missing.length;
  const voteValue =
    vote.direction === "no-votes" ? "No votes"
    : vote.code ? `${vote.code} · ${vote.direction === "pathogenic" ? `${vote.nPathogenic} to ${vote.nBenign}` : `${vote.nBenign} to ${vote.nPathogenic}`}`
    : "Neither";
  const voteSub = [vote.nIndeterminate ? `${vote.nIndeterminate} indeterminate` : null, missing ? `${missing} no result` : null].filter(Boolean).join(", ") || "every voting tool made a call";
  const pp2Value =
    engine.pp2 ? "PP2 applied"
    : constraint.missenseZ === null ? ENGINE_STATE_LABELS["no-result"]
    : constraint.pp2RuleMet ? "Rule met, not recorded"
    : "PP2 not met";
  const pp2Sub =
    constraint.missenseZ === null ? "gnomAD gene constraint did not reach this analysis"
    : `Missense Z ${constraint.missenseZ.toFixed(2)}${constraint.pp2RuleMet ? "" : ", needs ≥ 3.09 with o/e < 0.6"}`;
  const foldx = ev.rows.find(r => r.reading.key === "foldx")?.reading;
  const stabSub =
    stability.scored === 0 ? "No engine returned a value"
    : foldx?.score != null ? `FoldX ${foldx.scoreText} kcal/mol, ${foldx.callLabel.toLowerCase()}`
    : `${stability.scored} of ${stability.total} engines returned a value`;
  const engineValue = !engine.known ? "Not in payload" : engine.codes.length ? engine.codes.map(formatEvidenceCode).join(" · ") : "None";
  const engineSub = !engine.known ? (vote.code ? `the vote supports ${vote.code}` : "nothing to confirm") : engine.bp1Stale ? "BP1 from an earlier engine" : "BP1 not assessed";
  return (
    <dl className="gt-facts" data-testid="threshold-facts">
      <Fact label="In-silico vote" value={voteValue} sub={voteSub} />
      <Fact label="Gene constraint" value={pp2Value} sub={pp2Sub} />
      <Fact label="Stability ΔΔG" value="Not an ACMG input" sub={stabSub} />
      <Fact label="Engine record" value={engineValue} sub={engineSub} />
    </dl>
  );
}

function ReadingChip({ row }: { row: ThresholdRow }) {
  const r = row.reading;
  if (r.score === null) {
    const pending = r.availability.state === "pending";
    return (
      <span className="ev-tier" data-tone={pending ? "neutral" : "muted"}>
        {pending ? ENGINE_STATE_LABELS.running : r.availability.label ?? ENGINE_STATE_LABELS["no-result"]}
      </span>
    );
  }
  if (r.callLabel === "Informational" || r.callLabel === "Context only") {
    return <span className="gt-call__plain">{r.callLabel}</span>;
  }
  const isCode = /^(PP3|BP4)/.test(r.callLabel);
  return (
    <>
      <span className={`ev-tier${isCode ? " chip-code" : ""}`} data-tone={r.callTone}>
        {isCode ? formatEvidenceCode(r.callLabel) : r.callLabel}
      </span>
      {row.group === "calibrated" && r.calibrated?.direction && <span className="gt-call__sub">not counted</span>}
      {row.group === "vote" && r.votes && r.cutpoints.kind !== "calibrated" && r.signal !== "vus" && (
        <span className="gt-call__sub">authors&apos; cut</span>
      )}
    </>
  );
}

function ReadingRow({ row, isReference }: { row: ThresholdRow; isReference: boolean }) {
  const r = row.reading;
  const has = r.score !== null;
  return (
    <tr data-testid={`threshold-${r.key}`} data-group={row.group}>
      <th scope="row" className="gt-subject">
        <span className="gt-subject__name">{r.name}</span>
        {isReference && <span className="gt-subject__tag">Calibrated reference</span>}
        {r.description && <span className="gt-subject__note">{r.description}</span>}
        {r.caveats.length > 0 && (
          <span className="gt-caveats">
            {r.caveats.map(c => (
              <span key={c} className="ev-tier" data-tone="warning" title={CAVEAT_TEXT[c].detail}>
                {CAVEAT_TEXT[c].label}
              </span>
            ))}
          </span>
        )}
        {r.note && <span className="gt-subject__note gt-subject__fact">{r.note}</span>}
      </th>
      <td className="gt-num">
        {has ? r.scoreText : <span className="gt-dim">—</span>}
        {has && r.unit && <span className="gt-unit">{r.unit}</span>}
      </td>
      <td className="gt-scale">
        {has ? (
          <ScoreRuler reading={r} />
        ) : (
          <span className="gt-reason">
            {r.availability.state === "pending" ? "Still being computed for this variant." : r.availability.reason ?? "No score reached this variant."}
          </span>
        )}
      </td>
      <td className="gt-cuts">
        {row.cutLines.length ? row.cutLines.map(l => <span key={l} className="gt-cuts__line">{l}</span>) : <span className="gt-dim">—</span>}
        {row.cutSource && <span className="gt-cuts__source">{row.cutSource}</span>}
      </td>
      <td className="gt-status">
        <ReadingChip row={row} />
      </td>
    </tr>
  );
}

export function GuidelinesTab({ analysisState, foldingDdG, foldingEnergetics, isBiophysicalLoading, isFolding, onTabChange }: TabComponentProps) {
  const isStructuralLoading = useVariantAnalysisStore(s => s.isStructuralLoading ?? false);
  const { settings } = useSettings();
  const result = analysisState.result;
  if (!result) return null;

  const ev = buildThresholdEvidence({
    result,
    foldingDdG: foldingDdG ?? null,
    foldingEnergetics: foldingEnergetics ?? null,
    isLoading: analysisState.isLoading,
    isModelLoading: Boolean(isBiophysicalLoading || isStructuralLoading),
    isStabilityLoading: Boolean(isBiophysicalLoading || isFolding),
    alphagenomeConfigured: settings.alphagenomeApiKey?.trim() ? true : undefined,
  });
  const finding = thresholdFinding(ev);
  const disagreement = thresholdDisagreement(ev);
  const groups = groupThresholdRows(ev.rows);
  const scored = ev.rows.filter(r => r.reading.score !== null).length;
  const referenceKey = ev.predictor.reference?.key ?? null;

  return (
    <div className="gt-screen @container">
      <header>
        <h1 className="screen-title">Score thresholds</h1>
        <p className="screen-tab-description">
          The published cut-points for every score, where this variant falls, and which ones the ACMG engine uses.
        </p>
      </header>

      {/* ── 1. The finding ─────────────────────────────────────────────────────────────────── */}
      <section className="gt-card gt-hero" aria-labelledby="gt-finding-title" data-testid="threshold-finding">
        <div className="gt-card__head">
          <h2 className="eyebrow" id="gt-finding-title">
            <Scale className="w-3.5 h-3.5" aria-hidden="true" />
            Which cut-points decide the computational criteria?
          </h2>
          <EngineChips ev={ev} />
        </div>
        <p className="gt-summary" data-testid="threshold-summary">
          <span className="gt-summary__dot" aria-hidden="true" />
          <span>
            <strong>{finding.lead}</strong> {finding.rest.join(" ")}
          </span>
        </p>
        <StrengthLadder ev={ev} />
        {disagreement && (
          <p className="gt-disagree" data-testid="threshold-disagreement">
            <AlertTriangle className="gt-disagree__icon w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {disagreement}{" "}
              {onTabChange && (
                <button type="button" className="gt-link" onClick={() => onTabChange("predictors")}>
                  Open in-silico predictors
                  <ArrowRight className="w-3 h-3" aria-hidden="true" />
                </button>
              )}
            </span>
          </p>
        )}
        <Facts ev={ev} />
      </section>

      {/* ── 2. Readings ─────────────────────────────────────────────────────────────────────── */}
      <section className="gt-card" aria-labelledby="gt-readings-title">
        <div className="gt-card__head">
          <h2 className="eyebrow" id="gt-readings-title">
            <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
            Readings and cut-points
          </h2>
          <span className="gt-card__meta">
            {ev.rows.length} scores · {scored} with a result
          </span>
        </div>
        <div className="gt-table-wrap">
          <table className="gt-table">
            <caption className="sr-only">Every score with its cut-points, where this variant falls, and its reading</caption>
            <colgroup>
              <col className="gt-col-name" />
              <col className="gt-col-num" />
              <col className="gt-col-scale" />
              <col className="gt-col-cuts" />
              <col className="gt-col-call" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Score</th>
                <th scope="col" className="gt-num">Value</th>
                <th scope="col">Scale</th>
                <th scope="col">Cut-points</th>
                <th scope="col">Reading</th>
              </tr>
            </thead>
            {groups.map(g => (
              <tbody key={g.group}>
                <tr className="gt-group">
                  <th colSpan={5} scope="rowgroup">
                    <span className="gt-group__inner">
                      <span className="gt-group__title">{THRESHOLD_GROUP_LABEL[g.group]}</span>
                      <span className="gt-group__meta">{THRESHOLD_GROUP_NOTE[g.group]}</span>
                    </span>
                  </th>
                </tr>
                {g.rows.map(row => (
                  <ReadingRow key={row.reading.key} row={row} isReference={row.reading.key === referenceKey} />
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <div className="gt-card__foot">
          <span className="gt-legend__item"><span className="prd-legend__swatch" data-side="path"><i /><i /><i /></span>PP3 bands</span>
          <span className="gt-legend__item"><span className="prd-legend__swatch" data-side="benign"><i /><i /><i /></span>BP4 bands</span>
          <span className="gt-legend__item"><span className="prd-legend__tick" />Authors&apos; cut</span>
          <span className="gt-legend__item"><span className="prd-legend__tick" data-local="" />Local mark</span>
          <span className="gt-legend__item"><span className="prd-legend__marker" />This variant</span>
        </div>
      </section>
    </div>
  );
}

export default GuidelinesTab;
