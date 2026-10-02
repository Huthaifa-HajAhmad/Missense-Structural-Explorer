import React from "react";
import { BookOpen, Database, GitBranch, Ruler, Scale } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { useSettings } from "../../context/SettingsContext";
import { CALIBRATION_SOURCES, formatEvidenceCode } from "../../shared/thresholds";
import { buildPredictorEvidence } from "../../shared/predictorEvidence";
import {
  CLINGEN_CLASS_BANDS,
  CLINGEN_POINTS,
  PP2_RULE,
  RICHARDS_2015,
  TAVTIGIAN_2020,
  buildLadderEvidence,
} from "../../shared/ladderEvidence";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";

/**
 * PredictorsRail — the Evidence Lineage inspector for the Predictors tab.
 *
 * The column states WHAT each tool said; the rail states HOW the computational criteria were reached —
 * a six-step trace (tools → calls → rule → PP2 → BP1 → engine), the bands this variant reached, the
 * ClinGen point scale as a reference, the method caveats and the sources. The PP2 / BP1 steps, the
 * bands and the point scale came from the retired Score thresholds rail.
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
  const evidence = buildPredictorEvidence({
    result: analysisResult,
    alphagenomeConfigured: settings.alphagenomeApiKey?.trim() ? true : undefined,
  });
  const ev = buildLadderEvidence({ result: analysisResult, predictor: evidence });
  const { constraint } = ev;
  const { vote, voters, engine } = evidence;
  // The engine's own PP3/BP4 on the point scale, as recorded: "PP3" is +1, "BP4_Strong" is -4.
  const insilicoPoints = (() => {
    if (!engine.code) return null;
    const strength = (engine.code.includes("_") ? engine.code.split("_")[1] : "Supporting") as keyof typeof CLINGEN_POINTS;
    return (engine.code.startsWith("PP3") ? 1 : -1) * (CLINGEN_POINTS[strength] ?? 1);
  })();
  // Bands this variant reached: calibrated tools in a band, then voters on their authors' cut.
  const reached = [
    ...ev.ladder
      .filter(l => l.at && l.at !== "none")
      .map(l => {
        const [dir, strength] = (l.at as string).split(":");
        const line = l.cutLines.find(x => x.startsWith(dir)) ?? "";
        return {
          key: l.key,
          text: `${l.name} ${l.scoreText} · ${formatEvidenceCode(dir + (strength === "Supporting" ? "" : `_${strength}`))}${l.votes ? "" : " (not counted)"}`,
          rule: line.replace(/^(PP3|BP4) /, "").split(" · ")[0],
        };
      }),
    ...ev.directional
      .filter(d => d.side === "pathogenic" || d.side === "benign")
      .map(d => ({ key: d.key, text: `${d.name} ${d.scoreText} · authors' cut`, rule: d.cutText })),
  ];
  const scored = vote.nVoting;
  const totalVoters = scored + voters.missing.length;

  const r = analysisResult as any;
  const sources: Array<[string, string]> = [];
  const add = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) sources.push([label, value.trim()]);
  };
  add("Missense scores", analysisResult.conservationData?.source ?? "dbNSFP via MyVariant.info");
  add("CADD · AlphaMissense", analysisResult.predictorData?.source ?? "Ensembl VEP");
  add("Gene constraint", analysisResult.gnomadConstraint ? "gnomAD v4 (GraphQL)" : null);
  add("ESMC / VESM", r.esmcEval?.provenance);
  add("SaProt", r.saprotEval?.provenance);


  return (
    <div className="prd-rail" data-testid="predictors-rail">
      {/* ── 1. How the verdict was reached ── */}
      <section className="prd-rsec" aria-labelledby="prd-rail-trace">
        <h3 className="eyebrow" id="prd-rail-trace">
          <GitBranch className="w-3.5 h-3.5" />
          Rule trace
        </h3>
        <ol className="prd-steps" data-testid="predictor-rule-trace">
          <Step n={1} label="Voting tools scored" state={scored === 0 ? "idle" : "done"}>
            <span>{scored} of {totalVoters}</span>
            {voters.missing.length > 0 && (
              <span className="prd-step__sub">No score: {voters.missing.map(v => v.name).join(", ")}</span>
            )}
          </Step>
          <Step n={2} label="Calls">
            <span>
              {vote.nPathogenic} pathogenic · {vote.nBenign} benign · {vote.nIndeterminate} indeterminate
            </span>
            <span className="prd-step__sub">Informational tools are listed but never counted.</span>
          </Step>
          <Step n={3} label="Rule" state={vote.code ? "done" : "idle"}>
            <span>
              {vote.direction === "pathogenic" ? "Pathogenic > benign → PP3"
                : vote.direction === "benign" ? "Benign > pathogenic → BP4"
                : vote.direction === "tie" ? "Split vote → no criterion"
                : "Nothing to count → no criterion"}
            </span>
            <span className="prd-step__sub">Plurality of calls; applied at Supporting strength.</span>
          </Step>
          <Step n={4} label="Gene constraint → PP2" state={constraint.missenseZ === null ? "idle" : "done"}>
            <span>
              {constraint.missenseZ === null
                ? `${ENGINE_STATE_LABELS["no-result"]} from gnomAD, so PP2 was not tested`
                : `Z ${constraint.missenseZ.toFixed(2)}${constraint.oeMis !== null ? `, o/e ${constraint.oeMis.toFixed(2)}` : ""} → ${constraint.pp2RuleMet ? "met" : "not met"}`}
            </span>
            <span className="prd-step__sub">Rule: Z ≥ {PP2_RULE.missenseZ} and o/e &lt; {PP2_RULE.oeMisBelow} (local proxy)</span>
          </Step>
          <Step n={5} label="BP1" state={ev.engine.bp1Stale ? "warn" : "done"}>
            <span>Not assessed</span>
            <span className="prd-step__sub">Needs the gene&apos;s curated disease mechanism; pLI is not that fact.</span>
            {ev.engine.bp1Stale && (
              <span className="prd-step__warn">This result records BP1 from an earlier engine. Re-run the analysis to refresh it.</span>
            )}
          </Step>
          <Step n={6} label="Engine record" state={engine.withheldByWeighting || (engine.known && (engine.code ?? null) !== vote.code) ? "warn" : "done"}>
            <span className="prd-step__verdict">
              {engine.known ? (
                ev.engine.codes.length ? (
                  ev.engine.codes.map(c => (
                    <span key={c} className="ev-tier chip-code" data-tone={c.startsWith("B") ? "good" : "danger"}>{formatEvidenceCode(c)}</span>
                  ))
                ) : (
                  "No computational code recorded"
                )
              ) : vote.code ? (
                <>unconfirmed (supports {vote.code})</>
              ) : (
                "Not in payload"
              )}
            </span>
            {engine.weighting && (
              <span className="prd-step__sub">ACMG weighting: {engine.weighting}</span>
            )}
            {engine.withheldByWeighting && (
              <span className="prd-step__warn">The vote supports {vote.code}; the {engine.weighting} weighting withholds it.</span>
            )}
            {engine.known && !engine.withheldByWeighting && engine.code && vote.code && engine.code !== vote.code && (
              <span className="prd-step__warn">
                The payload records {formatEvidenceCode(engine.code)} where the current rule gives {vote.code} — it was classified by an earlier engine. Re-run the analysis to refresh it.
              </span>
            )}
          </Step>
        </ol>
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
          <summary>How to read this vote</summary>
          <ul>
            <li>
              ClinGen (Pejaver 2022) recommends a single calibrated tool chosen in advance (REVEL, BayesDel,
              MutPred2 or VEST4), not a count of correlated tools. The vote here is kept at Supporting strength for that reason; the
              calibrated reference on the tab is the reading ClinGen would apply.
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
              Protein language, genome-wide and conservation scores are informational; the card on the
              Predictors tab explains each family and why it does not vote.
            </li>
            <li>
              The strength ladder places a tool on a strength only where ClinGen has calibrated it. A tool with just its
              authors&apos; cut-point shows a side of that cut, never a strength, because the cut-point does not say how
              strong the evidence is.
            </li>
            <li>
              PP2: missense variant in a gene with a low rate of benign missense variation where missense is a common
              disease mechanism. gnomAD missense Z with o/e is the engine&apos;s proxy for it.
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
