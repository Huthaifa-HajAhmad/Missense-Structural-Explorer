import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-code-pro';
import '../../src/index.css';
import { ResearchGuideButton } from '../../src/components/knowledge/ResearchGuideButton';
import { ModelKnowledgeModal } from '../../src/components/modals/ModelKnowledgeModal';
import { MetricExplanationModal } from '../../src/components/evidence/MetricExplanationModal';
import { HowToInspectModal } from '../../src/components/modals/HowToInspectModal';
import CommandPalette from '../../src/components/CommandPalette';
import { SettingsProvider, useSettings } from '../../src/context/SettingsContext';
import { useSidebarShortcut } from '../../src/hooks/useSidebarShortcut';
import LiveTelemetryPanel from '../../src/components/telemetry/LiveTelemetryPanel';

function TelemetryPreview() {
  const [actions, setActions] = useState(0);
  return <main className="max-w-md p-4"><output aria-label="Configuration actions">{actions}</output>
    <LiveTelemetryPanel onConfigureClick={() => setActions(n => n + 1)} /></main>;
}

function Preview() {
  const [model, setModel] = useState<string | null>(null);
  const [metric, setMetric] = useState<string | null>(null);
  const [inspect, setInspect] = useState(false);
  const [palette, setPalette] = useState(false);
  const [sidebarToggles, setSidebarToggles] = useState(0);
  const { settings, updateSetting } = useSettings();
  useSidebarShortcut(() => setSidebarToggles(n => n + 1));
  return <main style={{ padding: '2rem', minHeight: '130vh', background: 'var(--cs-bg)', color: 'var(--cs-text-primary)' }}>
    <h1 className="screen-title">Individual scientific explanations</h1>
    <p>Development preview. Each control opens its own explanation. No live variant values or services.</p>
    <button type="button" className="rgd-trigger" onClick={() => document.documentElement.classList.toggle('dark')}>Switch theme</button>
    <button type="button" className="rgd-trigger" aria-pressed={settings.reducedMotion} onClick={() => updateSetting('reducedMotion', !settings.reducedMotion)}>Toggle reduced motion</button>
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBlock: '2rem' }}>
      <button type="button" className="rgd-trigger" onClick={() => setModel('foldx')}>About FoldX</button>
      <button type="button" className="rgd-trigger" onClick={() => setModel('revel')}>About REVEL</button>
      <button type="button" className="rgd-trigger" onClick={() => setMetric('rmsd')}>Explain RMSD</button>
      <button type="button" className="rgd-trigger" onClick={() => setInspect(true)}>Read the 3D view</button>
      <ResearchGuideButton topic="llr" label="Explain LLR" />
      <ResearchGuideButton topic="missing_data" label="Why no result?" />
      <ResearchGuideButton topic="vesm_embedding" label="About VESM embeddings" />
    </div>
    <ModelKnowledgeModal isOpen={model !== null} modelKey={model} onClose={() => setModel(null)} />
    <MetricExplanationModal selectedMetric={metric} setSelectedMetric={setMetric} isDark={false} />
    <HowToInspectModal isOpen={inspect} onClose={() => setInspect(false)} isDark={false} selectedResidueIndex={116} gene="NAE1" />
    <p>The surrounding research workspace remains visible through the dimmed backdrop.</p>
    <output aria-label="Sidebar toggle count">{sidebarToggles}</output>
    <CommandPalette open={palette} onOpenChange={setPalette} onViewChange={() => {}} onEvidenceTabChange={() => {}} onSelectHistory={() => {}} onRunQuery={() => {}} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<SettingsProvider>{location.search.includes('telemetry') ? <TelemetryPreview /> : <Preview />}</SettingsProvider>);
