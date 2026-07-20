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
  isDark: boolean;
}

const W = 40;
const H = 76;
const PAD = 4;
const PLOT_W = W - PAD * 2;
const PLOT_H = H - PAD * 2 - 10; // leave 10px at top for label

export default function LandscapeMinimap({
  landscapeData,
  currentAM,
  currentREVEL,
  isDark,
}: LandscapeMinimapProps) {
  const points = useMemo(() => {
    if (!landscapeData?.length) return [];
    return landscapeData
      .map((d) => {
        const revel = d.revelMean ?? d.revelMax ?? null;
        const am = d.amMean ?? d.amMax ?? null;
        return { revel, am };
      })
      .filter((d) => d.am !== null && d.revel !== null)
      .map((d) => ({
        x: PAD + (d.revel! * PLOT_W),
        y: PAD + 10 + ((1 - d.am!) * PLOT_H),
        am: d.am!,
        revel: d.revel!,
        isCurrent: false,
      }));
  }, [landscapeData]);

  // Current variant dot
  const currentPoint =
    currentAM != null && currentREVEL != null
      ? {
          x: PAD + currentREVEL * PLOT_W,
          y: PAD + 10 + (1 - currentAM) * PLOT_H,
        }
      : null;

  const hasData = points.length > 0 || currentPoint;

  const dotColor = (am: number, revel: number): string => {
    // Pathogenic: AM Likely Pathogenic or REVEL Strong
    if (am >= THRESHOLDS.alphaMissense.pathogenicSupporting || revel >= THRESHOLDS.revel.pathogenicStrong) {
      return "#DC2626";   // pathogenic red
    }
    // Ambiguous/Supporting: AM Ambiguous or REVEL Supporting
    if (am > THRESHOLDS.alphaMissense.likelyBenign || revel >= THRESHOLDS.revel.pathogenicSupporting) {
      return "#D97706";  // uncertain amber
    }
    return "#16A34A";                     // benign green
  };

  return (
    <div className="sidebar-minimap" title="AM vs REVEL landscape scatter">
      <span className="sidebar-minimap-label">AM×REVEL</span>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block", overflow: "visible" }}
      >
        {/* Axis lines */}
        <line
          x1={PAD} y1={PAD + 10 + PLOT_H}
          x2={PAD + PLOT_W} y2={PAD + 10 + PLOT_H}
          stroke={isDark ? "#3C3934" : "#E5E1DC"} strokeWidth={0.5}
        />
        <line
          x1={PAD} y1={PAD + 10}
          x2={PAD} y2={PAD + 10 + PLOT_H}
          stroke={isDark ? "#3C3934" : "#E5E1DC"} strokeWidth={0.5}
        />

        {!hasData && (
          <text
            x={W / 2} y={H / 2 + 4}
            textAnchor="middle"
            fontSize={6}
            fill={isDark ? "#4B5563" : "#9CA3AF"}
            fontFamily="Inter, sans-serif"
          >
            No data
          </text>
        )}

        {/* Background dots (landscape variants) */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={1.2}
            fill={dotColor(p.am, p.revel)}
            opacity={0.55}
          />
        ))}

        {/* Current variant — highlighted clay dot with ring */}
        {currentPoint && (
          <>
            <circle
              cx={currentPoint.x}
              cy={currentPoint.y}
              r={3.5}
              fill="none"
              stroke="#C46849"
              strokeWidth={1}
              opacity={0.5}
            />
            <circle
              cx={currentPoint.x}
              cy={currentPoint.y}
              r={2}
              fill="#C46849"
            />
          </>
        )}
      </svg>
    </div>
  );
}
