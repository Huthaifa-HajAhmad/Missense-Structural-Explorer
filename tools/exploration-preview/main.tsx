/** Production AppViews with synthetic coordinates; no live analysis or scientific evidence. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-code-pro';
import '@fontsource-variable/lora';
import '../../src/index.css';
import AppViews from '../../src/components/AppViews';
import type { MasterView } from '../../src/components/MasterSidebar';
import { SettingsProvider, useSettings } from '../../src/context/SettingsContext';
import { useVariantAnalysisStore as store } from '../../src/stores/useVariantAnalysisStore';
import { landscapeKey } from '../../src/shared/landscapeEvidence';
import { AMINO_ACID_1_TO_3_TITLE } from '../../src/shared/aminoAcids';
import { SOD1_LANDSCAPE_ROWS, SOD1_LANDSCAPE_CONTEXT, SOD1_VARIANT_SCORES } from '../../src/shared/__tests__/fixtures/sod1Landscape';

const sequence = 'MATKAVCVLKGDGPVQGIINFEQKESNGPVKVWGSIKGLTEGLHGFHVHEFGDNTAGCTSAGPHFNPLSRKHGGPKDEERHVGDLGNVTADKDGVADVSIEDSVISLSGDHCIIGRTLVVHEKADDLGKGGNEESTKTGNAGSRLACGVIGIAQ';
// Helical stand-in geometry; intentionally not the SOD1 fold. Missing position 30 exercises coverage.
const pdb = sequence.split('').flatMap((aa, i) => i === 29 ? [] : ['N', 'CA', 'C', 'O'].map((atom, j) => {
  const t = i * 1.7 + j * .22;
  const xyz = [Math.cos(t) * 8, Math.sin(t) * 8, i * .7 + j * .2].map(n => n.toFixed(3).padStart(8)).join('');
  return `ATOM  ${String(i * 4 + j + 1).padStart(5)}  ${atom.padEnd(3)} ${AMINO_ACID_1_TO_3_TITLE[aa].toUpperCase()} A${String(i + 1).padStart(4)}    ${xyz}  1.00 85.00           ${atom[0]}`;
})).join('\n') + '\nEND';
const key = landscapeKey('SOD1', 'p.Ala5Val', 'P00441');
const result = {
  metadata: { gene: 'SOD1', variant: 'p.Ala5Val', uniprotId: 'P00441', residueIndex: 5, wildType: 'Ala', mutant: 'Val', sequenceLength: sequence.length },
  predictorData: { amPathogenicity: SOD1_VARIANT_SCORES.am }, conservationData: { revel: SOD1_VARIANT_SCORES.revel },
  landscapeData: SOD1_LANDSCAPE_ROWS, landscapeMeta: null, uniprotFeatures: { features: [] },
};
store.setState({ gene: 'SOD1', variant: 'p.Ala5Val', uniprotId: 'P00441', selectedResidueIndex: 5,
  hoveredResidueIndex: null, landscapeSelection: { key, kind: 'substitution', pos: 5, alt: 'V' },
  landscapeOverview: { key, status: 'ready', error: null, data: { positions: SOD1_LANDSCAPE_ROWS, context: SOD1_LANDSCAPE_CONTEXT, meta: {} } as any },
  analysisState: { result, error: null, isLoading: false } as any,
  pdbText: pdb, pdbTextProvenance: { source: 'alphafold', afdbVersion: 'fixture' },
  esmFoldWtPdb: pdb, esmFoldMutPdb: null, viewMode: 'wildtype', structureRepresentation: 'confidence',
  foldingStatus: 'unavailable', isFolding: false, isEsmFolding: false,
});
const nativeFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/api/v1/sequence/')) return Response.json({ sequence });
  if (url.includes('/api/')) return Response.json({ error: 'Live services disabled for fixture review' }, { status: 404 });
  return nativeFetch(input, init);
};

function Preview() {
  const [view, setView] = useState<MasterView>('landscape');
  const [metric, setMetric] = useState<'mean' | 'max'>('mean');
  const [width, setWidth] = useState(31);
  const { isDark, setTheme } = useSettings();
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--cs-bg)', color: 'var(--cs-text-primary)' }}>
    <header style={{ padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
      <strong>Synthetic fixture · not scientific evidence</strong>
      <button className="viz-action" onClick={() => setTheme(isDark ? 'light' : 'dark')}>Switch theme</button>
      <button className="viz-action" onClick={() => store.setState({ selectedResidueIndex: 30, landscapeSelection: { key, kind: 'residue', pos: 30 } })}>Missing residue fixture</button>
      <button className="viz-action" onClick={() => store.setState({ customPdbUrl: '/fixture/entry.pdb', customPdbEntry: { url: '/fixture/entry.pdb', text: pdb, numbering: 'author', chainId: 'A', mapping: null, reason: 'Synthetic unmapped entry' } })}>Unmapped entry fixture</button>
    </header>
    <AppViews masterView={view} setMasterView={setView} pushErrorEntry={console.error} setIsSettingsOpen={() => {}}
      activeEvidenceTab="population" setActiveEvidenceTab={() => {}} metricMode={metric} setMetricMode={setMetric}
      windowSize={width} setWindowSize={setWidth} classCardTitle="" classCardHeader="" classBorderSec="" classTextBody="" classTextMute="" />
  </div>;
}
createRoot(document.getElementById('root')!).render(<SettingsProvider><Preview /></SettingsProvider>);
