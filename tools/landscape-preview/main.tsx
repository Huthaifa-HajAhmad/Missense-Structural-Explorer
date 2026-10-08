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

const long = new URLSearchParams(window.location.search).get('fixture') === 'long';
const sequence = long ? 'A'.repeat(204) + 'S' + 'A'.repeat(1295) : 'MATKAVCVLKGDGPVQGIINFEQKESNGPVKVWGSIKGLTEGLHGFHVHEFGDNTAGCTSAGPHFNPLSRKHGGPKDEERHVGDLGNVTADKDGVADVSIEDSVISLSGDHCIIGRTLVVHEKADDLGKGGNEESTKTGNAGSRLACGVIGIAQ';
const gene = long ? 'LONG-FIXTURE' : 'SOD1';
const variant = long ? 'p.Ser205Cys' : 'p.Ala5Val';
const accession = long ? 'LONG-FIXTURE' : 'P00441';
const target = long ? { pos: 205, wt: 'S', mut: 'C' } : { pos: 5, wt: 'A', mut: 'V' };
const key = landscapeKey(gene, variant, accession);
const longRows = Array.from({ length: 1500 }, (_, i) => {
  const am = (Math.sin(i * .73) + 1) / 2;
  return { residx: i + 1, aaref: sequence[i], amMean: am, amMin: am, amMax: am, amCount: 1,
    revelMean: am, revelMin: am, revelMax: am, revelCount: 1, gerp: 3, phylop: 2, nucleotideCount: 3,
    substitutions: [{ alt: sequence[i] === 'S' ? 'C' : 'V', am, revel: am }] };
});
longRows[204] = { ...longRows[204], amMean: .55, amMin: .179, amMax: .984, amCount: 6, revelMean: .74, revelMin: .64, revelMax: .82, revelCount: 6,
  substitutions: ['C','A','T','Y','F','P'].map((alt, i) => ({ alt, am: [.179,.27,.41,.58,.88,.984][i], revel: [.752,.69,.64,.78,.80,.82][i] })) };
const context = long ? { ...SOD1_LANDSCAPE_CONTEXT,
  clinvar: Array.from({ length: 600 }, (_, i) => ({ pos: 1 + i * 2, cls: i % 3 === 0 ? 'plp' : i % 3 === 1 ? 'blb' : 'other', significance: 'Synthetic assertion', stars: null, hgvsp: `p.Ala${1 + i * 2}Val` })),
  gnomad: Array.from({ length: 1000 }, (_, i) => ({ pos: i + 1, variants: i % 20 + 1, maxAc: i % 70 })),
  regions: null, regionsStatus: 'withheld-mapping',
} : SOD1_LANDSCAPE_CONTEXT;
const result: any = {
  metadata: { residueIndex: target.pos, wildType: long ? 'Ser' : 'A', mutant: long ? 'Cys' : 'V', variant },
  predictorData: { amPathogenicity: long ? .108 : SOD1_VARIANT_SCORES.am },
  conservationData: { revel: long ? .752 : SOD1_VARIANT_SCORES.revel },
  landscapeData: long ? longRows : SOD1_LANDSCAPE_ROWS,
  landscapeMeta: null,
  uniprotFeatures: { features: long ? [{ type: 'DOMAIN', description: 'Synthetic domain A', start: 70, end: 210 }, { type: 'DOMAIN', description: 'Synthetic domain B', start: 600, end: 800 }] : [{ type: 'DOMAIN', description: 'Cu/Zn superoxide dismutase', start: 1, end: 153 }] },
};
store.setState({ gene, variant, uniprotId: accession, selectedResidueIndex: target.pos,
  hoveredResidueIndex: null, landscapeSelection: { key, kind: 'substitution', pos: target.pos, alt: target.mut },
  landscapeOverview: { key, status: 'ready', error: null, data: { positions: result.landscapeData, context, meta: {} } as any },
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
      <span><strong>Missense & Fold</strong> <span style={{ marginLeft: 24 }}>{long ? "Synthetic 1,500-residue density fixture · S205C" : "SOD1 · p.Ala5Val"}</span></span>
      <span style={{ fontSize: 12 }}>Layout review · test fixtures, not live evidence <button className="viz-action" style={{ marginLeft: 16 }} onClick={() => setTheme(isDark ? 'light' : 'dark')}>Switch theme</button></span>
    </header>
    <main style={{ flex: 1, minHeight: 0 }}><div className="data-screen-layout landscape-workspace">
      <div className="data-screen-primary"><div className="landscape-main" style={{ overflowY: 'auto' }}>
        <SequenceVisualizer uniprotId={accession} gene={gene} variant={variant} residueIndex={selected}
          targetResidue={target} onResidueClick={select} predictorData={result.predictorData}
          conservationData={result.conservationData} landscapeData={result.landscapeData} uniprotFeatures={result.uniprotFeatures.features}
          metricMode={mode} setMetricMode={setMode} windowSize={width} setWindowSize={setWidth} />
      </div></div>
      <ViewInspector activeView="landscape" onViewChange={() => {}} analysisResult={result} isFolding={false}
        isBiophysicalLoading={false} isClinicalLoading={false} gene={gene} variant={variant}
        onSelectResidueIndex={select} metricMode={mode} />
    </div></main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<SettingsProvider><Preview /></SettingsProvider>);
