import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { contextPage, type ContextReading, type ContextTab } from '../../shared/contextWorkspace';
import { useEvidenceWorkspace, InspectReadingButton } from './EvidenceWorkspace';
import { DGTEX_COHORTS } from '../../shared/developmentalExpression';
import { AlignmentStrip } from './ContextCharts';
import { AssertionMatrix } from './ContextFigures';
import { WorkspaceTabs } from '../ui/WorkspaceTabs';
import { ExpressionRecords } from './expression/ExpressionRecords';
import { validityPosition } from '../../shared/diseaseFrame';
const EvidenceComparison = React.lazy(() => import('./EvidenceComparison'));

/** Page size for source records and the expression chart alike; one number, three captions. */
const CX_PAGE_LIMIT = 20;

const TAB_CONFIG: Record<ContextTab, {
  hideControlsWhenEmpty: boolean;
  canRevealPin: boolean;
  searchPlaceholder: string;
}> = {
  'gene-disease': {
    hideControlsWhenEmpty: true,
    canRevealPin: true,
    searchPlaceholder: 'Submitter or assertion',
  },
  'expression-models': {
    hideControlsWhenEmpty: true,
    canRevealPin: true,
    searchPlaceholder: 'Tissue or cohort',
  },
  'species-models': {
    hideControlsWhenEmpty: true,
    canRevealPin: true,
    searchPlaceholder: 'Species, taxon or term',
  },
};

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
export function ContextExplorer({ tab, rows, groups, empty, relevantLabel = 'Review systems only', hasReviewSystems = true, onChooseSystems }: {
  tab: ContextTab; rows: ContextReading[]; groups: { id: string; label: string }[]; empty?: React.ReactNode; relevantLabel?: string; hasReviewSystems?: boolean; onChooseSystems?: () => void;
}) {
  const w = useEvidenceWorkspace(tab);
  const config = TAB_CONFIG[tab];
  const explorerRef = useRef<HTMLElement>(null);
  const [revealRequested, setRevealRequested] = useState(false);
  const expression = tab === 'expression-models';
  const relevantOnly = w.relevantOnly && (!expression || hasReviewSystems);
  const group = groups.some(g => g.id === w.section) ? w.section : groups[0].id;
  const all = w.expanded.includes(`all:${group}:${w.query}:${w.cohort}:${w.relevantOnly}`);
  const page = useMemo(() => contextPage(rows, { group, query: w.query, cohort: group === 'developmental' ? w.cohort : 'all',
    relevantOnly, limit: all ? Number.MAX_SAFE_INTEGER : CX_PAGE_LIMIT }), [rows, group, w.query, w.cohort, relevantOnly, all]);
  const selected = rows.find(r => r.key === w.selected);
  const levels = useMemo(() => [...new Set(rows.filter(r => r.group === 'validity').map(r => r.valueText))].sort((a, b) => (validityPosition(b) ?? -1) - (validityPosition(a) ?? -1)), [rows]);
  useLayoutEffect(() => {
    if (!revealRequested) return;
    const target = explorerRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    if (target) { target.focus(); target.scrollIntoView?.({ block: 'nearest' }); }
    setRevealRequested(false);
  }, [revealRequested]);
  const chart = useMemo(() => {
    const maximum = page.max || 1;
    const ticks = [0, maximum / 4, maximum / 2, maximum * .75, maximum];
    return { rows: page.rows.map(r => ({ ...r, name: r.group === 'developmental' ? `${r.name} · cohort ${r.cohort}` : r.name })), domain: [0, maximum] as [number, number], ticks,
      tickLabels: ticks.map(t => t === 0 ? '0' : t < .001 ? t.toExponential(1) : String(Number(t.toPrecision(3)))),
      axisLabel: 'Median gene expression (TPM)', summary: 'Descriptive RNA abundance. No expression or pathogenicity threshold is applied.',
      unplottedHeading: 'Not plotted',
      unplottedBody: 'These tissues have no returned gene median. Missing measurements are not zero.',
      emptyCopy: 'No returned tissue values can plot on this axis. Inspect the source records below.' };
  }, [page]);
  return <section ref={explorerRef} className="cx-explorer" aria-label="Explore source readings">
    {groups.length > 1 && <WorkspaceTabs id={`${tab}-sources`} label="Evidence sources" tabs={groups} value={group} onChange={section => w.setOptions({ section, query: '', relevantOnly: false })} />}
    <div role={groups.length > 1 ? 'tabpanel' : undefined} id={`${tab}-sources-panel-${group}`} aria-labelledby={groups.length > 1 ? `${tab}-sources-tab-${group}` : undefined}>
      <div className="cx-record-toolbar">
      {(!config.hideControlsWhenEmpty || page.sourceCount > 0) && <div className="cx-controls">
        <label>Search records<input type="search" value={w.query} placeholder={config.searchPlaceholder} onChange={e => w.setOptions({ query: e.target.value })} /></label>
        {group === 'developmental' && <label>Sampled age cohort<select value={w.cohort} onChange={e => w.setOptions({ cohort: e.target.value })}><option value="all">All public age cohorts</option>{Object.entries(DGTEX_COHORTS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
        {(tab === 'expression-models' || group === 'phenotypes') && <label className="cx-check"><input type="checkbox" disabled={expression && !hasReviewSystems} checked={relevantOnly} onChange={e => w.setOptions({ relevantOnly: e.target.checked })} />{expression ? 'Selected systems only' : relevantLabel}</label>}
        {expression && !hasReviewSystems && onChooseSystems && <button type="button" className="viz-action" onClick={onChooseSystems}>Choose systems</button>}
      </div>}
      {(!config.hideControlsWhenEmpty || page.sourceCount > 0) && <p className="cx-caption" role="status">{page.rows.length} of {page.sourceCount} records shown{page.total !== page.sourceCount ? `; ${page.total} match the filters` : ''}.</p>}
      </div>
      {group === 'developmental' && page.sourceCount > 0 && <p className="cx-caption">Sampled age is independent of disease onset. Cohorts are descriptive, not a developmental trajectory.</p>}
      {selected && !page.rows.some(r => r.key === selected.key) && <p className="cx-notice">The pinned record is outside this view. Its details remain in the inspector. {config.canRevealPin && <button type="button" className="viz-action" onClick={() => {
        setRevealRequested(true);
        if (expression) w.setView('records');
        w.setOptions({ section: selected.group, query: '', cohort: 'all', relevantOnly: false });
        // Reveal every returned row in that source, including pins beyond the initial bound.
        const expansion = `all:${selected.group}::all:false`;
        if (!w.expanded.includes(expansion)) w.toggleGroup(expansion);
      }}>Show pinned record</button>}</p>}
      {!page.rows.length ? <div className="cx-empty">{page.sourceCount ? 'No records match these display filters. Clear the search or filters to see the source readings.' : empty === null ? null : empty ?? 'No returned readings in this source view. Check the source status below.'}</div>
        : <div className="cx-records" data-testid="context-records">
          {w.comparison && tab === 'expression-models' ? <React.Suspense fallback={<p role="status">Preparing tissue comparison.</p>}><EvidenceComparison tab={tab} model={chart} title={group === 'adult' ? 'Adult tissue expression' : 'Pediatric tissue and age cohorts'} description="Compare measured medians within one source. Pin a tissue to inspect the exact value and sampling context." /></React.Suspense>
          : !w.comparison && expression ? <ExpressionRecords rows={page.rows} selected={w.selected} />
          : w.comparison && tab === 'gene-disease' && group === 'validity' ? <AssertionMatrix rows={page.rows} levels={levels} selected={w.selected} onSelect={key => w.select(key)} />
          : w.comparison ? page.rows.map(r => <button key={r.key} type="button" className="cx-reading" aria-pressed={w.selected === r.key} onClick={() => w.select(r.key)}>
            <span className="cx-reading__name">{r.name}<small>{r.group === 'developmental' || tab === 'species-models' ? r.description : r.source}</small></span>
            <span className="cx-reading__visual">{r.mapping?.window ? <AlignmentStrip mapping={r.mapping} /> : tab === 'expression-models' && r.value !== null ? <span className="cx-meter" aria-hidden="true"><span style={{ width: `${page.max > 0 ? r.value / page.max * 100 : 0}%` }} /><i style={{ left: `${page.max > 0 ? r.value / page.max * 100 : 0}%` }} /></span> : <span className="cx-category">{r.group}</span>}</span>
            <strong className="cx-reading__value">{r.valueText}</strong>
          </button>) : <div className="cx-table-scroll" role="region" aria-label="Exact source readings" tabIndex={0}><table className="cx-table"><thead><tr><th>Record</th><th>Reading</th><th>Source / context</th></tr></thead><tbody>{page.rows.map(r => <tr key={r.key} data-selected={w.selected === r.key || undefined}>
            <th scope="row"><InspectReadingButton tab={tab} readingKey={r.key}>{r.name}</InspectReadingButton></th><td>{tab === 'expression-models' && r.value !== null ? `${r.value} TPM` : r.valueText}</td><td>{r.source}<small>{r.description}</small></td>
          </tr>)}</tbody></table></div>}
        </div>}
      {page.total > CX_PAGE_LIMIT && <button type="button" className="viz-action" onClick={() => w.toggleGroup(`all:${group}:${w.query}:${w.cohort}:${w.relevantOnly}`)}>{all ? `Show first ${CX_PAGE_LIMIT}` : `Show all ${page.total} records`}</button>}
      {expression && page.rows.length > 0 && <p className="cx-caption">Selected systems first, then highest median. Filters change visibility, not the source scale.</p>}
      {page.rows.length > 0 && <p className="cx-caption">
        {w.comparison && tab === 'expression-models'
          ? `Linear TPM scale: 0–${page.max || 1}. The scale uses the full source view and stays fixed when filtering. Zero is plotted at the origin; missing readings have no mark.`
          : 'Select a record to pin its interpretation and provenance. Tab to a record, then press Enter or Space.'}
      </p>}
    </div>
  </section>;
}
