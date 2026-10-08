/** Local visual review only. Uses documented test fixtures, never production evidence. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-code-pro';
import '../../src/index.css';
import { SettingsProvider, useSettings } from '../../src/context/SettingsContext';
import SequenceVisualizer from '../../src/components/SequenceVisualizer';
import ViewInspector from '../../src/components/inspector/ViewInspector';
import { useVariantAnalysisStore as store } from '../../src/stores/useVariantAnalysisStore';
import { landscapeKey } from '../../src/shared/landscapeEvidence';
import { SOD1_LANDSCAPE_ROWS, SOD1_LANDSCAPE_CONTEXT, SOD1_VARIANT_SCORES } from '../../src/shared/__tests__/fixtures/sod1Landscape';

const sequence = 'MATKAVCVLKGDGPVQGIINFEQKESNGPVKVWGSIKGLTEGLHGFHVHEFGDNTAGCTSAGPHFNPLSRKHGGPKDEERHVGDLGNVTADKDGVADVSIEDSVISLSGDHCIIGRTLVVHEKADDLGKGGNEESTKTGNAGSRLACGVIGIAQ';
const key = landscapeKey('SOD1', 'p.Ala5Val', 'P00441');
const result: any = {
  metadata: { residueIndex: 5, wildType: 'A', mutant: 'V', variant: 'p.Ala5Val' },
  predictorData: { amPathogenicity: SOD1_VARIANT_SCORES.am },
  conservationData: { revel: SOD1_VARIANT_SCORES.revel },
  landscapeData: SOD1_LANDSCAPE_ROWS,
  landscapeMeta: null,
  uniprotFeatures: { features: [{ type: 'DOMAIN', description: 'Cu/Zn superoxide dismutase', start: 1, end: 153 }] },
};
store.setState({ gene: 'SOD1', variant: 'p.Ala5Val', uniprotId: 'P00441', selectedResidueIndex: 5,
  hoveredResidueIndex: null, landscapeSelection: { key, kind: 'substitution', pos: 5, alt: 'V' },
  landscapeOverview: { key, status: 'ready', error: null, data: { positions: SOD1_LANDSCAPE_ROWS, context: SOD1_LANDSCAPE_CONTEXT, meta: {} } as any },
});
const nativeFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/api/v1/sequence/')) return Response.json({ sequence });
  if (url.includes('/api/')) return Response.json({ error: 'No live services in this fixture preview' }, { status: 404 });
  return nativeFetch(input, init);
};
function Preview() {
  const selected = store(s => s.selectedResidueIndex);
  const select = store(s => s.setSelectedResidueIndex);
  const [mode, setMode] = useState<'mean' | 'max'>('mean');
  const [width, setWidth] = useState(31);
  const { setTheme, isDark } = useSettings();
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--cs-bg)', color: 'var(--cs-text-primary)' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', borderBottom: '1px solid var(--cs-border-subtle)', background: 'var(--cs-surface)' }}>
      <span><strong>Missense & Fold</strong> <span style={{ marginLeft: 24 }}>SOD1 · p.Ala5Val</span></span>
      <span style={{ fontSize: 12 }}>Layout review · test fixtures, not live evidence <button className="viz-action" style={{ marginLeft: 16 }} onClick={() => setTheme(isDark ? 'light' : 'dark')}>Switch theme</button></span>
    </header>
    <main style={{ flex: 1, minHeight: 0 }}><div className="data-screen-layout landscape-workspace">
      <div className="data-screen-primary"><div className="landscape-main" style={{ overflowY: 'auto' }}>
        <SequenceVisualizer uniprotId="P00441" gene="SOD1" variant="p.Ala5Val" residueIndex={selected}
          targetResidue={{ pos: 5, wt: 'A', mut: 'V' }} onResidueClick={select} predictorData={result.predictorData}
          conservationData={result.conservationData} landscapeData={result.landscapeData} uniprotFeatures={result.uniprotFeatures.features}
          metricMode={mode} setMetricMode={setMode} windowSize={width} setWindowSize={setWidth} />
      </div></div>
      <ViewInspector activeView="landscape" onViewChange={() => {}} analysisResult={result} isFolding={false}
        isBiophysicalLoading={false} isClinicalLoading={false} gene="SOD1" variant="p.Ala5Val"
        onSelectResidueIndex={select} metricMode={mode} />
    </div></main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<SettingsProvider><Preview /></SettingsProvider>);
