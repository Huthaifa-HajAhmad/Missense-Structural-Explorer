import type { EvidenceChartRow, EvidenceWorkspaceTab } from '../../shared/evidenceComparison';
import { useEvidenceWorkspace } from '../evidence/EvidenceWorkspace';
import { INSPECTOR_SECTIONS } from '../../lib/inspectorFocus';
import { safeExternalHref } from '../../shared/externalLink';
import { ResearchGuideButton } from '../knowledge/ResearchGuideButton';
import { EVIDENCE_GUIDES, resolveResearchGuide } from '../../shared/researchGuides';

/** Adds a pinned reading to the existing rule trace; never replaces provenance. */
export function EvidenceReadingInspector({ tab, rows }: { tab: EvidenceWorkspaceTab; rows: (EvidenceChartRow & { reportUrl?: string | null })[] }) {
  const w = useEvidenceWorkspace(tab);
  if (!w.enabled) return null;
  const row = rows.find(r => r.key === w.selected);
  const report = safeExternalHref(row?.reportUrl);
  const topic = row?.knowledgeKey && resolveResearchGuide(row.knowledgeKey) ? row.knowledgeKey : EVIDENCE_GUIDES[tab];
  return <section className="evw-inspection" id={INSPECTOR_SECTIONS.evidenceReading} tabIndex={-1} aria-label="Selected evidence reading">
    <span className="eyebrow">{row ? 'Pinned reading' : 'Explore a reading'}</span>
    <span className="sr-only" role="status">{row ? `${row.name} pinned in the inspector.` : 'No reading pinned.'}</span>
    {row ? <><h3>{row.name}</h3><p>{row.description}</p><dl>{row.facts.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
      <details open key={row.key}><summary>How to interpret this reading</summary>{row.notes.map((note, i) => <p key={i}>{note}</p>)}</details>
      <ResearchGuideButton topic={topic} label="Background for this reading" />
      {report && <a className="ctx-link" href={report} target="_blank" rel="noreferrer">Open source report (opens in a new tab)</a>}
      <button type="button" className="viz-action" onClick={() => w.select(null)}>Clear pin</button></>
      : <><h3>{w.selected ? 'The selected reading is no longer available' : 'Select a point or source record'}</h3><p>Its exact value, meaning and source will appear here. The evidence trace remains below.</p>{w.selected && <button type="button" className="viz-action" onClick={() => w.select(null)}>Clear pin</button>}</>}
  </section>;
}
