import React, { useMemo } from "react";
import { PredictorInformationalSummary } from "../evidence/PredictorInformationalSummary";
import { EvidenceReadingInspector } from './EvidenceReadingInspector';
import { buildPredictorComparison } from '../../shared/evidenceComparison';
import { BookOpen, Database, GitBranch, Ruler, Scale } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { useSettings } from "../../context/SettingsContext";
import { CALIBRATION_SOURCES, formatEvidenceCode } from "../../shared/thresholds";
import { REGIONAL_MISSENSE_CALIBRATION } from "../../shared/thresholds/calibration";
import { buildPredictorEvidence } from "../../shared/predictorEvidence";
import { CHAIN_ORDER_TEXT, activeToolText, disagreementText, noCriterionText } from "../../shared/predictorSummary";
import { useVariantAnalysisStore } from '../../stores/useVariantAnalysisStore';
import {
  CLINGEN_CLASS_BANDS,
  CLINGEN_POINTS,
  PP2_RULE,
  PP2_SOURCE,
  REGIONAL_STATUS_WORDS,
  RICHARDS_2015,
  TAVTIGIAN_2020,
  buildLadderEvidence,
} from "../../shared/ladderEvidence";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";
import { constraintSourceLabel } from "../header/constraintMetrics";

/**
 * PredictorsRail — the Evidence Lineage inspector for the Predictors tab.
 *
 * The column states WHAT each tool said; the rail states HOW the computational criteria were reached —
 * a six-step trace (tools → first scored tool → rule → PP2 → BP1 → engine), the bands this variant reached, the
 * ClinGen point scale as a reference, the method caveats and the sources. The PP2 / BP1 steps, the
 * bands and the point scale came from the retired Score thresholds rail.
 *
 * It replaced a rail that asserted two things the code did not do: that scores were "calibrated
 * against local odds of pathogenicity" and that "consensus voting prevents circular double-counting"
 * (a count of correlated tools is exactly what double-counts). Its model registry was four
 * hard-coded version strings, one for a splicing model this tab does not show.
 *
 * Built from the same `buildPredictorEvidence` object as the column, so the two panes cannot report
 * different counts or codes.
 */

type StepState = "done" | "warn" | "idle";

function Step({ n, label, state = "done", children }: { n: number; label: string; state?: StepState; children: React.ReactNode }) {
  return (
    <li className="prd-step" data-state={state}>
      <span className="prd-step__n" aria-hidden="true">{n}</span>
      <div className="prd-step__body">
        <span className="prd-step__label">{label}</span>
        <div className="prd-step__value">{children}</div>
      </div>
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prd-kv__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const POINTS_MIN = -8;
const POINTS_MAX = 11;
const pointsPct = (v: number) => ((v - POINTS_MIN) / (POINTS_MAX - POINTS_MIN)) * 100;

export function PredictorsRail({ analysisResult }: { analysisResult: AnalysisResult }) {
  const { settings } = useSettings();
  const isLoading = useVariantAnalysisStore(s => s.analysisState?.isLoading ?? false);
  // Tri-state: the browser can only attest to a key it holds; the server may hold its own.
  const alphagenomeConfigured = settings.alphagenomeApiKey?.trim() ? true : undefined;
  const evidence = useMemo(() => buildPredictorEvidence({
    result: analysisResult,
    isLoading,
    alphagenomeConfigured,
  }), [analysisResult, isLoading, alphagenomeConfigured]);
  const ev = useMemo(() => buildLadderEvidence({ result: analysisResult, predictor: evidence }), [analysisResult, evidence]);
  const comparisonRows = useMemo(() => buildPredictorComparison(evidence, ev).rows, [evidence, ev]);
  const { constraint } = ev;
  const { primary, engine } = evidence;
  const chain = evidence.readings.filter(r => r.chainKey !== null);
  const active = primary.activeTool === "cadd"
    ? evidence.readings.find(r => r.key === "cadd") ?? null
    : chain.find(r => r.chainKey === primary.activeTool) ?? null;
  // The engine's own PP3/BP4 on the point scale, as recorded: "PP3" is +1, "BP4_Strong" is -4.
  const insilicoPoints = (() => {
    if (!engine.code) return null;
    const strength = (engine.code.includes("_") ? engine.code.split("_")[1] : "Supporting") as keyof typeof CLINGEN_POINTS;
    return (engine.code.startsWith("PP3") ? 1 : -1) * (CLINGEN_POINTS[strength] ?? 1);
  })();
  // Bands this variant reached: calibrated tools in a band, then tools on their authors' cut.
  const reached = [
    ...ev.ladder
      .filter(l => l.at && l.at !== "none")
      .map(l => {
        const [dir, strength] = (l.at as string).split(":");
        const line = l.cutLines.find(x => x.startsWith(dir)) ?? "";
        return {
          key: l.key,
          text: `${l.name} ${l.scoreText} · ${formatEvidenceCode(dir + (strength === "Supporting" ? "" : `_${strength}`))}${l.inChain ? "" : " (not counted)"}`,
          rule: line.replace(/^(PP3|BP4) /, "").split(" · ")[0],
        };
      }),
    ...ev.directional
      .filter(d => d.side === "pathogenic" || d.side === "benign")
      .map(d => ({ key: d.key, text: `${d.name} ${d.scoreText} · authors' cut`, rule: d.cutText })),
  ];
  const scored = chain.filter(r => r.score !== null).length;
  const missing = chain.filter(r => r.score === null);

  const sources: Array<[string, string]> = [];
  const add = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) sources.push([label, value.trim()]);
  };
  const caddReading = evidence.readings.find(x => x.key === "cadd");
  const pdSource = analysisResult.predictorData?.source;
  const caddSource = caddReading?.source;
  add("Missense scores", analysisResult.conservationData?.source);
  if (caddSource && pdSource && caddSource !== pdSource) {
    add("CADD", caddSource);
    add("AlphaMissense", pdSource);
  } else if (caddSource && !pdSource && caddSource !== "Ensembl VEP") {
    add("CADD", caddSource);
  } else {
    add("CADD · AlphaMissense", pdSource);
  }
  add("Gene constraint", analysisResult.gnomadConstraint ? constraintSourceLabel(analysisResult) : null);


  return (
    <div className="prd-rail" data-testid="predictors-rail">
      <EvidenceReadingInspector tab="predictors" rows={comparisonRows} />
      {/* ── 1. How the verdict was reached ── */}
      <section className="prd-rsec" aria-labelledby="prd-rail-trace">
        <h3 className="eyebrow" id="prd-rail-trace">
          <GitBranch className="w-3.5 h-3.5" />
          Rule trace
        </h3>
        <ol className="prd-steps" data-testid="predictor-rule-trace">
          <Step n={1} label="Calibrated tools scored" state={scored === 0 ? "idle" : "done"}>
            <span>{scored} of {chain.length}</span>
            {missing.length > 0 && (
              <span className="prd-step__sub">
                No score:{" "}
                {missing
                  .map(v => {
                    const label = v.availability.label;
                    return label && label !== ENGINE_STATE_LABELS["no-result"] ? `${v.name} (${label})` : v.name;
                  })
                  .join(", ")}
              </span>
            )}
          </Step>
          <Step n={2} label={primary.vcepApplied && primary.vcepRule ? `Deciding input · ${primary.vcepRule.cspecId} v${primary.vcepRule.version}` : "First with a score"} state={active || primary.activeTool === "spliceai" ? "done" : "idle"}>
            <span>
              {primary.outcome === "vcep-excluded"
                ? "Missense predictors excluded"
                : primary.activeTool === "spliceai"
                ? `${activeToolText(primary)} · ${formatEvidenceCode(primary.code ?? "PP3")}`
                : active
                ? `${active.name} ${active.scoreText} · ${formatEvidenceCode(primary.activeCall?.code ?? active.callLabel)}`
                : "None"}
            </span>
            <span className="prd-step__sub">
              {primary.vcepRule
                ? `${primary.vcepRule.vcep} (${primary.vcepRule.cspecId} v${primary.vcepRule.version}): ${primary.vcepRule.summary}`
                : `Order: ${CHAIN_ORDER_TEXT}. Informational tools are listed but never used.`}
            </span>
          </Step>
          <Step n={3} label="Rule" state={primary.code ? "done" : primary.outcome === "blocked-spliceai" || primary.outcome.startsWith("withheld") ? "warn" : "idle"}>
            <span>{primary.code ? `${formatEvidenceCode(primary.code)} at ${primary.vcepApplied ? "VCEP" : "its calibrated"} strength` : noCriterionText(primary)}</span>
            {primary.disagreeingTools.length > 0 && (
              <span className="prd-step__warn">{disagreementText(primary)}</span>
            )}
            {primary.splicePp3Corroboration && (
              <span className="prd-step__sub">{primary.splicePp3Corroboration}</span>
            )}
            {primary.vcepNotes.map((note, idx) => (
              <span key={idx} className="prd-step__sub">{note}</span>
            ))}
            <span className="prd-step__sub">SpliceAI ≥ 0.20 blocks BP4 and applies splicing PP3 once when PVS1 is absent (Walker 2023; VCEP cut-points apply where specified).</span>
          </Step>
          <Step n={4} label="Regional constraint → PP2" state={ev.engine.pp2Stale ? "warn" : constraint.regionalOe === null ? "idle" : "done"}>
            <span>
              {constraint.regionalOe === null
                ? `No regional O/E at this variant${constraint.regionalStatus ? ` (${REGIONAL_STATUS_WORDS[constraint.regionalStatus] ?? constraint.regionalStatus})` : ""}, so PP2 was not tested`
                : `Regional O/E ${constraint.regionalOe.toFixed(2)} → ${constraint.pp2Code === "PP2_Moderate" ? "PP2 Moderate" : constraint.pp2Code === "PP2" ? "PP2 Supporting" : "not met"}`}
            </span>
            <span className="prd-step__sub">
              Rule: O/E ≤ {PP2_RULE.pp2.Moderate} Moderate, ≤ {PP2_RULE.pp2.Supporting} Supporting ·{" "}
              <a href={`https://doi.org/${PP2_SOURCE.doi}`} target="_blank" rel="noreferrer">{PP2_SOURCE.short}</a>
            </span>
            {ev.engine.pp2Stale && (
              <span className="prd-step__warn">This result records PP2 from the retired gene Z / o-e proxy. Re-run the analysis to refresh it.</span>
            )}
          </Step>
          <Step n={5} label="BP1" state={ev.engine.bp1Stale ? "warn" : "idle"}>
            <span>Not assessed</span>
            <span className="prd-step__sub">Needs the gene&apos;s curated disease mechanism; pLI is not that fact.</span>
            {ev.engine.bp1Stale && (
              <span className="prd-step__warn">This result records BP1 from an earlier engine. Re-run the analysis to refresh it.</span>
            )}
          </Step>
          <Step n={6} label="Engine record" state={engine.withheldByWeighting || (engine.known && (engine.code ?? null) !== primary.code) ? "warn" : "done"}>
            <span className="prd-step__verdict">
              {engine.known ? (
                ev.engine.codes.length ? (
                  ev.engine.codes.map(c => (
                    <span key={c} className="ev-tier chip-code" data-tone={c.startsWith("B") ? "good" : "danger"}>{formatEvidenceCode(c)}</span>
                  ))
                ) : (
                  "No computational code recorded"
                )
              ) : primary.code ? (
                <>unconfirmed (rule gives {formatEvidenceCode(primary.code)})</>
              ) : (
                "Not in payload"
              )}
            </span>
            {engine.weighting && (
              <span className="prd-step__sub">ACMG weighting: {engine.weighting}</span>
            )}
            {engine.withheldByWeighting && (
              <span className="prd-step__warn">The rule gives {formatEvidenceCode(primary.code ?? "")}; the {engine.weighting} weighting withholds it.</span>
            )}
            {engine.known && !engine.withheldByWeighting && (engine.code ?? null) !== primary.code && (
              <span className="prd-step__warn">
                The payload records {engine.code ? formatEvidenceCode(engine.code) : "no PP3 or BP4"} where the current rule gives {primary.code ? formatEvidenceCode(primary.code) : "neither"} — it was classified by an earlier engine. Re-run the analysis to refresh it.
              </span>
            )}
          </Step>
        </ol>
      </section>

      {/* Local agreement is descriptive, so it reads after the trace rather than above it. */}
      <section className="prd-rsec" aria-label="Local informational agreement">
        <h3 className="eyebrow">Local agreement / informational</h3>
        <PredictorInformationalSummary evidence={evidence} />
      </section>

      {/* ── 2. Bands reached ── */}
      <section className="prd-rsec" aria-labelledby="prd-rail-bands">
        <h3 className="eyebrow" id="prd-rail-bands">
          <Ruler className="w-3.5 h-3.5" />
          Bands this variant reached
        </h3>
        {reached.length ? (
          <ul className="prd-rcuts" data-testid="predictor-bands-reached">
            {reached.map(x => (
              <li key={x.key} className="prd-rcut">
                <span className="prd-rcut__name">{x.text}</span>
                <span className="prd-rcut__rule">{x.rule}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="prd-rail-note">No score reaches a PP3 or BP4 band or an authors&apos; cut for this variant.</p>
        )}
      </section>

      {/* ── 3. ClinGen points (reference) ── */}
      <section className="prd-rsec" aria-labelledby="prd-rail-points">
        <h3 className="eyebrow" id="prd-rail-points">
          <Scale className="w-3.5 h-3.5" />
          ClinGen points (reference)
        </h3>
        <div
          className="prd-points"
          role="img"
          aria-label={`Tavtigian 2020 point scale: benign at −7 or below, likely benign −6 to −1, uncertain 0 to 5, likely pathogenic 6 to 9, pathogenic 10 or more.${insilicoPoints !== null ? ` The recorded in-silico code is worth ${insilicoPoints > 0 ? "+" : ""}${insilicoPoints}.` : ""}`}
        >
          {CLINGEN_CLASS_BANDS.map(b => {
            const lo = (b.min ?? POINTS_MIN) - 0.5;
            const hi = (b.max ?? POINTS_MAX - 0.5) + 0.5;
            const left = pointsPct(Math.max(POINTS_MIN, lo));
            return (
              <span key={b.id} className="prd-points__band" data-id={b.id} title={b.label} style={{ left: `${left}%`, width: `${pointsPct(Math.min(POINTS_MAX, hi)) - left}%` }}>
                {b.id}
              </span>
            );
          })}
          {[-7, 0, 6, 10].map(t => (
            <span key={t} className="prd-points__tick" style={{ left: `${pointsPct(t)}%` }}>{t > 0 ? `+${t}` : t}</span>
          ))}
          {insilicoPoints !== null && engine.code && (
            <>
              <span className="prd-points__mark" style={{ left: `${pointsPct(insilicoPoints)}%` }} />
              <span className="prd-points__marklabel" style={{ left: `${pointsPct(insilicoPoints)}%` }}>
                {engine.code.split("_")[0]} {insilicoPoints > 0 ? "+" : "−"}{Math.abs(insilicoPoints)}
              </span>
            </>
          )}
        </div>
        <p className="prd-rail-note">
          Supporting 1, Moderate 2, Strong 4, Very strong 8 points (Tavtigian 2020). The engine classifies with the
          Richards 2015 combining rules, not by summing points.
        </p>
      </section>

      {/* ── 4. Method notes ── */}
      <section className="prd-rsec" aria-labelledby="prd-rail-notes" id={INSPECTOR_SECTIONS.thresholdKey} tabIndex={-1}>
        <h3 className="eyebrow" id="prd-rail-notes">
          <BookOpen className="w-3.5 h-3.5" />
          Method
        </h3>
        <details className="prd-notes">
          <summary>How PP3/BP4 is decided</summary>
          <ul>
            <li>
              ClinGen (Pejaver 2022) recommends one calibrated tool chosen in advance, not a count of correlated
              tools. The engine reads {CHAIN_ORDER_TEXT} in that order, and the first tool with a score gives
              PP3 or BP4 at its calibrated strength. A score between its bands gives neither; the next tool is not asked.
            </li>
            <li>
              The order was chosen on ClinVar variants classified after each tool was trained: REVEL first gave
              more Moderate-or-stronger calls and fewer wrong-direction calls than any other order.
            </li>
            <li>
              When another calibrated tool points the other way, a note says so. It never changes the strength.
            </li>
            <li>
              BP4 is withheld when SpliceAI is 0.20 or more, or when SpliceAI did not finish (Walker 2023).
              PP3 and PM1 together are capped at Strong.
            </li>
            <li>
              CADD, popEVE, AlphaGenome and the conservation scores are informational; the card on the
              Predictors tab explains each family and why it does not set PP3/BP4.
            </li>
            <li>
              The strength ladder places a tool on a strength only where ClinGen has calibrated it. A tool with just its
              authors&apos; cut-point shows a side of that cut, never a strength, because the cut-point does not say how
              strong the evidence is.
            </li>
            <li>
              PP2: missense variant in a gene with a low rate of benign missense variation where missense is a common
              disease mechanism. The engine reads it from the O/E of the gnomAD regional interval holding the variant, with
              Chao et al.&apos;s calibrated edges (≤ {REGIONAL_MISSENSE_CALIBRATION.pp2.Moderate} Moderate, ≤ {REGIONAL_MISSENSE_CALIBRATION.pp2.Supporting} Supporting); gene Z is context only.
            </li>
            <li>
              BP1: missense variant in a gene where truncating variants are the known cause of disease. It needs curated
              gene–disease knowledge, so it is not assessed automatically.
            </li>
            <li>
              ΔΔG measures folding stability, not pathogenicity, and no ACMG criterion takes a ΔΔG cut-point; see
              Energetics.
            </li>
          </ul>
        </details>
      </section>

      {/* ── 4. Sources ── */}
      <section className="prd-rsec" aria-labelledby="prd-rail-sources">
        <h3 className="eyebrow" id="prd-rail-sources">
          <Database className="w-3.5 h-3.5" />
          Sources
        </h3>
        <dl className="prd-kv">
          {sources.map(([label, value]) => (
            <Row key={label} label={label}>
              <span>{value}</span>
            </Row>
          ))}
        </dl>
        <ul className="prd-refs">
          {[...Object.values(CALIBRATION_SOURCES), TAVTIGIAN_2020, RICHARDS_2015].map(src => (
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
}

export default PredictorsRail;
