import React, { useMemo, useState } from "react";
import { PP3_BP4_CALIBRATION } from "../shared/thresholds/calibration";
import { agreementClass, residueSummary, type Agreement, type SummaryMode } from "../shared/landscapeEvidence";
import type { LandscapeResidueItem } from "../shared/contracts";

interface Props {
  rows: LandscapeResidueItem[];
  variantRevel: number | null;
  variantAm: number | null;
  mode: SummaryMode;
  selectedResidue?: number | null;
  onSelectResidue?: (pos: number) => void;
  onHoverResidue?: (pos: number | null) => void;
  onBrush?: (bounds: { x0: number; x1: number; y0: number; y1: number }) => void;
}

const W = 640;
const H = 330;
const PAD_LEFT = 56;
const PAD_BOTTOM = 44;
const PAD_RIGHT = 36;
const PAD_TOP = 26;
const PLOT_W = W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;

const x = (v: number) => PAD_LEFT + v * PLOT_W;
const y = (v: number) => PAD_TOP + (1 - v) * PLOT_H;

const COLOR: Record<Agreement, string> = {
  "both-pp3": "var(--cs-danger)",
  "both-bp4": "var(--cs-text-indigo-on-soft)",
  discordant: "var(--cs-warn)",
  other: "var(--cs-text-muted)"
};
const LABEL: Record<Agreement, string> = {
  "both-pp3": "both PP3",
  "both-bp4": "both BP4",
  discordant: "discordant",
  other: "either indeterminate"
};

/**
 * REVEL against AlphaMissense for the loaded residues, read on the ClinGen bands. The dashed lines
 * are the calibrated PP3 / BP4 Supporting edges of each tool; the shaded corners are where both
 * tools agree. Dots are residue summaries (clickable and keyboard-reachable — each is a focusable
 * point with an enlarged hit circle, Enter selects); the diamond is the queried variant's own pair of
 * scores — a different kind of number, drawn with a different mark.
 */
export default function LandscapeAgreementPlot({ rows, variantRevel, variantAm, mode, selectedResidue, onSelectResidue, onHoverResidue, onBrush }: Props) {
  const [drag, setDrag] = useState<{ start: [number, number]; end: [number, number] } | null>(null);
  const plotPosition = (event: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const point = event.currentTarget.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const matrix = event.currentTarget.getScreenCTM();
    const local = matrix ? point.matrixTransform(matrix.inverse()) : point;
    return [Math.max(PAD_LEFT, Math.min(W - PAD_RIGHT, local.x)), Math.max(PAD_TOP, Math.min(H - PAD_BOTTOM, local.y))];
  };
  const { points, omitted, counts } = useMemo(() => {
    const placed: Array<{ pos: number; revel: number; am: number; cls: Agreement }> = [];
    const tally: Record<Agreement, number> = { "both-pp3": 0, "both-bp4": 0, discordant: 0, other: 0 };
    let skipped = 0;
    for (const r of rows) {
      const revel = residueSummary(r, "revel", mode);
      const am = residueSummary(r, "alphaMissense", mode);
      const cls = agreementClass(revel, am);
      // A point needs both axes; a missing one is left out and counted, never placed mid-plot.
      if (revel === null || am === null || !cls) {
        skipped += 1;
        continue;
      }
      tally[cls] += 1;
      placed.push({ pos: r.residx, revel, am, cls });
    }
    return { points: placed, omitted: skipped, counts: tally };
  }, [rows, mode]);

  const rev = PP3_BP4_CALIBRATION.revel;
  const am = PP3_BP4_CALIBRATION.alphaMissense;
  const revPp3 = rev.pp3.Supporting as number;
  const revBp4 = rev.bp4.Supporting as number;
  const amPp3 = am.pp3.Supporting as number;
  const amBp4 = am.bp4.Supporting as number;
  const variantPoint = variantRevel !== null && variantAm !== null ? { revel: variantRevel, am: variantAm } : null;
  const statWord = mode === "mean" ? "mean" : "max";

  const summary =
    `REVEL against AlphaMissense, residue ${statWord}s: ${points.length} residues plotted` +
    (omitted ? `, ${omitted} without both scores left out` : "") +
    `. ${counts["both-pp3"]} both in the PP3 range, ${counts["both-bp4"]} both in the BP4 range, ${counts.discordant} discordant.` +
    (variantPoint ? " The diamond is the queried variant." : "");

  const select = (pos: number) => onSelectResidue?.(pos);

  return (
    <div className="lsr-scatter flex flex-col gap-2 w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="agreement-plot" role="group" aria-label={summary}
        onPointerDown={event => {
          if (!onBrush || event.button !== 0 || (event.target as Element).closest('[data-point], [data-hit]')) return;
          const start = plotPosition(event); setDrag({ start, end: start }); event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => { if (drag) setDrag({ ...drag, end: plotPosition(event) }); }}
        onPointerCancel={() => setDrag(null)}
        onPointerUp={event => {
          if (!drag) return;
          const end = plotPosition(event);
          if (Math.abs(end[0] - drag.start[0]) > 5 && Math.abs(end[1] - drag.start[1]) > 5) onBrush?.({
            x0: (Math.min(drag.start[0], end[0]) - PAD_LEFT) / PLOT_W,
            x1: (Math.max(drag.start[0], end[0]) - PAD_LEFT) / PLOT_W,
            y0: 1 - (Math.max(drag.start[1], end[1]) - PAD_TOP) / PLOT_H,
            y1: 1 - (Math.min(drag.start[1], end[1]) - PAD_TOP) / PLOT_H,
          });
          setDrag(null);
        }}>
        <rect x={PAD_LEFT} y={PAD_TOP} width={PLOT_W} height={PLOT_H} fill="var(--cs-surface)" />
        <title>REVEL × AlphaMissense agreement</title>
        {/* Agreement corners */}
        <rect x={x(revPp3)} y={y(1)} width={x(1) - x(revPp3)} height={y(amPp3) - y(1)} fill="var(--cs-danger)" opacity={0.08} />
        <rect x={x(0)} y={y(amBp4)} width={x(revBp4) - x(0)} height={y(0) - y(amBp4)} fill="var(--cs-text-indigo-on-soft)" opacity={0.1} />

        {[revBp4, revPp3].map((t) => (
          <line key={`rx-${t}`} x1={x(t)} y1={y(0)} x2={x(t)} y2={y(1)} stroke="var(--cs-grid-line)" strokeDasharray="2 2" strokeWidth={0.75} />
        ))}
        {[amBp4, amPp3].map((t) => (
          <line key={`ay-${t}`} x1={x(0)} y1={y(t)} x2={x(1)} y2={y(t)} stroke="var(--cs-grid-line)" strokeDasharray="2 2" strokeWidth={0.75} />
        ))}

        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(0)} stroke="var(--cs-border)" strokeWidth={0.75} />
        <line x1={x(0)} y1={y(0)} x2={x(0)} y2={y(1)} stroke="var(--cs-border)" strokeWidth={0.75} />
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={`t-${v}`}>
            <text x={x(v)} y={y(0) + 12} textAnchor="middle" className="font-mono text-[11px] fill-cs-text-muted">{Number(v.toFixed(2))}</text>
            <text x={x(0) - 6} y={y(v) + 3} textAnchor="end" className="font-mono text-[11px] fill-cs-text-muted">{Number(v.toFixed(2))}</text>
          </g>
        ))}
        <text x={x(revPp3)} y={y(1) - 3} textAnchor="middle" className="font-mono text-[10px] fill-cs-text-muted">{revPp3}</text>
        <text x={x(revBp4)} y={y(1) - 3} textAnchor="middle" className="font-mono text-[10px] fill-cs-text-muted">{revBp4}</text>
        <text x={x(1) + 3} y={y(amPp3) + 2} className="font-mono text-[10px] fill-cs-text-muted">{amPp3}</text>
        <text x={x(1) + 3} y={y(amBp4) + 2} className="font-mono text-[10px] fill-cs-text-muted">{amBp4}</text>
        <text x={PAD_LEFT + PLOT_W / 2} y={H - 6} textAnchor="middle" className="text-[12px] fill-cs-text-secondary font-semibold">REVEL ({statWord})</text>
        <text x={10} y={PAD_TOP + PLOT_H / 2} textAnchor="middle" transform={`rotate(-90 10,${PAD_TOP + PLOT_H / 2})`} className="text-[12px] fill-cs-text-secondary font-semibold">AlphaMissense ({statWord})</text>

        {points.length === 0 && !variantPoint && (
          <text x={PAD_LEFT + PLOT_W / 2} y={PAD_TOP + PLOT_H / 2} textAnchor="middle" className="text-[10px] fill-cs-text-muted">
            {omitted > 0 ? "No residue scored by both predictors" : "No landscape scores"}
          </text>
        )}

        {/* Hit targets: the visible dot is 5–7px; the interactive circle remains at least 26px across at the minimum chart width. All of them
            are drawn first so no neighbour's hit area can sit over another point's dot. */}
        {onSelectResidue &&
          points.map((p) => (
            <circle key={`hit-${p.pos}`} data-hit="true" onPointerEnter={() => onHoverResidue?.(p.pos)} onPointerLeave={() => onHoverResidue?.(null)} cx={x(p.revel)} cy={y(p.am)} r={16} fill="transparent" pointerEvents="all" className="cursor-pointer" onClick={() => select(p.pos)} />
          ))}
        {points.map((p) => {
          const on = p.pos === selectedResidue;
          return (
            <g key={p.pos} className={onSelectResidue ? "lsr-scatter__pt" : undefined}>
              <circle
                cx={x(p.revel)}
                cy={y(p.am)}
                r={on ? 6 : 4}
                fill={COLOR[p.cls]}
                fillOpacity={0.85}
                stroke={on ? "var(--cs-text-primary)" : "none"}
                strokeWidth={1}
                data-point="true"
                role={onSelectResidue ? 'button' : undefined}
                aria-pressed={onSelectResidue ? on : undefined}
                onPointerEnter={() => onHoverResidue?.(p.pos)}
                onPointerLeave={() => onHoverResidue?.(null)}
                onFocus={() => onHoverResidue?.(p.pos)}
                onBlur={() => onHoverResidue?.(null)}
                tabIndex={onSelectResidue ? 0 : undefined}
                aria-label={`Residue ${p.pos}: REVEL ${statWord} ${p.revel.toFixed(3)}, AlphaMissense ${statWord} ${p.am.toFixed(3)} (${LABEL[p.cls]})${onSelectResidue ? " — press Enter to select" : ""}`}
                onClick={onSelectResidue ? () => select(p.pos) : undefined}
                onKeyDown={
                  onSelectResidue
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          select(p.pos);
                        }
                      }
                    : undefined
                }
              >
                <title>{`Residue ${p.pos}: REVEL ${statWord} ${p.revel.toFixed(3)}, AlphaMissense ${statWord} ${p.am.toFixed(3)} (${LABEL[p.cls]})`}</title>
              </circle>
            </g>
          );
        })}

        {variantPoint && (
          <g>
            <circle cx={x(variantPoint.revel)} cy={y(variantPoint.am)} r={12} fill="transparent" pointerEvents="none" />
            <path
              d={`M ${x(variantPoint.revel)} ${y(variantPoint.am) - 5.5} L ${x(variantPoint.revel) + 5.5} ${y(variantPoint.am)} L ${x(variantPoint.revel)} ${y(variantPoint.am) + 5.5} L ${x(variantPoint.revel) - 5.5} ${y(variantPoint.am)} Z`}
              fill="var(--cs-accent-clay)"
              stroke="var(--cs-surface-2)"
              strokeWidth={1.5}
            >
              <title>{`This variant: REVEL ${variantPoint.revel.toFixed(3)}, AlphaMissense ${variantPoint.am.toFixed(3)}`}</title>
            </path>
          </g>
        )}
        {drag && <rect x={Math.min(drag.start[0], drag.end[0])} y={Math.min(drag.start[1], drag.end[1])}
          width={Math.abs(drag.start[0] - drag.end[0])} height={Math.abs(drag.start[1] - drag.end[1])}
          fill="var(--cs-accent-clay)" fillOpacity={0.12} stroke="var(--cs-accent-clay)" strokeDasharray="4 3" pointerEvents="none" />}
      </svg>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-cs-text-secondary">
        {(Object.keys(LABEL) as Agreement[]).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: COLOR[k] }} />
            {LABEL[k]} {counts[k]}
          </span>
        ))}
        {variantPoint && (
          <span className="flex items-center gap-1">
            <span className="text-cs-accent-clay">◆</span> this variant
          </span>
        )}
        {omitted > 0 && <span className="text-cs-text-muted">{omitted} without both scores</span>}
      </div>
    </div>
  );
}
