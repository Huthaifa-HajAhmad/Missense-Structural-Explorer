import { supportText, type ChainView, type InterfacesEvidence, type ObservedView } from '../../../shared/interfacesEvidence';

/**
 * The chains, and a connector between the variant's chain and another chain only where PDBe-KB measured a
 * native interface for that pair.
 *
 * SUBUNIT text ("Heterodimer with CCS") says which chains exist, not where they touch, so the composition
 * draws no contact the solved structures did not show. A homomer's partner is the other copy; a
 * heteromer's is matched by accession, else by gene. Fibril stacking is never an edge: SOD1 Ala5 touches
 * the fibril in 4 of 15 structures, and the composition used to draw that stack as the dimer. A chain with
 * no measured pair gets no edge, and the note says the composition comes from SUBUNIT text alone.
 */

/** The native, measured interface between `chain` and the variant's chain, when PDBe-KB has one. */
function measuredPair(ev: InterfacesEvidence, chain: ChainView): ObservedView | null {
  const native = ev.observed.partners;
  if (chain.role === 'self') return native.find(p => p.homomeric) ?? null;
  const accession = chain.accession.toUpperCase();
  return native.find(p => !p.homomeric && p.accession.toUpperCase() === accession)
    ?? native.find(p => !p.homomeric && p.gene?.toUpperCase() === chain.label.toUpperCase())
    ?? null;
}

export function AssemblyDiagram({ ev }: { ev: InterfacesEvidence }) {
  const variant = ev.chains.find(c => c.carriesVariant) ?? ev.chains[0];
  const others = ev.chains.filter(c => c !== variant);
  const edges = others.flatMap(chain => {
    const pair = measuredPair(ev, chain);
    return pair ? [{ chain, pair }] : [];
  });
  return <div className="mx-composition" role="group" aria-label={`${ev.assembly.label}: composition schematic, not molecular geometry`}>
    <div className="mx-composition__chains">
      {ev.chains.map((c, i) => <div className="mx-chain" key={`${c.id}-${i}`} data-variant={c.carriesVariant || undefined}>
        <span className="mx-chain__id">{c.id}</span>
        <span className="mx-chain__name">{c.label}<small>{c.carriesVariant ? ev.residueLabel + ' on this chain' : c.role === 'self' ? 'Additional copy' : 'Partner chain'}</small></span>
      </div>)}
    </div>
    {edges.length > 0 && <ul className="mx-edges" aria-label="Measured interfaces between chains">
      {edges.map(({ chain, pair }) => <li key={chain.id} className="mx-edge" data-lit={pair.k > 0 || undefined}>
        <span className="mx-edge__ends"><span>{variant.id}</span><span className="mx-edge__line" aria-hidden="true" /><span>{chain.id}</span></span>
        <span className="mx-edge__label">{pair.k > 0
          ? `${ev.residueLabel} at it: ${supportText(pair.k, pair.n)}`
          : `${ev.residueLabel} not at it, in ${pair.n === 1 ? 'the one solved structure' : `${pair.n} solved structures`}`}</span>
      </li>)}
    </ul>}
    {edges.length < others.length && <p>No solved structure of this pair: composition from UniProt SUBUNIT text.</p>}
    <p>Composition schematic. Chain placement does not describe molecular geometry.</p>
  </div>;
}
