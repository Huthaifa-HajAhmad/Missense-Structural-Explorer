import React, { useMemo } from "react";
import { BookOpen, Database, GitBranch, Layers, Ruler, SlidersHorizontal } from "lucide-react";
import { AnalysisResult, EnergeticsData } from "../../types";
import { useSettings } from "../../context/SettingsContext";
import { ENGINE_STATE_LABELS, raspCoverageSentence, getEngine, type EnergyUnit, type EnergyEngineId } from "../../shared/engineStatus";
import type { RaspCoverage } from "../../shared/raspIndex";
import {
  AGREEMENT_CHIP,
  absenceText,
  buildEnergeticsEvidence,
  listNames,
  markText,
  signedDdg,
  ENERGETICS_CAVEAT_TEXT,
  ENERGETICS_GROUP_LABEL,
  FOLDX_TEMPLATE_DIFFERENCE_KCAL,
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
  selectedEngine?: EnergyEngineId | null;
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

/** The structure a value rests on. ProtVar's FoldX always ran on ITS AlphaFold model, never on this run's template. */
function structureBasisText(
  key: EnergyEngineId,
  group: string,
  structure: ReturnType<typeof buildEnergeticsEvidence>["structure"],
  evidence: ReturnType<typeof buildEnergeticsEvidence>
): string {
  if (key === "protvar" || (key === "foldx" && evidence.foldxStandIn)) {
    const model = evidence.foldxStandIn?.model ?? evidence.foldxTemplateCheck?.protvarTemplate ?? null;
    return `AlphaFold DB model${model ? ` ${model}` : ""}, precomputed by EBI ProtVar; not this run's template.`;
  }
  if (group === "lookup") return "Precomputed table; may use a different structure from this run.";
  const id = structure?.pdbId ? ` · ${structure.pdbId}${structure.chainId ? `:${structure.chainId}` : ""}` : "";
  return `${structure?.label ?? "Not reported"}${id}`;
}

export const EnergeticsInspector: React.FC<EnergeticsInspectorProps> = ({
  selectedEngine = null,
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
  const selected = evidence.readings.find(r => r.key === selectedEngine);
  const raspCoverage = ((foldingEnergetics as any)?.raspCoverage as RaspCoverage | undefined) ?? null;
  const withValue = evidence.readings.filter(r => r.ddg !== null);
  const structureWarn = structure?.repairState === "unrepaired" || structure?.repairState === "failed" || evidence.lowPlddt !== null;

  return (
    <div className="nrg-rail" data-testid="energetics-rail">
      <section className="nrg-selected-method" id={INSPECTOR_SECTIONS.stabilityMethod} tabIndex={-1} aria-labelledby="nrg-selected-title">
        <span className="sr-only" role="status" aria-atomic="true">
          {selected ? `${selected.name} pinned${selected.ddg !== null ? ` · ${signedDdg(selected.ddg, unit)}` : ''}` : 'No method pinned yet'}
        </span>
        <span className="eyebrow">Method inspector</span>
        <h2 id="nrg-selected-title">{selected?.name ?? 'Explore an estimate'}</h2>
        {selected ? <>
          <p>{selected.description}</p>
          <div className="nrg-selected-value">{signedDdg(selected.ddg, unit)}</div>
          <span className="ev-tier" data-tone={selected.callTone}>{selected.ddg === null ? selected.outcome.label : selected.callLabel}</span>
          <p>{selected.ddg === null ? absenceText(selected) : selected.counted ? 'Included in the overall agreement reading.' : 'Shown for reference; excluded from the overall agreement reading.'}</p>
          <dl>
            <div><dt>Substitution</dt><dd>{analysisResult?.metadata?.gene} {analysisResult?.metadata?.variant}</dd></div>
            <div><dt>Method family</dt><dd>{ENERGETICS_GROUP_LABEL[selected.group]}</dd></div>
            <div><dt>Structure basis</dt><dd>{structureBasisText(selected.key, selected.group, structure, evidence)}</dd></div>
            <div><dt>Sign convention</dt><dd>{getEngine(selected.key).nativeSign === 'negative-destabilizing' ? 'Provider sign reversed for comparison; positive here means less stable folding.' : 'Positive means less stable folding.'}</dd></div>
            <div><dt>Local destabilising mark</dt><dd>{markText(selected.strongMark, unit)} {unit}. App-defined, not a clinical cut-point.</dd></div>
          </dl>
          {selected.note && <p>{selected.note}</p>}
          {selected.caveats.map(c => <p className="nrg-selected-caveat" key={c}>{ENERGETICS_CAVEAT_TEXT[c].detail}</p>)}
        </> : <p>Select a point in Comparison or a method in Engine records to see its value, assumptions and limitations here.</p>}
      </section>
      {evidence.foldxTemplateCheck && (
        <section className="nrg-rsec" aria-labelledby="nrg-rail-twofold" data-testid="foldx-template-check">
          <h3 className="eyebrow" id="nrg-rail-twofold">
            <Layers className="w-3.5 h-3.5" aria-hidden="true" />
            FoldX on two templates
          </h3>
          <table className="nrg-twofold">
            <caption className="sr-only">Local FoldX against ProtVar's FoldX for this variant, in {unit}</caption>
            <thead>
              <tr>
                <th scope="col">Template</th>
                <th scope="col" className="nrg-twofold__num">ΔΔG</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">
                  Local FoldX
                  <span className="nrg-twofold__sub">{evidence.foldxTemplateCheck.localTemplate}{structure?.repairState === "unrepaired" ? " · not repaired" : ""}</span>
                </th>
                <td className="nrg-twofold__num">{signedDdg(evidence.foldxTemplateCheck.local, unit).replace(/ (kcal|kJ)\/mol$/, "")}</td>
              </tr>
              <tr>
                <th scope="row">
                  ProtVar FoldX
                  <span className="nrg-twofold__sub">{evidence.foldxTemplateCheck.protvarTemplate} · precomputed</span>
                </th>
                <td className="nrg-twofold__num">{signedDdg(evidence.foldxTemplateCheck.protvar, unit).replace(/ (kcal|kJ)\/mol$/, "")}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Difference (ProtVar − local)</th>
                <td className="nrg-twofold__num">{signedDdg(evidence.foldxTemplateCheck.delta, unit).replace(/ (kcal|kJ)\/mol$/, "")}</td>
              </tr>
            </tfoot>
          </table>
          <p className="nrg-twofold-reading" data-tone={evidence.foldxTemplateCheck.tone}>
            {evidence.foldxTemplateCheck.headline} {evidence.foldxTemplateCheck.detail}
          </p>
          <p className="nrg-step__sub">Cross-check only. One FoldX value is counted ({unit}); the {markText(FOLDX_TEMPLATE_DIFFERENCE_KCAL, unit, false)} gap mark is this app's, near FoldX's reported error.</p>
        </section>
      )}
      <details className="nrg-lineage" open={!selected || undefined}>
        <summary>How the overall reading was reached</summary>
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
            {structure?.repair && !evidence.foldxStandIn && <span className="nrg-step__sub">FoldX template: {structure.repair.toLowerCase()}</span>}
            {evidence.foldxStandIn && (
              <span className="nrg-step__sub">FoldX value: ProtVar precomputed{evidence.foldxStandIn.model ? ` on ${evidence.foldxStandIn.model}` : ""}; no local value</span>
            )}
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
                  : !r.counted ? "Not counted" : past ? "Past mark" : "Below";
              return (
                <tr key={r.key} className="nrg-cut" data-active={past || undefined} data-muted={r.ddg === null || !r.counted || undefined}>
                  <th scope="row" className="nrg-cut__name">{r.name}</th>
                  <td className="nrg-cuts__num nrg-cut__rule">≥ {markText(r.strongMark, unit)}</td>
                  <td className="nrg-cuts__num nrg-cut__here">{r.ddg !== null ? signedDdg(r.ddg, unit).replace(/ (kcal|kJ)\/mol$/, "") : "–"}</td>
                  <td className="nrg-cut__status">{status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="nrg-step__sub">
          FoldX publishes no threshold; {markText(1.5, unit)} and {markText(0.5, unit)} {unit} are this app&apos;s marks. The{" "}
          {markText(1, unit)} mark for the learned engines is local too. None is a clinical cut-point.
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
