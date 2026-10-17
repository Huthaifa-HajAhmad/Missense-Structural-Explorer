import type { SplicingWorkspaceReading } from '../../../shared/splicingWorkspace';
import { useEvidenceWorkspace } from '../EvidenceWorkspace';

/** Exact channel details remain available even when a channel cannot be placed on the map. */
export function SplicingRecords({ rows }: { rows: SplicingWorkspaceReading[] }) {
  const workspace = useEvidenceWorkspace('splicing');
  return <section className="spl-section" aria-labelledby="spl-records-title">
    <h2 id="spl-records-title" className="eyebrow">Channel details</h2>
    <p className="spl-records-caption">Select a reading for its exact values and provenance. Channel offsets are measured from the variant. Rule inputs and context predictions are in Score scales.</p>
    <div className="spl-card spl-records-scroll" role="region" aria-label="Splicing channel details" tabIndex={0}>
      <table className="spl-records-table">
        <thead><tr><th scope="col">Reading</th><th scope="col">Exact value</th><th scope="col">Position or context</th></tr></thead>
        {['SpliceAI channels'].filter(group => rows.some(r => r.group === group)).map(group => <tbody key={group}>
          <tr className="spl-group"><th scope="rowgroup" colSpan={3}>{group}</th></tr>
          {rows.filter(r => r.group === group).map(r => <tr key={r.key} data-selected={workspace.selected === r.key || undefined} data-row-key={r.key}>
            <th scope="row"><button type="button" className="spl-record-button" aria-pressed={workspace.selected === r.key}
              onClick={() => workspace.select(r.key)}>{r.name}</button></th>
            <td className="spl-mono">{r.valueText}</td>
            <td>{r.channel ? <>{r.position}<span className="spl-records-note">{r.site}</span></> : r.description}</td>
          </tr>)}
        </tbody>)}
      </table>
    </div>
  </section>;
}
