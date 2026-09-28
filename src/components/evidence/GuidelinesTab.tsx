import React from "react";
import { ListChecks, PanelRightOpen, Scale } from "lucide-react";
import { TabComponentProps } from "./types";
import {
  buildGuidelinesRows,
  guidelinesGroup,
  guidelinesBandPct,
  guidelinesFinding,
  summarizeGuidelinesRows,
  type GuidelinesRow,
  type GuidelinesSummary,
} from "../../shared/thresholds";
import { INSPECTOR_SECTIONS, requestInspectorFocus } from "../../lib/inspectorFocus";

/** Summary chip tone per verdict group. */
const GROUP_TONES = {
  path: "path",
  benign: "benign",
  vus: "vus",
  info: "info",
  nodata: "nodata",
} as const;

type GroupKey = keyof typeof GROUP_TONES;

const GROUP_LABELS: Record<GroupKey, string> = {
  path: "path. supporting",
  benign: "benign / neutral",
  vus: "VUS / intermediate",
  info: "informational",
  nodata: "awaiting data",
};

function SummaryChip({ group, count }: { group: GroupKey; count: number }) {
  return (
    <span
      className="gt-summary-chip"
      data-tone={GROUP_TONES[group]}
    >
      <span className="font-mono font-bold tabular-nums">{count}</span>
      <span>{GROUP_LABELS[group]}</span>
    </span>
  );
}

function Fact({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="pop-fact">
      <dt className="pop-fact__label">{label}</dt>
      <dd className="pop-fact__value">
        {children}
        {sub && <span className="pop-fact__sub">{sub}</span>}
      </dd>
    </div>
  );
}

function ConcordanceVerdictChip({ summary }: { summary: GuidelinesSummary }) {
  const nPath = summary.pathSupporting.length;
  const nBenign = summary.benignSupporting.length;
  const nScored = summary.total - summary.noData.length;
  const tone =
    nScored === 0
      ? "muted"
      : nPath > nBenign
      ? "danger"
      : nBenign > nPath
      ? "good"
      : nPath > 0 && nBenign > 0
      ? "warning"
      : "neutral";
  const label =
    nScored === 0
      ? "Awaiting Data"
      : nPath > nBenign
      ? "Pathogenic Concordance"
      : nBenign > nPath
      ? "Benign / Neutral"
      : nPath > 0 && nBenign > 0
      ? "Conflicting Signals"
      : "Indeterminate";
  return (
    <span
      className="ev-tier pop-verdict shrink-0"
      data-tone={tone}
      data-testid="guidelines-verdict"
      title={`${nPath} pathogenic supporting vs ${nBenign} benign/neutral`}
    >
      {label}
    </span>
  );
}

/** The score numeral tinted by verdict, with its calibration micro-track beneath. */
function ScoreCell({ row }: { row: GuidelinesRow }) {
  const group = guidelinesGroup(row);
  const hasValue = row.value !== null && row.value !== undefined;
  return (
    <div className="inline-flex flex-col items-center min-w-[96px]">
      <span className="gt-value" data-tone={GROUP_TONES[group]}>
        {row.display}
      </span>
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
                width: `${guidelinesBandPct(seg.to, row.band!) - guidelinesBandPct(seg.from, row.band!)}%`,
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

/**
 * Score Thresholds / Guidelines Tab.
 *
 * Three-tier architecture matching the Population Data and In-Silico Predictors tabs:
 *   1. THE FINDING — hero card naming the multi-modal concordance question, verdict chip,
 *      pathogenic–benign ratio, declarative finding prose, live summary roll-up, and 4-cell fact strip.
 *   2. READINGS — one unified table (pop-table) grouping 20 monitored assays into 3 categories
 *      with micro-tracks and ACMG codes.
 *   3. TRACK LEGEND & INSPECTOR LINK — high-contrast legend with direct focus-trigger
 *      into the inspector's ACMG/AMP evidence code key.
 */
export function GuidelinesTab({
  analysisState,
  foldingDdG,
  foldingEnergetics,
}: TabComponentProps) {
  const result = analysisState.result;
  if (!result) return null;

  const rows = buildGuidelinesRows({ result, foldingDdG: foldingDdG ?? null, foldingEnergetics });
  const summary = summarizeGuidelinesRows(rows);
  const finding = guidelinesFinding(summary);

  const cat1Rows = rows.filter(r => r.category === 1);
  const cat2Rows = rows.filter(r => r.category === 2);
  const cat3Rows = rows.filter(r => r.category === 3);

  const cat1Scored = cat1Rows.filter(r => r.value !== null && r.value !== undefined).length;
  const cat1Path = cat1Rows.filter(r => r.status === "path" || r.status === "path_strong").length;
  const cat1Benign = cat1Rows.filter(r => r.status === "benign" || r.status === "neutral").length;

  const cat2Scored = cat2Rows.filter(r => r.value !== null && r.value !== undefined).length;
  const cat2Destab = cat2Rows.filter(r => r.status === "path" || r.status === "path_strong").length;

  const cat3Scored = cat3Rows.filter(r => r.value !== null && r.value !== undefined).length;
  const cat3Constrained = cat3Rows.filter(r => r.status === "path" || r.status === "path_strong").length;

  const renderCategoryHeader = (catKey: string, catTitle: string) => (
    <tr key={catKey} className="pop-group">
      <th
        colSpan={6}
        scope="rowgroup"
        className="gt-cat-cell p-2.5 px-4 text-left"
      >
        {catTitle}
      </th>
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
      <tr key={row.key} className="hover:bg-[var(--cs-bg-subtle)] transition-colors border-b border-[var(--cs-border-subtle)]">
        <th scope="row" className="p-3 px-4 text-[12px] font-semibold text-left border-r border-[var(--cs-border-subtle)] text-[var(--cs-text-primary)] font-normal">
          {row.name}
        </th>
        <td className="p-3 px-4 text-center border-r border-[var(--cs-border-subtle)]">
          <ScoreCell row={row} />
        </td>
        <td className="p-3 px-4 text-center text-[11px] font-mono border-r border-[var(--cs-border-subtle)] text-[var(--cs-text-muted)]">
          {row.benignText}
        </td>
        <td className="p-3 px-4 text-center text-[11px] font-mono border-r border-[var(--cs-border-subtle)] text-[var(--cs-text-muted)]">
          {row.pathText}
        </td>
        <td className="p-3 px-4 text-center font-bold font-mono text-xs border-r border-[var(--cs-border-subtle)]">
          {hasValue && isPath ? (
            <span
              className="ev-tier chip-code"
              data-tone="danger"
            >
              {pathCode}
            </span>
          ) : hasValue && isBenign ? (
            <span
              className="ev-tier chip-code"
              data-tone="good"
            >
              {benignCode}
            </span>
          ) : (
            <span className="opacity-40 text-[var(--cs-text-muted)]">{row.acmgCode}</span>
          )}
        </td>
        <td className="p-3 px-4 text-center">
          {hasValue ? (
            <span className="gt-badge" data-tone={GROUP_TONES[group]}>
              {row.matchLabel}
            </span>
          ) : (
            <span className="text-[var(--cs-text-muted)]">—</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="pop-screen gt-screen @container">
      <header>
        <h1 className="screen-title">Threshold Guide</h1>
        <p className="screen-tab-description">
          ACMG/AMP evidence code thresholds for each computational predictor, with live match highlighting for the current variant.
        </p>
      </header>

      {/* ── 1. The Finding ─────────────────────────────────────────────────── */}
      <section className="pop-card pop-hero" aria-labelledby="gt-finding-title" data-testid="threshold-finding">
        <div className="pop-hero__body">
          <div className="pop-hero__top">
            <span className="eyebrow" id="gt-finding-title">
              <Scale className="w-3.5 h-3.5 text-cs-accent-clay" aria-hidden="true" />
              ACMG Cut-Point Concordance · 20 Monitored Assays
            </span>
            <ConcordanceVerdictChip summary={summary} />
          </div>

          <div className="pop-hero__figure">
            <span className="figure-headline" title="Pathogenic calls – benign calls among evaluated threshold metrics">
              {summary.pathSupporting.length}–{summary.benignSupporting.length}
            </span>
            <span className="pop-hero__figure-label">
              pathogenic–benign calls across {summary.total - summary.noData.length} scored metrics
              {summary.vus.length > 0 ? ` · ${summary.vus.length} intermediate / VUS` : ""}
            </span>
          </div>

          <p className="detail-prose pop-hero__finding">
            <strong>{finding.headline}</strong>
            {" — "}
            {finding.predicate}.
          </p>

          {/* At-a-glance verdict roll-up over all 20 metrics */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1" role="status" aria-label="Live threshold match summary">
            {summary.pathSupporting.length > 0 && <SummaryChip group="path" count={summary.pathSupporting.length} />}
            {summary.benignSupporting.length > 0 && <SummaryChip group="benign" count={summary.benignSupporting.length} />}
            {summary.vus.length > 0 && <SummaryChip group="vus" count={summary.vus.length} />}
            {summary.informational.length > 0 && <SummaryChip group="info" count={summary.informational.length} />}
            {summary.noData.length > 0 && <SummaryChip group="nodata" count={summary.noData.length} />}
            <span className="text-[10.5px] font-mono text-[var(--cs-text-muted)]">
              · {summary.total} metrics
            </span>
          </div>
        </div>

        <dl className="pop-facts">
          <Fact label="In-Silico & ML" sub="11 algorithms & LLMs">
            {cat1Scored} / 11 scored <span className="pop-mono">({cat1Path} path · {cat1Benign} benign)</span>
          </Fact>
          <Fact label="Biophysical ΔΔG" sub="5 force-field & DL engines">
            {cat2Scored} / 5 scored <span className="pop-mono">({cat2Destab} destab)</span>
          </Fact>
          <Fact label="Conservation & Z" sub="4 genomic constraints">
            {cat3Scored} / 4 scored <span className="pop-mono">({cat3Constrained} constrained)</span>
          </Fact>
          <Fact label="Monitored Total" sub="multi-modal concordance">
            {summary.pathSupporting.length} path / {summary.benignSupporting.length} benign
          </Fact>
        </dl>
      </section>

      {/* ── 2. Readings Table ──────────────────────────────────────────────── */}
      <section className="pop-section" aria-labelledby="gt-readings-title">
        <h2 className="eyebrow" id="gt-readings-title">
          <ListChecks className="w-3.5 h-3.5 text-cs-accent-clay" aria-hidden="true" />
          Threshold Readings &amp; Live Calibrations
        </h2>

        <div className="pop-card pop-table-wrap">
          <div className="gt-scroller overflow-auto" style={{ maxHeight: "clamp(420px, calc(100vh - 300px), 960px)" }}>
            <table className="pop-table w-full font-sans border-collapse" style={{ minWidth: 640 }}>
              <caption className="sr-only">ACMG/AMP cut-point table with live verdict for each computational predictor</caption>
              <thead>
                <tr className="table-header-row border-b border-[var(--cs-border)]">
                  <th scope="col" className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-left border-r border-[var(--cs-border-subtle)] text-[var(--cs-text-secondary)]">Assay / Metric</th>
                  <th scope="col" className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center font-mono border-r border-[var(--cs-border-subtle)] text-[var(--cs-text-secondary)]">Score</th>
                  <th scope="col" className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center border-r border-[var(--cs-border-subtle)] text-[var(--cs-text-secondary)]">Benign ≤</th>
                  <th scope="col" className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center border-r border-[var(--cs-border-subtle)] text-[var(--cs-text-secondary)]">Pathogenic ≥</th>
                  <th scope="col" className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center border-r border-[var(--cs-border-subtle)] text-[var(--cs-text-secondary)]">ACMG Code</th>
                  <th scope="col" className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center text-[var(--cs-text-secondary)]">Match</th>
                </tr>
              </thead>
              <tbody>
                {renderCategoryHeader("cat-path", "1. In-Silico Pathogenicity & Machine Learning")}
                {cat1Rows.map(renderRow)}
                {renderCategoryHeader("cat-biophys", "2. Biophysical & Structural Energetics")}
                {cat2Rows.map(renderRow)}
                {renderCategoryHeader("cat-cons", "3. Evolutionary Conservation & Population Intolerance")}
                {cat3Rows.map(renderRow)}
              </tbody>
            </table>
          </div>

          {/* ── 3. Track Legend & Relocated ACMG/AMP Key Link ────────────── */}
          <div className="gt-legend">
            <p className="text-[11px] font-sans leading-relaxed m-0 text-[var(--cs-text-secondary)]">
              Track legend:&nbsp;
              <span className="font-semibold text-[var(--cs-text-success)]">benign window</span>
              <span className="text-[var(--cs-text-muted)]"> · grey zone · </span>
              <span className="font-semibold text-[var(--cs-text-danger-on-soft)]">pathogenic window</span>
              <span className="text-[var(--cs-text-muted)]"> — ticks name the cut-points; the marker is the current score.</span>
            </p>
            <button
              type="button"
              onClick={() => requestInspectorFocus(INSPECTOR_SECTIONS.thresholdKey)}
              className="gt-key-btn"
            >
              <PanelRightOpen className="w-3.5 h-3.5" aria-hidden="true" />
              ACMG/AMP code key
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default GuidelinesTab;
