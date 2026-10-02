import React from "react";
import { BookOpen, Database, GitBranch, Ruler, Scale } from "lucide-react";
import type { AnalysisResult, EnergeticsData } from "../../types";
import { useSettings } from "../../context/SettingsContext";
import { CALIBRATION_SOURCES, THRESHOLDS, formatEvidenceCode } from "../../shared/thresholds";
import {
  CLINGEN_CLASS_BANDS,
  CLINGEN_POINTS,
  RICHARDS_2015,
  TAVTIGIAN_2020,
  buildThresholdEvidence,
} from "../../shared/thresholdEvidence";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";

/**
 * GuidelinesRail — the Evidence Lineage inspector for the Score thresholds tab.
 *
 * The column shows every cut-point; the rail shows HOW the computational codes were reached: a rule
 * trace (vote → PP3/BP4, gene constraint → PP2, BP1 not assessed, engine record), the bands this
 * variant actually reached, the ClinGen point scale as a reference, method notes and sources.
 *
 * It replaced five boxed cards that repeated the tab (a second "Pathogenic Concordance" verdict and
 * every score again), labelled REVEL "Conservation", defined BP3 as "…or structurally neutral
 * substitution" (invented) and showed only the pathogenic half of the point scale, tinted amber.
 * Built from the same `buildThresholdEvidence` object as the column.
 */

type StepState = "done" | "warn" | "idle";

function Step({ n, label, state = "done", children }: { n: number; label: string; state?: StepState; children: React.ReactNode }) {
  return (
    <li className="gt-step" data-state={state}>
      <span className="gt-step__n" aria-hidden="true">{n}</span>
      <div className="gt-step__body">
        <span className="gt-step__label">{label}</span>
        <div className="gt-step__value">{children}</div>
      </div>
    </li>
  );
}

const POINTS_MIN = -8;
const POINTS_MAX = 11;
const pointsPct = (v: number) => ((v - POINTS_MIN) / (POINTS_MAX - POINTS_MIN)) * 100;

export interface GuidelinesRailProps {
  analysisResult: AnalysisResult;
  foldingDdG: number | null;
  foldingEnergetics?: EnergeticsData | null;
  onSelectEvidenceTab?: (tab: string) => void;
}

export function GuidelinesRail({ analysisResult, foldingDdG, foldingEnergetics }: GuidelinesRailProps) {
  const { settings } = useSettings();
  const ev = buildThresholdEvidence({
    result: analysisResult,
    foldingDdG,
    foldingEnergetics,
    alphagenomeConfigured: settings.alphagenomeApiKey?.trim() ? true : undefined,
  });
  const { predictor, engine, constraint } = ev;
  const vote = predictor.vote;
  const PP2 = THRESHOLDS.pp2Constraint;

  const insilicoStale = engine.known && !engine.insilico.withheldByWeighting && (engine.insilico.code ?? null) !== vote.code;

  // Bands this variant reached: calibrated tools in a band, then voters on their authors' cut.
  const reached = [
    ...ev.ladder
      .filter(l => l.at && l.at !== "none")
      .map(l => {
        const [dir, strength] = (l.at as string).split(":");
        const row = ev.rows.find(r => r.reading.key === l.key)!;
        const line = row.cutLines.find(x => x.startsWith(dir)) ?? "";
        return {
          key: l.key,
          text: `${l.name} ${l.scoreText} · ${formatEvidenceCode(dir + (strength === "Supporting" ? "" : `_${strength}`))}${l.votes ? "" : " (not counted)"}`,
          rule: line.replace(/^(PP3|BP4) /, "").split(" · ")[0],
        };
      }),
    ...predictor.voters.pathogenic
      .filter(v => v.cutpoints.kind === "authors")
      .map(v => ({ key: v.key, text: `${v.name} ${v.scoreText} · authors' cut`, rule: v.cutpoints.marks.map(m => m.label).join(" · ") })),
  ];

  // PP3 Supporting / BP4 Supporting on the point scale, as the engine records them.
  const insilicoPoints = (() => {
    const code = engine.insilico.code;
    if (!code) return null;
    const strength = (code.includes("_") ? code.split("_")[1] : "Supporting") as keyof typeof CLINGEN_POINTS;
    return (code.startsWith("PP3") ? 1 : -1) * (CLINGEN_POINTS[strength] ?? 1);
  })();

  const r = analysisResult as any;
  const sources: Array<[string, string]> = [];
  const add = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) sources.push([label, value.trim()]);
  };
  add("Missense scores", analysisResult.conservationData?.source ?? "dbNSFP via MyVariant.info");
  add("CADD · AlphaMissense", analysisResult.predictorData?.source ?? "Ensembl VEP");
  add("Gene constraint", analysisResult.gnomadConstraint ? "gnomAD v4 (GraphQL)" : null);
  add("ESMC / VESM", r.esmcEval?.provenance);

  const refs = [...Object.values(CALIBRATION_SOURCES), TAVTIGIAN_2020, RICHARDS_2015];

  return (
    <div className="gt-rail" data-testid="thresholds-rail">
      {/* ── 1. Rule trace ── */}
      <section className="gt-rsec" aria-labelledby="gt-rail-trace">
        <h3 className="eyebrow" id="gt-rail-trace">
          <GitBranch className="w-3.5 h-3.5" />
          Rule trace
        </h3>
        <ol className="gt-steps" data-testid="threshold-rule-trace">
          <Step n={1} label="In-silico vote" state={vote.nVoting === 0 ? "idle" : "done"}>
            <span>
              {vote.nPathogenic} pathogenic · {vote.nBenign} benign · {vote.nIndeterminate} indeterminate
            </span>
            <span className="gt-step__sub">
              {vote.direction === "pathogenic" ? "Plurality → PP3 at Supporting"
                : vote.direction === "benign" ? "Plurality → BP4 at Supporting"
                : vote.direction === "tie" ? "Split vote → no criterion"
                : "Nothing to count → no criterion"}
            </span>
          </Step>
          <Step n={2} label="Gene constraint → PP2" state={constraint.missenseZ === null ? "idle" : "done"}>
            <span>
              {constraint.missenseZ === null
                ? `${ENGINE_STATE_LABELS["no-result"]} from gnomAD, so PP2 was not tested`
                : `Z ${constraint.missenseZ.toFixed(2)}${constraint.oeMis !== null ? `, o/e ${constraint.oeMis.toFixed(2)}` : ""} → ${constraint.pp2RuleMet ? "met" : "not met"}`}
            </span>
            <span className="gt-step__sub">Rule: Z ≥ {PP2.missenseZ} and o/e &lt; {PP2.oeMisBelow} (local proxy)</span>
          </Step>
          <Step n={3} label="BP1" state={engine.bp1Stale ? "warn" : "done"}>
            <span>Not assessed</span>
            <span className="gt-step__sub">Needs the gene&apos;s curated disease mechanism; pLI is not that fact.</span>
            {engine.bp1Stale && (
              <span className="gt-step__warn">This result records BP1 from an earlier engine. Re-run the analysis to refresh it.</span>
            )}
          </Step>
          <Step n={4} label="Engine record" state={insilicoStale || engine.insilico.withheldByWeighting ? "warn" : "done"}>
            <span className="gt-step__codes">
              {!engine.known
                ? vote.code ? `Not in payload (the vote supports ${vote.code})` : "Not in payload"
                : engine.codes.length
                  ? engine.codes.map(c => (
                      <span key={c} className="ev-tier chip-code" data-tone={c.startsWith("B") ? "good" : "danger"}>{formatEvidenceCode(c)}</span>
                    ))
                  : "No computational code"}
            </span>
            {engine.insilico.withheldByWeighting && (
              <span className="gt-step__warn">The vote supports {vote.code}; the {engine.insilico.weighting} weighting withholds it.</span>
            )}
            {insilicoStale && (
              <span className="gt-step__warn">
                The payload records {engine.insilico.code ? formatEvidenceCode(engine.insilico.code) : "no PP3 or BP4"} where the current rule gives {vote.code ?? "neither"}. Re-run the analysis to refresh it.
              </span>
            )}
          </Step>
        </ol>
      </section>

      {/* ── 2. Bands reached ── */}
      <section className="gt-rsec" aria-labelledby="gt-rail-bands">
        <h3 className="eyebrow" id="gt-rail-bands">
          <Ruler className="w-3.5 h-3.5" />
          Bands this variant reached
        </h3>
        {reached.length ? (
          <ul className="gt-rcuts" data-testid="threshold-bands-reached">
            {reached.map(x => (
              <li key={x.key} className="gt-rcut">
                <span className="gt-rcut__name">{x.text}</span>
                <span className="gt-rcut__rule">{x.rule}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="gt-rail-note">No score reaches a PP3 or BP4 band or an authors&apos; cut for this variant.</p>
        )}
      </section>

      {/* ── 3. ClinGen points (reference) ── */}
      <section className="gt-rsec" aria-labelledby="gt-rail-points">
        <h3 className="eyebrow" id="gt-rail-points">
          <Scale className="w-3.5 h-3.5" />
          ClinGen points (reference)
        </h3>
        <div
          className="gt-points"
          role="img"
          aria-label={`Tavtigian 2020 point scale: benign at −7 or below, likely benign −6 to −1, uncertain 0 to 5, likely pathogenic 6 to 9, pathogenic 10 or more.${insilicoPoints !== null ? ` The recorded in-silico code is worth ${insilicoPoints > 0 ? "+" : ""}${insilicoPoints}.` : ""}`}
        >
          {CLINGEN_CLASS_BANDS.map(b => {
            const lo = (b.min ?? POINTS_MIN) - 0.5;
            const hi = (b.max ?? POINTS_MAX - 0.5) + 0.5;
            const left = pointsPct(Math.max(POINTS_MIN, lo));
            return (
              <span key={b.id} className="gt-points__band" data-id={b.id} title={b.label} style={{ left: `${left}%`, width: `${pointsPct(Math.min(POINTS_MAX, hi)) - left}%` }}>
                {b.id}
              </span>
            );
          })}
          {[-7, 0, 6, 10].map(t => (
            <span key={t} className="gt-points__tick" style={{ left: `${pointsPct(t)}%` }}>{t > 0 ? `+${t}` : t}</span>
          ))}
          {insilicoPoints !== null && engine.insilico.code && (
            <>
              <span className="gt-points__mark" style={{ left: `${pointsPct(insilicoPoints)}%` }} />
              <span className="gt-points__marklabel" style={{ left: `${pointsPct(insilicoPoints)}%` }}>
                {engine.insilico.code.split("_")[0]} {insilicoPoints > 0 ? "+" : "−"}{Math.abs(insilicoPoints)}
              </span>
            </>
          )}
        </div>
        <p className="gt-rail-note">
          Supporting 1, Moderate 2, Strong 4, Very strong 8 points (Tavtigian 2020). The engine classifies with the
          Richards 2015 combining rules, not by summing points.
        </p>
      </section>

      {/* ── 4. Method ── */}
      <section className="gt-rsec" aria-labelledby="gt-rail-notes" id={INSPECTOR_SECTIONS.thresholdKey} tabIndex={-1}>
        <h3 className="eyebrow" id="gt-rail-notes">
          <BookOpen className="w-3.5 h-3.5" />
          Method
        </h3>
        <details className="gt-notes" open>
          <summary>How to read these cut-points</summary>
          <ul>
            <li>
              PP3 and BP4: computational evidence that a missense change is damaging or not. ClinGen (Pejaver 2022)
              recommends one calibrated tool chosen in advance; the engine&apos;s vote across seven tools is a local
              rule, held at Supporting strength.
            </li>
            <li>
              MetaRNN and ClinPred use gnomAD allele frequency, which PM2 and BS1 also read, and are trained on ClinVar.
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
              ΔΔG measures folding stability, not pathogenicity, and no ACMG criterion takes a ΔΔG cut-point. The marks
              drawn are local.
            </li>
            <li>Conservation (phyloP, GERP++) is constraint, and it overlaps the meta-predictors that already use it.</li>
          </ul>
        </details>
      </section>

      {/* ── 5. Sources ── */}
      <section className="gt-rsec" aria-labelledby="gt-rail-sources">
        <h3 className="eyebrow" id="gt-rail-sources">
          <Database className="w-3.5 h-3.5" />
          Sources
        </h3>
        <dl className="prd-kv">
          {sources.map(([label, value]) => (
            <div key={label} className="prd-kv__row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <ul className="gt-refs">
          {refs.map(src => (
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

export default GuidelinesRail;
