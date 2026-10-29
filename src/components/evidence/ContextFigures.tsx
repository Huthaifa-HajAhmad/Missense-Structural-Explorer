import { ChartFrame } from '../charts/ChartFrame';
import { speciesCoverage, type ContextReading } from '../../shared/contextWorkspace';
import { useEvidenceWorkspace } from './EvidenceWorkspace';

/** Counts describe source records, never a combined evidence strength or an ortholog ID join. */
export function SpeciesCoverage({ rows }: { rows: ContextReading[] }) {
  const w = useEvidenceWorkspace('species-models');
  const model = speciesCoverage(rows);
  const expanded = w.expanded.includes('coverage-species');
  const visible = expanded ? model : model.slice(0, 8);
  const groups = [{ id: 'orthologs', label: 'Alliance orthologs' }, { id: 'alignment', label: 'Ensembl alignments' }, { id: 'phenotypes', label: 'Phenotype records' }] as const;
  return <ChartFrame title="Which species have records to explore?" description="Compare coverage across sources. Counts describe returned records, not independent experiments or model suitability."
    summary={`${model.length} species have returned source records. Provider gene identifiers remain separate.`}
    empty={model.length ? undefined : 'No species records are available to compare. Check the source view below for its status and recovery action.'}
    footer={<span>A dash means no displayed record in that source, not biological absence. Choose a count to inspect that species and source.</span>}>
    {model.length > 0 && <div className="cx-table-scroll" role="region" aria-label="Species source coverage" tabIndex={0}><table className="cx-coverage-table">
      <thead><tr><th scope="col">Species</th>{groups.map(g => <th scope="col" key={g.id}>{g.label}</th>)}</tr></thead>
      <tbody>{visible.map(s => <tr key={s.taxon}><th scope="row">{s.label}<small>Taxon {s.taxon}</small></th>{groups.map(g => <td key={g.id}>
        {s.counts[g.id] ? <button type="button" aria-label={`${s.label}: ${s.counts[g.id]} ${g.label}`} onClick={() => w.setOptions({ section: g.id, query: s.taxon, relevantOnly: false })}>
          <span className="cx-coverage-dot" aria-hidden="true" /><strong>{s.counts[g.id]}</strong><span className="sr-only"> records</span>
        </button> : <span aria-label="No displayed records">—</span>}
      </td>)}</tr>)}</tbody>
    </table></div>}
    {model.length > 8 && <div className="evw-figure-scope"><span>{visible.length} of {model.length} species</span><button type="button" className="viz-action" aria-expanded={expanded} onClick={() => w.toggleGroup('coverage-species')}>{expanded ? 'Show first 8' : `Show all ${model.length} species`}</button></div>}
  </ChartFrame>;
}

export function AssertionMatrix({ rows, levels, selected, onSelect }: { rows: ContextReading[]; levels: string[]; selected: string | null; onSelect: (key: string) => void }) {
  return <ChartFrame title="Where do the submitted assertions differ?" description="Each row is one submission for the selected disease and inheritance. Select a submitter or category to inspect the original assertion."
    summary={`${rows.length} displayed submissions. Categories are not a numeric scale or independent votes.`}
    footer={<span>A dash means no submission in that category.</span>}>
    <div className="cx-table-scroll" role="region" aria-label="Submitted validity assertion matrix" tabIndex={0}><table className="cx-table cx-matrix">
      <thead><tr><th scope="col">Submitter</th>{levels.map(level => <th scope="col" key={level}>{level}</th>)}<th scope="col">Evaluated</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.key} data-selected={selected === r.key || undefined}><th scope="row"><button type="button" className="evw-reading-button" aria-pressed={selected === r.key} onClick={() => onSelect(r.key)}>{r.name}</button></th>{levels.map(level => <td key={level}>{r.valueText === level ? <button type="button" className="cx-assertion" aria-label={`${r.name}: ${level}`} aria-pressed={selected === r.key} onClick={() => onSelect(r.key)}><span aria-hidden="true">●</span><span className="sr-only">{level}</span></button> : <><span aria-hidden="true">—</span><span className="sr-only">No assertion in this category</span></>}</td>)}<td>{r.facts.find(f => f.label === 'Evaluated')?.value}</td></tr>)}</tbody>
    </table></div>
  </ChartFrame>;
}
