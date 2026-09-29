import React from "react";
import { BookOpen, Database, GitBranch, Ruler } from "lucide-react";
import type { AnalysisResult } from "../../types";
import { THRESHOLDS } from "../../shared/thresholds";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { IPTM_BAND_LABEL, MULTIMER_SOURCES, buildMultimerEvidence, type IptmBand } from "../../shared/multimerEvidence";

/**
 * MultimerRail — the Evidence Lineage inspector for the Multimer assembly tab.
 *
 * The column says WHAT the assembly and interface readings are; the rail says HOW they were reached:
 * a five-step trace (curation → partner → model → interface → engine), the ipTM guidance with this
 * model's region marked, the method caveats a curator needs, and the sources the payload names.
 *
 * It replaced three tinted boxes that stated "ipTM ≥ 0.80 indicates high-confidence subunit interface
 * geometry" without a source, a "heavy-atom distance ≤ 4.5 Å" the code never applied, and hard-coded
 * "Tier 1 · JapanFold" / "Swiss-Prot Curated" labels whatever actually served the numbers.
 *
 * Built from the same `buildMultimerEvidence` object as the column.
 */

type StepState = "done" | "warn" | "idle";

function Step({ n, label, state = "done", children }: { n: number; label: string; state?: StepState; children: React.ReactNode }) {
  return (
    <li className="mlt-step" data-state={state}>
      <span className="mlt-step__n" aria-hidden="true">{n}</span>
      <div className="mlt-step__body">
        <span className="mlt-step__label">{label}</span>
        <div className="mlt-step__value">{children}</div>
      </div>
    </li>
  );
}

export function MultimerRail({ analysisResult }: { analysisResult: AnalysisResult }) {
  const data = (analysisResult as any).multimerData ?? null;
  const ev = buildMultimerEvidence({ result: analysisResult, data, isLoading: false, error: null });
  const { assembly: asm, model, experimental: exp } = ev;
  const C = THRESHOLDS.complexConfidence;

  const bands: Array<{ key: IptmBand; rule: string }> = [
    { key: "confident", rule: `> ${C.iptmConfident}` },
    { key: "grey", rule: `${C.iptmLow} to ${C.iptmConfident}` },
    { key: "low", rule: `< ${C.iptmLow}` },
  ];

  const sources: Array<[string, string]> = [];
  if (ev.uniprotId) sources.push(["Assembly", `UniProtKB ${ev.uniprotId} · SUBUNIT`]);
  if (model.provenance && model.state === "built") sources.push(["Complex model", model.provenance]);
  if (model.state === "built" && ev.chains.length) sources.push(["Chains", ev.chains.map(c => `${c.id} ${c.accession}`).join(", ")]);
  if (exp.state === "ok" || exp.state === "none") sources.push(["Solved interfaces", "PDBe-KB"]);

  const heteromer = asm.kind === "heteromer";

  return (
    <div className="mlt-rail" data-testid="multimer-rail">
      <section className="mlt-rsec" aria-labelledby="mlt-rail-trace">
        <h3 className="eyebrow" id="mlt-rail-trace">
          <GitBranch className="w-3.5 h-3.5" />
          Rule trace
        </h3>
        <ol className="mlt-steps" data-testid="multimer-rule-trace">
          <Step n={1} label="Curation" state={asm.subunitText ? "done" : "idle"}>
            <span>{asm.subunitText ? `SUBUNIT states: ${asm.label.toLowerCase()}` : "No SUBUNIT record"}</span>
            <span className="mlt-step__sub">{asm.subunitText ? "The first assembly named in the record decides." : "Read as not stated, never as a monomer."}</span>
          </Step>
          <Step n={2} label="Partner" state={heteromer ? (asm.partners.length === 1 ? "done" : "warn") : "idle"}>
            <span>
              {heteromer
                ? asm.partners.length
                  ? asm.partners.map(p => `${p.gene} ${p.accession}`).join(", ")
                  : "Not resolved"
                : asm.kind === "homomer"
                ? "Identical copies of this protein"
                : "Not needed"}
            </span>
            {heteromer && (
              <span className="mlt-step__sub">A symbol in the SUBUNIT sentence, matched to UniProt&apos;s curated interactions or a reviewed human entry.</span>
            )}
          </Step>
          <Step n={3} label="Complex model" state={model.state === "built" ? "done" : model.state === "failed" ? "warn" : "idle"}>
            <span>
              {model.state === "built"
                ? `Built · ${ev.chains.length} chains · ipTM ${model.iptm !== null ? model.iptm.toFixed(2) : "not reported"}`
                : model.stateLabel ?? ENGINE_STATE_LABELS["no-result"]}
            </span>
            {model.state !== "built" && model.reason && <span className="mlt-step__sub">{model.reason}</span>}
          </Step>
          <Step n={4} label="Interface" state={ev.interface.verdict === "not-measured" ? "idle" : "done"}>
            <span>{ev.interface.label}</span>
            <span className="mlt-step__sub">
              {ev.interface.source}. The variant residue itself must be in a contact; sequence neighbours do not count.
            </span>
          </Step>
          <Step n={5} label="Engine record">
            <span>None</span>
            <span className="mlt-step__sub">No ACMG criterion reads this tab.</span>
          </Step>
        </ol>
      </section>

      <section className="mlt-rsec" aria-labelledby="mlt-rail-cuts">
        <h3 className="eyebrow" id="mlt-rail-cuts">
          <Ruler className="w-3.5 h-3.5" />
          ipTM guidance · AlphaFold-Multimer
        </h3>
        <ul className="mlt-cuts" data-testid="iptm-bands">
          {bands.map(b => {
            const active = model.state === "built" && model.band === b.key;
            return (
              <li key={b.key} className="mlt-cut" data-active={active || undefined}>
                <span className="mlt-cut__label">{IPTM_BAND_LABEL[b.key]}</span>
                <span className="mlt-cut__rule">{b.rule}</span>
                {active && <span className="mlt-cut__here">this model</span>}
              </li>
            );
          })}
        </ul>
        <p className="mlt-rail__note">Authors&apos; guidance, not a calibration. Boltz-2 reports ipTM on the same scale and publishes no marks of its own.</p>
      </section>

      <section className="mlt-rsec" aria-labelledby="mlt-rail-notes">
        <h3 className="eyebrow" id="mlt-rail-notes">
          <BookOpen className="w-3.5 h-3.5" />
          Method
        </h3>
        <details className="mlt-notes" open>
          <summary>How to read this tab</summary>
          <ul>
            <li>
              Only chain A carries the variant; every other chain is wild type. For a homomer that is one mutant copy in the
              complex, closer to a heterozygous carrier than a homozygous one.
            </li>
            <li>
              A contact in the variant model shows the residue is at an interface. It does not show a contact is lost: no
              wild-type complex is modelled beside it, so nothing here measures disruption.
            </li>
            <li>
              ipTM scores all interfaces in the model together. A confident ipTM does not mean this residue&apos;s contacts are
              confident, and it says nothing about pathogenicity.
            </li>
            <li>
              Homomers up to four copies and heterodimers with one resolved partner are modelled. Larger or less defined
              assemblies are stated, not modelled.
            </li>
            <li>
              Solved-structure interfaces come from PDBe-KB and are observed, not predicted. They can include crystal packing
              in some entries, so the number of entries showing an interface is worth reading.
            </li>
          </ul>
        </details>
      </section>

      <section className="mlt-rsec" aria-labelledby="mlt-rail-sources">
        <h3 className="eyebrow" id="mlt-rail-sources">
          <Database className="w-3.5 h-3.5" />
          Sources
        </h3>
        {sources.length > 0 && (
          <dl className="mlt-kv">
            {sources.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <ul className="mlt-refs">
          {MULTIMER_SOURCES.map(src => (
            <li key={src.citation}>
              {src.citation}{" "}
              <a href={src.doi ? `https://doi.org/${src.doi}` : src.url} target="_blank" rel="noopener noreferrer">
                {src.doi ? `doi:${src.doi}` : "link"}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default MultimerRail;
