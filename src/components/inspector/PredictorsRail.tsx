import React from "react";
import { BookOpen, Database, GitBranch, Ruler } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { useSettings } from "../../context/SettingsContext";
import { CALIBRATION_SOURCES, formatEvidenceCode } from "../../shared/thresholds";
import { buildPredictorEvidence } from "../../shared/predictorEvidence";

/**
 * PredictorsRail — the Evidence Lineage inspector for the Predictors tab.
 *
 * The column states WHAT each tool said; the rail states HOW the PP3/BP4 verdict was reached — a
 * four-step trace (tools → calls → rule → engine) — then the calibrated reference tool's bands with
 * this variant's band marked, the method caveats, and the sources.
 *
 * It replaced a rail that asserted two things the code did not do: that scores were "calibrated
 * against local odds of pathogenicity" (the vote used uncalibrated cut-points for most tools) and
 * that "consensus voting prevents circular double-counting" (a vote of correlated tools is exactly
 * what double-counts, and the AlphaGenome AVI re-counted AlphaMissense). Its model registry was four
 * hard-coded version strings, one for a splicing model this tab does not show.
 *
 * Built from the same `buildPredictorEvidence` object as the column, so the two panes cannot report
 * different counts or codes.
 */

type StepState = "done" | "warn" | "idle";

function Step({ n, label, state = "done", children }: { n: number; label: string; state?: StepState; children: React.ReactNode }) {
  return (
    <li className="rail-step" data-state={state}>
      <span className="rail-step__n" aria-hidden="true">{n}</span>
      <div className="rail-step__body">
        <span className="rail-step__label">{label}</span>
        <div className="rail-step__value">{children}</div>
      </div>
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rail-kv__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const fmtCut = (n: number) => (Math.abs(n) >= 10 ? n.toFixed(1) : Number(n.toFixed(3)).toString());

export function PredictorsRail({ analysisResult }: { analysisResult: AnalysisResult }) {
  const { settings } = useSettings();
  const evidence = buildPredictorEvidence({
    result: analysisResult,
    alphagenomeConfigured: settings.alphagenomeApiKey?.trim() ? true : undefined,
  });
  const { vote, voters, engine, reference } = evidence;
  const scored = vote.nVoting;
  const totalVoters = scored + voters.missing.length;

  const r = analysisResult as any;
  const sources: Array<[string, string]> = [];
  const add = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) sources.push([label, value.trim()]);
  };
  add("Missense scores", analysisResult.conservationData?.source ?? "dbNSFP via MyVariant.info");
  add("CADD · AlphaMissense", analysisResult.predictorData?.source ?? "Ensembl VEP");
  add("ESMC / VESM", r.esmcEval?.provenance);
  add("SaProt", r.saprotEval?.provenance);

  const engineTone = engine.code?.startsWith("PP3") ? "danger" : engine.code?.startsWith("BP4") ? "good" : "neutral";

  return (
    <div className="flex flex-col gap-5" data-testid="predictors-rail">
      {/* ── 1. How the verdict was reached ── */}
      <section className="rail-section" aria-labelledby="prd-rail-trace">
        <h3 className="eyebrow" id="prd-rail-trace">
          <GitBranch className="w-3.5 h-3.5" />
          Rule trace
        </h3>
        <ol className="rail-steps" data-testid="predictor-rule-trace">
          <Step n={1} label="Voting tools scored" state={scored === 0 ? "idle" : "done"}>
            <span className="pop-mono">{scored} of {totalVoters}</span>
            {voters.missing.length > 0 && (
              <span className="rail-step__sub">No score: {voters.missing.map(v => v.name).join(", ")}</span>
            )}
          </Step>
          <Step n={2} label="Calls">
            <span className="pop-mono">
              {vote.nPathogenic} pathogenic · {vote.nBenign} benign · {vote.nIndeterminate} indeterminate
            </span>
            <span className="rail-step__sub">Informational tools are listed but never counted.</span>
          </Step>
          <Step n={3} label="Rule" state={vote.code ? "done" : "idle"}>
            <span>
              {vote.direction === "pathogenic" ? "Pathogenic > benign → PP3"
                : vote.direction === "benign" ? "Benign > pathogenic → BP4"
                : vote.direction === "tie" ? "Tie → no criterion"
                : "Nothing to count → no criterion"}
            </span>
            <span className="rail-step__sub">Plurality of calls; applied at Supporting strength.</span>
          </Step>
          <Step n={4} label="Engine record" state={engine.withheldByWeighting || (engine.known && (engine.code ?? null) !== vote.code) ? "warn" : "done"}>
            <span className="rail-step__verdict">
              {engine.known ? (
                engine.code ? <span className="ev-tier chip-code" data-tone={engineTone}>{engine.code}</span> : "No PP3 / BP4 recorded"
              ) : vote.code ? (
                <>unconfirmed (supports {vote.code})</>
              ) : (
                "Not in payload"
              )}
            </span>
            {engine.weighting && (
              <span className="rail-step__sub">ACMG weighting: {engine.weighting}</span>
            )}
            {engine.withheldByWeighting && (
              <span className="rail-step__warn">The vote supports {vote.code}; the {engine.weighting} weighting withholds it.</span>
            )}
            {engine.known && !engine.withheldByWeighting && engine.code && vote.code && engine.code !== vote.code && (
              <span className="rail-step__warn">
                The payload records {engine.code} where the current rule gives {vote.code} — it was classified by an earlier engine. Re-run the analysis to refresh it.
              </span>
            )}
          </Step>
        </ol>
      </section>

      {/* ── 2. The calibrated reference tool ── */}
      {reference && (
        <section className="rail-section" aria-labelledby="prd-rail-bands">
          <h3 className="eyebrow" id="prd-rail-bands">
            <Ruler className="w-3.5 h-3.5" />
            {reference.name} bands · {reference.source}
          </h3>
          <ul className="rail-cuts" data-testid="reference-bands">
            {[...reference.bands]
              .sort((a, b) => b.threshold - a.threshold)
              .map(b => {
                const active = reference.call.code === b.code;
                const op = b.direction === "PP3" ? "≥" : "≤";
                return (
                  <li key={b.code} className="rail-cut" data-active={active || undefined}>
                    <span className="ev-tier chip-code" data-tone={active ? (b.direction === "PP3" ? "danger" : "good") : "muted"}>
                      {formatEvidenceCode(b.code)}
                    </span>
                    <span className="rail-cut__rule pop-mono">{op} {fmtCut(b.threshold)}</span>
                    {active && <span className="rail-cut__here">this variant</span>}
                  </li>
                );
              })}
          </ul>
          <p className="rail-step__sub">
            {reference.name} <span className="pop-mono">{reference.score.toFixed(3)}</span> →{" "}
            {reference.call.direction ? formatEvidenceCode(reference.call.code) : "indeterminate (between the bands)"}.
            {" "}ClinGen names REVEL, BayesDel, MutPred2 and VEST4 as tools to use on their own.
          </p>
        </section>
      )}

      {/* ── 3. Method notes ── */}
      <section className="rail-section" aria-labelledby="prd-rail-notes">
        <h3 className="eyebrow" id="prd-rail-notes">
          <BookOpen className="w-3.5 h-3.5" />
          Method
        </h3>
        <details className="rail-notes" open>
          <summary>How to read this vote</summary>
          <ul>
            <li>
              ClinGen (Pejaver 2022) recommends a single calibrated tool chosen in advance, not a count of
              correlated tools. The vote here is kept at Supporting strength for that reason; the
              calibrated reference above is the reading ClinGen would apply.
            </li>
            <li>
              REVEL, BayesDel, CADD and AlphaMissense vote on ClinGen&apos;s calibrated bands. MetaRNN, ClinPred
              and popEVE vote on their authors&apos; cut-points, which are not calibrated.
            </li>
            <li>
              MetaRNN and ClinPred take gnomAD allele frequency as a feature and are trained on ClinVar:
              their votes overlap with PM2/BS1 and are partly circular for a variant already in ClinVar.
            </li>
            <li>
              The AlphaGenome AVI is a rank among scored variants, not a probability, and contains
              AlphaMissense, so it is informational. It no longer raises PP3 to Moderate or Strong.
            </li>
            <li>
              Conservation (phyloP, GERP++, ConSurf) measures constraint, not pathogenicity. ClinGen caps
              PP3 and PM1 together at Strong, because both draw on conservation.
            </li>
          </ul>
        </details>
      </section>

      {/* ── 4. Sources ── */}
      <section className="rail-section" aria-labelledby="prd-rail-sources">
        <h3 className="eyebrow" id="prd-rail-sources">
          <Database className="w-3.5 h-3.5" />
          Sources
        </h3>
        <dl className="rail-kv rail-kv--sources">
          {sources.map(([label, value]) => (
            <Row key={label} label={label}>
              <span>{value}</span>
            </Row>
          ))}
        </dl>
        <ul className="rail-refs">
          {Object.values(CALIBRATION_SOURCES).map(src => (
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
