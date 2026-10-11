import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-code-pro';
import '../../src/index.css';
import AppViews from '../../src/components/AppViews';
import { SettingsProvider, useSettings } from '../../src/context/SettingsContext';
import { useVariantAnalysisStore as store } from '../../src/stores/useVariantAnalysisStore';
import { contextWorkspaceFixture } from '../../src/test/contextWorkspaceFixture';
import { molecularWorkspaceFixture } from '../../src/test/molecularWorkspaceFixture';
import { splicingWorkspaceFixture, SPLICING_WORKSPACE_CASES } from '../../src/test/splicingWorkspaceFixture';
import type { MasterView } from '../../src/components/MasterSidebar';

function scenario(name: string, scope: 'context' | 'molecular' | 'splicing' = 'context') {
  const f = scope === 'splicing' ? { state: null, result: splicingWorkspaceFixture(name) } : scope === 'molecular' ? { state: null, result: molecularWorkspaceFixture(name) } : contextWorkspaceFixture(name);
  store.setState({ ...f.state, gene: f.result.metadata!.gene, variant: f.result.metadata!.variant, uniprotId: f.result.metadata!.uniprotId,
    analysisState: { result: f.result, isLoading: false, error: null }, isFolding: false, isBiophysicalLoading: false } as never);
}
scenario('Overlapping domains', 'molecular');
const nativeFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.includes('/api/') ? Response.json({ error: 'Live services disabled in preview' }, { status: 404 }) : nativeFetch(input, init);
};
function Preview() {
  const [view, setView] = useState<MasterView>('evidence');
  const [tab, setTab] = useState('function');
  const [example, setExample] = useState('Overlapping domains');
  const molecular = ['structure', 'perturbation', 'function'].includes(tab);
  const scope = tab === 'splicing' ? 'splicing' : molecular ? 'molecular' : 'context';
  const [metric, setMetric] = useState<'mean' | 'max'>('mean');
  const [width, setWidth] = useState(31);
  const { isDark, setTheme } = useSettings();
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--cs-bg)', color: 'var(--cs-text-primary)' }}>
    <header style={{ padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
      <strong>Illustrative data · not scientific evidence</strong>
      <button className="viz-action" onClick={() => setTheme(isDark ? 'light' : 'dark')}>Switch theme</button>
      <label>Evidence <select aria-label="Evidence" value={tab} onChange={e => {
        const next = e.target.value;
        const nextMolecular = ['structure', 'perturbation', 'function'].includes(next);
        const nextScope = next === 'splicing' ? 'splicing' : nextMolecular ? 'molecular' : 'context';
        setTab(next); setView('evidence');
        if (nextScope !== scope) {
          const name = nextScope === 'splicing' ? 'Reverse strand' : nextMolecular ? 'Overlapping domains' : 'Mixed';
          setExample(name); scenario(name, nextScope);
        }
      }}>
        <option value="splicing">RNA splicing</option><option value="function">Functional domains</option><option value="structure">Residue shifts &amp; pockets</option><option value="perturbation">Structural perturbation</option><option value="gene-disease">Gene-disease</option><option value="expression-models">Expression</option><option value="species-models">Species &amp; models</option><option value="clinical">Population Data</option><option value="predictors">Predictors</option><option value="alphagenome">AlphaGenome</option></select></label>
      <label>Example <select aria-label="Example" value={example} onChange={e => { setExample(e.target.value); scenario(e.target.value, scope); }}>{(scope === 'splicing' ? SPLICING_WORKSPACE_CASES : molecular ? ['Overlapping domains', 'Dense SOD1', 'NAE1', 'Missing', 'New variant'] : ['Mixed', 'Mismatch', 'Missing', 'New variant']).map(name => <option key={name}>{name}</option>)}</select></label>
    </header>
    <AppViews masterView={view} setMasterView={setView} pushErrorEntry={console.error} setIsSettingsOpen={() => {}}
      activeEvidenceTab={tab} setActiveEvidenceTab={setTab} metricMode={metric} setMetricMode={setMetric}
      windowSize={width} setWindowSize={setWidth} classCardTitle="" classCardHeader="" classInput="" classBorderSec="" classTextBody="" classTextMute="" />
  </div>;
}
createRoot(document.getElementById('root')!).render(<SettingsProvider><Preview /></SettingsProvider>);
