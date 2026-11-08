import { Layers } from "lucide-react";
import { PinHeader } from "./PinHeader";
import { getEngine, type EnergyEngineId, type EnergyUnit } from "../../shared/engineStatus";
import {
  absenceText,
  markText,
  signedDdg,
  signedDdgNumber,
  ENERGETICS_CAVEAT_TEXT,
  ENERGETICS_GROUP_LABEL,
  FOLDX_TEMPLATE_DIFFERENCE_KCAL,
  type EnergeticsEvidence,
} from "../../shared/energeticsEvidence";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";

/** The structure a value rests on. ProtVar's FoldX always ran on ITS AlphaFold model, never on this run's template. */
function structureBasisText(
  key: EnergyEngineId,
  group: string,
  structure: EnergeticsEvidence["structure"],
  evidence: EnergeticsEvidence
): string {
  if (key === "protvar" || (key === "foldx" && evidence.foldxStandIn)) {
    const model = evidence.foldxStandIn?.model ?? evidence.foldxTemplateCheck?.protvarTemplate ?? null;
    return `AlphaFold DB model${model ? ` ${model}` : ""}, precomputed by EBI ProtVar; not this run's template.`;
  }
  if (group === "lookup") return "Precomputed table; may use a different structure from this run.";
  const id = structure?.pdbId ? ` · ${structure.pdbId}${structure.chainId ? `:${structure.chainId}` : ""}` : "";
  return `${structure?.label ?? "Not reported"}${id}`;
}

/** The pinned method: its value, call, structure basis and caveats, then FoldX on two templates when both exist. */
export function EnergeticsMethodInspector({
  evidence,
  unit,
  selectedEngine,
  onClearEngine,
  variant,
}: {
  evidence: EnergeticsEvidence;
  unit: EnergyUnit;
  selectedEngine: EnergyEngineId | null;
  onClearEngine?: () => void;
  /** The substitution being explained, shown in the "Substitution" row. */
  variant: { gene?: string; variant?: string } | undefined;
}) {
  const { structure } = evidence;
  const selected = evidence.readings.find(r => r.key === selectedEngine);
  return (
    <>
      <section className="nrg-selected-method" id={INSPECTOR_SECTIONS.stabilityMethod} tabIndex={-1} aria-labelledby="nrg-selected-title">
        <PinHeader eyebrow={selected ? 'Pinned reading' : 'Explore a reading'} onClear={selected ? onClearEngine : undefined} />
        <div className="nrg-selected-method__body">
        <span className="sr-only" role="status" aria-atomic="true">
          {selected ? `${selected.name} pinned${selected.ddg !== null ? ` · ${signedDdg(selected.ddg, unit)}` : ''}` : 'No method pinned yet'}
        </span>
        {/* With nothing pinned, the strip above already says what this card is for; the heading stays for screen readers. */}
        <h2 id="nrg-selected-title" className={selected ? undefined : 'sr-only'}>{selected?.name ?? 'Explore an estimate'}</h2>
        {selected ? <>
          <p>{selected.description}</p>
          <div className="nrg-selected-value">{signedDdg(selected.ddg, unit)}</div>
          <span className="ev-tier" data-tone={selected.callTone}>{selected.ddg === null ? selected.outcome.label : selected.callLabel}</span>
          <p>{selected.ddg === null ? absenceText(selected) : selected.counted ? 'Included in the overall agreement reading.' : 'Shown for reference; excluded from the overall agreement reading.'}</p>
          <dl>
            <div><dt>Substitution</dt><dd>{variant?.gene} {variant?.variant}</dd></div>
            <div><dt>Method family</dt><dd>{ENERGETICS_GROUP_LABEL[selected.group]}</dd></div>
            <div><dt>Structure basis</dt><dd>{structureBasisText(selected.key, selected.group, structure, evidence)}</dd></div>
            <div><dt>Sign convention</dt><dd>{getEngine(selected.key).nativeSign === 'negative-destabilizing' ? 'Provider sign reversed for comparison; positive here means less stable folding.' : 'Positive means less stable folding.'}</dd></div>
            <div><dt>Local destabilising mark</dt><dd>{markText(selected.strongMark, unit)} {unit}. App-defined, not a clinical cut-point.</dd></div>
          </dl>
          {selected.note && <p>{selected.note}</p>}
          {selected.caveats.map(c => <p className="nrg-selected-caveat" key={c}>{ENERGETICS_CAVEAT_TEXT[c].detail}</p>)}
        </> : <p>Select a point in Comparison or a method in Engine records to see its value, assumptions and limitations here.</p>}
        </div>
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
                <td className="nrg-twofold__num">{signedDdgNumber(evidence.foldxTemplateCheck.local, unit)}</td>
              </tr>
              <tr>
                <th scope="row">
                  ProtVar FoldX
                  <span className="nrg-twofold__sub">{evidence.foldxTemplateCheck.protvarTemplate} · precomputed</span>
                </th>
                <td className="nrg-twofold__num">{signedDdgNumber(evidence.foldxTemplateCheck.protvar, unit)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Difference (ProtVar − local)</th>
                <td className="nrg-twofold__num">{signedDdgNumber(evidence.foldxTemplateCheck.delta, unit)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="nrg-twofold-reading" data-tone={evidence.foldxTemplateCheck.tone}>
            {evidence.foldxTemplateCheck.headline} {evidence.foldxTemplateCheck.detail}
          </p>
          <p className="nrg-step__sub">Cross-check only. One FoldX value is counted ({unit}); the {markText(FOLDX_TEMPLATE_DIFFERENCE_KCAL, unit, false)} gap mark is this app's, near FoldX's reported error.</p>
        </section>
      )}
    </>
  );
}
