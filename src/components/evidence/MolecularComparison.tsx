import type { ResidueContextEvidence } from '../../shared/residueContextEvidence';
import { RESIDUE_SCALE_DEFINITIONS } from '../../shared/residueScales';
import { PropertyDumbbell } from './residue/PropertyDumbbell';
import { ChartFrame } from '../charts/ChartFrame';
import { useEvidenceWorkspace } from './EvidenceWorkspace';

/**
 * The marker key sits with the figure's instructions, not under the last row: a reader meets it
 * before the first mark instead of after scrolling past every row. The ring key draws the same
 * coincident state the tracks draw, so the key and the marks cannot disagree.
 */
function MarkerKey({ wildType, mutant }: { wildType: string; mutant: string }) {
  return (
    <span className="rsx-legend mol-key" data-testid="residue-marker-key">
      <span><i className="rsx-key-wt" aria-hidden="true" />Open circle: {wildType}, reference</span>
      <span><i className="rsx-key-mut" aria-hidden="true" />Filled circle: {mutant}, variant</span>
      <span><i className="rsx-key-equal" aria-hidden="true" />Ring: the two values coincide</span>
    </span>
  );
}

export function ResiduePropertyComparison({ model }: { model: ResidueContextEvidence }) {
  const w = useEvidenceWorkspace('structure');
  return <ChartFrame title="What changes in the side chain?"
    description="Each row compares one amino-acid property on its own scale. Select a row to pin its source and reading in the inspector."
    legend={<MarkerKey wildType={model.pair.wildType} mutant={model.pair.mutant} />}
    summary={`${model.finding.headline} ${model.pair.wildType} is the open circle and ${model.pair.mutant} the filled one; a ring marks two values that coincide.`}
    empty={model.properties?.length ? undefined : 'Residue properties are not available for this substitution.'}
    footer={<span>These are amino-acid properties, not measured effects on this protein; select a row for its source and exact values.</span>}>
    <div className="mol-properties">{model.properties?.map(r => {
      const pinned = w.selected === r.key;
      const definitionId = `mol-property-${r.key}-definition`;
      return <button key={r.key} type="button" className="mol-property" aria-pressed={pinned}
        // The definition is a description, not part of the name: a row's name must not change when
        // it is pinned, and a name carrying a sentence is not a name.
        aria-label={`${r.label}, ${r.plainChange}`} aria-describedby={definitionId}
        onClick={() => w.select(r.key)}>
        <span className="mol-property__name">
          <span className="mol-property__heading">
            <strong>{r.label}</strong>
            {pinned && <small className="mol-property__pin" aria-hidden="true">Pinned in inspector</small>}
          </span>
          <span>{r.plainChange}</span>
          <small className="mol-property__definition" id={definitionId}>{RESIDUE_SCALE_DEFINITIONS[r.key]}</small>
        </span>
        <PropertyDumbbell row={r} wildType={model.pair.wildType} mutant={model.pair.mutant} />
        <span className="mol-property__values">{r.wildTypeNative ?? r.wildTypeValue} → {r.mutantNative ?? r.mutantValue}{r.unit ? ` ${r.unit}` : ''}</span>
      </button>;
    })}</div>
    {model.backbone && <p className="mol-guide" data-testid="backbone-caveat"><strong>{model.backbone.title}</strong> {model.backbone.body}</p>}
  </ChartFrame>;
}
