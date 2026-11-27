import React from 'react';
import type { AnalysisResult } from '../../types';
import { useContextWorkspaceRead } from '../../hooks/useContextWorkspace';
import { ContextDisclosure } from '../evidence/ContextExplorer';
import { EvidenceReadingInspector } from './EvidenceReadingInspector';
import { validityReference, type ValidityClass } from '../../shared/validityClasses';
import { dosageReference, type DosageCodeEntry } from '../../shared/dosageSensitivity';
import { SNAPSHOT_STALE_AFTER_DAYS } from '../../shared/snapshotAge';
import { Provenance, sourceReadingState } from './RailParts';
import { ReferenceScaleChart, type ReferenceItem } from './ReferenceScaleChart';

const validityItem = (c: ValidityClass & { count: number }): ReferenceItem => ({ key: c.key, label: c.label, definition: c.definition, caution: c.caution,
  badge: c.count ? String(c.count) : null, note: c.count ? `${c.count} submission${c.count === 1 ? '' : 's'} for this disease` : null });
const DOSAGE_SHORT: Record<number, string> = { 0: 'No evidence', 1: 'Little', 2: 'Some', 3: 'Sufficient', 30: 'Recessive', 40: 'Unlikely' };
const dosageItem = (c: DosageCodeEntry): ReferenceItem => ({ key: String(c.code), label: `${c.code} · ${c.label}`, short: `${c.code} ${DOSAGE_SHORT[c.code]}`,
  definition: c.definition, hollow: c.code === 0,
  badge: c.marks.length ? c.marks.map(m => (m === 'Haploinsufficiency' ? 'HI' : 'TS')).join(' ') : null,
  note: c.marks.length ? `This gene: ${c.marks.join(' and ').toLowerCase()}` : null });

/** Record details, source availability and reference each have one home.
 * Uses the same typed model as the workspace; no inferred source success or consensus. */
export function GeneDiseaseRail({ analysisResult }: { analysisResult: AnalysisResult }) {
  const { context, model, rows } = useContextWorkspaceRead(analysisResult, 'gene-disease');
  const { dosage, sources, selected } = model;
  const validity = validityReference(model.assertions.map(a => a.level));
  const ofGroup = (group: ValidityClass['group']) => validity.classes.filter(c => c.group === group).map(validityItem);
  const codes = dosageReference(dosage.readings).map(c => ({ ...c, item: dosageItem(c) }));
  // Each chart opens on a contesting class (else the strongest in use) and on this gene's HI score.
  // The key includes that opening choice, so a new disease or late-arriving data resets the readout.
  const openClass = (validity.classes.find(c => c.caution && c.count) ?? validity.classes.find(c => c.count))?.key ?? null;
  const openScore = codes.find(c => c.marks.includes('Haploinsufficiency'))?.item.key ?? null;
  const disease = context.diseaseLoad?.data;
  const sourceRows = [
    { name: 'GenCC validity', reading: sources.gencc, provenance: disease?.provenance },
    { name: 'Gene2Phenotype mechanism', reading: sources.g2p, provenance: disease?.mechanismContext?.provenance },
    { name: 'ClinGen dosage', reading: sources.dosage, provenance: context.dosageLoad?.data?.provenance },
  ];
  return <div className="ctx-rail gd-rail" data-testid="gene-disease-rail">
    <EvidenceReadingInspector tab="gene-disease" rows={rows} showGuide={false} empty={<div className="gd-review-overview">
      <h3>Review overview</h3>
      {selected ? <><p>{selected.label}</p><p className="gd-caption">{selected.inheritance.label} · {selected.diseaseId}</p>
        <p>{model.assertions.length} submitted validity assertions. {model.mechanismSummary}</p>
        <p className="gd-caption">Select a submitter or dosage reading to inspect its interpretation and source.</p></>
        : <p>Choose a disease in the workspace to review its validity, mechanism and variant context.</p>}
    </div>} />
    <section className="gd-source-section" aria-labelledby="gd-rail-sources"><h3 id="gd-rail-sources">Sources &amp; availability</h3>
      <div data-testid="context-sources">{sourceRows.map(({ name, reading, provenance }) => {
        const state = sourceReadingState(reading);
        const status = { label: state.tone === 'good' ? 'Available' : state.label, tone: state.tone };
        const note = <>{reading.reason && <p className="detail-prose">{reading.reason}</p>}
          {model.stale.filter(a => a.source === provenance?.source).map(a => <p key={a.source}>{a.label}</p>)}</>;
        return provenance ? <Provenance key={name} name={name} provenance={provenance} rolling={name === 'ClinGen dosage'} status={status}>{note}</Provenance>
          : <details key={name} className="xp-prov"><summary><span className="xp-prov__name">{name}</span><span className="ev-tier" data-tone={status.tone}>{status.label}</span></summary>
            {note}<p className="gd-caption">No source manifest is available for this response.</p></details>;
      })}</div>
    </section>
    <ContextDisclosure tab="gene-disease" id="classification-reference" title="Reference & methods">
      <section className="gd-reference" aria-labelledby="gd-rail-gencc"><h3 id="gd-rail-gencc">Validity classes</h3>
        <p>Each submission keeps its own class. Classes are never averaged or counted into a consensus, and none classifies this variant.</p>
        <ReferenceScaleChart key={`${selected?.key}:${openClass}`} title="GenCC validity classes" stepsLabel="Evidence strength" steps={ofGroup('graded').reverse()}
          groups={[{ label: 'Contests', items: ofGroup('contested') }, { label: 'Not graded', items: ofGroup('ungraded') }]}
          prompt="Select a class for a short summary of GenCC’s definition." initial={openClass} />
        {validity.unlisted.length > 0 && <p className="gd-caption">Also submitted, not a GenCC term: {validity.unlisted.join(', ')}.</p>}
        <h3>Dosage scores</h3>
        <ReferenceScaleChart key={`${model.gene}:${openScore}`} title="ClinGen dosage scores" stepsLabel="Evidence that copy number matters" steps={codes.filter(c => c.kind === 'evidence').map(c => c.item)}
          groups={[{ label: 'Special', items: codes.filter(c => c.kind === 'special').map(c => c.item) }]}
          prompt="Select a score for a plain-language summary." initial={openScore} />
        <h3>Scope</h3>
        <ul className="gd-ref__notes">
          <li>Mechanism records must match the exact gene, MONDO disease and allelic requirement.</li>
          <li>Snapshots are flagged after {SNAPSHOT_STALE_AFTER_DAYS.GenCC} days (GenCC) or {SNAPSHOT_STALE_AFTER_DAYS.Gene2Phenotype} days (Gene2Phenotype); a flag never hides evidence.</li>
          <li>Context only: no ACMG criterion is added or changed.</li>
        </ul>
      </section>
    </ContextDisclosure>
  </div>;
}
