import { ArrowUpRight, MousePointer2, Pin, X } from 'lucide-react';
import { useEvidenceWorkspace } from '../evidence/EvidenceWorkspace';
import { INSPECTOR_SECTIONS } from '../../lib/inspectorFocus';
import { safeExternalHref } from '../../shared/externalLink';
import type { SplicingWorkspaceReading } from '../../shared/splicingWorkspace';

const offsetLabels = ['Genomic offset from variant', 'Transcript offset from variant'];
const settingLabels = ['Reporting window', 'Masking'];
/** A splice reading has two coordinate systems: keep them paired, separate from provenance. */
export function SplicingReadingInspector({ rows }: { rows: SplicingWorkspaceReading[] }) {
  const workspace = useEvidenceWorkspace('splicing');
  if (!workspace.enabled) return null;
  const row = rows.find(r => r.key === workspace.selected);
  const report = safeExternalHref(row?.reportUrl);
  const score = row?.facts[0];
  const offsets = row?.facts.filter(f => offsetLabels.includes(f.label)) ?? [];
  const settings = row?.facts.filter(f => settingLabels.includes(f.label)) ?? [];
  const provenance = row?.facts.filter(f => f !== score && !offsetLabels.includes(f.label) && !settingLabels.includes(f.label) && f.label !== 'Annotated-site relationship') ?? [];

  return <section className="spl-inspection" id={INSPECTOR_SECTIONS.evidenceReading} tabIndex={-1} aria-label="Selected evidence reading">
    <span className="sr-only" role="status">{row ? `${row.name} pinned in the inspector.` : 'No reading pinned.'}</span>
    <header className="spl-inspection__head">
      <span className="eyebrow"><Pin size={13} aria-hidden="true" />{row ? 'Pinned reading' : 'Explore a reading'}</span>
      {workspace.selected && <button type="button" className="spl-inspection__clear" aria-label="Clear pin" title="Clear pin" onClick={() => workspace.select(null)}><X size={15} aria-hidden="true" /></button>}
    </header>
    {row ? <>
      <div className="spl-inspection__reading">
        <h3>{row.name}</h3>
        <div className="spl-inspection__score" data-missing={row.value === null || undefined}>{row.valueText}</div>
        <span className="spl-inspection__unit">{score?.label}</span>
        <p>{row.description}</p>
      </div>
      {row.channel && <div className="spl-inspection__position">
        <h4>Position from variant</h4>
        {offsets.length > 0
          ? <dl className="spl-inspection__pair">{offsets.map(f => <div key={f.label}><dt>{f.label.startsWith('Genomic') ? 'Genomic' : 'Transcript'}</dt><dd>{f.value}</dd></div>)}</dl>
          // Below the floor or not returned: the record states why no offset is shown as a location.
          : <p className="spl-inspection__no-position">{row.position}</p>}
        <p>{row.site}</p>
      </div>}
      <div className="spl-inspection__provenance">
        <h4>Source & provenance</h4>
        {settings.length > 0 && <dl className="spl-inspection__pair">{settings.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>}
        <dl className="spl-inspection__facts">{provenance.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
      </div>
      <details className="spl-inspection__notes" key={row.key}>
        <summary>How to interpret this reading</summary>
        {row.notes.map((note, i) => <p key={i}>{note}</p>)}
      </details>
      {report && <a className="spl-inspection__source" href={report} target="_blank" rel="noreferrer">SpliceAI source documentation<ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>}
    </> : <div className="spl-inspection__empty">
      <MousePointer2 size={24} strokeWidth={1.5} aria-hidden="true" />
      <h3>{workspace.selected ? 'Reading no longer available' : 'Follow a splice reading'}</h3>
      <p>Select a map marker or source record to inspect its exact score, position and provenance.</p>
      <span>The rule trace remains below.</span>
    </div>}
  </section>;
}
