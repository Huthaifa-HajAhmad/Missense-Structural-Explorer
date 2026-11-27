/**
 * ReportBlocks.tsx — the presentational pieces of the Variant evidence report.
 *
 * Every piece renders a value it is handed from `buildReportDocument`; nothing here derives a
 * classification, a count or a sentence. The only thing the reader can change is prose, and the
 * only state kept here is whether a textarea is open.
 */
import React, { useState } from "react";
import { ProseEditor } from "./ReportProseEditor";
import {
  parseProse,
  type ProseRun,
  type ReportBlock,
  type ReportChip,
  type ReportDocument,
  type ReportLink,
} from "../../shared/reportDocument";
import type { ReportSectionKey } from "../../stores/slices/uiSlice";

export type OpenTab = (tab: ReportLink["tab"]) => void;

// ── Small pieces ─────────────────────────────────────────────────────────────────────────────────

export function ReportChipView({ chip }: { chip: ReportChip }) {
  return (
    <span className={`ev-tier${chip.dashed ? " rpt-chip--dashed" : ""}`} data-tone={chip.tone}>
      {chip.label}
    </span>
  );
}

const Runs = ({ runs }: { runs: ProseRun[] }) => (
  <>
    {runs.map((r, i) => (r.bold ? <strong key={i}>{r.text}</strong> : <React.Fragment key={i}>{r.text}</React.Fragment>))}
  </>
);

/** Prose in the report's small markup. Nothing here is ever injected as HTML. */
export function ProseView({ text }: { text: string }) {
  const nodes = parseProse(text);
  if (nodes.length === 0) return null;
  return (
    <div className="rpt-prose">
      {nodes.map((n, i) =>
        n.type === "ul" ? (
          <ul key={i}>{n.items.map((it, j) => <li key={j}><Runs runs={it} /></li>)}</ul>
        ) : n.type === "h" ? (
          <h3 key={i}><Runs runs={n.runs} /></h3>
        ) : (
          <p key={i}><Runs runs={n.runs} /></p>
        )
      )}
    </div>
  );
}

/** The block's export switch, at the end of its header so the title lines up with the body. */
function IncludeTick({ block, onToggle }: { block: ReportBlock; onToggle: () => void }) {
  return (
    <label className="rpt-tick">
      <input type="checkbox" checked={block.included} aria-label={`${block.title} in export`} onChange={onToggle} />
      <span aria-hidden="true">In export</span>
    </label>
  );
}

// ── The classification hero ──────────────────────────────────────────────────────────────────────

function TierLadder({ block }: { block: ReportBlock }) {
  const v = block.verdict;
  if (!v || v.tier === null) return null;
  const side = v.tierIndex >= 3 ? "pathogenic" : v.tierIndex <= 1 ? "benign" : "neutral";
  return (
    <div className="rpt-tiers" role="img" aria-label={`Tier ${v.tier} on a five-step scale from benign to pathogenic`}>
      {v.tiers.map((t, i) => (
        <div key={t} className="rpt-tier" data-active={i === v.tierIndex ? "" : undefined} data-side={i === v.tierIndex ? side : undefined}>
          {t}
        </div>
      ))}
    </div>
  );
}

function ClassificationHero({ block }: { block: ReportBlock }) {
  const v = block.verdict;
  if (!v) return null;
  return (
    <div className="rpt-hero">
      <p className="rpt-hero__figure" data-testid="report-verdict">{v.text ?? "No classification"}</p>
      <TierLadder block={block} />
    </div>
  );
}

// ── Body pieces ──────────────────────────────────────────────────────────────────────────────────

function BlockTable({ block }: { block: ReportBlock }) {
  const t = block.table;
  if (!t) return null;
  const numeric = new Set(t.numeric ?? []);
  return (
    <div className="rpt-table-wrap">
      <table className="rpt-table">
        <thead>
          <tr>{t.headers.map((h, i) => <th key={h} className={numeric.has(i) ? "rpt-num" : undefined}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={numeric.has(j) ? "rpt-num" : j === 0 ? "rpt-strong" : undefined}>
                  {t.detail?.column === j ? <details><summary>{t.detail.label}</summary><p>{c}</p></details> : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockFacts({ block }: { block: ReportBlock }) {
  if (block.facts.length === 0) return null;
  return (
    <dl className="rpt-facts">
      {block.facts.map(f => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd className={f.mono ? "rpt-mono" : undefined}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const EMPTY_STATEMENT: Partial<Record<ReportSectionKey, string>> = {
  literature: "No papers are pinned. Pin papers from the Literature tab with Add to report, and the report cites only those.",
  needed: "Nothing further is listed as missing for this variant.",
  notes: "Add your own notes here, for example the case discussion or the follow-up you would run.",
  summary: "No written summary was produced for this run.",
};

// ── One block ────────────────────────────────────────────────────────────────────────────────────

export interface ReportBlockCardProps {
  block: ReportBlock;
  editing: boolean;
  onToggle: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onEdit: (text: string, base?: string, evidenceId?: string) => void;
  onRevert: () => void;
  onKeepMine: () => void;
  onOpenTab?: OpenTab;
}

export function ReportBlockCard({ block, editing, onToggle, onStartEdit, onStopEdit, onEdit, onRevert, onKeepMine, onOpenTab }: ReportBlockCardProps) {
  const isClassification = block.key === "classification";
  const hasProse = block.text.trim().length > 0;
  const [showAllRows, setShowAllRows] = useState(false);
  const shortList = block.table?.shortList;
  const emptyStatement = block.empty && !hasProse ? EMPTY_STATEMENT[block.key] ?? "Nothing to report." : null;

  return (
    <section tabIndex={-1} id={`report-${block.key}`} className="rpt-card report-section" data-block={block.key} data-edited={block.edited ? "" : undefined}>
      <header className="rpt-card__head">
        <h2 className="rpt-card__title">{block.title}</h2>
        <span className="rpt-card__chips">
          {block.chips.map(c => <ReportChipView key={c.label} chip={c} />)}
        </span>
        <span className="rpt-card__spacer" />
        {block.edited && !editing ? <button type="button" className="rpt-btn" data-variant="quiet" onClick={onRevert}>Revert to draft</button> : null}
        {editing
          ? null
          : <button type="button" className="rpt-btn" data-variant="quiet" onClick={onStartEdit}>{hasProse ? "Edit" : "Write"}</button>}
        {/* A block with nothing in it is skipped by every export, so it offers no export switch. */}
        {block.empty && !block.edited ? null : <IncludeTick block={block} onToggle={onToggle} />}
      </header>

      {isClassification ? <ClassificationHero block={block} /> : null}

      {block.warnings.length > 0 ? <details className="rpt-review" open={block.stale || block.key === "summary"}>
        <summary>{block.key === "summary" ? "Review this summary before sharing" : "Interpretation and method"} <span>{block.warnings.length === 1 ? "1 note" : `${block.warnings.length} notes`}</span></summary>
        {block.warnings.map(w => <p key={w}>{w}</p>)}
      </details> : null}
      {block.stale ? (
        <div className="rpt-callout">
          <p><strong>The evidence changed after you edited this.</strong> Your wording is kept. Review the current draft and evidence before accepting it.</p>
          <details className="rpt-compare"><summary>Compare with current draft</summary><div><p><strong>Your text</strong><br />{block.text || "Intentionally blank"}</p><p><strong>Current draft</strong><br />{block.drafted || "No generated text"}</p></div></details>
          <button type="button" className="rpt-btn" onClick={onKeepMine}>Keep my text</button>
          <button type="button" className="rpt-btn" onClick={onRevert}>Use the new draft</button>
        </div>
      ) : null}

      {editing ? <ProseEditor key={block.key} block={block} onChange={onEdit} onDone={onStopEdit} onCancel={onStopEdit} /> : hasProse ? <ProseView text={block.text} /> : null}
      {emptyStatement && !editing ? <div className="rpt-empty"><p>{emptyStatement}</p></div> : null}

      {!isClassification || block.facts.length > 0 ? <BlockFacts block={block} /> : null}
      <BlockTable block={shortList && !showAllRows ? { ...block, table: { ...block.table!, rows: block.table!.rows.slice(0, shortList.rows) } } : block} />
      {shortList ? <button type="button" className="rpt-btn rpt-table-toggle" aria-expanded={showAllRows} onClick={() => setShowAllRows(v => !v)}>{showAllRows ? shortList.less : shortList.more}</button> : null}

      {block.references.length ? <details className="rpt-references"><summary>Sources <span>{block.references.length}</span></summary>{block.references.map(r => <a key={r.url} href={r.url} target="_blank" rel="noreferrer">{r.label}</a>)}</details> : null}
      {(block.caption || block.reads.length > 0) ? (
        <footer className="rpt-card__foot">
          {block.caption ? <span>{block.caption}</span> : null}
          {block.reads.length > 0 && onOpenTab ? (
            <span>
              <b>Reads:</b>{" "}
              {block.reads.map((r, i) => (
                <React.Fragment key={`${r.label}-${i}`}>
                  {i > 0 ? ", " : ""}
                  <button type="button" className="rpt-link" onClick={() => onOpenTab(r.tab)}>{r.label}</button>
                </React.Fragment>
              ))}
            </span>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}

// ── Left out ─────────────────────────────────────────────────────────────────────────────────────

export function LeftOutCard({ blocks, onInclude }: { blocks: ReportBlock[]; onInclude: (key: ReportSectionKey) => void }) {
  if (blocks.length === 0) return null;
  return (
    <section className="rpt-card report-section" aria-label="Not in this report" data-testid="report-left-out">
      <header className="rpt-card__head">
        <h2 className="rpt-card__title">Not in this report</h2>
      </header>
      {blocks.map(b => (
        <div key={b.key} className="rpt-left" id={`report-${b.key}`} tabIndex={-1}>
          <span className="rpt-left__name">{b.title}</span>
          <span className="rpt-dim">left out by you</span>
          <button type="button" className="rpt-btn" data-variant="quiet" onClick={() => onInclude(b.key)}>Include</button>
          {b.stillCounted.length > 0 ? (
            <span className="rpt-left__note">Its {b.stillCounted.join(", ")} is still counted in the classification.</span>
          ) : null}
        </div>
      ))}
      <footer className="rpt-card__foot">
        Left-out blocks are hidden from every export. The export names them in its footer, so a reader knows what was left out.
      </footer>
    </section>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────────────────────────

export function ReportFooterCard({ doc }: { doc: ReportDocument }) {
  const f = doc.footer;
  return (
    <section className="rpt-card report-section" aria-label="Report footer" data-testid="report-footer">
      <footer className="rpt-card__foot" style={{ borderTop: 0 }}>
        <span><b>Research use.</b> {f.useStatement.replace(/^Research use\.\s*/, "")}</span>
        <span>
          <b>Left out by the author:</b> {f.omitted.length ? f.omitted.join("; ") : "nothing"}
        </span>
        <span>
          <b>Document ID</b> <span className="rpt-mono">{f.documentId}</span>. A fingerprint of the content, not counting export time or file format. It does not prove authorship.
        </span>
      </footer>
    </section>
  );
}
