import React from "react";
import { TabComponentProps } from "./types";
import { PanelRightOpen } from "lucide-react";
import {
  buildGuidelinesRows,
  guidelinesGroup,
  guidelinesBandPct,
  summarizeGuidelinesRows,
  type GuidelinesRow
} from "../../shared/thresholds";
import { INSPECTOR_SECTIONS, requestInspectorFocus } from "../../lib/inspectorFocus";

/** Summary chip tone per verdict group. */
const GROUP_TONES = {
  path: "path",
  benign: "benign",
  vus: "vus",
  info: "info",
  nodata: "nodata"
} as const;

type GroupKey = keyof typeof GROUP_TONES;

const GROUP_LABELS: Record<GroupKey, string> = {
  path: "path. supporting",
  benign: "benign / neutral",
  vus: "VUS / intermediate",
  info: "informational",
  nodata: "awaiting data"
};

function SummaryChip({ group, count }: { group: GroupKey; count: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-sans"
      style={
        group === "path"
          ? { background: "var(--cs-bg-danger)", color: "var(--cs-text-danger-on-soft)", borderColor: "color-mix(in srgb, var(--cs-text-danger) 25%, transparent)" }
          : group === "benign"
          ? { background: "var(--cs-bg-success)", color: "var(--cs-text-success)", borderColor: "color-mix(in srgb, var(--cs-text-success) 25%, transparent)" }
          : group === "vus"
          ? { background: "var(--cs-bg-warning)", color: "var(--cs-text-warning)", borderColor: "color-mix(in srgb, var(--cs-text-warning) 30%, transparent)" }
          : group === "info"
          ? { background: "color-mix(in srgb, var(--cs-accent-clay) 10%, transparent)", color: "var(--cs-accent-clay)", borderColor: "color-mix(in srgb, var(--cs-accent-clay) 25%, transparent)" }
          : { background: "var(--cs-surface-2)", color: "var(--cs-text-muted)", borderColor: "var(--cs-border)" }
      }
    >
      <span className="font-mono font-bold tabular-nums">{count}</span>
      <span>{GROUP_LABELS[group]}</span>
    </span>
  );
}

/** The score numeral tinted by verdict, with its calibration micro-track beneath. */
function ScoreCell({ row }: { row: GuidelinesRow }) {
  const group = guidelinesGroup(row);
  const hasValue = row.value !== null && row.value !== undefined;
  return (
    <div className="inline-flex flex-col items-center min-w-[96px]">
      <span className="gt-value" data-tone={GROUP_TONES[group]}>{row.display}</span>
      {hasValue && row.band && (
        <span
          className="gt-track w-full"
          aria-hidden="true"
          title={`${row.display} · benign ${row.benignText} · pathogenic ${row.pathText}`}
        >
          {row.band.segments.map((seg, i) => (
            <span
              key={i}
              className="gt-track-seg"
              data-tone={seg.tone}
              style={{
                left: `${guidelinesBandPct(seg.from, row.band!)}%`,
                width: `${guidelinesBandPct(seg.to, row.band!) - guidelinesBandPct(seg.from, row.band!)}%`
              }}
            />
          ))}
          {row.band.ticks.map((tick, i) => (
            <span key={i} className="gt-tick" style={{ left: `${guidelinesBandPct(tick, row.band!)}%` }} />
          ))}
          <span
            className="gt-marker"
            data-tone={GROUP_TONES[group]}
            style={{ left: `${guidelinesBandPct(row.value!, row.band!)}%` }}
          />
        </span>
      )}
    </div>
  );
}

export function GuidelinesTab({
  analysisState,
  foldingDdG,
  foldingEnergetics
}: TabComponentProps) {
  const result = analysisState.result;
  if (!result) return null;

  const rows = buildGuidelinesRows({ result, foldingDdG: foldingDdG ?? null, foldingEnergetics });
  const summary = summarizeGuidelinesRows(rows);

  const renderCategoryHeader = (catKey: string, catTitle: string) => (
    <tr key={catKey} className="bg-[var(--cs-surface-2)]">
      <td colSpan={6} className="gt-cat-cell p-2 px-4 text-[10.5px] font-bold uppercase tracking-wider text-left" style={{ color: "var(--cs-accent-clay)" }}>
        {catTitle}
      </td>
    </tr>
  );

  const renderRow = (row: GuidelinesRow) => {
    const group = guidelinesGroup(row);
    const isPath = row.status === "path_strong" || row.status === "path";
    const isBenign = row.status === "benign";
    const codes = row.acmgCode.split("/");
    const pathCode = codes[0]?.trim() || row.acmgCode;
    const benignCode = codes[1]?.trim() || row.acmgCode;
    const hasValue = row.value !== null && row.value !== undefined;

    return (
      <tr key={row.key} className="hover:bg-[var(--cs-bg-subtle)] transition-colors" style={{ color: "var(--cs-text-primary)", borderBottom: "1px solid var(--cs-border-subtle)" }}>
        <td className="p-3 px-4 text-[12px] font-semibold text-left border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-primary)" }}>{row.name}</td>
        <td className="p-3 px-4 text-center border-r border-[var(--cs-border-subtle)]">
          <ScoreCell row={row} />
        </td>
        <td className="p-3 px-4 text-center text-[11px] font-mono border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-muted)" }}>{row.benignText}</td>
        <td className="p-3 px-4 text-center text-[11px] font-mono border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-muted)" }}>{row.pathText}</td>
        <td className="p-3 px-4 text-center font-bold font-mono text-xs border-r border-[var(--cs-border-subtle)]">
          {hasValue && isPath ? (
            <span className="px-2 py-0.5 rounded border font-bold" style={{ color: "var(--cs-text-danger-on-soft)", backgroundColor: "var(--cs-bg-danger)", borderColor: "var(--cs-text-danger)" }}>{pathCode}</span>
          ) : hasValue && isBenign ? (
            <span className="px-2 py-0.5 rounded border font-bold" style={{ color: "var(--cs-text-success)", backgroundColor: "var(--cs-bg-success)", borderColor: "var(--cs-text-success)" }}>{benignCode}</span>
          ) : (
            <span className="opacity-40" style={{ color: "var(--cs-text-muted)" }}>{row.acmgCode}</span>
          )}
        </td>
        <td className="p-3 px-4 text-center">
          {hasValue ? (
            <span className="gt-badge" data-tone={GROUP_TONES[group]}>{row.matchLabel}</span>
          ) : (
            <span style={{ color: "var(--cs-text-muted)" }}>—</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="screen-title">Threshold Guide</h1>
        <p className="screen-tab-description">ACMG/AMP evidence code thresholds for each computational predictor, with live match highlighting for the current variant.</p>
      </div>

      {/* At-a-glance verdict roll-up over all 20 metrics. */}
      <div className="flex flex-wrap items-center gap-1.5" role="status" aria-label="Live threshold match summary">
        {summary.pathSupporting.length > 0 && <SummaryChip group="path" count={summary.pathSupporting.length} />}
        {summary.benignSupporting.length > 0 && <SummaryChip group="benign" count={summary.benignSupporting.length} />}
        {summary.vus.length > 0 && <SummaryChip group="vus" count={summary.vus.length} />}
        {summary.informational.length > 0 && <SummaryChip group="info" count={summary.informational.length} />}
        {summary.noData.length > 0 && <SummaryChip group="nodata" count={summary.noData.length} />}
        <span className="text-[10.5px] font-mono" style={{ color: "var(--cs-text-muted)" }}>
          · {summary.total} metrics
        </span>
      </div>

      {/* Threshold Table — capped-height scroller so the header and the
          category bands stay visible across the full 23-row body. */}
      <div className="rounded-xl border border-[var(--cs-border)] overflow-hidden bg-[var(--cs-surface)] shadow-none">
        <div className="gt-scroller overflow-auto" style={{ maxHeight: "clamp(420px, calc(100vh - 300px), 960px)" }}>
          <table className="w-full font-sans border-collapse" style={{ minWidth: 640 }}>
            <caption className="sr-only">ACMG/AMP cut-point table with live verdict for each computational predictor</caption>
            <thead>
              <tr className="table-header-row border-b border-[var(--cs-border)]">
                <th scope="col" className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-left border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Assay / Metric</th>
                <th scope="col" className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center font-mono border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Score</th>
                <th scope="col" className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Benign ≤</th>
                <th scope="col" className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Pathogenic ≥</th>
                <th scope="col" className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>ACMG Code</th>
                <th scope="col" className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center" style={{ color: "var(--cs-text-secondary)" }}>Match</th>
              </tr>
            </thead>
            <tbody>
              {renderCategoryHeader("cat-path", "1. In-Silico Pathogenicity & Machine Learning")}
              {rows.filter(r => r.category === 1).map(renderRow)}
              {renderCategoryHeader("cat-biophys", "2. Biophysical & Structural Energetics")}
              {rows.filter(r => r.category === 2).map(renderRow)}
              {renderCategoryHeader("cat-cons", "3. Evolutionary Conservation & Population Intolerance")}
              {rows.filter(r => r.category === 3).map(renderRow)}
            </tbody>
          </table>
        </div>
      </div>

      {/* Track legend + pointer to the relocated verbose key. The evidence-code
          definitions live in the inspector pane to keep this column decisive. */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
        <p className="text-[11px] font-sans leading-relaxed m-0" style={{ color: "var(--cs-text-secondary)" }}>
          Track legend:&nbsp;
          <span className="font-semibold" style={{ color: "var(--cs-text-success)" }}>benign window</span>
          <span style={{ color: "var(--cs-text-muted)" }}> · grey zone · </span>
          <span className="font-semibold" style={{ color: "var(--cs-text-danger-on-soft)" }}>pathogenic window</span>
          <span style={{ color: "var(--cs-text-muted)" }}> — ticks name the cut-points; the marker is the current score.</span>
        </p>
        <button
          type="button"
          onClick={() => requestInspectorFocus(INSPECTOR_SECTIONS.thresholdKey)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-cs-accent-clay/30 bg-cs-accent-clay/10 text-cs-accent-clay text-[10.5px] font-mono font-semibold hover:bg-cs-accent-clay/20 transition-colors cursor-pointer shrink-0"
        >
          <PanelRightOpen className="w-3 h-3" aria-hidden="true" />
          ACMG/AMP code key
        </button>
      </div>
    </div>
  );
}
