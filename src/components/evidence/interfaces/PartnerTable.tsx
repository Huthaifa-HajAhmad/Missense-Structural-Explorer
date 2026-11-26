import { ExternalLink } from "lucide-react";
import { STRING_CONFIDENCE_CUTS } from "../../../shared/thresholds";
import { isSelfRow, stringNetworkUrl, type InterfacesEvidence, type PartnerGroupView, type PartnerRow, type StringCell } from "../../../shared/interfacesEvidence";
import { InspectReadingButton, useEvidenceWorkspace } from "../EvidenceWorkspace";

/**
 * The partner grid. Each name has one target: the reading inspector in the workspace, STRING otherwise.
 * The STRING score itself links to the pair on STRING, so the row no longer carries a second "STRING ↗"
 * chip beside the name (doc/INTERFACES_PPI_AUDIT_2026-11-26.md, U9). Absent scores are short: "< 0.15"
 * below STRING's lowest band, "beyond top 500" when STRING's list stopped before reaching the partner.
 */
const isSelf = (p: PartnerRow, ev: InterfacesEvidence) => isSelfRow(p, ev.uniprotId);

function shortNote(note: string | null): string {
  if (!note) return "—";
  const below = /^None ≥ ([\d.]+)$/.exec(note);
  if (below) return `< ${below[1]}`;
  const top = /^Not in STRING's top (\d+)$/.exec(note);
  return top ? `beyond top ${top[1]}` : note;
}

function StringCellView({ cell, href }: { cell: StringCell; href: string | null }) {
  if (cell.score === null) return <span className="ifc-dim" title={cell.note ?? undefined}>{shortNote(cell.note)}</span>;
  const score = <span className="ifc-num">{cell.score.toFixed(3)}</span>;
  return (
    <span className="ifc-assoc">
      <span className="ifc-assoc__row">
        <span className="ifc-bar" aria-hidden="true">
          <span className="ifc-bar__fill" style={{ width: `${Math.max(0, Math.min(1, cell.score)) * 100}%` }} />
          {STRING_CONFIDENCE_CUTS.map(c => <span key={c.id} className="ifc-bar__tick" style={{ left: `${c.min * 100}%` }} />)}
        </span>
        {href ? <a className="ifc-partner-link" href={href} target="_blank" rel="noopener noreferrer" title="Open this pair on STRING (new tab)">{score}</a> : score}
      </span>
      {cell.band && <span className="ifc-assoc__band">{cell.band}</span>}
    </span>
  );
}

function PartnerName({ p, ev, workspace }: { p: PartnerRow; ev: InterfacesEvidence; workspace: boolean }) {
  const self = isSelf(p, ev);
  const name = self ? `${p.gene} (other chain)` : p.gene;
  if (workspace) return <InspectReadingButton tab="interfaces" readingKey={`partner:${p.key}`}>{name}</InspectReadingButton>;
  if (p.family || self || p.organism) return <span>{name}</span>;
  return (
    <a className="ifc-partner-link" href={stringNetworkUrl(ev.gene, p.gene)} target="_blank" rel="noopener noreferrer" title={`Open ${ev.gene} and ${p.gene} on STRING (new tab)`}>
      {p.gene}
      <ExternalLink className="w-3 h-3" aria-hidden="true" />
    </a>
  );
}

function PartnerRowView({ p, ev }: { p: PartnerRow; ev: InterfacesEvidence }) {
  const workspace = useEvidenceWorkspace("interfaces").enabled;
  const self = isSelf(p, ev);
  const href = !p.family && !self && !p.organism ? stringNetworkUrl(ev.gene, p.gene) : null;
  const o = p.observed;
  return (
    <tr data-reading-key={`partner:${p.key}`} data-hit={(p.variantInSite || p.variantAtObservedInterface) || undefined} data-family={p.family || undefined}>
      <th scope="row" className="ifc-subject">
        <span className="ifc-subject__name">
          <PartnerName p={p} ev={ev} workspace={workspace} />
          {p.organism && <span className="ev-tier ifc-species" data-tone="muted">{p.organism}</span>}
        </span>
        {(self || p.accession || p.family) && <span className="ifc-subject__note">{self ? `${ev.uniprotId} · same protein` : p.family ? "No gene named" : p.accession}</span>}
      </th>
      <td className="ifc-evidence">
        {p.evidence}
        {p.qualifier && <span className="ev-tier ifc-qualifier" data-tone="muted">{p.qualifier}</span>}
      </td>
      {ev.columns.solved && (
        <td className="ifc-num">
          {o ? (
            <>
              {o.n === 0 ? `– of ${o.total}` : `${o.k} of ${o.n}`}
              <span className="ifc-unit">{o.n === 0 ? `${ev.residueLabel} not modelled` : o.variantAtInterface ? `with ${ev.residueLabel}` : `${ev.residueLabel} not at it`}</span>
            </>
          ) : <span className="ifc-dim">—</span>}
        </td>
      )}
      <td className="ifc-string">{p.family ? <span className="ifc-dim">—</span> : <StringCellView cell={p.physical} href={href} />}</td>
      <td className="ifc-string">{p.family ? <span className="ifc-dim">—</span> : <StringCellView cell={p.functional} href={href} />}</td>
      {ev.columns.site && (
        <td className="ifc-site" data-hit={p.variantInSite || undefined}>
          {p.sites.length ? (
            <>
              <span className="ifc-site__range">{p.sites.map(s => (s.start === s.end ? `${s.start}` : `${s.start}–${s.end}`)).join(", ")}</span>
              <span className="ifc-site__note">{p.variantInSite ? `${ev.residueLabel} inside` : `${ev.residueLabel} outside`}</span>
            </>
          ) : <span className="ifc-dim">—</span>}
        </td>
      )}
    </tr>
  );
}

/** A folded tail: one line, and on request the names as a list, each with the score it was sorted by. */
function FoldedRows({ g, ev, colCount, open, onToggle }: { g: PartnerGroupView; ev: InterfacesEvidence; colCount: number; open: boolean; onToggle: () => void }) {
  if (!g.folded) return null;
  const listId = `ifc-fold-${g.id}`;
  const scoreOf = (r: PartnerRow) => (g.id === "functional" ? r.functional.score : r.physical.score);
  return (
    <tr className="ifc-fold">
      <td colSpan={colCount}>
        <span className="ifc-fold__summary">{g.folded.summary}</span>
        <button type="button" className="ifc-link ifc-fold__toggle" aria-expanded={open} aria-controls={listId} onClick={onToggle}>
          {open ? "Hide names" : `Show ${g.folded.rows.length} names`}
        </button>
        {open && (
          <ul className="ifc-chips" id={listId} aria-label={`${g.title}: ${g.folded.rows.length} more partners`}>
            {g.folded.rows.map(r => (
              <li key={r.key} className="ifc-chip" data-reading-key={`partner:${r.key}`}>
                {r.organism
                  ? <span className="ifc-chip__name"><InspectReadingButton tab="interfaces" readingKey={`partner:${r.key}`}>{r.gene}</InspectReadingButton></span>
                  : <a className="ifc-chip__name ifc-partner-link" href={stringNetworkUrl(ev.gene, r.gene)} target="_blank" rel="noopener noreferrer" title={`Open ${ev.gene} and ${r.gene} on STRING (new tab)`}>{r.gene}</a>}
                {r.organism && <span className="ifc-chip__meta">{r.organism}</span>}
                {scoreOf(r) !== null && <span className="ifc-chip__meta ifc-mono">{scoreOf(r)!.toFixed(2)}</span>}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

export function PartnerTable({ ev, groups, openFolds, onToggleFold }: { ev: InterfacesEvidence; groups: PartnerGroupView[]; openFolds: ReadonlySet<string>; onToggleFold: (id: PartnerGroupView["id"]) => void }) {
  const colCount = 4 + (ev.columns.solved ? 1 : 0) + (ev.columns.site ? 1 : 0);
  return (
    <div className="ifc-table-wrap" role="region" aria-label={`Interaction partners of ${ev.gene}`} tabIndex={0}>
      <table className="ifc-table ifc-table--partners" data-testid="partner-grid" id="ifc-partner-grid">
        <thead>
          <tr>
            <th scope="col">Partner</th>
            <th scope="col">Evidence</th>
            {ev.columns.solved && <th scope="col" className="ifc-num">Solved</th>}
            <th scope="col">STRING physical</th>
            <th scope="col">STRING functional</th>
            {ev.columns.site && <th scope="col" className="ifc-site">Mapped site</th>}
          </tr>
        </thead>
        {groups.map(g => (
          <tbody key={g.id} data-group={g.id}>
            <tr className="ifc-group">
              <th colSpan={colCount} scope="rowgroup">
                <span className="ifc-group__inner">
                  <span className="ifc-group__title">{g.title}</span>
                  <span className="ifc-group__meta">{g.meta}</span>
                </span>
              </th>
            </tr>
            {g.rows.map(p => <PartnerRowView key={p.key} p={p} ev={ev} />)}
            <FoldedRows g={g} ev={ev} colCount={colCount} open={openFolds.has(g.id)} onToggle={() => onToggleFold(g.id)} />
          </tbody>
        ))}
      </table>
    </div>
  );
}
