import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-code-pro';
import '../../src/index.css';
import AppViews from '../../src/components/AppViews';
import { SettingsProvider, useSettings } from '../../src/context/SettingsContext';
import { useVariantAnalysisStore as store } from '../../src/stores/useVariantAnalysisStore';
import { contextWorkspaceFixture } from '../../src/test/contextWorkspaceFixture';
import type { MasterView } from '../../src/components/MasterSidebar';

function scenario(name: string) {
  const { result, state } = contextWorkspaceFixture(name);
  store.setState({ ...state, gene: result.metadata!.gene, variant: result.metadata!.variant, uniprotId: result.metadata!.uniprotId,
    analysisState: { result, isLoading: false, error: null }, isFolding: false, isBiophysicalLoading: false });
}
scenario('Mixed');
const nativeFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.includes('/api/') ? Response.json({ error: 'Live services disabled in preview' }, { status: 404 }) : nativeFetch(input, init);
};
function Preview() {
  const [view, setView] = useState<MasterView>('evidence');
  const [tab, setTab] = useState('gene-disease');
  const [metric, setMetric] = useState<'mean' | 'max'>('mean');
  const [width, setWidth] = useState(31);
  const { isDark, setTheme } = useSettings();
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--cs-bg)', color: 'var(--cs-text-primary)' }}>
    <header style={{ padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
      <strong>Illustrative data · not scientific evidence</strong>
      <button className="viz-action" onClick={() => setTheme(isDark ? 'light' : 'dark')}>Switch theme</button>
      <label>Evidence <select aria-label="Evidence" value={tab} onChange={e => { setTab(e.target.value); setView('evidence'); }}>
        <option value="gene-disease">Gene-disease</option><option value="expression-models">Expression</option><option value="species-models">Species &amp; models</option><option value="clinical">Population Data</option><option value="predictors">Predictors</option><option value="alphagenome">AlphaGenome</option></select></label>
      <label>Example <select aria-label="Example" onChange={e => scenario(e.target.value)}>{['Mixed', 'Mismatch', 'Missing', 'New variant'].map(name => <option key={name}>{name}</option>)}</select></label>
    </header>
    <AppViews masterView={view} setMasterView={setView} pushErrorEntry={console.error} setIsSettingsOpen={() => {}}
      activeEvidenceTab={tab} setActiveEvidenceTab={setTab} metricMode={metric} setMetricMode={setMetric}
      windowSize={width} setWindowSize={setWidth} classCardTitle="" classCardHeader="" classInput="" classBorderSec="" classTextBody="" classTextMute="" />
  </div>;
}
createRoot(document.getElementById('root')!).render(<SettingsProvider><Preview /></SettingsProvider>);
