import React from "react";
import { FONT_MONO, FONT_SANS } from "./chartFonts";

interface DisplacementItem {
  resSeq: number;
  resName: string;
  displacement: number;
}

interface BackboneDisplacementChartProps {
  displacements: DisplacementItem[];
  pos: number;
}

export function BackboneDisplacementChart({
  displacements,
  pos
}: BackboneDisplacementChartProps) {
  const maxDispVal = displacements.length > 0 ? Math.max(...displacements.map(d => d.displacement)) : 0.6;
  const yMax = Math.max(1.0, Math.ceil(maxDispVal * 2) / 2);

  const chartHeight = 130;
  const chartWidth = 560;
  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 15;
  const paddingBottom = 25;

  const graphWidth = chartWidth - paddingLeft - paddingRight;
  const graphHeight = chartHeight - paddingTop - paddingBottom;

  const barWidth = displacements.length > 0 ? Math.max(12, Math.floor(graphWidth / displacements.length) - 6) : 20;
  const getX = (index: number) => paddingLeft + index * (graphWidth / displacements.length) + (graphWidth / displacements.length - barWidth) / 2;
  const getY = (val: number) => paddingTop + graphHeight - (val / yMax) * graphHeight;

  const gridValues = [0, 0.5, 1.0, 1.5].filter(v => v <= yMax);

  return (
    <div className="pt-3 border-t border-dashed" style={{ borderColor: "var(--cs-border-subtle)" }}>
      <span className="block text-[11px] uppercase font-bold tracking-wider mb-3 font-sans text-left text-slate-400">
        Local Backbone Displacement Profile
      </span>
      <div className="relative w-full overflow-x-auto flex justify-center py-2.5 border rounded-lg" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border-subtle)" }}>
        <svg className="w-full max-w-[560px] h-[130px]" viewBox={`0 0 560 130`}>
          {gridValues.map(v => (
            <g key={v}>
              <line
                x1={paddingLeft}
                y1={getY(v)}
                x2={chartWidth - paddingRight}
                y2={getY(v)}
                stroke="var(--cs-border-subtle)"
                strokeWidth="1"
                strokeDasharray={v === 0 ? "none" : "3,3"}
              />
              <text
                x={paddingLeft - 8}
                y={getY(v) + 3}
                textAnchor="end"
                fontSize="8"
                fontFamily={FONT_MONO}
                fill="var(--cs-text-muted)"
              >
                {v.toFixed(1)} Å
              </text>
            </g>
          ))}

          {yMax >= 0.5 && (
            <g>
              <line
                x1={paddingLeft}
                y1={getY(0.5)}
                x2={chartWidth - paddingRight}
                y2={getY(0.5)}
                stroke="rgba(239, 68, 68, 0.45)"
                strokeDasharray="4,4"
                strokeWidth="1.5"
              />
              <text
                x={chartWidth - paddingRight - 5}
                y={getY(0.5) - 3}
                textAnchor="end"
                fontSize="8"
                fontFamily={FONT_SANS}
                fill="rgba(239, 68, 68, 0.85)"
                fontWeight="bold"
              >
                High Disruption (0.5 Å)
              </text>
            </g>
          )}

          {displacements.map((d: DisplacementItem, idx: number) => {
            const x = getX(idx);
            const y = getY(d.displacement);
            const barH = paddingTop + graphHeight - y;
            const isMut = d.resSeq === pos;
            const isHigh = d.displacement > 0.5;

            return (
              <g key={idx}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(1, barH)}
                  rx="1.5"
                  fill={isHigh ? "rgba(239, 68, 68, 0.65)" : isMut ? "var(--cs-accent-clay)" : "rgba(13, 148, 136, 0.5)"}
                  stroke={isHigh ? "rgb(239, 68, 68)" : isMut ? "var(--cs-accent-clay)" : "rgb(13, 148, 136)"}
                  strokeWidth="1.2"
                />
                <text
                  x={x + barWidth / 2}
                  y={chartHeight - 8}
                  textAnchor="middle"
                  fontSize="8"
                  fontFamily={FONT_MONO}
                  fill={isMut ? "var(--cs-text-primary)" : "var(--cs-text-muted)"}
                  fontWeight={isMut ? "bold" : "normal"}
                >
                  {d.resName}{d.resSeq}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
