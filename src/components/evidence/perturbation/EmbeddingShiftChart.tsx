import React from "react";
import { FONT_MONO } from "./chartFonts";

interface LocalShiftPoint {
  x: number;
  y: number;
  position: number;
  residue: string;
  shift: number;
}

interface EmbeddingShiftChartProps {
  activeEval: any;
  /** Display name of the card this evaluation belongs to, so an empty result can name itself. */
  modelName: string;
  pos: number;
  points: LocalShiftPoint[];
  pathD: string;
  /** Distance definition varies by model (cosine for ESMC, Euclidean otherwise). */
  shiftMetric: string;
  meanShift: number;
}

export function EmbeddingShiftChart({
  activeEval,
  modelName,
  pos,
  points,
  pathD,
  shiftMetric,
  meanShift
}: EmbeddingShiftChartProps) {
  /**
   * Max and Mean are statistics *of* the ±10 window, so they only exist when that window does.
   * This header used to print "Max: 0.000 / Mean: 0.000" over an absent window — a coerced zero
   * reading as a measured one, directly above the notice that no window was returned.
   */
  const hasWindow = points.length > 0;

  /**
   * KL divergence is a separate measurement (a real one even where the window is missing, as in
   * ESM-2's remote path), so it is reported on its own terms rather than gated on the window.
   */
  const klDivergence = (activeEval as any).klDivergence;
  const hasKl = typeof klDivergence === "number" && Number.isFinite(klDivergence);

  /**
   * Which engine served this evaluation decides *why* a window is missing: the serverless path
   * scores substitutions through a masked-token API that exposes no per-residue embeddings,
   * while the local engine computes the window from hidden states. Attributing the gap to "this
   * model" — as this card used to — blamed the model for an engine limitation.
   */
  const provenance = typeof activeEval.provenance === "string" ? activeEval.provenance : "";
  const engineWithholdsWindow = /remote|cloud|serverless|hf/i.test(provenance);

  return (
    <div className="p-4 rounded-xl border transition-all duration-300 shadow-sm space-y-3 flex flex-col h-full" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
      <div className="flex justify-between items-center border-b pb-2 text-left" style={{ borderColor: "var(--cs-border-subtle)" }}>
        <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-cs-text-muted">Local Contextual Embedding Shift</span>
        <span className="text-[9px] font-mono flex items-center gap-2" style={{ color: "var(--cs-accent-clay)" }}>
          {hasKl && (
            <span style={{ color: "var(--cs-text-secondary)" }}>KL Div: {klDivergence.toFixed(3)}</span>
          )}
          <span className="font-bold text-cs-text-secondary">
            Max: {hasWindow && typeof activeEval.embeddingShift === "number" ? activeEval.embeddingShift.toFixed(3) : "—"}
          </span>
          <span
            className="text-cs-text-muted"
            title={`${shiftMetric} averaged across this ±10 residue window. Units differ by model: this value is not comparable to another model's card.`}
          >
            Mean: {hasWindow ? meanShift.toFixed(3) : "—"}
          </span>
        </span>
      </div>

      {hasWindow ? (
        <div className="relative w-full flex-1 overflow-x-auto flex justify-center items-center py-2">
          <svg className="w-full max-w-[580px] h-[230px]" viewBox="0 0 580 170" preserveAspectRatio="xMidYMid meet">
            <line x1="40" y1="140" x2="560" y2="140" stroke="var(--cs-border-subtle)" strokeWidth="1" />
            <line x1="40" y1="85" x2="560" y2="85" stroke="var(--cs-border-subtle)" strokeDasharray="3,3" strokeWidth="1" />
            <line x1="40" y1="30" x2="560" y2="30" stroke="var(--cs-border-subtle)" strokeDasharray="3,3" strokeWidth="1" />

            <path 
              d={`${pathD} L ${points[points.length - 1].x} 140 L 40 140 Z`} 
              fill="url(#shift-gradient)" 
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
                      fontFamily={FONT_MONO}
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
              <linearGradient id="shift-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--cs-accent-clay)" />
                <stop offset="100%" stopColor="var(--cs-accent-clay)" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      ) : (
        <div className="py-8 px-4 text-center space-y-1">
          <p className="text-[11px] font-mono text-cs-text-secondary">
            {modelName} returned no local shift window
          </p>
          <p className="text-[10px] text-cs-text-muted leading-relaxed max-w-[46ch] mx-auto">
            This result carries no per-residue shift map, so the ±10 residue trace around position {pos}
            cannot be drawn, and the window statistics above are unavailable with it.{" "}
            {engineWithholdsWindow
              ? "This card was served by the serverless engine, which scores the substitution through a masked-token API and returns no per-residue embeddings; re-running on the local engine returns the full window."
              : "This model reported no per-residue shift map for this position."}
          </p>
        </div>
      )}
    </div>
  );
}
