import React from "react";
import { BookOpen, Database, Ruler, SlidersHorizontal } from "lucide-react";
import { AnalysisResult } from "../../types";
import { useSettings } from "../../context/SettingsContext";
import { ENGINE_STATE_LABELS, raspCoverageSentence, type EnergyEngineId } from "../../shared/engineStatus";
import type { RaspCoverage } from "../../shared/raspIndex";
import { absenceText, markText, signedDdgNumber } from "../../shared/energeticsEvidence";
import { FOLDX_HOW_TO_READ } from "../../shared/foldxRepairMode";
import { useEnergeticsEvidence, type EnergeticsRun } from "../energetics/useEnergeticsEvidence";
import { EnergeticsMethodInspector } from "./EnergeticsMethodInspector";
import { EnergeticsRuleTrace } from "./EnergeticsRuleTrace";


/**
 * EnergeticsInspector — the Evidence Lineage rail for the Energetics view.
 *
 * The column states WHAT each engine said; the rail states HOW the reading was reached: a trace
 * (structure → engines → marks → summary → engine record), each engine's local mark beside this
 * variant's value, the engines with no value and why, the method caveats, and the sources the
 * payload actually carries.
 *
 * It replaced a "Stability Telemetry" rail that repeated the column's six rows a second time, and a
 * "Physical reference & baseline" block that printed 298.15 K, pH 7.0 and "±1.20 kcal/mol
 * (ProTherm)" for every run — constants, not this run's conditions, and an uncertainty with no
 * source. Its provenance block printed "RaSP snapshot" and "Embedding model: VESM_150M_v1" whether or
 * not any engine had used them (the server stamps both on every run).
 *
 * Built from the same `buildEnergeticsEvidence` object as the column, so the two panes cannot report
 * different counts or states.
 */

interface EnergeticsInspectorProps extends EnergeticsRun {
  selectedEngine?: EnergyEngineId | null;
  analysisResult: AnalysisResult | null;
}

/** Method papers, verified against the journals (see doc/ENERGETICS_TAB_REVIEW.md). */
const REFERENCES: Array<{ citation: string; doi: string }> = [
  { citation: "Schymkowitz et al. The FoldX web server. Nucleic Acids Res 2005 (FoldX)", doi: "10.1093/nar/gki387" },
  { citation: "Rodrigues et al. DynaMut2. Protein Sci 2021", doi: "10.1002/pro.3942" },
  { citation: "Zhou et al. DDMut. Nucleic Acids Res 2023", doi: "10.1093/nar/gkad472" },
  { citation: "Dieckhaus et al. ThermoMPNN. PNAS 2024", doi: "10.1073/pnas.2314853121" },
  { citation: "Diaz et al. Stability Oracle. Nat Commun 2024", doi: "10.1038/s41467-024-49780-2" },
  { citation: "Blaabjerg et al. RaSP. eLife 2023", doi: "10.7554/eLife.82593" },
];

export const EnergeticsInspector: React.FC<EnergeticsInspectorProps> = ({ selectedEngine = null, analysisResult, ...run }) => {
  const { updateSetting } = useSettings();
  const { evidence, unit } = useEnergeticsEvidence(run, analysisResult);
  const pinned = evidence.readings.some(r => r.key === selectedEngine);
  const raspCoverage = ((run.foldingEnergetics as any)?.raspCoverage as RaspCoverage | undefined) ?? null;

  return (
    <div className="nrg-rail" data-testid="energetics-rail">
      <EnergeticsMethodInspector evidence={evidence} unit={unit} selectedEngine={selectedEngine} variant={analysisResult?.metadata} />
      <details className="nrg-lineage" open={!pinned || undefined}>
        <summary>How the overall reading was reached</summary>
      <EnergeticsRuleTrace evidence={evidence} unit={unit} />


      {/* ── 2. Each engine's mark beside this variant ── */}
      <section className="nrg-rsec" aria-labelledby="nrg-rail-cuts">
        <h3 className="eyebrow" id="nrg-rail-cuts">
          <Ruler className="w-3.5 h-3.5" aria-hidden="true" />
          Destabilizing marks · local
        </h3>
        <table className="nrg-cuts" data-testid="energetics-marks">
          <caption className="sr-only">Each engine's local destabilizing mark beside this variant's value, in {unit}</caption>
          <thead>
            <tr>
              <th scope="col">Method</th>
              <th scope="col" className="nrg-cuts__num">Mark</th>
              <th scope="col" className="nrg-cuts__num">Variant</th>
              <th scope="col"><span className="sr-only">Reading</span></th>
            </tr>
          </thead>
          <tbody>
            {evidence.readings.map(r => {
              const past = r.ddg !== null && r.callTone === "danger";
              const status =
                r.ddg === null
                  ? r.outcome.state === "running" ? ENGINE_STATE_LABELS.running : "No value"
                  : !r.counted ? "Not counted" : past ? "Past mark" : "Below mark";
              return (
                <tr key={r.key} className="nrg-cut" data-active={past || undefined} data-muted={r.ddg === null || !r.counted || undefined}>
                  <th scope="row" className="nrg-cut__name">{r.name}</th>
                  <td className="nrg-cuts__num nrg-cut__rule">≥ {markText(r.strongMark, unit)}</td>
                  <td className="nrg-cuts__num nrg-cut__here">{r.ddg !== null ? signedDdgNumber(r.ddg, unit) : "–"}</td>
                  <td className="nrg-cut__status">{status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="nrg-step__sub">
          FoldX publishes no threshold; {markText(1.5, unit)} and {markText(0.5, unit)} {unit} are this app&apos;s marks. The{" "}
          {markText(1, unit)} mark for the learned engines is local too. None is a clinical cut-point.{" "}
          {FOLDX_HOW_TO_READ}
        </p>
      </section>

      {/* ── 3. What is missing, and why ── */}
      {evidence.missing.length > 0 && (
        <section className="nrg-rsec" aria-labelledby="nrg-rail-missing">
          <h3 className="eyebrow" id="nrg-rail-missing">
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
            Engines without a value
          </h3>
          <ul className="nrg-missing" data-testid="energetics-missing">
            {evidence.missing.map(r => (
              <li key={r.key}>
                <div className="nrg-missing__head">
                  <span className="nrg-missing__name">{r.name}</span>
                  <span
                    className="ev-tier"
                    data-tone={r.outcome.tone === "danger" ? "danger" : r.outcome.tone === "warn" ? "warning" : "muted"}
                  >
                    {r.outcome.label}
                  </span>
                </div>
                <p className="nrg-missing__reason">{absenceText(r)}</p>
                {r.outcome.detail && (
                  <details className="nrg-reason__detail">
                    <summary>Technical detail</summary>
                    <p>{r.outcome.detail}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 4. Method ── */}
      <section className="nrg-rsec" aria-labelledby="nrg-rail-notes">
        <h3 className="eyebrow" id="nrg-rail-notes">
          <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
          Method
        </h3>
        <details className="nrg-notes">
          <summary>How to read these estimates</summary>
          <ul>
            <li>
              Destabilization is not pathogenicity. ΔΔG speaks to misfolding and degradation; gain-of-function,
              dominant-negative and interface variants can be pathogenic and stable.
            </li>
            <li>
              Signs are normalized so positive means destabilizing. DynaMut2 and DDMut report the opposite sign
              natively; their values are negated before display.
            </li>
            <li>
              Predictor error is of the order of the marks themselves: DDMut reports RMSE 1.84 kcal/mol on its
              blind test (Zhou 2023). Differences under about 1 kcal/mol between engines are within noise.
            </li>
            <li>
              No calibrated probability is shown. The app has no ΔΔG-to-probability calibration fitted to data,
              so it reports how many engines pass their own mark and their median instead.
            </li>
            <li>
              RaSP is a lookup, not a calculation. {raspCoverageSentence(raspCoverage)} A missing RaSP value
              usually means the protein is not in the table, not that the variant is neutral.
            </li>
            <li>
              The engines share inputs (the same template, and for the learned ones overlapping training data),
              so agreement between them is not independent confirmation.
            </li>
          </ul>
        </details>
      </section>

      {/* ── 5. Sources ── */}
      <section className="nrg-rsec" aria-labelledby="nrg-rail-sources">
        <h3 className="eyebrow" id="nrg-rail-sources">
          <Database className="w-3.5 h-3.5" aria-hidden="true" />
          Sources
        </h3>
        {evidence.sources.length > 0 ? (
          <dl className="nrg-kv">
            {evidence.sources.map(([label, value]) => (
              <div key={label} className="nrg-kv__row">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="nrg-step__sub">The payload carries no run provenance yet.</p>
        )}
        <ul className="nrg-refs">
          {REFERENCES.map(ref => (
            <li key={ref.doi}>
              {ref.citation}{" "}
              <a href={`https://doi.org/${ref.doi}`} target="_blank" rel="noopener noreferrer">
                doi:{ref.doi}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      </details>
      {/* ── 6. Display ── */}
      <section className="nrg-rsec" aria-labelledby="nrg-rail-units">
        <h3 className="eyebrow" id="nrg-rail-units">Energy units</h3>
        <div className="nrg-seg" role="group" aria-labelledby="nrg-rail-units">
          <button type="button" aria-pressed={unit === "kcal/mol"} onClick={() => updateSetting("energyUnit", "kcal/mol")}>
            kcal/mol
          </button>
          <button type="button" aria-pressed={unit === "kJ/mol"} onClick={() => updateSetting("energyUnit", "kJ/mol")}>
            kJ/mol
          </button>
        </div>
      </section>
    </div>
  );
};

export default React.memo(EnergeticsInspector);
