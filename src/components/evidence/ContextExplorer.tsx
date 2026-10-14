import React, { useMemo } from 'react';
import { contextPage, type ContextReading, type ContextTab } from '../../shared/contextWorkspace';
import { useEvidenceWorkspace, InspectReadingButton } from './EvidenceWorkspace';
import { DGTEX_COHORTS } from '../../shared/developmentalExpression';
import { AlignmentStrip } from './ContextCharts';
import { AssertionMatrix } from './ContextFigures';
import { WorkspaceTabs } from '../ui/WorkspaceTabs';
const EvidenceComparison = React.lazy(() => import('./EvidenceComparison'));

/** Page size for source records and the expression chart alike; one number, three captions. */
const CX_PAGE_LIMIT = 20;

export function ContextGuide({ children }: { children: React.ReactNode }) {
  return <details className="cx-guide"><summary>How to read this evidence</summary><div>{children}</div></details>;
}

/** Dense secondary tables mount only on demand; the open state survives tab navigation. */
export function ContextDisclosure({ tab, id, title, children }: { tab: ContextTab; id: string; title: string; children: React.ReactNode }) {
  const w = useEvidenceWorkspace(tab);
  const key = `detail:${id}`;
  const open = !w.enabled || w.expanded.includes(key);
  return <details className="ctx-details" open={open} onToggle={e => {
    if (w.enabled && e.currentTarget.open !== open) w.toggleGroup(key);
  }}><summary>{title}</summary>{open && children}</details>;
}

/** Both representations select the same record keys. Bounds are presentation only;
 * searching resets the visible page but never changes the quantitative source domain. */
export function ContextExplorer({ tab, rows, groups, empty, relevantLabel = 'Review systems only' }: {
  tab: ContextTab; rows: ContextReading[]; groups: { id: string; label: string }[]; empty?: React.ReactNode; relevantLabel?: string;
}) {
  const w = useEvidenceWorkspace(tab);
  const group = groups.some(g => g.id === w.section) ? w.section : groups[0].id;
  const all = w.expanded.includes(`all:${group}:${w.query}:${w.cohort}:${w.relevantOnly}`);
  const page = useMemo(() => contextPage(rows, { group, query: w.query, cohort: group === 'developmental' ? w.cohort : 'all',
    relevantOnly: w.relevantOnly, limit: all ? Number.MAX_SAFE_INTEGER : CX_PAGE_LIMIT }), [rows, group, w.query, w.cohort, w.relevantOnly, all]);
  const selected = rows.find(r => r.key === w.selected);
  const levels = useMemo(() => [...new Set(rows.filter(r => r.group === 'validity').map(r => r.valueText))], [rows]);
  const chart = useMemo(() => {
    const maximum = page.max || 1;
    const ticks = [0, maximum / 4, maximum / 2, maximum * .75, maximum];
    return { rows: page.rows.slice(0, CX_PAGE_LIMIT).map(r => ({ ...r, name: r.group === 'developmental' ? `${r.name} · cohort ${r.cohort}` : r.name })), domain: [0, maximum] as [number, number], ticks,
      tickLabels: ticks.map(t => t === 0 ? '0' : t < .001 ? t.toExponential(1) : String(Number(t.toPrecision(3)))),
      axisLabel: 'Median gene expression (TPM)', summary: 'Descriptive RNA abundance. No expression or pathogenicity threshold is applied.',
      unplottedHeading: 'Not plotted',
      unplottedBody: 'These tissues have no returned gene median. Missing measurements are not zero.',
      emptyCopy: 'No returned tissue values can plot on this axis. Inspect the source records below.' };
  }, [page]);
  return <section className="cx-explorer" aria-label="Explore source readings">
    {groups.length > 1 && <WorkspaceTabs id={`${tab}-sources`} label="Evidence sources" tabs={groups} value={group} onChange={section => w.setOptions({ section, query: '', relevantOnly: false })} />}
    <div role={groups.length > 1 ? 'tabpanel' : undefined} id={`${tab}-sources-panel-${group}`} aria-labelledby={groups.length > 1 ? `${tab}-sources-tab-${group}` : undefined}>
      <div className="cx-controls">
        <label>Search records<input type="search" value={w.query} placeholder={tab === 'expression-models' ? 'Tissue or cohort' : tab === 'gene-disease' ? 'Submitter or assertion' : 'Species, taxon or term'} onChange={e => w.setOptions({ query: e.target.value })} /></label>
        {group === 'developmental' && <label>Sampled age cohort<select value={w.cohort} onChange={e => w.setOptions({ cohort: e.target.value })}><option value="all">All public age cohorts</option>{Object.entries(DGTEX_COHORTS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
        {(tab === 'expression-models' || group === 'phenotypes') && <label className="cx-check"><input type="checkbox" checked={w.relevantOnly} onChange={e => w.setOptions({ relevantOnly: e.target.checked })} />{relevantLabel}</label>}
      </div>
      <p className="cx-caption" role="status">Showing {page.rows.length} of {page.total} matching records · {page.sourceCount} in this source view.</p>
      {group === 'developmental' && <p className="cx-caption">Sampled age is independent of disease onset. Cohorts are descriptive, not a developmental trajectory.</p>}
      {selected && !page.rows.some(r => r.key === selected.key) && <p className="cx-notice">The pinned record is outside this view. Its details remain in the inspector.</p>}
      {!page.rows.length ? <div className="cx-empty">{page.sourceCount ? 'No records match these display filters. Clear the search or filters to see the source readings.' : empty ?? 'No returned readings in this source view. Check the source status below.'}</div>
        : <div className="cx-records" data-testid="context-records">
          {w.comparison && tab === 'expression-models' ? <React.Suspense fallback={<p role="status">Preparing tissue comparison.</p>}><EvidenceComparison tab={tab} model={chart} title={group === 'adult' ? 'Adult tissue expression' : 'Pediatric tissue and age cohorts'} description="Compare measured medians within one source. Pin a tissue to inspect the exact value and sampling context." />{page.rows.length > CX_PAGE_LIMIT && <p className="cx-caption">The chart shows the first {CX_PAGE_LIMIT} matching readings. Source records contain all matches.</p>}</React.Suspense>
          : w.comparison && tab === 'gene-disease' && group === 'validity' ? <AssertionMatrix rows={page.rows} levels={levels} selected={w.selected} onSelect={key => w.select(key === w.selected ? null : key)} />
          : w.comparison ? page.rows.map(r => <button key={r.key} type="button" className="cx-reading" aria-pressed={w.selected === r.key} onClick={() => w.select(r.key)}>
            <span className="cx-reading__name">{r.name}<small>{r.group === 'developmental' || tab === 'species-models' ? r.description : r.source}</small></span>
            <span className="cx-reading__visual">{r.mapping?.window ? <AlignmentStrip mapping={r.mapping} /> : tab === 'expression-models' && r.value !== null ? <span className="cx-meter" aria-hidden="true"><span style={{ width: `${page.max > 0 ? r.value / page.max * 100 : 0}%` }} /><i style={{ left: `${page.max > 0 ? r.value / page.max * 100 : 0}%` }} /></span> : <span className="cx-category">{r.group}</span>}</span>
            <strong className="cx-reading__value">{r.valueText}</strong>
          </button>) : <div className="cx-table-scroll" role="region" aria-label="Exact source readings" tabIndex={0}><table className="cx-table"><thead><tr><th>Record</th><th>Reading</th><th>Source / context</th></tr></thead><tbody>{page.rows.map(r => <tr key={r.key} data-selected={w.selected === r.key || undefined}>
            <th scope="row"><InspectReadingButton tab={tab} readingKey={r.key}>{r.name}</InspectReadingButton></th><td>{tab === 'expression-models' && r.value !== null ? `${r.value} TPM` : r.valueText}</td><td>{r.source}<small>{r.description}</small></td>
          </tr>)}</tbody></table></div>}
        </div>}
      {page.total > CX_PAGE_LIMIT && <button type="button" className="viz-action" onClick={() => w.toggleGroup(`all:${group}:${w.query}:${w.cohort}:${w.relevantOnly}`)}>{all ? `Show first ${CX_PAGE_LIMIT}` : `Show all ${page.total} records`}</button>}
      <p className="cx-caption">
        {w.comparison && tab === 'expression-models'
          ? `Linear TPM scale: 0–${page.max || 1}. The scale uses the full source view and stays fixed when filtering. Zero is plotted at the origin; missing readings have no mark. Arrow keys explore the chart; Enter pins a reading.`
          : 'Select a record to pin its interpretation and provenance. Tab to a record, then press Enter or Space.'}
      </p>
    </div>
  </section>;
}
