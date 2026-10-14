import type { InterfacesEvidence } from '../../../shared/interfacesEvidence';

/** Composition only: neither contact edges nor a spatial position can be inferred
 * from SUBUNIT text. The sequence and support figures carry measured contacts. */
export function AssemblyDiagram({ ev }: { ev: InterfacesEvidence }) {
  return <div className="mx-composition" role="group" aria-label={`${ev.assembly.label}: composition schematic, not molecular geometry`}>
    <div className="mx-composition__head"><span>Assembly composition</span><span>{ev.chains.length} shown</span></div>
    <div className="mx-composition__chains">
      {ev.chains.map((c, i) => <div className="mx-chain" key={`${c.id}-${i}`} data-variant={c.carriesVariant || undefined}>
        <span className="mx-chain__id">{c.id}</span>
        <span className="mx-chain__name">{c.label}<small>{c.carriesVariant ? ev.residueLabel + ' on this chain' : c.role === 'self' ? 'Additional copy' : 'Partner chain'}</small></span>
      </div>)}
    </div>
    <p>Composition schematic. Chain placement does not describe molecular geometry.</p>
  </div>;
}
