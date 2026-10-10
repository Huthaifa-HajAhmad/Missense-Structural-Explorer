import type { ResidueContextEvidence } from '../../shared/residueContextEvidence';
import { PropertyDumbbell } from './residue/PropertyDumbbell';
import { ChartFrame } from '../charts/ChartFrame';
import { useEvidenceWorkspace } from './EvidenceWorkspace';

export function ResiduePropertyComparison({ model }: { model: ResidueContextEvidence }) {
  const w = useEvidenceWorkspace('structure');
  return <ChartFrame title="What changes in the side chain?"
    description="Compare the open reference marker with the filled variant marker. Each property keeps its own scale."
    summary={model.finding.headline} empty={model.properties?.length ? undefined : 'Residue properties are not available for this substitution.'}
    footer={<><span>Open marker: {model.pair.wildType} · Filled marker: {model.pair.mutant}</span><span>These are amino-acid properties, not measured effects on this protein. Select a row for its source and exact values.</span></>}>
    <div className="mol-properties">{model.properties?.map(r => <button key={r.key} type="button" className="mol-property" aria-pressed={w.selected === r.key}
      onClick={() => w.select(r.key)}>
      <span className="mol-property__name"><strong>{r.label}</strong><span>{r.plainChange}</span></span>
      <PropertyDumbbell row={r} wildType={model.pair.wildType} mutant={model.pair.mutant} />
      <span className="mol-property__values">{r.wildTypeNative ?? r.wildTypeValue} → {r.mutantNative ?? r.mutantValue}{r.unit ? ` ${r.unit}` : ''}</span>
    </button>)}</div>
    {model.backbone && <p className="mol-guide"><strong>{model.backbone.title}</strong> {model.backbone.body}</p>}
  </ChartFrame>;
}
