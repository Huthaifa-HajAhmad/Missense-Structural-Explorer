import type { ContextReading } from '../../../shared/contextWorkspace';
import { InspectReadingButton } from '../EvidenceWorkspace';

/** Source metadata belongs once per source; only record-specific facts belong in rows. */
export function ExpressionRecords({ rows, selected, samplingOnly = false }: { rows: ContextReading[]; selected: string | null; samplingOnly?: boolean }) {
  const first = rows[0];
  const pediatric = first?.group === 'developmental';
  const release = first?.facts?.find(f => f.label === 'Release')?.value;
  return <div className="cx-table-scroll xp-record-table" role="region" aria-label="Exact source readings" tabIndex={0}>
    <table className="cx-table">
      <caption>{first?.source ?? (pediatric ? 'dGTEx' : 'GTEx')} · {pediatric ? 'Pediatric RNA' : 'Adult RNA'}{release ? ` · ${release}` : ''}. TPM: transcripts per million.</caption>
      <thead><tr><th scope="col">Tissue / cell population</th>{pediatric && <th scope="col">Sampled age cohort</th>}{!samplingOnly && <th scope="col">Median TPM</th>}<th scope="col">RNA samples</th>{pediatric && <th scope="col">Donors</th>}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.key} data-selected={selected === r.key || undefined}>
        <th scope="row"><InspectReadingButton tab="expression-models" readingKey={r.key}>{r.name}</InspectReadingButton></th>
        {pediatric && <td>{r.description}</td>}
        {!samplingOnly && <td>{r.value === null ? 'No gene reading' : r.value}</td>}
        <td>{r.facts?.find(f => f.label === 'RNA samples')?.value ?? 'Not reported'}</td>
        {pediatric && <td>{r.facts?.find(f => f.label === 'Donors')?.value ?? 'Not reported'}</td>}
      </tr>)}</tbody>
    </table>
  </div>;
}
