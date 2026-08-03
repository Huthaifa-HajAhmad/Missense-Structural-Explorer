import React, { useMemo } from "react";
import { THRESHOLDS } from "../shared/thresholds";

interface LandscapePoint {
  residx: number;
  amMean?: number | null;
  amMax?: number | null;
  revelMean?: number | null;
  revelMax?: number | null;
}

interface LandscapeMinimapProps {
  landscapeData?: LandscapePoint[] | null;
  currentAM?: number | null;
  currentREVEL?: number | null;
  metricMode?: "mean" | "max";
}

// Relaxed expanded coordinate resolution for higher fidelity rendering and label separation
const W = 240;
const H = 220;
const PAD_LEFT = 45;   // Increased to prevent y-axis overlap
const PAD_BOTTOM = 40; // Increased to prevent x-axis overlap
const PAD_RIGHT = 12;
const PAD_TOP = 15;
const PLOT_W = W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;

export default function LandscapeMinimap({
  landscapeData,
  currentAM,
  currentREVEL,
  metricMode = "max",
}: LandscapeMinimapProps) {
  const points = useMemo(() => {
    if (!landscapeData?.length) return [];
    return landscapeData
      .map((d) => {
        // Respect the selected metricMode (default to max for clinical safety)
        const revel = metricMode === "mean"
          ? (d.revelMean ?? d.revelMax ?? null)
          : (d.revelMax ?? d.revelMean ?? null);
        const am = metricMode === "mean"
          ? (d.amMean ?? d.amMax ?? null)
          : (d.amMax ?? d.amMean ?? null);
        return { revel, am };
      })
      .filter((d) => d.am !== null && d.revel !== null)
      .map((d) => ({
        x: PAD_LEFT + (d.revel! * PLOT_W),
        // y is inverted (1.0 pathogenicity at top, 0.0 at bottom)
        y: PAD_TOP + ((1 - d.am!) * PLOT_H),
        am: d.am!,
        revel: d.revel!,
      }));
  }, [landscapeData, metricMode]);

  // Current query variant dot coordinates (representing single variant)
  const currentPoint =
    currentAM != null && currentREVEL != null
      ? {
          x: PAD_LEFT + currentREVEL * PLOT_W,
          y: PAD_TOP + (1 - currentAM) * PLOT_H,
        }
      : null;

  const hasData = points.length > 0 || currentPoint;

  const dotColor = (am: number, revel: number): string => {
    // Pathogenic: AM Likely Pathogenic or REVEL Strong
    if (am >= THRESHOLDS.alphaMissense.pathogenicSupporting || revel >= THRESHOLDS.revel.pathogenicStrong) {
      return "var(--cs-danger)";
    }
    // Ambiguous/Supporting: AM Ambiguous or REVEL Supporting
    if (am > THRESHOLDS.alphaMissense.likelyBenign || revel >= THRESHOLDS.revel.pathogenicSupporting) {
      return "var(--cs-warn)";
    }
    return "var(--cs-good)";
  };

  const revelThresholds = [
    THRESHOLDS.revel.benign,
    THRESHOLDS.revel.pathogenicSupporting,
    THRESHOLDS.revel.pathogenicStrong
  ];

  const amThresholds = [
    THRESHOLDS.alphaMissense.likelyBenign,
    THRESHOLDS.alphaMissense.pathogenicSupporting
  ];

  return (
    <div className="flex flex-col gap-2 animate-fade-in w-full items-center justify-center">
      <div 
        className="relative flex items-center justify-center overflow-visible select-none w-full" 
        title="Pathogenicity scatter plot comparing REVEL vs AlphaMissense scores across all positions of the gene, with the current query variant highlighted."
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto max-w-[240px]"
          style={{ display: "block", overflow: "visible" }}
          role="img"
          aria-label="AlphaMissense vs REVEL pathogenicity landscape"
        >
          <title>Pathogenicity Scatter Map</title>
          <desc>
            A two-dimensional scatter plot graphing AlphaMissense pathogenicity scores on the Y-axis against REVEL pathogenicity scores on the X-axis, with ClinGen decision boundary lines.
          </desc>

          {/* Grid Decision boundaries (translucent ClinGen quadrants) */}
          {revelThresholds.map((t, idx) => (
            <line
              key={`x-guide-${idx}`}
              x1={PAD_LEFT + t * PLOT_W}
              y1={PAD_TOP}
              x2={PAD_LEFT + t * PLOT_W}
              y2={PAD_TOP + PLOT_H}
              stroke="var(--cs-grid-line)"
              strokeWidth={0.5}
              strokeDasharray="1.5 2"
            />
          ))}

          {amThresholds.map((t, idx) => (
            <line
              key={`y-guide-${idx}`}
              x1={PAD_LEFT}
              y1={PAD_TOP + (1 - t) * PLOT_H}
              x2={PAD_LEFT + PLOT_W}
              y2={PAD_TOP + (1 - t) * PLOT_H}
              stroke="var(--cs-grid-line)"
              strokeWidth={0.5}
              strokeDasharray="1.5 2"
            />
          ))}

          {/* Axis lines */}
          <line
            x1={PAD_LEFT}
            y1={PAD_TOP + PLOT_H}
            x2={PAD_LEFT + PLOT_W}
            y2={PAD_TOP + PLOT_H}
            stroke="var(--cs-border)"
            strokeWidth={0.75}
          />
          <line
            x1={PAD_LEFT}
            y1={PAD_TOP}
            x2={PAD_LEFT}
            y2={PAD_TOP + PLOT_H}
            stroke="var(--cs-border)"
            strokeWidth={0.75}
          />

          {/* X Axis Tick Labels (0, 0.5, 1.0) */}
          {[0, 0.5, 1.0].map((val) => {
            const x = PAD_LEFT + val * PLOT_W;
            return (
              <g key={`x-tick-${val}`}>
                <line
                  x1={x}
                  y1={PAD_TOP + PLOT_H}
                  x2={x}
                  y2={PAD_TOP + PLOT_H + 2.5}
                  stroke="var(--cs-border)"
                  strokeWidth={0.5}
                />
                <text
                  x={x}
                  y={PAD_TOP + PLOT_H + 9}
                  textAnchor="middle"
                  className="font-sans text-[8px] font-medium fill-cs-text-muted"
                >
                  {val.toFixed(1)}
                </text>
              </g>
            );
          })}

          {/* Y Axis Tick Labels (0, 0.5, 1.0) */}
          {[0, 0.5, 1.0].map((val) => {
            const y = PAD_TOP + (1 - val) * PLOT_H;
            return (
              <g key={`y-tick-${val}`}>
                <line
                  x1={PAD_LEFT}
                  y1={y}
                  x2={PAD_LEFT - 2.5}
                  y2={y}
                  stroke="var(--cs-border)"
                  strokeWidth={0.5}
                />
                <text
                  x={PAD_LEFT - 5}
                  y={y + 1.5}
                  textAnchor="end"
                  className="font-sans text-[8px] font-medium fill-cs-text-muted"
                >
                  {val.toFixed(1)}
                </text>
              </g>
            );
          })}

          {/* Axis Titles */}
          <text
            x={PAD_LEFT + PLOT_W / 2}
            y={H - 6}
            textAnchor="middle"
            className="font-sans text-[9px] fill-cs-text-muted uppercase tracking-wider font-semibold"
          >
            REVEL
          </text>
          
          {/* Rotated Y Axis Title - offset to x=12 to clear tick values */}
          <text
            x={12}
            y={PAD_TOP + PLOT_H / 2}
            textAnchor="middle"
            transform={`rotate(-90 12,${PAD_TOP + PLOT_H / 2})`}
            className="font-sans text-[9px] fill-cs-text-muted uppercase tracking-wider font-semibold"
          >
            AlphaMissense
          </text>

          {!hasData && (
            <text
              x={PAD_LEFT + PLOT_W / 2}
              y={PAD_TOP + PLOT_H / 2 + 3}
              textAnchor="middle"
              className="font-sans text-[9px] fill-cs-text-muted"
            >
              No landscape scores
            </text>
          )}

          {/* Background dots (landscape variants) */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={0.9}
              fill={dotColor(p.am, p.revel)}
              className="opacity-[var(--cs-dot-opacity-faint)]"
            />
          ))}

          {/* Current variant — highlighted clay dot with ring */}
          {currentPoint && (
            <g>
              <circle
                cx={currentPoint.x}
                cy={currentPoint.y}
                r={4}
                fill="none"
                stroke="var(--cs-accent-clay)"
                strokeWidth={1}
                className="opacity-50 animate-pulse"
              />
              <circle
                cx={currentPoint.x}
                cy={currentPoint.y}
                r={2.2}
                fill="var(--cs-accent-clay)"
                className="opacity-[var(--cs-dot-opacity-focus)]"
              />
            </g>
          )}
        </svg>
      </div>

      {currentPoint && (
        <div className="flex items-center gap-1.5 justify-center mt-1">
          <span className="w-1.5 h-1.5 rounded-full bg-cs-accent-clay shrink-0" />
          <span className="text-[9px] font-mono text-cs-text-muted uppercase tracking-wide">
            Clay Dot: Query Variant
          </span>
        </div>
      )}
    </div>
  );
}
