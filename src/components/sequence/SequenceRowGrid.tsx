import React from "react";
import type { LandscapeResidueItem } from "../../shared/contracts";
import { PP3_BP4_CALIBRATION } from "../../shared/thresholds/calibration";
import {
  bandKey,
  bandLabel,
  conservationLevel,
  residueCount,
  residueRange,
  residueSummary,
  type LandscapeTool
} from "../../shared/landscapeEvidence";
import type { SequenceRowGridProps } from "./types";
import { DensityLegend, DensityTrack, formatThresholdValue, type DensityMarker, type DensitySeries } from "./DensityTrack";

/** Residue column width, shared by every row and the profile track. */
const RESIDUE_COLUMN_WIDTH = 30;
/** REVEL and AlphaMissense are scores on [0, 1], so the profile domain is fixed there. */
const PROBABILITY_DOMAIN = [0, 1] as const;

const TOOL_NAME: Record<LandscapeTool, string> = { revel: "REVEL", alphaMissense: "AlphaMissense" };
const f3 = (n: number) => n.toFixed(3);

type Focus = "target" | "selected" | "hovered" | undefined;

function focusOf(pos: number, targetPos: number, selected: number | null, hovered: number | null | undefined): Focus {
  if (pos === targetPos) return "target";
  if (pos === selected) return "selected";
  if (pos === hovered) return "hovered";
  return undefined;
}

/**
 * Residue grid: identity rows, one row per predictor (residue summaries coloured on the ClinGen
 * calibrated bands), and conservation rows on their own ink ramp. Every cell in a row is the same
 * kind of number; the queried variant's own scores appear only as markers on the profile, in the
 * tooltip of its residue, and in the finding above.
 */
export const SequenceRowGrid: React.FC<SequenceRowGridProps> = ({
  wildWindow,
  relativeStartIndex,
  mutation,
  residueIndex,
  hoveredResidueIndex,
  landscapeMap,
  metricMode,
  variantScores,
  domains,
  residueClass,
  onResidueClick,
  onResidueHover,
  loadingWindow
}) => {
  const targetPos = mutation.pos;
  const targetColumn = targetPos - relativeStartIndex;
  const columns = React.useMemo(
    () => wildWindow.map((res, i) => ({ res, pos: relativeStartIndex + i })),
    [wildWindow, relativeStartIndex]
  );
  const statWord = metricMode === "mean" ? "mean" : "max";

  const densitySeries: DensitySeries[] = React.useMemo(
    () => [
      {
        key: "revel",
        name: "REVEL",
        color: "var(--cs-danger)",
        points: columns.map((c) => residueSummary(landscapeMap.get(c.pos), "revel", metricMode))
      },
      {
        key: "am",
        name: "AlphaMissense",
        color: "var(--cs-accent-clay)",
        // Second, non-colour channel: the two series stay separable under CVD.
        dash: "4 2",
        points: columns.map((c) => residueSummary(landscapeMap.get(c.pos), "alphaMissense", metricMode))
      }
    ],
    [columns, landscapeMap, metricMode]
  );

  const markers: DensityMarker[] = [];
  if (targetColumn >= 0 && targetColumn < columns.length) {
    const name = mutation.wt && mutation.mut ? `${mutation.wt}${targetPos}${mutation.mut}` : `residue ${targetPos}`;
    if (variantScores.revel !== null) {
      markers.push({ key: "v-revel", index: targetColumn, value: variantScores.revel, color: "var(--cs-danger)", label: `${name} REVEL ${f3(variantScores.revel)} (this variant)` });
    }
    if (variantScores.am !== null) {
      markers.push({ key: "v-am", index: targetColumn, value: variantScores.am, color: "var(--cs-accent-clay)", label: `${name} AlphaMissense ${f3(variantScores.am)} (this variant)` });
    }
  }

  const revelPp3 = PP3_BP4_CALIBRATION.revel.pp3.Supporting as number;
  const amPp3 = PP3_BP4_CALIBRATION.alphaMissense.pp3.Supporting as number;
  const densityGuides = [
    { value: revelPp3, color: "var(--cs-danger)", label: `REVEL PP3 ${formatThresholdValue(revelPp3)}` },
    { value: amPp3, color: "var(--cs-accent-clay)", label: `AM PP3 ${formatThresholdValue(amPp3)}` }
  ];
  const lastPos = relativeStartIndex + columns.length - 1;
  const densitySummary =
    `Per-residue ${statWord} REVEL and AlphaMissense across residues ${relativeStartIndex} to ${lastPos}, scale 0 to 1. ` +
    `Reference lines at the ClinGen PP3 Supporting edges, REVEL ${revelPp3} and AlphaMissense ${amPp3}. ` +
    (markers.length ? "Diamonds mark the queried variant's own scores." : "");

  const hover = (pos: number | null) => () => onResidueHover(pos);

  const residueCell = (pos: number, letter: string, cls: string, label: string, mismatch = false) => (
    <button
      key={pos}
      type="button"
      className="ls-cell ls-cell--letter ls-aa"
      data-class={cls}
      data-focus={focusOf(pos, targetPos, residueIndex, hoveredResidueIndex)}
      data-mismatch={mismatch ? "true" : undefined}
      onClick={() => onResidueClick?.(pos)}
      onMouseEnter={hover(pos)}
      onMouseLeave={hover(null)}
      onFocus={hover(pos)}
      onBlur={hover(null)}
      title={label}
      aria-label={label}
    >
      {letter}
    </button>
  );

  const scoreRow = (tool: LandscapeTool) =>
    columns.map(({ pos }) => {
      const row = landscapeMap.get(pos);
      const value = residueSummary(row, tool, metricMode);
      const n = residueCount(row, tool);
      const range = residueRange(row, tool);
      const band = bandKey(tool, value);
      const own = pos === targetPos ? (tool === "revel" ? variantScores.revel : variantScores.am) : null;
      const pending = loadingWindow && !row;
      const text =
        value === null
          ? pending
            ? `Residue ${pos} ${TOOL_NAME[tool]}: loading`
            : `Residue ${pos} ${TOOL_NAME[tool]}: no score returned`
          : `Residue ${pos} ${TOOL_NAME[tool]} ${statWord} ${f3(value)} over ${n} missense substitution${n === 1 ? "" : "s"}` +
            (range && n > 1 ? ` (range ${f3(range[0])}–${f3(range[1])})` : "") +
            ` · band ${bandLabel(tool, value)}` +
            (own !== null ? ` · this variant ${f3(own)} (${bandLabel(tool, own)})` : "");
      return (
        <button
          key={pos}
          type="button"
          className="ls-cell ls-band"
          data-band={band ?? "none"}
          data-focus={focusOf(pos, targetPos, residueIndex, hoveredResidueIndex)}
          onClick={() => onResidueClick?.(pos)}
          onMouseEnter={hover(pos)}
          onMouseLeave={hover(null)}
          title={text}
          aria-label={text}
        >
          {value !== null ? value.toFixed(2).replace(/^0/, "") : pending ? "…" : "–"}
        </button>
      );
    });

  const consRow = (tool: "gerp" | "phylop") =>
    columns.map(({ pos }) => {
      const row: LandscapeResidueItem | undefined = landscapeMap.get(pos);
      const value = row ? (tool === "gerp" ? row.gerp : row.phylop) : null;
      const level = conservationLevel(tool, value);
      const name = tool === "gerp" ? "GERP++ RS" : "phyloP100way";
      const nts = row?.nucleotideCount ?? 0;
      const text =
        value === null || value === undefined
          ? `Residue ${pos} ${name}: no score returned`
          : `Residue ${pos} ${name} ${value.toFixed(2)}, mean over ${nts} codon nucleotide${nts === 1 ? "" : "s"}` +
            (pos === targetPos && tool === "gerp" && variantScores.gerp !== null ? ` · variant nucleotide ${variantScores.gerp.toFixed(2)}` : "") +
            (pos === targetPos && tool === "phylop" && variantScores.phylop !== null ? ` · variant nucleotide ${variantScores.phylop.toFixed(2)}` : "");
      return (
        <button
          key={pos}
          type="button"
          className="ls-cell ls-cons"
          data-level={level ?? "none"}
          data-focus={focusOf(pos, targetPos, residueIndex, hoveredResidueIndex)}
          onClick={() => onResidueClick?.(pos)}
          onMouseEnter={hover(pos)}
          onMouseLeave={hover(null)}
          title={text}
          aria-label={text}
        >
          {value !== null && value !== undefined ? value.toFixed(1) : "–"}
        </button>
      );
    });

  const visibleDomains = domains
    .filter((d) => d.end >= relativeStartIndex && d.start <= lastPos)
    .map((d) => ({
      ...d,
      from: Math.max(d.start, relativeStartIndex) - relativeStartIndex,
      to: Math.min(d.end, lastPos) - relativeStartIndex
    }));

  return (
    <div className="relative overflow-x-auto rounded-xl border border-cs-border p-4 flex flex-col gap-1 scrollbar-thin bg-cs-surface-2 max-w-full">
      <DensityLegend
        series={densitySeries}
        caption={`per-residue ${statWord} over SNV-reachable missense substitutions${markers.length ? " · ◆ this variant" : ""}`}
      />

      {/* Coordinate ruler */}
      <div className="flex font-mono text-[10px] h-4 pl-[76px] text-cs-text-muted" aria-hidden="true">
        {columns.map(({ pos }) => (
          <div key={pos} className="w-[30px] shrink-0 text-center">
            {(pos % 5 === 0 || pos === targetPos) && (
              <span className={pos === targetPos ? "font-bold text-cs-accent-clay" : ""}>{pos}</span>
            )}
          </div>
        ))}
      </div>

      <DensityTrack
        series={densitySeries}
        guides={densityGuides}
        markers={markers}
        columnWidth={RESIDUE_COLUMN_WIDTH}
        domain={PROBABILITY_DOMAIN}
        unitLabel="score 0–1"
        modeLabel={statWord.toUpperCase()}
        ariaLabel={densitySummary}
        emptyNotice={loadingWindow ? "Loading scores for this window…" : "No REVEL or AlphaMissense scores were returned for this window"}
      />

      {/* UniProt domains on the residue axis */}
      <div className="flex items-center pl-2">
        <span className="ls-row-label">DOMAIN</span>
        <div className="relative h-[14px]" style={{ width: columns.length * RESIDUE_COLUMN_WIDTH }}>
          {visibleDomains.length === 0 ? (
            <span className="text-[10px] font-mono text-cs-text-muted">none annotated in this window</span>
          ) : (
            visibleDomains.map((d, i) => (
              <div
                key={`${d.name}-${i}`}
                className="ls-domain absolute top-[2px]"
                style={{ left: d.from * RESIDUE_COLUMN_WIDTH + 1, width: (d.to - d.from + 1) * RESIDUE_COLUMN_WIDTH - 2 }}
                title={`${d.name} (${d.start}–${d.end})`}
              >
                <span className="px-1 text-[9px] leading-[10px] font-mono text-cs-text-primary truncate block">{d.name}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex items-center pl-2">
        <span className="ls-row-label">REFERENCE</span>
        <div className="flex">
          {columns.map(({ res, pos }) => {
            const row = landscapeMap.get(pos);
            const mismatch = Boolean(row?.refMismatch);
            const label =
              `Reference ${res} at residue ${pos}${pos === targetPos ? ", the queried residue" : ""}` +
              (mismatch ? ` · dbNSFP reports ${row?.aaref ?? "another residue"} here: the scores may be on a different numbering` : "");
            return residueCell(pos, res, residueClass(res), label, mismatch);
          })}
        </div>
      </div>

      <div className="flex items-center pl-2 mb-1">
        <span className="ls-row-label">VARIANT</span>
        <div className="flex">
          {columns.map(({ res, pos }) => {
            if (pos === targetPos && mutation.mut) {
              return residueCell(pos, mutation.mut, residueClass(mutation.mut), `Queried substitution ${mutation.wt}${pos}${mutation.mut}`);
            }
            return (
              <div key={pos} className="w-[30px] h-[28px] shrink-0 flex items-center justify-center text-cs-border" aria-hidden="true">
                ·
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center pl-2">
        <span className="ls-row-label" title="REVEL (Ioannidis 2016), residue summary">REVEL</span>
        <div className="flex gap-0">{scoreRow("revel")}</div>
      </div>
      <div className="flex items-center pl-2 mb-1">
        <span className="ls-row-label" title="AlphaMissense (Cheng 2023), residue summary">AM</span>
        <div className="flex">{scoreRow("alphaMissense")}</div>
      </div>
      <div className="flex items-center pl-2">
        <span className="ls-row-label" title="GERP++ rejected substitutions (Davydov 2010), codon mean">GERP++</span>
        <div className="flex">{consRow("gerp")}</div>
      </div>
      <div className="flex items-center pl-2">
        <span className="ls-row-label" title="phyloP 100-way vertebrate (Pollard 2010), codon mean">PHYLOP</span>
        <div className="flex">{consRow("phylop")}</div>
      </div>
    </div>
  );
};
