import React, { useId } from 'react';
import { alignedProteinName, buildAlignmentEvidence, mismatchReason, RESIDUE_STATE_LABEL, speciesNames, type AlignmentResponse } from '../../shared/residueAlignment';
import { speciesLabel, speciesOrder } from '../../shared/modelOrganisms';
import { AMINO_ACID_1_TO_3_TITLE } from '../../shared/aminoAcids';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import type { ContextLoad } from '../../stores/slices/evidenceContextSlice';
import { AlignmentStrip, MeasureBar } from './ContextCharts';
import { alignmentKey, matchesQuery } from '../../shared/contextWorkspace';
import { InspectReadingButton, useEvidenceWorkspace } from './EvidenceWorkspace';
import { SpeciesRecordFilter } from './species/SpeciesRecordFilter';

/** One-letter codes: the walk compares them with the sequence. */
export type VariantResidue = { sequence: string | null | undefined; position: number | null; wildType: string; mutant: string };

export function ResidueAlignmentCard({ load, residue, onRetry }: { load?: ContextLoad<AlignmentResponse>; residue: VariantResidue; onRetry: () => void }) {
  const id = useId();
  const data = load?.data ?? null;
  const evidence = buildAlignmentEvidence(data, residue.sequence, residue.position, residue.wildType, residue.mutant);
  const rows = [...evidence.rows].sort((a, b) => speciesOrder(a.h.taxonId) - speciesOrder(b.h.taxonId) || a.h.geneId.localeCompare(b.h.geneId));
  const carriers = rows.filter(r => r.m.carriesVariantResidue);
  const { query } = useEvidenceWorkspace('species-models');
  // The summary sentence counts every aligned ortholog; search narrows only the table under it.
  const listed = rows.filter(({ h }) => matchesQuery(query, [speciesLabel(h.taxonId, h.species), h.taxonId, h.type, h.geneId, h.proteinId]));
  const label = `${AMINO_ACID_1_TO_3_TITLE[residue.wildType] ?? residue.wildType}${residue.position ?? ''}${AMINO_ACID_1_TO_3_TITLE[residue.mutant] ?? residue.mutant}`;
  return <section className="ctx-card" aria-labelledby={id} data-testid="residue-alignment-card">
    <div className="ctx-card__head"><h2 id={id}>Residue in orthologs</h2><span className="ctx-caption">Ensembl Compara · protein alignment</span></div>
    {!load || load.status === 'loading' ? <div className="ctx-card__body" role="status">{ENGINE_STATE_LABELS.running} — reading protein alignments.</div>
      : load.status === 'error' ? <div className="ctx-card__body ctx-notice" role="status"><span>{load.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — ${data?.message ?? 'alignments could not be read.'}`}</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></div>
      : data?.status === 'not-found' ? <p className="ctx-card__body">{data.message}</p>
      : !residue.position ? <p className="ctx-card__body">This variant has no protein position, so there is no residue to map.</p>
      : evidence.mismatchCause ? <div className="ctx-card__body sm-statement" role="status"><p className="sm-statement__title">Site not placed</p><p className="ctx-prose">{mismatchReason(evidence.mismatchCause, data?.sourceProteinId)}</p></div>
      : !rows.length ? <p className="ctx-card__body">Ensembl returned no ortholog alignment for the covered organisms.</p>
      : evidence.ready && <>
        <div className="ctx-card__body sm-alignment-summary">
          {data?.message && <p className="ctx-caption" role="note">{data.message}</p>}
          {evidence.bridge && <p className="ctx-caption" role="note">Ensembl aligns <span className="ctx-mono">{alignedProteinName(data?.sourceProteinId)}</span> ({evidence.bridge.sourceLength} residues), another isoform than the {evidence.bridge.appLength}-residue sequence this analysis used. The site was placed as its residue {evidence.bridge.sourcePosition}, because the 21 residues around it occur exactly once there.</p>}
          <p className="ctx-prose">Residue <span className="ctx-mono">{label}</span> is the same amino acid in {evidence.oneToOne.length > 0 && evidence.oneToOne.length < rows.length
            ? <><strong>{evidence.identicalOneToOne} of {evidence.oneToOne.length}</strong> one-to-one orthologs and in {evidence.identical - evidence.identicalOneToOne} of {rows.length - evidence.oneToOne.length} records from many-to-many gene families.</>
            : <><strong>{evidence.identical} of {rows.length}</strong> aligned orthologs.</>}
            {carriers.length > 0 && <> The substituted residue <span className="ctx-mono">{AMINO_ACID_1_TO_3_TITLE[residue.mutant] ?? residue.mutant}</span> is the normal residue in {speciesNames(carriers).join(', ')}; that shows it exists at this site in another species, not that it is tolerated in human.</>}</p>
        </div>
        <SpeciesRecordFilter shown={listed.length} total={rows.length} noun="aligned orthologs" placeholder="Species, taxon or gene ID" />
        {!listed.length ? <p className="ctx-card__body">No aligned ortholog matches this search.</p> : <div className="ctx-table-wrap" tabIndex={0} role="region" aria-label="Residue aligned in each ortholog"><table className="ctx-table">
          <caption className="ctx-sr-only">Gapped alignment around the variant. The variant column is outlined; differing neighbours are underlined.</caption>
          <thead><tr><th scope="col">Organism</th><th scope="col">At the variant site</th><th scope="col">Alignment (±7)</th><th scope="col">Human residues identical</th></tr></thead>
          <tbody>{listed.map(({ h, m }) => <tr key={`${h.geneId}:${h.proteinId}`}>
            <th scope="row"><InspectReadingButton tab="species-models" readingKey={alignmentKey(h.taxonId, h.geneId, h.proteinId)}>{speciesLabel(h.taxonId, h.species)}</InspectReadingButton><span className="ctx-caption ctx-block">{h.type} · <span className="ctx-mono">{h.geneId}</span></span></th>
            <td>{RESIDUE_STATE_LABEL[m.state]}{m.targetResidue && <span className="ctx-caption ctx-block ctx-mono">{m.targetResidue}{m.targetPosition}</span>}</td>
            <td><AlignmentStrip mapping={m} /></td>
            <td className="ctx-num"><span className="ctx-mono">{h.humanIdentity === null ? '—' : `${h.humanIdentity.toFixed(0)}%`}</span><MeasureBar value={h.humanIdentity} max={100} label={`${h.humanIdentity ?? 'unknown'} percent of human residues identical`} /></td>
          </tr>)}</tbody>
        </table></div>}
      </>}
    <p className="ctx-card__foot">Walked column by column through the gapped alignment, never by residue number. Identity is the share of human residues matched in that ortholog, across the whole protein. Conservation is context only and casts no ACMG vote.</p>
  </section>;
}
