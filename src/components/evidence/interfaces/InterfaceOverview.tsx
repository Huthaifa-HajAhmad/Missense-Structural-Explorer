import type { InterfacesEvidence } from '../../../shared/interfacesEvidence';
import { interfaceSupportGroups } from '../../../shared/mechanismWorkspace';
import { useEvidenceWorkspace } from '../EvidenceWorkspace';

/** A small-multiple comparison of returned structure support, never an effect scale. */
export function InterfaceOverview({ ev }: { ev: InterfacesEvidence }) {
  const w = useEvidenceWorkspace('interfaces');
  const groups = interfaceSupportGroups(ev);
  if (!groups.length) return null;
  return <section className="mx-support" aria-label="Interface support by structural context">
    <header className="mx-figure-heading"><div><span className="mx-kicker">Structural evidence</span><h2>Is {ev.residueLabel} at a returned interface?</h2></div><p>Structures with the residue at the interface / structures returned for the pair. Markers show 0–100% support.</p></header>
    {groups.map(g => <div className="mx-support__group" key={g.kind} data-context={g.kind}>
      <h3>{g.label}</h3>
      {g.rows.map(p => <button type="button" className="mx-support__row" key={p.key}
        aria-pressed={w.selected === p.key} onClick={() => w.select(p.key)}>
        <span className="mx-support__name">{p.label}<small>{p.accession}{p.organism ? ` · ${p.organism}` : ''}</small></span>
        <span className="mx-support__scale" aria-hidden="true">{p.supportPercent !== null && <><span style={{ inlineSize: `${p.supportPercent}%` }} /><i style={{ insetInlineStart: `${p.supportPercent}%` }} /></>}</span>
        <span className="mx-support__count">{p.k}<small> / {p.n}</small></span>
      </button>)}
      {g.total > g.rows.length && <button type="button" className="viz-action" onClick={() => w.setView('records')}>View all {g.total} {g.label.toLowerCase()} in assemblies & models</button>}
    </div>)}
    <footer>Each row keeps its own denominator. Fibril and outside-assembly contacts do not contribute to the native-interface finding.</footer>
  </section>;
}
