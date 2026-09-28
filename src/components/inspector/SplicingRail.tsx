import React from "react";
import { BookOpen, Database, GitBranch, Ruler } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { useSettings } from "../../context/SettingsContext";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { THRESHOLDS, formatEvidenceCode } from "../../shared/thresholds";
import { SPLICE_CHANNEL_NAME, SPLICING_SOURCES, buildSplicingEvidence } from "../../shared/splicingEvidence";

/**
 * SplicingRail — the Evidence Lineage inspector for the RNA Splicing tab.
 *
 * The column states WHAT the splice predictors said; the rail states HOW the splicing reading was
 * reached — a four-step trace (score → rule → context → engine) — then the bands with this
 * variant's marked, the method caveats a curator needs, and the sources the payload names.
 *
 * It replaced an inspector that: mapped "PP3"/"BP4" rules the engine never ran (proximity ≤ 5 bp and
 * dbscSNV ≥ 0.6 as PP3, SpliceAI ≤ 0.02 as BP4); cited Pejaver 2022 — the missense calibration —
 * as the ClinGen splicing source, and linked dbscSNV to a PubMed record for another paper; printed
 * the legacy word "N/A"; and said "No precomputed or runtime SpliceAI delta scores exist for this
 * position" for an exonic SNV SpliceAI would have scored.
 *
 * Built from the same `buildSplicingEvidence` object as the column.
 */

type StepState = "done" | "warn" | "idle";

function Step({ n, label, state = "done", children }: { n: number; label: string; state?: StepState; children: React.ReactNode }) {
  return (
    <li className="spl-step" data-state={state}>
      <span className="spl-step__n" aria-hidden="true">{n}</span>
      <div className="spl-step__body">
        <span className="spl-step__label">{label}</span>
        <div className="spl-step__value">{children}</div>
      </div>
    </li>
  );
}

export function SplicingRail({ analysisResult, isBiophysicalLoading = false }: { analysisResult: AnalysisResult; isBiophysicalLoading?: boolean }) {
  const { settings } = useSettings();
  // The same loading flags the tab composes, so the two panes agree on "running".
  const isAnalysisLoading = useVariantAnalysisStore(s => s.analysisState.isLoading);
  const ev = buildSplicingEvidence({
    result: analysisResult,
    isLoading: Boolean(isAnalysisLoading || isBiophysicalLoading),
    alphagenomeConfigured: settings.alphagenomeApiKey?.trim() ? true : undefined,
  });
  const S = THRESHOLDS.spliceai;
  const { rule, geometry: g, engine } = ev;
  const pos = g.position !== null ? `${g.position > 0 ? "+" : "−"}${Math.abs(g.position)}` : null;
  const engineCode = engine.known ? engine.code : engine.voteCode;
  const engineWarn = ev.relation === "conflict" || ev.relation === "bp4-unchecked";

  const bands: Array<{ key: string; code: string | null; rule: string; label: string; tone: "danger" | "good" | "neutral" }> = [
    { key: "pp3", code: "PP3", rule: `≥ ${S.splicingPp3.toFixed(2)}`, label: "PP3 · splicing", tone: "danger" },
    { key: "between", code: null, rule: `${S.splicingBp4Below.toFixed(2)}–${S.splicingPp3.toFixed(2)}`, label: "Neither", tone: "neutral" },
    { key: "bp4", code: "BP4", rule: `< ${S.splicingBp4Below.toFixed(2)}`, label: "BP4 · splicing", tone: "good" },
  ];

  const md: any = (analysisResult as any).metadata ?? {};
  const sources: Array<[string, string]> = [];
  if (md.genomicCoordinates) sources.push(["Coordinate", `${md.genomicCoordinates}${md.assembly ? ` · ${md.assembly}` : ""}`]);
  sources.push(["SpliceAI", ev.spliceai.sourceText]);
  if (rule.maxDs !== null) {
    sources.push(["Reporting window", ev.spliceai.windowText]);
    sources.push(["Scores", ev.spliceai.maskText]);
    if (ev.spliceai.provenance?.annotationSet) sources.push(["Transcript set", ev.spliceai.provenance.annotationSet]);
  }
  if (g.transcriptId) sources.push(["Junction geometry", g.ensemblTranscriptId && g.ensemblTranscriptId !== g.transcriptId ? `${g.transcriptId} (${g.ensemblTranscriptId})` : g.transcriptId]);

  return (
    <div className="spl-rail" data-testid="splicing-rail">
      {/* ── 1. How the reading was reached ── */}
      <section className="spl-rsec" aria-labelledby="spl-rail-trace">
        <h3 className="eyebrow" id="spl-rail-trace">
          <GitBranch className="w-3.5 h-3.5" />
          Rule trace
        </h3>
        <ol className="spl-steps" data-testid="splicing-rule-trace">
          <Step n={1} label="SpliceAI score" state={rule.maxDs === null ? "idle" : "done"}>
            {rule.state === "pending" ? (
              <span>{ENGINE_STATE_LABELS.running}</span>
            ) : rule.maxDs !== null ? (
              <span>
                <span className="spl-mono">{rule.maxDs.toFixed(3)}</span> max Δ
                {rule.maxChannel ? ` · ${SPLICE_CHANNEL_NAME[rule.maxChannel].toLowerCase()}` : ""}
              </span>
            ) : (
              <span>No score</span>
            )}
            <span className="spl-step__sub">{rule.maxDs !== null ? ev.spliceai.sourceText : ev.spliceai.availability.reason}</span>
          </Step>
          <Step n={2} label="Splicing rule · Walker 2023" state={rule.code ? "done" : "idle"}>
            <span>
              {rule.state === "pp3" ? "≥ 0.20 → supports PP3"
                : rule.state === "bp4" ? "< 0.10 → supports BP4"
                : rule.state === "between" ? "Between 0.10 and 0.20 → neither"
                : "Not applied — needs a SpliceAI score"}
            </span>
            <span className="spl-step__sub">SpliceAI decides it alone. Distance and dbscSNV do not.</span>
          </Step>
          <Step n={3} label="Context · not counted" state="idle">
            <span>{pos ? `${pos} from the ${g.junction}` : g.distance !== null ? `${g.distance} bp from a boundary` : "Position not resolved"}</span>
            <span className="spl-step__sub">
              dbscSNV{" "}
              {ev.dbscsnv.max !== null
                ? `${ev.dbscsnv.max.toFixed(3)} (${ev.dbscsnv.altering ? "at or above" : "below"} the authors' ${THRESHOLDS.dbscsnv.spliceAltering})`
                : g.inDbscsnvWindow === false ? "does not cover this position" : "returned no score"}
            </span>
          </Step>
          <Step n={4} label="Engine record" state={engineWarn ? "warn" : "done"}>
            <span className="spl-step__verdict">
              {engine.known ? (
                engine.code ? <span className="ev-tier chip-code" data-tone={engine.code.startsWith("PP3") ? "danger" : "good"}>{formatEvidenceCode(engine.code)}</span> : "No PP3 / BP4 recorded"
              ) : engine.voteCode ? (
                <>unconfirmed (the vote supports {engine.voteCode})</>
              ) : (
                "Not in payload"
              )}
            </span>
            <span className="spl-step__sub">From the missense vote. The engine does not read splicing, so step 2 is never recorded as a code.</span>
            {ev.relation === "conflict" && (
              <span className="spl-step__warn">Splicing supports PP3 while the in-silico code is {engineCode}. Review before accepting it.</span>
            )}
            {ev.relation === "bp4-unchecked" && (
              <span className="spl-step__warn">{engineCode} rests on the missense vote; with no SpliceAI score, its splicing side is unchecked.</span>
            )}
          </Step>
        </ol>
      </section>

      {/* ── 2. Bands ── */}
      <section className="spl-rsec" aria-labelledby="spl-rail-bands">
        <h3 className="eyebrow" id="spl-rail-bands">
          <Ruler className="w-3.5 h-3.5" />
          SpliceAI bands · Walker 2023
        </h3>
        <ul className="spl-cuts" data-testid="splicing-bands">
          {bands.map(b => {
            const active = rule.state === b.key;
            return (
              <li key={b.key} className="spl-cut" data-active={active || undefined}>
                <span className={`ev-tier${b.code ? " chip-code" : ""}`} data-tone={active ? b.tone : "muted"}>{b.label}</span>
                <span className="spl-cut__rule">{b.rule}</span>
                {active && <span className="spl-cut__here">this variant</span>}
              </li>
            );
          })}
        </ul>
        <h4 className="spl-rail__sub">Authors&apos; operating points · not strengths</h4>
        <dl className="spl-kv">
          <div><dt>SpliceAI · high recall</dt><dd className="spl-mono">{S.authorsHighRecall}</dd></div>
          <div><dt>SpliceAI · recommended</dt><dd className="spl-mono">{S.authorsRecommended}</dd></div>
          <div><dt>SpliceAI · high precision</dt><dd className="spl-mono">{S.authorsHighPrecision}</dd></div>
          <div><dt>dbscSNV ADA / RF · altering</dt><dd className="spl-mono">{THRESHOLDS.dbscsnv.spliceAltering}</dd></div>
        </dl>
      </section>

      {/* ── 3. Method notes ── */}
      <section className="spl-rsec" aria-labelledby="spl-rail-notes">
        <h3 className="eyebrow" id="spl-rail-notes">
          <BookOpen className="w-3.5 h-3.5" />
          Method
        </h3>
        <details className="spl-notes" open>
          <summary>How to read this tab</summary>
          <ul>
            <li>
              The ClinGen SVI Splicing Subgroup (Walker 2023) applies PP3 for predicted splicing impact at a SpliceAI
              max Δ ≥ 0.2, and BP4 below 0.1. This app&apos;s engine does not apply either: its PP3/BP4 comes from the
              missense vote only, so the splicing reading here is shown beside it, never as a recorded code.
            </li>
            <li>
              A delta score is the change in the model&apos;s splice-site probability, not the probability that splicing
              is disrupted. The authors&apos; 0.2 / 0.5 / 0.8 are recall–precision operating points, not strengths.
            </li>
            <li>
              A missing SpliceAI score is not a benign result. SpliceAI scores every single-nucleotide change in an
              annotated gene, so an absence usually means the request failed or the coordinate was rejected.
            </li>
            <li>
              dbscSNV exists only from −3 to +8 around a donor and −12 to +2 around an acceptor (Jian 2014). Its 0.6 is
              the authors&apos; cut-point and is not ClinGen-calibrated, so it is context, not a criterion.
            </li>
            <li>
              Distance from a junction is not evidence either way. A change at the canonical ±1/±2 dinucleotide is
              assessed under PVS1 (Abou Tayoun 2018), not PP3.
            </li>
            <li>
              AlphaGenome&apos;s splicing share is how much of its AVI rank&apos;s attribution the splicing feature carries — an
              explanation of a rank, not a splicing prediction.
            </li>
          </ul>
        </details>
      </section>

      {/* ── 4. Sources ── */}
      <section className="spl-rsec" aria-labelledby="spl-rail-sources">
        <h3 className="eyebrow" id="spl-rail-sources">
          <Database className="w-3.5 h-3.5" />
          Sources
        </h3>
        <dl className="spl-kv">
          {sources.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <ul className="spl-refs">
          {SPLICING_SOURCES.map(src => (
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

export default SplicingRail;
