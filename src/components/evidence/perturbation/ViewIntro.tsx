import React from "react";
import type { PerturbationEvidence } from "../../../shared/perturbationEvidence";
import { MarkRuler } from "./Rulers";

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
      <div className="ptb-counts" role="img" aria-label={[caption, ...rows.map(r => r.label)].join(". ")}>
        {rows.map(r => (
          <div key={r.label} className="ptb-counts__row" data-role={r.variant ? "variant" : undefined}>
            <span className="ptb-counts__label">{r.label}</span>
            <span className="ptb-counts__track"><i style={{ width: `${(r.value / max) * 100}%` }} /></span>
          </div>
        ))}
      </div>
      <p>{note}</p>
    </figure>
  );
}

/**
 * The opening card of the Packing & geometry and Sequence embeddings views: what the view measures,
 * and for packing, the FoldX energy terms and the clash and contact counts drawn as figures.
 */
export function ViewIntro({ evidence, view }: { evidence: PerturbationEvidence; view: "records" | "embeddings" }) {
  const pos = evidence.residues.position;
  const clashes = evidence.physical.clashCounts;
  const contacts = evidence.physical.contactChange;
  const confidenceBand = evidence.physical.inputConfidence?.band;
  const lowConfidence = confidenceBand === "Low" || confidenceBand === "Very low";
  const energyTerms = evidence.physical.readings.filter(r => (r.key === "vdw" || r.key === "elec") && r.value !== null);
  const hasFigures = energyTerms.length > 0 || clashes !== null || contacts !== null;
  return (
    <section className="ptb-card ptb-view-intro">
      <h2>{view === 'records' ? 'What changed in the modelled protein structure?' : 'Where did the model’s numerical description of the protein change?'}</h2>
      <p>{view === 'records' ? 'FoldX replaces the amino acid in a structural model and adjusts nearby side chains. These measurements compare that model with its reference; they do not establish what happens in a living cell.' : 'An embedding is a list of numbers a model uses to represent an amino acid and its surroundings. Comparing the original and substituted sequences shows changes in that representation, not measured atomic movement or disease risk.'}</p>
      {view === 'records' && <>
        {(evidence.physical.method || evidence.physical.inputConfidence) && <p className="ptb-dim">
          {evidence.physical.method}
          {evidence.physical.method && evidence.physical.inputConfidence && " · "}
          {evidence.physical.inputConfidence && <>Input model confidence at {pos !== null ? `residue ${pos}` : "the site"}: pLDDT {evidence.physical.inputConfidence.plddt.toFixed(1)}{evidence.physical.inputConfidence.band && ` · ${evidence.physical.inputConfidence.band}`}</>}
        </p>}
        {lowConfidence && <p className="ptb-callout" data-tone="neutral">Geometry in a low-confidence region describes the model more than the protein.</p>}
      {hasFigures && <div className="ptb-energy-plots">{energyTerms.map(r => {
        const extent = Math.max(1, Math.ceil(Math.abs(r.value!)));
        return <figure key={r.key}><figcaption>{r.name}: <strong>{r.text} kcal/mol</strong></figcaption><MarkRuler value={r.value!} min={-extent} max={extent} marks={[{ value: 0, label: 'No change' }]} label={`${r.name}, mutant minus reference, kcal/mol`} format={n => n.toFixed(1)} /><p>Left of 0: this term is lower in the mutant model than in the reference; right of 0: higher. One energy component, not total stability.</p></figure>;
      })}
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
      </>}
    </section>
  );
}
