import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-code-pro';
import '@fontsource-variable/lora';
import '../../src/index.css';
import AppViews from '../../src/components/AppViews';
import { SettingsProvider, useSettings } from '../../src/context/SettingsContext';
import { useVariantAnalysisStore as store } from '../../src/stores/useVariantAnalysisStore';
import { nae1Reference } from '../../src/shared/__tests__/fixtures/splicingReference';
import type { MasterView } from '../../src/components/MasterSidebar';

let example = 'Dense';
const papers = Array.from({ length: 36 }, (_, i) => ({ id: String(91000000 + i),
  title: i === 0 ? 'Illustrative case: NAE1 p.Asp116Gly in a patient cohort' : i % 4 === 0 ? `Illustrative source ${i + 1}: regulatory pathways and protein turnover` : `Illustrative source ${i + 1}: NAE1 activity and neddylation`,
  abstract: i === 0 ? 'We describe a patient with NAE1 p.Asp116Gly. Enzyme activity was measured in vitro. This is an illustrative test record.' : i % 4 === 0 ? 'Protein turnover was examined across a regulatory pathway. This is an illustrative test record.' : 'NAE1 enzyme activity was measured in vitro. Reduced enzyme activity was observed. These illustrative observations test the screening display only.',
  authors: 'Preview research consortium', journal: 'Illustrative records', year: 2026 - i % 12 }));
const nativeFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/literature/')) {
    const p = new URL(url, location.origin).searchParams, query = p.get('query') ?? '';
    if (example === 'Error') return Response.json({ error: 'Illustrative provider error' }, { status: 400 });
    const variant = query.includes('D116G');
    const list = example === 'Missing' ? [] : example === 'Sparse' ? papers.slice(0, 2) : papers.slice(p.has('cursor') ? 25 : 0, p.has('cursor') ? 36 : 25);
    return Response.json({ gene: 'NAE1', citations: variant ? example === 'Missing' ? [] : [papers[0]] : list, hitCount: variant ? example === 'Missing' ? 0 : 1 : example === 'Missing' ? 0 : example === 'Sparse' ? 2 : 204,
      europePmcQuery: query || 'NAE1 AND (mutation OR variant OR functional OR "pathogenic")', degraded: example === 'Degraded', fetchedAt: 1700000000000, pageSize: 25,
      nextCursor: variant || p.has('cursor') || example !== 'Dense' ? null : 'fixture-page-2' });
  }
  return url.includes('/api/') ? Response.json({ error: 'Live services disabled in preview' }, { status: 404 }) : nativeFetch(input, init);
};
function scenario(name: string) {
  example = name;
  const result = nae1Reference({ isDemoData: true, metadata: { variant: name === 'New allele' ? 'p.Asp116Ala' : name === 'Unsupported notation' ? 'c.123A>G' : 'p.Asp116Gly' },
    analysis: name === 'Missing' ? '' : '### Clinical and Pathogenicity Interpretation\n\nIllustrative summary: this fixture tests the distinction between recorded criteria, uncounted context, and a written interpretation. It is not a clinical assessment.',
    ruleBasedInsights: { acmgVerdict: 'Variant of Uncertain Significance (VUS)', acmgCriteria: [{ code: name === 'Strength suffix' ? 'PP3_Moderate' : 'PP3', reason: 'Illustrative engine record.' }], plausibility: '' },
    insights: { source: 'rule_based', acmgCriteria: [], biochemicalShift: '', structuralImpact: '' } });
  store.setState({ gene: 'NAE1', variant: result.metadata.variant, uniprotId: 'Q13564', analysisState: { result, isLoading: false, error: null }, isBiophysicalLoading: false });
  store.getState().setFoldingEnergetics(name === 'Missing' ? null : { foldx: 2.62, dynamut2: -1.4, ddmut: -1.2, rasp: .9, thermompnn: 1.1, stabilityoracle: 1.3 });
}
scenario('Dense');
function Preview() {
  const [view, setView] = useState<MasterView>('insights');
  const [tab, setTab] = useState('predictors');
  const [name, setName] = useState('Dense');
  const [metric, setMetric] = useState<'mean' | 'max'>('mean');
  const [width, setWidth] = useState(31);
  const { isDark, setTheme } = useSettings();
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--cs-bg)', color: 'var(--cs-text-primary)' }}>
    <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: 12, fontSize: 13 }}>
      <strong>Illustrative review fixtures · not clinical evidence</strong>
      <label>Workspace <select aria-label="Workspace" value={view} onChange={e => setView(e.target.value as MasterView)}><option value="search">Query</option><option value="insights">Insights</option><option value="literature">Literature</option></select></label>
      <label>Example <select aria-label="Example" value={name} onChange={e => { setName(e.target.value); scenario(e.target.value); }}>{['Dense', 'Sparse', 'Missing', 'Degraded', 'Error', 'New allele', 'Strength suffix', 'Unsupported notation'].map(n => <option key={n}>{n}</option>)}</select></label>
      <button className="review-action" onClick={() => setTheme(isDark ? 'light' : 'dark')}>Switch theme</button>
    </header>
    <AppViews masterView={view} setMasterView={setView} pushErrorEntry={console.error} setIsSettingsOpen={() => {}}
      activeEvidenceTab={tab} setActiveEvidenceTab={setTab} metricMode={metric} setMetricMode={setMetric} windowSize={width} setWindowSize={setWidth}
      classCardTitle="" classCardHeader="" classInput="" classBorderSec="" classTextBody="" classTextMute="" />
  </div>;
}
createRoot(document.getElementById('root')!).render(<SettingsProvider><Preview /></SettingsProvider>);
