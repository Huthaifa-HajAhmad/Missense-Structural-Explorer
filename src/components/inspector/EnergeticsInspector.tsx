import React, { useMemo } from "react";
import { BookOpen, Database, GitBranch, Ruler, SlidersHorizontal } from "lucide-react";
import { AnalysisResult, EnergeticsData } from "../../types";
import { useSettings } from "../../context/SettingsContext";
import { ENGINE_STATE_LABELS, type EnergyUnit } from "../../shared/engineStatus";
import {
  AGREEMENT_CHIP,
  RASP_BUNDLED_PROTEINS,
  absenceText,
  buildEnergeticsEvidence,
  listNames,
  signedDdg,
} from "../../shared/energeticsEvidence";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";

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

interface EnergeticsInspectorProps {
  analysisResult: AnalysisResult | null;
  foldingEnergetics?: EnergeticsData | null;
  foldingStatus?: "failed" | "success" | "unavailable" | null;
  foldingError?: string | null;
  dynamut2Status?: "pending" | "unavailable" | "done" | null;
  ddmutStatus?: "pending" | "unavailable" | "done" | null;
  thermompnnStatus?: "pending" | "unavailable" | "done" | "error" | null;
  thermompnnError?: string | null;
  disruptionPredictor?: { plddt?: number | null } | null;
  isFolding?: boolean;
  /** Single-value FoldX fallback, the same one the main column uses. */
  foldingDdG?: number | null;
}

type StepState = "done" | "warn" | "idle";

function Step({ n, label, state = "done", children }: { n: number; label: string; state?: StepState; children: React.ReactNode }) {
  return (
    <li className="nrg-step" data-state={state}>
      <span className="nrg-step__n" aria-hidden="true">{n}</span>
      <div className="nrg-step__body">
        <span className="nrg-step__label">{label}</span>
        <div className="nrg-step__value">{children}</div>
      </div>
    </li>
  );
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

export const EnergeticsInspector: React.FC<EnergeticsInspectorProps> = ({
  analysisResult,
  foldingEnergetics,
  foldingStatus,
  foldingError,
  dynamut2Status,
  ddmutStatus,
  thermompnnStatus,
  thermompnnError,
  disruptionPredictor,
  isFolding = false,
  foldingDdG = null,
}) => {
  const { settings, updateSetting } = useSettings();
  const unit: EnergyUnit = settings.energyUnit === "kJ/mol" ? "kJ/mol" : "kcal/mol";

  const evidence = useMemo(
    () =>
      buildEnergeticsEvidence({
        foldingDdG,
        foldingStatus,
        foldingEnergetics: foldingEnergetics as Record<string, any> | null | undefined,
        dynamut2Status,
        ddmutStatus,
        thermompnnStatus,
        thermompnnError,
        foldingError,
        isFolding,
        plddt: disruptionPredictor?.plddt ?? analysisResult?.disruptionPredictor?.plddt ?? null,
      }),
    [
      foldingDdG, foldingStatus, foldingEnergetics, dynamut2Status, ddmutStatus, thermompnnStatus,
      thermompnnError, foldingError, isFolding, disruptionPredictor?.plddt, analysisResult?.disruptionPredictor?.plddt,
    ]
  );

  const { agreement, coverage, structure } = evidence;
  const withValue = evidence.readings.filter(r => r.ddg !== null);
  const structureWarn = structure?.repairState === "unrepaired" || structure?.repairState === "failed" || evidence.lowPlddt !== null;

  return (
    <div className="nrg-rail" data-testid="energetics-rail">
      {/* ── 1. How the reading was reached ── */}
      <section
        className="nrg-rsec"
        aria-labelledby="nrg-rail-trace"
        id={INSPECTOR_SECTIONS.stabilityTelemetry}
        tabIndex={-1}
      >
        <h3 className="eyebrow" id="nrg-rail-trace">
          <GitBranch className="w-3.5 h-3.5" aria-hidden="true" />
          Rule trace
        </h3>
        <ol className="nrg-steps" data-testid="energetics-rule-trace">
          <Step n={1} label="Template structure" state={!structure ? "idle" : structureWarn ? "warn" : "done"}>
            <span>
              {structure
                ? `${structure.label}${structure.pdbId ? ` · ${structure.pdbId}${structure.chainId ? `:${structure.chainId}` : ""}` : ""}${
                    structure.resolution !== null ? ` · ${structure.resolution.toFixed(1)} Å` : ""
                  }`
                : isFolding
                  ? "Resolving"
                  : "Not reported"}
            </span>
            {structure?.repair && <span className="nrg-step__sub">FoldX template: {structure.repair.toLowerCase()}</span>}
            {evidence.lowPlddt !== null && (
              <span className="nrg-step__warn">AlphaFold pLDDT {evidence.lowPlddt.toFixed(1)} at this residue: structure-based estimates are unreliable here.</span>
            )}
          </Step>
          <Step n={2} label="Engines returned a value" state={coverage.insufficient ? "warn" : "done"}>
            <span>{coverage.label}</span>
            {evidence.running.length > 0 && (
              <span className="nrg-step__sub">Running: {listNames(evidence.running.map(r => r.name))}</span>
            )}
            {evidence.missing.length > 0 && (
              <span className="nrg-step__sub">No value: {listNames(evidence.missing.map(r => r.name))}</span>
            )}
            {withValue.some(r => !r.counted) && (
              <span className="nrg-step__sub">
                Shown, not counted: {listNames(withValue.filter(r => !r.counted).map(r => r.name))}
              </span>
            )}
          </Step>
          <Step n={3} label="Each engine on its own mark" state={agreement.nCounted ? "done" : "idle"}>
            <span>
              {agreement.destabilizing.length} destabilizing · {agreement.moderate.length} moderate ·{" "}
              {agreement.notDestabilizing.length} not destabilizing
            </span>
            <span className="nrg-step__sub">Local marks, listed below. No probability is computed.</span>
          </Step>
          <Step n={4} label="Summary" state={agreement.direction === "split" ? "warn" : agreement.nCounted ? "done" : "idle"}>
            <span>
              {AGREEMENT_CHIP[agreement.direction].label}
              {agreement.nCounted > 1 ? ` · median ${signedDdg(agreement.median, unit)}` : ""}
            </span>
            {agreement.nCounted > 0 && coverage.insufficient && (
              <span className="nrg-step__warn">Fewer than three engines returned a value; read this as individual estimates, not agreement.</span>
            )}
          </Step>
          <Step n={5} label="Engine record">
            <span>Not an ACMG input</span>
            <span className="nrg-step__sub">No criterion in the rule engine reads ΔΔG.</span>
          </Step>
        </ol>
      </section>

      {/* ── 2. Each engine's mark beside this variant ── */}
      <section className="nrg-rsec" aria-labelledby="nrg-rail-cuts">
        <h3 className="eyebrow" id="nrg-rail-cuts">
          <Ruler className="w-3.5 h-3.5" aria-hidden="true" />
          Destabilizing marks · local
        </h3>
        <ul className="nrg-cuts" data-testid="energetics-marks">
          {evidence.readings.map(r => (
            <li key={r.key} className="nrg-cut" data-active={r.callTone === "danger" || undefined}>
              <span className="nrg-cut__name">{r.name}</span>
              <span className="nrg-cut__rule">≥ +{r.strongMark}</span>
              <span className="nrg-cut__here">
                {r.ddg !== null
                  ? `${signedDdg(r.ddg, unit)}${r.callTone === "danger" ? " · this variant is past it" : ""}${!r.counted ? " · not counted" : ""}`
                  : r.outcome.state === "running"
                    ? ENGINE_STATE_LABELS.running
                    : "no value"}
              </span>
            </li>
          ))}
        </ul>
        <p className="nrg-step__sub">
          FoldX publishes no threshold; +1.5 and +0.5 kcal/mol are this app&apos;s marks. The ±1.0 mark for the learned
          engines is local too. None is a clinical cut-point.
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
        <details className="nrg-notes" open>
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
              RaSP is a lookup, not a calculation: the bundled table covers {RASP_BUNDLED_PROTEINS.toLocaleString("en-GB")} human
              proteins with experimental structures, so most variants have no RaSP value by design.
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
