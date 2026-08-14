import React from "react";

interface LocalShiftPoint {
  x: number;
  y: number;
  position: number;
  residue: string;
  shift: number;
}

interface EmbeddingShiftChartProps {
  activeEval: any;
  activePerturbModel: "saprot" | "esm2" | "esmc";
  pos: number;
  points: LocalShiftPoint[];
  pathD: string;
  shiftMetric: string;
  meanShift: number;
}

export function EmbeddingShiftChart({
  activeEval,
  pos,
  points,
  pathD,
  shiftMetric,
  meanShift
}: EmbeddingShiftChartProps) {
  return (
    <div className="p-4 rounded-xl border transition-all duration-300 shadow-sm space-y-3" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
      <div className="flex justify-between items-center border-b pb-2 text-left" style={{ borderColor: "var(--cs-border-subtle)" }}>
        <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-slate-400">Local Contextual Embedding Shift</span>
        <span className="text-[9px] font-mono flex items-center gap-2" style={{ color: "var(--cs-accent-clay)" }}>
          {(activeEval as any).klDivergence !== undefined && (activeEval as any).klDivergence !== null && (
            <span style={{ color: "var(--cs-text-secondary)" }}>KL Div: {(activeEval as any).klDivergence.toFixed(3)}</span>
          )}
          <span className="font-bold text-slate-350">Max: {activeEval.embeddingShift.toFixed(3)}</span>
        </span>
      </div>

      {points.length > 0 ? (
        <div className="relative w-full overflow-x-auto flex justify-center py-2">
          <svg className="w-full max-w-[580px] h-[170px]" viewBox="0 0 580 170">
            <line x1="40" y1="140" x2="560" y2="140" stroke="var(--cs-border-subtle)" strokeWidth="1" />
            <line x1="40" y1="85" x2="560" y2="85" stroke="var(--cs-border-subtle)" strokeDasharray="3,3" strokeWidth="1" />
            <line x1="40" y1="30" x2="560" y2="30" stroke="var(--cs-border-subtle)" strokeDasharray="3,3" strokeWidth="1" />

            <path 
              d={`${pathD} L ${points[points.length - 1].x} 140 L 40 140 Z`} 
              fill="url(#esmc-gradient)" 
              opacity="0.15" 
            />

            <path 
              d={pathD} 
              fill="none" 
              stroke="var(--cs-accent-clay)" 
              strokeWidth="2" 
            />

            {points.map((p, idx) => {
              const isMutSite = p.position === pos;
              return (
                <g key={idx}>
                  <circle 
                    cx={p.x} 
                    cy={p.y} 
                    r={isMutSite ? 5 : 3.5} 
                    fill={isMutSite ? "var(--cs-accent-clay)" : "var(--cs-surface)"} 
                    stroke="var(--cs-accent-clay)" 
                    strokeWidth="2" 
                  />
                  {idx % 3 === 0 || isMutSite ? (
                    <text 
                      x={p.x} 
                      y="155" 
                      textAnchor="middle" 
                      fontSize="9" 
                      fontFamily="monospace"
                      fill={isMutSite ? "var(--cs-text-primary)" : "var(--cs-text-muted)"}
                      fontWeight={isMutSite ? "bold" : "normal"}
                    >
                      {isMutSite ? `Mut:${p.position}` : p.position}
                    </text>
                  ) : null}
                </g>
              );
            })}

            <defs>
              <linearGradient id="esmc-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--cs-accent-clay)" />
                <stop offset="100%" stopColor="var(--cs-accent-clay)" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      ) : (
        <div className="py-8 text-center text-[11px] font-mono animate-pulse text-slate-500">
          Local contextual embedding shift data unavailable for this window.
        </div>
      )}
      <p className="text-[10px] leading-normal text-left text-slate-500">
        * Line plots trace {shiftMetric} shifts in model embedding coordinates across the structural neighborhood (± 10 residues). Average local shift is {meanShift.toFixed(3)}.
      </p>
    </div>
  );
}
