import React from 'react';
import { Network } from 'lucide-react';
import type { TabComponentProps } from './types';
import { useEvidenceContext } from '../../hooks/useEvidenceContext';
import { buildGeneDiseaseModel } from '../../shared/geneDiseaseEvidence';
import { DiseaseContextPicker } from './DiseaseContextPicker';
import { MechanismContextCard } from './MechanismContextCard';
import { VariantLocusCard } from './VariantLocusCard';
import { GeneDiseaseReadings } from './GeneDiseaseReadings';

export function GeneDiseaseTab({ analysisState }: TabComponentProps) {
  if (!analysisState.result) return null;
  return <GeneDiseaseContent result={analysisState.result} />;
}

function GeneDiseaseContent({ result }: { result: NonNullable<TabComponentProps['analysisState']['result']> }) {
  const context = useEvidenceContext(result, false, true);
  const model = buildGeneDiseaseModel({ gene: context.gene, disease: context.diseaseLoad, selectedKey: context.selection.diseaseKey, dosage: context.dosageLoad });
  const { verdict, selected, dosage } = model;
  const hi = dosage.readings.find(r => r.key === 'haploinsufficiency');
  const ts = dosage.readings.find(r => r.key === 'triplosensitivity');
  const code = (r: typeof hi) => r ? (r.code !== null ? String(r.code) : r.call) : '—';
  const genccAge = model.sources.gencc.age;
  return <div className="gd-screen" data-testid="gene-disease-screen">
    <header><h1 className="screen-title">Gene–disease</h1><p className="screen-tab-description">Causal relationship, disease mechanism and variant context.</p></header>
    {context.identityChanged && <p className="gd-notice" role="status">The annotation reference changed. Review choices stay with their original transcript, isoform and assembly; select the context for this reference explicitly.</p>}
    <DiseaseContextPicker gene={context.gene} load={context.diseaseLoad} selection={context.selection} onChange={context.setSelection} onRetry={context.retryDisease} />

    <section className="gd-card gd-hero" aria-labelledby="gd-finding-title" data-testid="gene-disease-finding" data-verdict={verdict.kind}>
      <div className="gd-hero__body">
        <div className="gd-hero__top">
          <span className="eyebrow" id="gd-finding-title"><Network className="w-3.5 h-3.5" />Does this gene cause {selected ? 'this disease' : 'disease'}?</span>
          <span className="ev-tier ev-tier--lg gd-verdict" data-tone={verdict.tone}>{verdict.label}</span>
        </div>
        <div className="gd-hero__figure"><span className="figure-headline gd-figure">{model.headline}</span>{model.headlineLabel && <span className="gd-hero__figure-label">{model.headlineLabel}</span>}</div>
        <p className="detail-prose gd-hero__finding">{model.sentence}</p>
      </div>
      <dl className="gd-facts">
        <div><dt>Disease</dt><dd>{selected ? <>{selected.label}<span className="gd-caption gd-block">{selected.inheritance.label} · <span className="gd-mono">{selected.diseaseId}</span></span></> : <span className="gd-caption">None chosen</span>}</dd></div>
        <div><dt>Validity</dt><dd>{model.assertions.length ? <>{model.submitters.length} submitter{model.submitters.length === 1 ? '' : 's'}<span className="gd-caption gd-block">{model.latestAssertion ? `latest ${model.latestAssertion}` : 'no dates reported'}</span></> : <span className="gd-caption">No assertion</span>}</dd></div>
        <div><dt>ClinGen dosage</dt><dd>{dosage.state === 'ready' ? <><span className="gd-mono">HI {code(hi)} · TS {code(ts)}</span><span className="gd-caption gd-block">gene-level, not variant-level</span></> : <span className="gd-caption">{model.sources.dosage.label}</span>}</dd></div>
        <div><dt>Engine record</dt><dd>Context only<span className="gd-caption gd-block">No ACMG criterion added</span></dd></div>
      </dl>
      {(model.sources.gencc.release || genccAge || !!model.stale.length) && <p className="gd-hero__footnote" data-stale={model.stale.length ? true : undefined}>
        {model.stale.length ? model.stale.map(a => `${a.source}: ${a.label}.`).join(' ')
          : `GenCC ${[model.sources.gencc.release?.toLowerCase(), genccAge?.label.toLowerCase()].filter(Boolean).join(' · ')}.`}
      </p>}
    </section>

    <section className="gd-section" aria-labelledby="gd-readings-title">
      <h2 className="eyebrow" id="gd-readings-title">Source readings</h2>
      <GeneDiseaseReadings model={model} onRetryDosage={context.retryDosage} />
    </section>

    {selected && <>
      <MechanismContextCard frame={selected} context={context.diseaseLoad?.data?.mechanismContext} onRetry={context.retryDisease} crossCheck={model.crossCheck} />
      <VariantLocusCard clinvar={result.clinvar} frame={selected} />
    </>}
  </div>;
}
