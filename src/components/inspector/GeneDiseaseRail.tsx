import React from 'react';
import type { AnalysisResult } from '../../types';
import { useVariantAnalysisStore } from '../../stores/useVariantAnalysisStore';
import { evidenceContextIdentity } from '../../shared/evidenceContextIdentity';
import { buildGeneDiseaseModel } from '../../shared/geneDiseaseEvidence';
import { VALIDITY_SCALE, validityPosition } from '../../shared/diseaseFrame';
import { DOSAGE_CODE_LABELS, DOSAGE_ZERO_NOTE } from '../../shared/dosageSensitivity';
import { SNAPSHOT_STALE_AFTER_DAYS } from '../../shared/snapshotAge';
import { Step, Provenance, slotState } from './RailParts';
import { safeExternalHref } from '../../shared/externalLink';

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
  const validity = !selected ? (model.frameCount ? 'Choose a disease to review its assertions.' : 'No curated disease, so no assertions to read.')
    : !model.assertions.length ? 'No GenCC assertion for this disease and inheritance.'
    : `${model.assertions.length} assertion${model.assertions.length === 1 ? '' : 's'} from ${model.submitters.length} submitter${model.submitters.length === 1 ? '' : 's'}: ${model.distinctLevels.join(', ')}.`;
  const dosageLine = dosage.state === 'ready' ? dosage.readings.map(r => `${r.name.toLowerCase()} ${r.code ?? r.call.toLowerCase()}`).join('; ')
    : `${sources.dosage.label}${dosage.message ? ` — ${dosage.message}` : ''}`;

  const sourceRows = [
    { name: 'GenCC validity', slot: diseaseLoad },
    { name: 'Gene2Phenotype mechanism', slot: diseaseLoad && diseaseLoad.data ? { status: diseaseLoad.status, data: { status: g2p ? 'ready' : 'not-found' } } : diseaseLoad },
    { name: 'ClinGen dosage', slot: state.dosageContexts[gene] },
  ];
  const trimmed = (text: string) => text.replace(/\.+$/, '');

  return <div className="ctx-rail gd-rail" data-testid="gene-disease-rail">
    <section className="rail-section" aria-labelledby="gd-rail-trace"><h3 className="eyebrow" id="gd-rail-trace">Review trace</h3>
      <ol className="rail-steps" data-testid="context-trace">
        <Step n={1} label="Disease choice">{selected ? <>{selected.label}<span className="rail-step__sub">{selected.inheritance.label}</span></> : choice}</Step>
        <Step n={2} label="Validity assertions" state={model.verdict.kind === 'adverse' ? 'warn' : undefined}>{validity}</Step>
        <Step n={3} label="ClinGen dosage">{trimmed(dosageLine)}.</Step>
        <Step n={4} label="Mechanism cross-check">{model.crossCheck ? model.crossCheck.sentence : selected ? 'No Gene2Phenotype mechanism for this exact disease and inheritance, or dosage is unavailable.' : 'Needs a chosen disease.'}</Step>
        <Step n={5} label="Interpretation boundary">Context only<span className="rail-step__sub">No ACMG criterion is added or changed.</span></Step>
      </ol>
    </section>

    <section className="rail-section" aria-labelledby="gd-rail-sources"><h3 className="eyebrow" id="gd-rail-sources">Sources read</h3>
      <dl className="rail-kv rail-kv--sources" data-testid="context-sources">{sourceRows.map(row => { const st = slotState(row.slot);
        return <div className="rail-kv__row" key={row.name}><dt>{row.name}</dt><dd><span className="ev-tier" data-tone={st.tone === 'good' ? 'neutral' : st.tone}>{st.label}</span></dd></div>; })}</dl>
    </section>

    <section className="rail-section" aria-labelledby="gd-rail-gencc"><h3 className="eyebrow" id="gd-rail-gencc">GenCC scale</h3>
      <ul className="gd-cuts" aria-label="GenCC classification scale, strongest first">
        {[...VALIDITY_SCALE].map((label, i) => ({ label, i })).reverse().map(({ label, i }) =>
          <li key={label} data-active={present.has(i) || undefined}><span>{label}</span>{present.has(i) && <span className="gd-here">this disease</span>}</li>)}
      </ul>
      <p className="rail-step__sub">Order is GenCC’s own. A position is shown per submitter and is never averaged.</p>
    </section>
    <section className="rail-section" aria-labelledby="gd-rail-dosage"><h3 className="eyebrow" id="gd-rail-dosage">ClinGen dosage scale</h3>
      <ul className="gd-cuts" aria-label="ClinGen dosage evidence scale">
        {([3, 2, 1, 0, 30, 40] as const).map(code => <li key={code} data-active={dosageCodes.has(code) || undefined}>
          <span><span className="gd-mono">{code}</span> · {DOSAGE_CODE_LABELS[code]}</span>{dosageCodes.has(code) && <span className="gd-here">this gene</span>}</li>)}
      </ul>
      <p className="rail-step__sub">Codes 30 and 40 are special categories, not higher scores.</p>
    </section>

    <section className="rail-section" aria-labelledby="gd-rail-method"><h3 className="eyebrow" id="gd-rail-method">Method</h3>
      <details className="rail-notes"><summary>How the readings are made</summary><ul>
        <li>{DOSAGE_ZERO_NOTE} Dosage is gene-level and says nothing about a missense change; it casts no ACMG vote.</li>
        <li>Mechanism is read only from Gene2Phenotype records matching this exact gene, MONDO disease and supported allelic requirement. The cross-check is descriptive: a gene can have several disease mechanisms.</li>
        <li>Snapshots are flagged after {SNAPSHOT_STALE_AFTER_DAYS.GenCC} days (GenCC, which updates weekly) or {SNAPSHOT_STALE_AFTER_DAYS.Gene2Phenotype} days (Gene2Phenotype). This is local policy; a flag never hides or re-weights evidence.</li>
        {!!model.assertions.length && model.verdict.kind === 'adverse' && <li>Disputed, refuted and “no known disease relationship” assertions lead the finding; the supportive ones stay visible.</li>}
      </ul></details>
    </section>

    {(disease?.provenance || g2p || dosageSource) && <section className="rail-section" aria-labelledby="gd-rail-prov"><h3 className="eyebrow" id="gd-rail-prov">Provenance</h3><div data-testid="context-provenance">
      {disease?.provenance && <Provenance provenance={disease.provenance} />}
      {g2p && <Provenance provenance={g2p} />}
      {dosageSource && <Provenance provenance={dosageSource} rolling />}
    </div></section>}
    {(() => { const href = safeExternalHref(dosage.reportUrl); return href
      ? <a className="ctx-link" href={href} target="_blank" rel="noreferrer">ClinGen curation for {gene}<span className="ctx-sr-only"> (opens in a new tab)</span></a>
      : null; })()}
    {!disease?.provenance && <p className="rail-step__sub">{diseaseLoad?.error ?? `${sources.gencc.label} — no validity-source manifest is available.`}</p>}
    {model.stale.map(a => <p key={a.source} className="rail-step__sub">{a.source}: {a.label}.</p>)}
  </div>;
}
