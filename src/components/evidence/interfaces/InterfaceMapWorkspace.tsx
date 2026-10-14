import type { InterfacesEvidence } from '../../../shared/interfacesEvidence';
import { interfaceMapView } from '../../../shared/mechanismWorkspace';
import { useEvidenceWorkspace } from '../EvidenceWorkspace';
import { InterfaceTrack } from './InterfaceTrack';

export function InterfaceMapWorkspace({ ev, lit, onLit, onOpen, numbering }: {
  ev: InterfacesEvidence; lit: string | null; onLit: (key: string | null) => void; onOpen: (key: string) => void; numbering: string;
}) {
  const w = useEvidenceWorkspace('interfaces');
  const v = interfaceMapView(ev, w.window === 'near', w.hidden);
  if (!w.enabled) return <InterfaceTrack ev={ev} lit={lit} onLit={onLit} onOpen={onOpen} />;
  return <>
    <header className="mx-map-heading"><div><span className="mx-kicker">Protein reference · {ev.uniprotId ?? 'unresolved'}</span><h3>Interface atlas</h3></div>
      <div className="mx-window" role="group" aria-label="Sequence window">
        <button type="button" aria-pressed={w.window !== 'near'} onClick={() => w.setOptions({ window: 'whole' })}>Whole protein</button>
        <button type="button" aria-pressed={w.window === 'near'} disabled={ev.position === null} onClick={() => w.setOptions({ window: 'near' })}>Around {ev.residueLabel}</button>
      </div>
    </header>
    <div className="mx-layers" role="group" aria-label="Interface map layers">{v.layers.map(l => <button key={l.id} type="button" aria-pressed={!w.hidden?.includes(l.id)} onClick={() => w.setOptions({ hidden: w.hidden?.includes(l.id) ? w.hidden.filter(id => id !== l.id) : [...(w.hidden ?? []), l.id] })}>{l.label}{" "}<span>{l.count}</span></button>)}</div>
    <p className="mx-map-reference">Residues {v.bounds.start}–{v.bounds.end} · bar height shows structural support · select a lane to inspect</p>
    {v.evidence.track.length ? <InterfaceTrack ev={v.evidence} bounds={v.bounds} lit={lit} onLit={onLit} onOpen={onOpen} inspectAllLanes />
      : <p className="mx-map-reference">{ev.track.length ? 'All map layers are hidden. Enable a layer above to explore its records.' : 'No interface or annotation records can be placed on this sequence.'}</p>}
    <details className="mx-reference-note"><summary>Residue numbering and reference</summary><p>{numbering}</p><p>The map window and layer controls change the display only. Source records and the inspector retain original, unclipped annotation bounds.</p></details>
  </>;
}
