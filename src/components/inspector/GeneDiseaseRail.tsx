import React from 'react';
import type { AnalysisResult } from '../../types';
import { useVariantAnalysisStore } from '../../stores/useVariantAnalysisStore';
import { evidenceContextIdentity } from '../../shared/evidenceContextIdentity';
import { buildGeneDiseaseModel } from '../../shared/geneDiseaseEvidence';
import { VALIDITY_SCALE, validityPosition } from '../../shared/diseaseFrame';
import { DOSAGE_CODE_LABELS, DOSAGE_ZERO_NOTE } from '../../shared/dosageSensitivity';
import { SNAPSHOT_STALE_AFTER_DAYS } from '../../shared/snapshotAge';
import { ContextSource } from './ContextSource';

/**
 * Evidence Lineage for the Gene–disease tab: the SAME model the tab renders, as a numbered trace.
 * (1) review trace ending in the engine record, (2) the scales the readings sit on with this
 * review's position marked, (3) method notes a curator must know, (4) sources from the payload.
 */
export function GeneDiseaseRail({ analysisResult }: { analysisResult: AnalysisResult }) {
  const state = useVariantAnalysisStore();
  const gene = analysisResult.metadata?.gene || state.gene;
  const key = evidenceContextIdentity(analysisResult, state.gene, state.variant);
  const selection = state.phenotypeSelections[key];
  const diseaseLoad = state.diseaseContexts[gene];
  const model = buildGeneDiseaseModel({ gene, disease: diseaseLoad, selectedKey: selection?.diseaseKey ?? null, dosage: state.dosageContexts[gene] });
  const { dosage, sources, selected } = model;
  const present = new Set(model.assertions.map(a => validityPosition(a.level)));
  const dosageCodes = new Set(dosage.readings.map(r => r.code));
  const disease = diseaseLoad?.data ?? null;
  const g2p = disease?.mechanismContext?.provenance ?? null;
  const dosageSource = state.dosageContexts[gene]?.data?.provenance ?? null;

  const choice = selected ? `${selected.label} · ${selected.inheritance.label}`
    : !sources.gencc.available && !model.frameCount ? `${sources.gencc.label} — no disease choices to select.`
    : 'No disease selected.';
  const validity = !selected ? 'Choose a disease to review its assertions.'
    : !model.assertions.length ? 'No GenCC assertion for this disease and inheritance.'
    : `${model.assertions.length} assertion${model.assertions.length === 1 ? '' : 's'} from ${model.submitters.length} submitter${model.submitters.length === 1 ? '' : 's'}: ${model.distinctLevels.join(', ')}.`;
  const dosageLine = dosage.state === 'ready' ? dosage.readings.map(r => `${r.name.toLowerCase()} ${r.code ?? r.call.toLowerCase()}`).join('; ')
    : `${sources.dosage.label}${dosage.message ? ` — ${dosage.message}` : ''}`;

  return <div className="gd-rail" data-testid="gene-disease-rail">
    <section className="gd-rail__section"><h2>Review trace</h2><ol className="gd-steps">
      <li><strong>Disease choice</strong><p>{choice}</p></li>
      <li data-state={model.verdict.kind === 'adverse' ? 'warn' : undefined}><strong>Validity assertions</strong><p>{validity}</p></li>
      <li><strong>ClinGen dosage</strong><p>{dosageLine}.</p></li>
      <li><strong>Mechanism cross-check</strong><p>{model.crossCheck ? model.crossCheck.sentence : selected ? 'No Gene2Phenotype mechanism for this exact disease and inheritance, or dosage is unavailable.' : 'Needs a chosen disease.'}</p></li>
      <li><strong>Engine record</strong><p>Context only. No ACMG criterion is added or changed.</p></li>
    </ol></section>

    <section className="gd-rail__section"><h3>GenCC scale</h3>
      <ul className="gd-cuts" aria-label="GenCC classification scale, strongest first">
        {[...VALIDITY_SCALE].map((label, i) => ({ label, i })).reverse().map(({ label, i }) =>
          <li key={label} data-active={present.has(i) || undefined}><span>{label}</span>{present.has(i) && <span className="gd-here">this disease</span>}</li>)}
      </ul>
      <p className="gd-caption">Order is GenCC’s own. A position is shown per submitter and is never averaged.</p>
    </section>
    <section className="gd-rail__section"><h3>ClinGen dosage scale</h3>
      <ul className="gd-cuts" aria-label="ClinGen dosage evidence scale">
        {([3, 2, 1, 0, 30, 40] as const).map(code => <li key={code} data-active={dosageCodes.has(code) || undefined}>
          <span><span className="gd-mono">{code}</span> · {DOSAGE_CODE_LABELS[code]}</span>{dosageCodes.has(code) && <span className="gd-here">this gene</span>}</li>)}
      </ul>
      <p className="gd-caption">Codes 30 and 40 are special categories, not higher scores.</p>
    </section>

    <section className="gd-rail__section"><h3>Method</h3>
      <p>{DOSAGE_ZERO_NOTE} Dosage is gene-level and says nothing about a missense change; it casts no ACMG vote.</p>
      <p>Mechanism is read only from Gene2Phenotype records matching this exact gene, MONDO disease and supported allelic requirement. The cross-check is descriptive: a gene can have several disease mechanisms.</p>
      <p>Snapshots are flagged after {SNAPSHOT_STALE_AFTER_DAYS.GenCC} days (GenCC, which updates weekly) or {SNAPSHOT_STALE_AFTER_DAYS.Gene2Phenotype} days (Gene2Phenotype). This is local policy; a flag never hides or re-weights evidence.</p>
      {!!model.assertions.length && model.verdict.kind === 'adverse' && <p>Disputed, refuted and “no known disease relationship” assertions lead the finding; the supportive ones stay visible.</p>}
    </section>

    {disease?.provenance && <ContextSource provenance={disease.provenance} />}
    {g2p && <ContextSource provenance={g2p} />}
    {dosageSource && <ContextSource provenance={dosageSource} rolling />}
    {dosage.reportUrl && <a className="ctx-link" href={dosage.reportUrl} target="_blank" rel="noreferrer">ClinGen curation for {gene}</a>}
    {!disease?.provenance && <p className="gd-caption">{diseaseLoad?.error ?? `${sources.gencc.label} — no validity-source manifest is available.`}</p>}
    {model.stale.map(a => <p key={a.source} className="gd-caption">{a.source}: {a.label}.</p>)}
  </div>;
}
