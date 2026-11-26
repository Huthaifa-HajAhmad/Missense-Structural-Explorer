import type { ReactNode } from "react";
import { Boxes, Download } from "lucide-react";
import { ENGINE_STATE_LABELS } from "../../../shared/engineStatus";
import type { InterfacesEvidence, ObservedView } from "../../../shared/interfacesEvidence";
import { downloadBlob } from "../../../lib/download";
import { AssemblyDiagram } from "./AssemblyDiagram";
import { ComplexModelRows } from "./ComplexModelRows";
import { SolvedRows } from "./SolvedRows";
import { StateCells } from "./ui";

/**
 * Assembly: the SUBUNIT statements, the solved structures per partner, and the complex model. The
 * composition schematic heads this section, beside the records it summarises, rather than the finding.
 */
interface RecordsProps {
  ev: InterfacesEvidence;
  variantKey: string;
  variant: string;
  complexPdb: string | null;
  lit: string | null;
  onLit: (key: string | null) => void;
  show3d: ((p: ObservedView) => void) | null;
  onRequestModel: () => void;
  children?: ReactNode;
}

function CurationRows({ ev }: { ev: InterfacesEvidence }) {
  const a = ev.assembly;
  return (
    <tbody data-group="curation">
      <tr className="ifc-group">
        <th colSpan={4} scope="rowgroup">
          <span className="ifc-group__inner">
            <span className="ifc-group__title">Curated assembly</span>
            <span className="ifc-group__meta">UniProtKB{ev.uniprotId ? ` ${ev.uniprotId}` : ""} SUBUNIT</span>
          </span>
        </th>
      </tr>
      {a.statements.length ? a.statements.map((s, i) => (
        <tr key={i} data-rule-input={i === 0 || undefined}>
          <th scope="row" className="ifc-subject">
            <span className="ifc-subject__name">{s.label}</span>
            <span className="ifc-subject__note">{i === 0 ? "decides the assembly" : "also stated"}</span>
          </th>
          <td className="ifc-quote" colSpan={2}>
            &ldquo;{s.sentence}&rdquo;
            {s.family && <span className="ifc-subject__note">Names a family (the {s.family}), not a gene: not resolved here. See STRING&apos;s physical partners.</span>}
          </td>
          <td className="ifc-status"><span className="ev-tier" data-tone={s.qualifier ? "muted" : "neutral"}>{s.qualifier ?? "Stated"}</span></td>
        </tr>
      )) : (
        <tr>
          <th scope="row" className="ifc-subject">
            <span className="ifc-subject__name">SUBUNIT record</span>
            <span className="ifc-subject__note">curated assembly statement</span>
          </th>
          <StateCells
            label={ENGINE_STATE_LABELS["no-result"]}
            reason={a.subunitText ? `“${a.subunitText}” names no assembly.` : "UniProt has no SUBUNIT record for this protein. That is not evidence of a monomer."}
          />
        </tr>
      )}
    </tbody>
  );
}

export function AssemblyRecords({ ev, variantKey, variant, complexPdb, lit, onLit, show3d, onRequestModel, children }: RecordsProps) {
  const { model } = ev;
  return (
    <section className="ifc-section" aria-labelledby="ifc-assembly-title">
      <h2 className="eyebrow" id="ifc-assembly-title">
        <Boxes className="w-3.5 h-3.5" aria-hidden="true" />
        Assembly
      </h2>
      <figure className="ifc-card ifc-composition">
        <div className="mx-composition-head">
          <span className="mx-kicker">Assembly</span>
          <strong>{ev.assembly.label}</strong>
          {ev.assembly.qualifier && <span className="ev-tier" data-tone="muted">{ev.assembly.qualifier}</span>}
          <span className="mx-composition-caption">{model.state === "built" ? "modelled" : ev.observed.partners.length ? "solved" : ev.chains.length > 1 ? "as stated" : "single chain"}</span>
        </div>
        <AssemblyDiagram ev={ev} />
      </figure>
      <div className="ifc-card ifc-table-wrap">
        <table className="ifc-table" data-testid="assembly-readings">
          <thead>
            <tr>
              <th scope="col">Reading</th>
              <th scope="col" colSpan={2}>Detail</th>
              <th scope="col" className="ifc-status">Status</th>
            </tr>
          </thead>
          <CurationRows ev={ev} />
          <SolvedRows key={variantKey} ev={ev} lit={lit} onLit={onLit} show3d={show3d} />
          <ComplexModelRows ev={ev} onRequest={onRequestModel} />
        </table>
        <div className="ifc-foot">
          <span>Only chain A carries the variant; a contact in the variant model is not a contact lost. ipTM marks are AlphaFold-Multimer&apos;s guidance; Boltz-2 has none of its own.</span>
          {complexPdb && (
            <button type="button" className="ifc-link" onClick={() => downloadBlob(`${ev.gene}_${variant.replace(/[^A-Za-z0-9]+/g, "")}_complex.pdb`, "chemical/x-pdb", complexPdb)}>
              <Download className="w-3 h-3" aria-hidden="true" />
              Download model
            </button>
          )}
        </div>
        {children}
      </div>
    </section>
  );
}
