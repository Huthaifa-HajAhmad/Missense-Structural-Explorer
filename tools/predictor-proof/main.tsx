import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-code-pro';
import '@fontsource-variable/lora';
import '../../src/index.css';
import AppViews from '../../src/components/AppViews';
import { SettingsProvider, useSettings } from '../../src/context/SettingsContext';
import { useVariantAnalysisStore as store } from '../../src/stores/useVariantAnalysisStore';
import { conservationDataSchema, predictorDataSchema, type AnalysisResult } from '../../src/shared/contracts';
import type { MasterView } from '../../src/components/MasterSidebar';

// Validate the captured provider result once, outside the product application.
const result = z.object({
  metadata: z.object({ gene: z.string(), variant: z.string(), uniprotId: z.string(), residueIndex: z.number(), wildType: z.string(), mutant: z.string() }).passthrough(),
  predictorData: predictorDataSchema.nullable().optional(),
  conservationData: conservationDataSchema.nullable().optional(),
}).passthrough().parse(JSON.parse(sessionStorage.getItem('predictor-proof-result') ?? 'null')) as AnalysisResult;
// The boundary schema requires metadata.
const metadata = result.metadata!;
store.setState({ gene: metadata.gene, variant: metadata.variant, uniprotId: metadata.uniprotId,
  analysisState: { result, isLoading: false, error: null }, isFolding: false, isBiophysicalLoading: false });
const nativeFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.includes('/api/') ? Response.json({ error: 'Optional live services disabled in verification' }, { status: 404 }) : nativeFetch(input, init);
};
function Preview() {
  const [view, setView] = useState<MasterView>('evidence');
  const [tab, setTab] = useState('predictors');
  const [metric, setMetric] = useState<'mean' | 'max'>('mean');
  const [width, setWidth] = useState(31);
  const { isDark, setTheme } = useSettings();
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--cs-bg)', color: 'var(--cs-text-primary)' }}>
    <header style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center', fontSize: 13 }}>
      <strong>Saved GATA4 result / provider verification</strong>
      <button className="viz-action" onClick={() => setTheme(isDark ? 'light' : 'dark')}>Switch theme</button>
    </header>
    <AppViews masterView={view} setMasterView={setView} pushErrorEntry={console.error} setIsSettingsOpen={() => {}}
      activeEvidenceTab={tab} setActiveEvidenceTab={setTab} metricMode={metric} setMetricMode={setMetric}
      windowSize={width} setWindowSize={setWidth} classCardTitle="" classCardHeader="" classBorderSec="" classTextBody="" classTextMute="" />
  </div>;
}
createRoot(document.getElementById('root')!).render(<SettingsProvider><Preview /></SettingsProvider>);
