import React, { useLayoutEffect, useRef, useState } from 'react';
import type { TabComponentProps } from './types';
import { useContextWorkspace } from '../../hooks/useContextWorkspace';
import { ContextSourceState } from './ContextSourceState';
import { ContextExplorer } from './ContextExplorer';
import { useEvidenceWorkspace } from './EvidenceWorkspace';
import { DiseaseContextPicker } from './DiseaseContextPicker';
import { MechanismContextCard } from './MechanismContextCard';
import { VariantLocusCard } from './VariantLocusCard';
import { GeneDiseaseReadings } from './GeneDiseaseReadings';
import { WorkspaceTabs } from '../ui/WorkspaceTabs';

const SECTIONS = [
  { id: 'validity', label: 'Validity' },
  { id: 'dosage', label: 'Dosage' },
  { id: 'mechanism', label: 'Mechanism' },
  { id: 'variant', label: 'Variant context' },
] as const;

export function GeneDiseaseTab({ analysisState }: TabComponentProps) {
  if (!analysisState.result) return null;
  return <GeneDiseaseContent result={analysisState.result} />;
}

function GeneDiseaseContent({ result }: { result: NonNullable<TabComponentProps['analysisState']['result']> }) {
  const { context, model, rows } = useContextWorkspace(result, 'gene-disease');
  const workspace = useEvidenceWorkspace('gene-disease');
  const { verdict, selected } = model;
  const root = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState<'pin' | 'review' | null>(null);
  const section = SECTIONS.find(s => s.id === workspace.section)?.id ?? 'validity';
  const pinned = rows.find(r => r.key === workspace.selected);
  useLayoutEffect(() => {
    if (!focusRequest) return;
    const target = root.current?.querySelector<HTMLButtonElement>(focusRequest === 'pin'
      ? 'button.evw-reading-button[aria-pressed="true"]'
      : '#gene-disease-sections-tab-validity');
    target?.focus();
    target?.scrollIntoView?.({ block: 'nearest' });
    setFocusRequest(null);
  }, [focusRequest]);
  const dosage = <section className="gd-section" aria-labelledby="gd-dosage-title">
    <div className="gd-section-heading"><h2 id="gd-dosage-title">Gene dosage</h2>
      <p className="detail-prose">Whole-gene copy-number evidence; independent of disease selection.</p></div>
    {model.dosage.state === 'ready' ? <GeneDiseaseReadings model={model} section="dosage" onRetryDosage={context.retryDosage} />
      : <div data-testid="dosage-card"><ContextSourceState name="ClinGen dosage" load={context.dosageLoad} onRetry={context.retryDosage}
        loadingMessage={`Checking ClinGen dosage curation for ${context.gene}. This may take a few moments.`} />
        {model.dosage.state === 'not-found' && context.dosageLoad?.data?.provenance && <p className="gd-caption">Source table retrieved {context.dosageLoad.data.provenance.retrievedAt.slice(0, 10)}. No matching gene record was found.</p>}
      </div>}
  </section>;
  const mechanism = selected && <MechanismContextCard frame={selected} context={context.diseaseLoad?.data?.mechanismContext} onRetry={context.retryDisease} crossCheck={model.crossCheck} />;
  const variant = selected && <VariantLocusCard clinvar={result.clinvar} frame={selected} />;

  const presentation = workspace.enabled && model.assertions.length > 0 ? <div className="gd-view-control" role="group" aria-label="Validity presentation">
    <button type="button" aria-pressed={workspace.comparison} aria-controls="gd-validity-representation" onClick={() => workspace.setView('comparison')}>Comparison</button>
    <button type="button" aria-pressed={!workspace.comparison} aria-controls="gd-validity-representation" onClick={() => workspace.setView('records')}>Records</button>
  </div> : null;

  return <div ref={root} data-evidence-screen className="gd-screen cx-screen" data-testid="gene-disease-screen" data-comparison={workspace.comparison || undefined}>
    <header><h1 className="screen-title">Gene–disease</h1><p className="screen-tab-description">Review the gene–disease relationship, then its relevance to this variant.</p></header>
    {context.identityChanged && <p className="gd-notice" role="status">The annotation reference changed. Review choices stay with their original transcript, isoform and assembly; select the context for this reference explicitly.</p>}
    <DiseaseContextPicker compact gene={context.gene} load={context.diseaseLoad} selection={context.selection} onChange={selection => {
      context.setSelection(selection);
      if (!selected && selection.diseaseKey) {
        workspace.setOptions({ section: 'validity', query: '' });
        setFocusRequest('review');
      }
    }} onRetry={context.retryDisease} />

    {selected && <>
      {workspace.enabled && <div className="gd-navigation"><WorkspaceTabs id="gene-disease-sections" label="Gene–disease evidence" tabs={SECTIONS} value={section} onChange={next => workspace.setOptions({ section: next, query: '' })} /></div>}
      {pinned && pinned.group !== section && <p className="gd-pin-notice">{pinned.name} remains pinned in the inspector. <button type="button" className="viz-action" onClick={() => {
        workspace.setOptions({ section: pinned.group, query: '', relevantOnly: false });
        workspace.setView('records');
        setFocusRequest('pin');
      }}>Show pinned record</button></p>}
      <div className="gd-section-panel" role={workspace.enabled ? 'tabpanel' : undefined} id={`gene-disease-sections-panel-${section}`} aria-labelledby={workspace.enabled ? `gene-disease-sections-tab-${section}` : undefined}>
        {(section === 'validity' || !workspace.enabled) && <>
          <section className="gd-card gd-hero" aria-labelledby="gd-finding-title" data-testid="gene-disease-finding" data-verdict={verdict.kind}>
            <div className="gd-hero__body">
              <h2 id="gd-finding-title" className="gd-finding-heading">{model.headline}</h2>
              {model.headlineLabel && <p className="gd-caption">{model.headlineLabel}</p>}
              {verdict.kind === 'adverse' && <span className="ev-tier gd-verdict" data-tone={verdict.tone}>{verdict.label}</span>}
              <p className="detail-prose gd-hero__finding">{model.sentence}</p>
            </div>
          </section>
          {!workspace.comparison && presentation}
          <div id="gd-validity-representation" className="gd-validity-representation">
            {workspace.comparison ? <ContextExplorer toolbarStart={presentation} tab="gene-disease" rows={rows.filter(r => r.group === 'validity')} groups={[{ id: 'validity', label: 'Validity' }]} empty={model.sentence} />
              : <GeneDiseaseReadings model={model} section="validity" />}
          </div>
        </>}
        {(section === 'dosage' || !workspace.enabled) && dosage}
        {(section === 'mechanism' || !workspace.enabled) && mechanism}
        {(section === 'variant' || !workspace.enabled) && variant}
      </div>
    </>}
    {!selected && dosage}
  </div>;
}
