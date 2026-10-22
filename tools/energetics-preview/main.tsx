import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-code-pro';
import '@fontsource-variable/lora';
import '../../src/index.css';
import AppViews from '../../src/components/AppViews';
import { SettingsProvider, useSettings } from '../../src/context/SettingsContext';
import { useVariantAnalysisStore as store } from '../../src/stores/useVariantAnalysisStore';
import type { MasterView } from '../../src/components/MasterSidebar';
import type { AnalysisResult, EnergeticsData } from '../../src/types';

// Labelled examples, not live measurements. Same production AppViews and inspector as the app.
const result = { metadata: { gene: 'SOD1', variant: 'p.Ala5Val', uniprotId: 'P00441', residueIndex: 5 }, conservationData: {} } as AnalysisResult;
const full = { foldx: 2.62, foldxMean: 2.62, foldxSd: 0.3, foldxRepairFailed: false, dynamut2: 0.36, ddmut: -0.7, thermompnn: 1.45, stabilityoracle: -0.8, rasp: 1.1,
  structureProvenance: { source: 'experimental', pdbId: '2C9V', chainId: 'A', resolution: 1.8, foldxRuns: 5 } } as EnergeticsData;
function scenario(name: string) {
  const energetics = name === 'Missing' ? {} : name === 'Single' ? { dynamut2: -0.09 } : name === 'Excluded' ? { ...full, foldxRepairFailed: true } : name === 'Extreme' ? { ...full, foldx: 24, foldxMean: 24, ddmut: 12 } : full;
  store.setState({ gene: 'SOD1', variant: 'p.Ala5Val', uniprotId: 'P00441',
    analysisState: { result, isLoading: false, error: null }, foldingEnergetics: energetics as EnergeticsData,
    foldingDdG: null, foldingStatus: name === 'Missing' || name === 'Single' ? 'unavailable' : 'success',
    dynamut2Status: name === 'Missing' ? 'unavailable' : 'done', ddmutStatus: name === 'Missing' || name === 'Single' ? 'unavailable' : 'done',
    thermompnnStatus: name === 'Missing' ? 'pending' : name === 'Single' ? 'unavailable' : 'done', isFolding: false,
  });
}
scenario('Disagreement');
const nativeFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.includes('/api/') ? Response.json({ error: 'Live services disabled in preview' }, { status: 404 }) : nativeFetch(input, init);
};
function Preview() {
  const [view, setView] = useState<MasterView>('energetics');
  const [metric, setMetric] = useState<'mean' | 'max'>('mean');
  const [width, setWidth] = useState(31);
  const { isDark, setTheme } = useSettings();
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--cs-bg)', color: 'var(--cs-text-primary)' }}>
    <header style={{ padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
      <strong>Illustrative data · not scientific evidence</strong>
      <button className="viz-action" onClick={() => setTheme(isDark ? 'light' : 'dark')}>Switch theme</button>
      <label>Example <select aria-label="Example" onChange={e => scenario(e.target.value)}>{['Disagreement', 'Single', 'Missing', 'Excluded', 'Extreme'].map(name => <option key={name}>{name}</option>)}</select></label>
    </header>
    <AppViews masterView={view} setMasterView={setView} pushErrorEntry={console.error} setIsSettingsOpen={() => {}}
      activeEvidenceTab="population" setActiveEvidenceTab={() => {}} metricMode={metric} setMetricMode={setMetric}
      windowSize={width} setWindowSize={setWidth} classCardTitle="" classCardHeader="" classInput="" classBorderSec="" classTextBody="" classTextMute="" />
  </div>;
}
createRoot(document.getElementById('root')!).render(<SettingsProvider><Preview /></SettingsProvider>);
