import React, { useId } from 'react';
import { ExternalLink } from 'lucide-react';
import type { DiseaseFrame, GeneDiseaseResponse } from '../../shared/diseaseFrame';
import { scopeMechanismRecords, type MechanismRecord } from '../../shared/mechanismContext';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
function Records({ records }: { records: MechanismRecord[] }) {
  return <div className="ctx-table-wrap" tabIndex={0} role="region" aria-label="Gene2Phenotype mechanism records"><table className="ctx-table">
    <thead><tr><th scope="col">Mechanism</th><th scope="col">Support</th><th scope="col">Allelic requirement</th><th scope="col">Source</th></tr></thead>
    <tbody>{records.map(r => <tr key={r.id}>
      <th scope="row">{r.mechanism || 'Not reported'}<span className="ctx-caption ctx-block">G2P relationship confidence: {r.confidence || 'Not reported'}</span></th>
      <td>{r.support || 'Not reported'}</td><td><span className="ctx-mono">{r.allelicRequirement}</span>{r.modifier && <span className="ctx-caption ctx-block">Modifier: {r.modifier}</span>}</td>
      <td><a className="ctx-link" href={`https://www.ebi.ac.uk/gene2phenotype/lgd/${r.id}`} target="_blank" rel="noreferrer">{r.id}<ExternalLink size={12} aria-hidden="true" /></a>
        <span className="ctx-caption ctx-block">Reviewed {r.reviewedAt?.slice(0, 10) ?? 'date not reported'}</span>
        <details className="ctx-details"><summary>Record details</summary><p className="ctx-caption">{r.diseaseLabel} · {r.diseaseId ?? 'No MONDO ID'}</p><p className="ctx-caption">Consequence: {r.consequence || 'Not reported'}. Variant types: {r.variantTypes || 'Not reported'}.</p>
          {r.categorisation && <p className="ctx-caption">Categorisation: {r.categorisation}</p>}{r.evidence && <p className="ctx-caption">Mechanism evidence: {r.evidence}</p>}
          {!!r.publications.length && <p className="ctx-caption">Publications: {r.publications.map((pmid, i) => <React.Fragment key={pmid}>{i > 0 && ', '}<a className="ctx-link ctx-mono" href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`} target="_blank" rel="noreferrer">{pmid}</a></React.Fragment>)}</p>}
        </details>
      </td>
    </tr>)}</tbody>
  </table></div>;
}
export function MechanismContextCard({ frame, context, onRetry }: {
  frame: DiseaseFrame; context: GeneDiseaseResponse['mechanismContext']; onRetry: () => void;
}) {
  const scope = scopeMechanismRecords(context?.records ?? [], frame);
  const id = useId();
  return <section className="ctx-card" aria-labelledby={id}><div className="ctx-card__head"><h2 id={id}>Disease mechanism</h2><span className="ctx-caption">Gene2Phenotype · source records</span></div>
    {!context || context.status === 'not-installed' ? <div className="ctx-card__body" role="status"><p>{ENGINE_STATE_LABELS['not-installed']} — a Gene2Phenotype snapshot is not installed.</p><button type="button" className="ctx-button" onClick={onRetry}>Check again</button></div>
      : context.status === 'error' ? <div className="ctx-card__body ctx-notice" role="status"><span>{ENGINE_STATE_LABELS['upstream-error']} — mechanism records could not be read.</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></div>
      : <>
        {!!scope.matching.length ? <>{scope.matching.some(r => r.modifier) && <p className="ctx-card__body ctx-notice">Source modifiers restrict some records to particular allelic or variant contexts. Disease identity and inheritance alone do not establish applicability to this variant.</p>}<Records records={scope.matching} /></> : <p className="ctx-card__body">No mechanism record has this exact gene, MONDO disease and a corresponding supported allelic requirement in the installed snapshot. This does not establish an unknown biological mechanism.</p>}
        {!!scope.unresolvedScope.length && <details className="ctx-details ctx-details--table"><summary>Same disease, unresolved allelic scope ({scope.unresolvedScope.length})</summary><p className="ctx-card__body">These records are not assigned to the selected inheritance. Review their allelic requirements and modifiers directly.</p><Records records={scope.unresolvedScope} /></details>}
        <p className="ctx-card__foot">Exact gene and MONDO IDs only. The local display mapping compares autosomal dominant ↔ monoallelic_autosomal and autosomal recessive ↔ biallelic_autosomal. Modifiers remain as submitted and are not resolved for this variant. Other allelic scopes remain separate. No broader disease or name-based joins.</p>
      </>}
    <p className="ctx-card__foot">Support and confidence are separate source fields. “Evidence” does not establish a validated functional assay for this variant; “inferred” stays inferred. Mechanism does not supply an ACMG vote.</p>
  </section>;
}
