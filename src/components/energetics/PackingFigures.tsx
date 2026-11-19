import type { PackingEvidence } from "../../shared/packingEvidence";
import { MarkRuler } from "./MarkRuler";

/** Two counts on one shared axis from 0: the reference in ink, the mutant in clay. Each count is printed. */
function CountFigure({ caption, note, rows }: {
  caption: string;
  note: string;
  rows: { label: string; value: number; variant: boolean }[];
}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <figure>
      <figcaption>{caption}</figcaption>
      <div className="pkg-counts" role="img" aria-label={[caption, ...rows.map(r => r.label)].join(". ")}>
        {rows.map(r => (
          <div key={r.label} className="pkg-counts__row" data-role={r.variant ? "variant" : undefined}>
            <span className="pkg-counts__label">{r.label}</span>
            <span className="pkg-counts__track"><i style={{ width: `${(r.value / max) * 100}%` }} /></span>
          </div>
        ))}
      </div>
      <p>{note}</p>
    </figure>
  );
}

/** The two FoldX energy terms that came back, each on its own axis centred on no change. */
function EnergyFigures({ packing }: { packing: PackingEvidence }) {
  const terms = packing.readings.filter(r => (r.key === "vdw" || r.key === "elec") && r.value !== null);
  return <>{terms.map(r => {
    const extent = Math.max(1, Math.ceil(Math.abs(r.value!)));
    return (
      <figure key={r.key}>
        <figcaption>{r.name}: <strong>{r.text} kcal/mol</strong></figcaption>
        <MarkRuler value={r.value!} min={-extent} max={extent} marks={[{ value: 0, label: "No change" }]} label={`${r.name}, mutant minus reference, kcal/mol`} format={n => n.toFixed(1)} />
        <p>Left of 0: this term is lower in the mutant model than in the reference; right of 0: higher. One energy component, not total stability.</p>
      </figure>
    );
  })}</>;
}

/**
 * The opening card of the Packing & geometry view: what the view measures, how the mutant model was
 * built, and the FoldX energy terms and the clash and contact counts drawn as figures.
 */
export function PackingFigures({ packing, position }: { packing: PackingEvidence; position: number | null }) {
  const { clashCounts: clashes, contactChange: contacts, inputConfidence, method } = packing;
  const lowConfidence = inputConfidence?.band === "Low" || inputConfidence?.band === "Very low";
  const hasFigures = packing.readings.some(r => (r.key === "vdw" || r.key === "elec") && r.value !== null) || clashes !== null || contacts !== null;
  return (
    <section className="pkg-card pkg-view-intro">
      <h2>What changed in the modelled protein structure?</h2>
      <p>FoldX replaces the amino acid in a structural model and adjusts nearby side chains. These measurements compare that model with its reference; they do not establish what happens in a living cell.</p>
      {(method || inputConfidence) && <p className="pkg-dim">
        {method}
        {method && inputConfidence && " · "}
        {inputConfidence && <>Input model confidence at {position !== null ? `residue ${position}` : "the site"}: pLDDT {inputConfidence.plddt.toFixed(1)}{inputConfidence.band && ` · ${inputConfidence.band}`}</>}
      </p>}
      {lowConfidence && <p className="pkg-callout" data-tone="neutral">Geometry in a low-confidence region describes the model more than the protein.</p>}
      {hasFigures && <div className="pkg-energy-plots">
        <EnergyFigures packing={packing} />
        {clashes && <CountFigure
          caption={`Heavy-atom clashes: ${clashes.wt} → ${clashes.mut}`}
          note="Heavy-atom clashes counted in the reference and in the mutant model. A count does not weigh how severe each clash is."
          rows={[{ label: `Reference ${clashes.wt}`, value: clashes.wt, variant: false }, { label: `Mutant ${clashes.mut}`, value: clashes.mut, variant: true }]}
        />}
        {contacts && <CountFigure
          caption={`Residue contacts within 4 Å: −${contacts.lost} / +${contacts.gained}`}
          note="Residues with a heavy atom within 4 Å of the site (±1 neighbours excluded), lost and gained by the substitution. Counts only, not energies."
          rows={[{ label: `Lost ${contacts.lost}`, value: contacts.lost, variant: false }, { label: `Gained ${contacts.gained}`, value: contacts.gained, variant: true }]}
        />}
      </div>}
    </section>
  );
}
