import React from "react";
import { ExternalLink } from "lucide-react";
import { METRIC_EXPLANATIONS } from "./MetricExplanations";

interface MetricExplanationModalProps {
  selectedMetric: string | null;
  setSelectedMetric: (metric: string | null) => void;
  isDark: boolean;
}

export function MetricExplanationModal({
  selectedMetric,
  setSelectedMetric,
  isDark
}: MetricExplanationModalProps) {
  if (!selectedMetric) return null;
  const detail = METRIC_EXPLANATIONS[selectedMetric];
  if (!detail) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="w-full max-w-md rounded-2xl border shadow-2xl p-6 relative flex flex-col gap-4 animate-slide-in"
        style={{ 
          background: isDark ? "#1C1A17" : "#FAF9F6", 
          borderColor: "var(--cs-border)",
          color: "var(--cs-text-primary)"
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[9px] uppercase font-mono font-bold tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>
              {detail.category}
            </span>
            <h3 className="text-base font-black tracking-tight mt-0.5 text-left">
              {detail.name}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setSelectedMetric(null)}
            className="w-6 h-6 rounded-full flex items-center justify-center border hover:bg-[var(--cs-bg-subtle)] transition-colors text-slate-450 hover:text-slate-200 cursor-pointer text-lg font-bold"
            style={{ borderColor: "var(--cs-border-subtle)" }}
          >
            &times;
          </button>
        </div>

        {/* Description */}
        <div className="space-y-3 text-xs leading-relaxed text-left max-h-[60vh] overflow-y-auto pr-1">
          {detail.architecture && (
            <div className="text-[11px] font-mono opacity-80" style={{ color: "var(--cs-text-muted)" }}>
              {detail.architecture}
            </div>
          )}

          <div>
            <span className="block text-[9px] uppercase font-bold font-mono tracking-wider opacity-60 mb-1">
              Scientific Description
            </span>
            <p style={{ color: "var(--cs-text-secondary)" }}>
              {detail.description}
            </p>
          </div>

          <div>
            <span className="block text-[9px] uppercase font-bold font-mono tracking-wider opacity-60 mb-1">
              Interpretation &amp; Thresholds
            </span>
            <p style={{ color: "var(--cs-text-secondary)" }}>
              {detail.interpretation}
            </p>
          </div>

          {detail.strengths && detail.strengths.length > 0 && (
            <div className="p-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
              <span className="block text-[9px] uppercase font-bold font-mono tracking-wider text-emerald-400 mb-1">
                Key Strengths
              </span>
              <ul className="space-y-1 pl-1">
                {detail.strengths.map((s, idx) => (
                  <li key={idx} className="text-[11px] text-emerald-200/90 leading-tight">
                    • {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {detail.weaknesses && detail.weaknesses.length > 0 && (
            <div className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5">
              <span className="block text-[9px] uppercase font-bold font-mono tracking-wider text-amber-400 mb-1">
                Known Limitations
              </span>
              <ul className="space-y-1 pl-1">
                {detail.weaknesses.map((w, idx) => (
                  <li key={idx} className="text-[11px] text-amber-200/90 leading-tight">
                    • {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-2 border-t animate-fade-in" style={{ borderColor: "var(--cs-border-subtle)" }}>
            <span className="block text-[9px] uppercase font-bold font-mono tracking-wider opacity-60 mb-1">
              Reference Paper
            </span>
            <a
              href={detail.paperUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-bold hover:underline"
              style={{ color: "var(--cs-accent-clay)" }}
            >
              <span>{detail.paperTitle}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={() => setSelectedMetric(null)}
            className="px-4 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer hover:bg-[var(--cs-bg-subtle)]"
            style={{ 
              borderColor: "var(--cs-border-subtle)", 
              background: "var(--cs-surface-2)",
              color: "var(--cs-text-primary)" 
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
