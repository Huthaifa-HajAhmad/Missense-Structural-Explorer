/** Production AppViews on the Report tab with labelled example values; no live analysis or scientific evidence. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-code-pro';
import '../../src/index.css';
import AppViews from '../../src/components/AppViews';
import type { MasterView } from '../../src/components/MasterSidebar';
import { SettingsProvider, useSettings } from '../../src/context/SettingsContext';
import { useVariantAnalysisStore as store } from '../../src/stores/useVariantAnalysisStore';
import { NAE1_RESULT } from '../../src/shared/__tests__/fixtures/nae1Result';

const result: any = {
  ...NAE1_RESULT,
  metadata: { gene: 'NAE1', variant: 'p.Asp116Gly', uniprotId: 'Q13564', residueIndex: 116, acmgWeighting: 'standard' },
  analysis: '### Clinical and Pathogenicity Interpretation\n\nAn **example** written summary. Several predictors lean damaging while the population record is absent.\n\n- Computational tools disagree.\n- No functional assay is cited.',
  predictorData: { ...NAE1_RESULT.predictorData, source: 'Ensembl VEP', spliceAiMax: 0.02 },
  ruleBasedInsights: { plausibility: '', acmgVerdict: 'Variant of Uncertain Significance (VUS)', acmgCriteria: [{ code: 'PP3', reason: '3/6 predictors agree on pathogenic impact.' }, { code: 'PM2', reason: 'Absent from gnomAD.' }], partialEvidence: { available: [], unavailable: [] } },
  insights: { acmgVerdict: 'Variant of Uncertain Significance (VUS)', model: 'example-model', source: 'ai_inference',
    acmgCriteria: [{ code: 'PP3', reason: '3/6 predictors agree', source: 'database_verified' }, { code: 'PS3', reason: 'assay in a cited abstract', source: 'ai_suggested' }] },
};
store.setState({ gene: 'NAE1', variant: 'p.Asp116Gly', uniprotId: 'Q13564',
  analysisState: { result, error: null, isLoading: false } as any,
  foldingEnergetics: { foldx: 2.1, dynamut2: 0.4 } as any, foldingStatus: 'success', isFolding: false });

const nativeFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.includes('/api/') ? Response.json({ error: 'Live services disabled in preview' }, { status: 404 }) : nativeFetch(input, init);
};

function Preview() {
  const [view, setView] = useState<MasterView>('report');
  const [metric, setMetric] = useState<'mean' | 'max'>('mean');
  const [width, setWidth] = useState(31);
  const { isDark, setTheme } = useSettings();
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--cs-bg)', color: 'var(--cs-text-primary)' }}>
    <header style={{ padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
      <strong>Illustrative data · not scientific evidence</strong>
      <button className="viz-action" onClick={() => setTheme(isDark ? 'light' : 'dark')}>Switch theme</button>
      <button className="viz-action" onClick={() => setView('report')}>Report</button>
      <button className="viz-action" onClick={() => setView('landscape')}>Landscape</button>
      <button className="viz-action" onClick={() => store.setState({ analysisState: { result: null, error: null, isLoading: false } as any })}>Empty</button>
    </header>
    <AppViews masterView={view} setMasterView={setView} pushErrorEntry={console.error} setIsSettingsOpen={() => {}}
      activeEvidenceTab="population" setActiveEvidenceTab={() => {}} metricMode={metric} setMetricMode={setMetric}
      windowSize={width} setWindowSize={setWidth} classCardTitle="" classCardHeader="" classInput="" classBorderSec="" classTextBody="" classTextMute="" />
  </div>;
}
createRoot(document.getElementById('root')!).render(<SettingsProvider><Preview /></SettingsProvider>);
