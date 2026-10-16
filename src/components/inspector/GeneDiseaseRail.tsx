import React from 'react';
import type { AnalysisResult } from '../../types';
import { useContextWorkspaceRead } from '../../hooks/useContextWorkspace';
import { ContextDisclosure } from '../evidence/ContextExplorer';
import { EvidenceReadingInspector } from './EvidenceReadingInspector';
import { VALIDITY_SCALE, validityPosition } from '../../shared/diseaseFrame';
import { DOSAGE_CODE_LABELS, DOSAGE_ZERO_NOTE } from '../../shared/dosageSensitivity';
import { SNAPSHOT_STALE_AFTER_DAYS } from '../../shared/snapshotAge';
import { Provenance, sourceReadingState } from './RailParts';

/** Record details, source availability and reference each have one home.
 * Uses the same typed model as the workspace; no inferred source success or consensus. */
export function GeneDiseaseRail({ analysisResult }: { analysisResult: AnalysisResult }) {
  const { context, model, rows } = useContextWorkspaceRead(analysisResult, 'gene-disease');
  const { dosage, sources, selected } = model;
  const present = new Set(model.assertions.map(a => validityPosition(a.level)));
  const dosageCodes = new Set(dosage.readings.map(r => r.code));
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
        : <p>Choose a disease in the workspace to review its validity, mechanism and variant context. Gene dosage can be reviewed independently.</p>}
    </div>} />
    <section className="gd-source-section" aria-labelledby="gd-rail-sources"><h3 id="gd-rail-sources">Sources &amp; availability</h3>
      <div data-testid="context-sources">{sourceRows.map(({ name, reading, provenance }) => {
        const state = sourceReadingState(reading);
        const status = { label: state.tone === 'good' ? 'Available' : state.label, tone: state.tone === 'good' ? 'neutral' : state.tone };
        const note = <>{reading.reason && <p className="detail-prose">{reading.reason}</p>}
          {model.stale.filter(a => a.source === provenance?.source).map(a => <p key={a.source}>{a.label}</p>)}</>;
        return provenance ? <Provenance key={name} name={name} provenance={provenance} rolling={name === 'ClinGen dosage'} status={status}>{note}</Provenance>
          : <details key={name} className="xp-prov"><summary><span className="xp-prov__name">{name}</span><span className="ev-tier" data-tone={status.tone}>{status.label}</span></summary>
            {note}<p className="gd-caption">No source manifest is available for this response.</p></details>;
      })}</div>
    </section>
    <ContextDisclosure tab="gene-disease" id="classification-reference" title="Reference & methods">
      <section className="gd-reference" aria-labelledby="gd-rail-gencc"><h3 id="gd-rail-gencc">Validity classifications</h3>
        <p>Validity describes a gene–disease relationship under the selected inheritance. Each submission is retained; counts do not form a consensus or classify this variant.</p>
        <ul className="gd-cuts" aria-label="GenCC classification scale, strongest first">
          {[...VALIDITY_SCALE].map((label, i) => ({ label, i })).reverse().map(({ label, i }) => <li key={label} data-active={present.has(i) || undefined}><span>{label}</span>{present.has(i) && <span className="gd-here">this disease</span>}</li>)}
        </ul>
        <h3>ClinGen dosage codes</h3>
        <ul className="gd-cuts" aria-label="ClinGen dosage evidence scale">
          {([3, 2, 1, 0, 30, 40] as const).map(code => <li key={code} data-active={dosageCodes.has(code) || undefined}><span>{code} · {DOSAGE_CODE_LABELS[code]}</span>{dosageCodes.has(code) && <span className="gd-here">this gene</span>}</li>)}
        </ul>
        <p>{DOSAGE_ZERO_NOTE} Codes 30 and 40 are special categories, not higher scores. Whole-gene dosage does not establish the effect of a missense variant.</p>
        <h3>Scope &amp; freshness</h3>
        <p>Mechanism records must match the exact gene, MONDO disease and supported allelic requirement. Modifiers and variant restrictions remain source-specific.</p>
        <p>Snapshots are flagged after {SNAPSHOT_STALE_AFTER_DAYS.GenCC} days (GenCC) or {SNAPSHOT_STALE_AFTER_DAYS.Gene2Phenotype} days (Gene2Phenotype). This local policy never hides or re-weights evidence.</p>
        <p>Context only: no ACMG criterion is added or changed.</p>
      </section>
    </ContextDisclosure>
  </div>;
}
