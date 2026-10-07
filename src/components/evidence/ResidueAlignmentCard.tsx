import React, { useId } from 'react';
import { buildAlignmentEvidence, RESIDUE_STATE_LABEL, type AlignmentResponse } from '../../shared/residueAlignment';
import { speciesLabel, speciesOrder } from '../../shared/modelOrganisms';
import { AMINO_ACID_1_TO_3_TITLE } from '../../shared/aminoAcids';
import { ENGINE_STATE_LABELS } from '../../shared/engineStatus';
import type { ContextLoad } from '../../stores/slices/evidenceContextSlice';
import { AlignmentStrip, MeasureBar } from './ContextCharts';

/** One-letter codes: the walk compares them with the sequence. */
export type VariantResidue = { sequence: string | null | undefined; position: number | null; wildType: string; mutant: string };

export function ResidueAlignmentCard({ load, residue, onRetry }: { load?: ContextLoad<AlignmentResponse>; residue: VariantResidue; onRetry: () => void }) {
  const id = useId();
  const data = load?.data ?? null;
  const evidence = buildAlignmentEvidence(data, residue.sequence, residue.position, residue.wildType, residue.mutant);
  const rows = [...evidence.rows].sort((a, b) => speciesOrder(a.h.taxonId) - speciesOrder(b.h.taxonId) || a.h.geneId.localeCompare(b.h.geneId));
  const carriers = rows.filter(r => r.m.carriesVariantResidue);
  const label = `${AMINO_ACID_1_TO_3_TITLE[residue.wildType] ?? residue.wildType}${residue.position ?? ''}${AMINO_ACID_1_TO_3_TITLE[residue.mutant] ?? residue.mutant}`;
  return <section className="ctx-card" aria-labelledby={id} data-testid="residue-alignment-card">
    <div className="ctx-card__head"><h2 id={id}>Residue in orthologs</h2><span className="ctx-caption">Ensembl Compara · protein alignment</span></div>
    {!load || load.status === 'loading' ? <div className="ctx-card__body" role="status">{ENGINE_STATE_LABELS.running} — reading protein alignments.</div>
      : load.status === 'error' ? <div className="ctx-card__body ctx-notice" role="status"><span>{load.error ?? `${ENGINE_STATE_LABELS['upstream-error']} — ${data?.message ?? 'alignments could not be read.'}`}</span><button type="button" className="ctx-button" onClick={onRetry}>Try again</button></div>
      : data?.status === 'not-found' ? <p className="ctx-card__body">{data.message}</p>
      : !residue.position ? <p className="ctx-card__body">This variant has no protein position, so there is no residue to map.</p>
      : evidence.mismatched ? <p className="ctx-card__body ctx-notice" role="status">Ensembl aligns protein {data?.sourceProteinId}, which is not the sequence this analysis used. No residue is mapped, because positions can shift between isoforms.</p>
      : !rows.length ? <p className="ctx-card__body">Ensembl returned no ortholog alignment for the covered organisms.</p>
      : evidence.ready && <>
        <div className="ctx-card__body">
          <p className="ctx-prose">Residue <span className="ctx-mono">{label}</span> is the same amino acid in <strong>{evidence.identical} of {rows.length}</strong> aligned orthologs.
            {carriers.length > 0 && <> The substituted residue <span className="ctx-mono">{AMINO_ACID_1_TO_3_TITLE[residue.mutant] ?? residue.mutant}</span> is the normal residue in {carriers.map(c => speciesLabel(c.h.taxonId, c.h.species)).join(', ')}; that shows it exists at this site in another species, not that it is tolerated in human.</>}</p>
        </div>
        <div className="ctx-table-wrap" tabIndex={0} role="region" aria-label="Residue aligned in each ortholog"><table className="ctx-table">
          <caption className="ctx-sr-only">Gapped alignment around the variant. The variant column is outlined; differing neighbours are underlined.</caption>
          <thead><tr><th scope="col">Organism</th><th scope="col">At the variant site</th><th scope="col">Alignment (±7)</th><th scope="col">Human residues identical</th></tr></thead>
          <tbody>{rows.map(({ h, m }) => <tr key={`${h.geneId}:${h.proteinId}`}>
            <th scope="row">{speciesLabel(h.taxonId, h.species)}<span className="ctx-caption ctx-block">{h.type} · <span className="ctx-mono">{h.geneId}</span></span></th>
            <td>{RESIDUE_STATE_LABEL[m.state]}{m.targetResidue && <span className="ctx-caption ctx-block ctx-mono">{m.targetResidue}{m.targetPosition}</span>}</td>
            <td><AlignmentStrip mapping={m} /></td>
            <td className="ctx-num"><span className="ctx-mono">{h.humanIdentity === null ? '—' : `${h.humanIdentity.toFixed(0)}%`}</span><MeasureBar value={h.humanIdentity} max={100} label={`${h.humanIdentity ?? 'unknown'} percent of human residues identical`} /></td>
          </tr>)}</tbody>
        </table></div>
      </>}
    <p className="ctx-card__foot">Walked column by column through the gapped alignment, never by residue number. Identity is the share of human residues matched in that ortholog, across the whole protein. Conservation is context only and casts no ACMG vote.</p>
  </section>;
}
