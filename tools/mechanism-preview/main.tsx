import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-code-pro';
import '../../src/index.css';
import AppViews from '../../src/components/AppViews';
import { SettingsProvider, useSettings } from '../../src/context/SettingsContext';
import { useVariantAnalysisStore as store } from '../../src/stores/useVariantAnalysisStore';
import { mechanismWorkspaceFixture } from '../../src/test/mechanismWorkspaceFixture';
import { EVIDENCE_SUB_ITEMS, type MasterView } from '../../src/components/MasterSidebar';
import { NAE1_RESULT, NAE1_ENERGETICS } from '../../src/shared/__tests__/fixtures/nae1Perturbation';

const nativeFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.includes('/api/') ? Response.json({ error: 'Live services disabled in preview' }, { status: 404 }) : nativeFetch(input, init);
};
function scenario(name: string) {
  const base = mechanismWorkspaceFixture(name);
  const result = name === 'Embedding fallback' ? { ...base, ...structuredClone(NAE1_RESULT), isDemoData: true,
    metadata: { ...base.metadata, ...NAE1_RESULT.metadata },
    esm3Eval: { ...NAE1_RESULT.esm3Eval, provenance: 'VESM-150M fallback' } } : base;
  store.setState({ gene: result.metadata!.gene, variant: result.metadata!.variant, uniprotId: result.metadata!.uniprotId,
    analysisState: { result, isLoading: false, error: null }, isFolding: false, isBiophysicalLoading: false,
    foldingEnergetics: name === 'Embedding fallback' ? NAE1_ENERGETICS : null } as never);
}
scenario('SOD1');
function Preview() {
  const [view, setView] = useState<MasterView>('evidence');
  const [tab, setTab] = useState('interfaces');
  const [example, setExample] = useState('SOD1');
  const [metric, setMetric] = useState<'mean' | 'max'>('mean');
  const [width, setWidth] = useState(31);
  const { isDark, setTheme } = useSettings();
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--cs-bg)', color: 'var(--cs-text-primary)' }}>
    <header style={{ padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
      <strong>Fixture preview · illustrative scenarios · not clinical evidence</strong>
      <button className="viz-action" onClick={() => setTheme(isDark ? 'light' : 'dark')}>Switch theme</button>
      <label>Workspace <select aria-label="Workspace" value={view} onChange={e => setView(e.target.value as MasterView)}>{['search', 'evidence', 'structure_alphafold', 'energetics', 'landscape', 'insights', 'literature', 'report'].map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Evidence <select aria-label="Evidence" value={tab} onChange={e => setTab(e.target.value)}>{EVIDENCE_SUB_ITEMS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Example <select aria-label="Example" value={example} onChange={e => { setExample(e.target.value); scenario(e.target.value); }}>{['SOD1', 'SLC12A4', 'NAE1', 'Embedding fallback', 'Splice signals', 'Missing position', 'Unresolved strand', 'Missing', 'New variant'].map(n => <option key={n}>{n}</option>)}</select></label>
    </header>
    <AppViews masterView={view} setMasterView={setView} pushErrorEntry={console.error} setIsSettingsOpen={() => {}}
      activeEvidenceTab={tab} setActiveEvidenceTab={setTab} metricMode={metric} setMetricMode={setMetric}
      windowSize={width} setWindowSize={setWidth} classCardTitle="" classCardHeader="" classBorderSec="" classTextBody="" classTextMute="" />
  </div>;
}
createRoot(document.getElementById('root')!).render(<SettingsProvider><Preview /></SettingsProvider>);
