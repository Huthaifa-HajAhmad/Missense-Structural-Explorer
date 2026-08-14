import React from "react";

interface PreferenceItem {
  aa: string;
  prob: number;
}

interface ResiduePreferenceListProps {
  preferences: PreferenceItem[];
  wtRes: string;
  mutRes: string;
  pos: number;
}

export function ResiduePreferenceList({
  preferences,
  wtRes,
  mutRes,
  pos
}: ResiduePreferenceListProps) {
  return (
    <div className="p-4 rounded-xl border transition-all duration-300 shadow-sm space-y-3" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
      <div className="flex justify-between items-center border-b pb-2 text-left" style={{ borderColor: "var(--cs-border-subtle)" }}>
        <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-slate-400">Residue Preference Distribution</span>
        <span className="text-[9px] px-2 py-0.5 rounded font-mono font-medium border bg-slate-500/5 text-slate-400 border-slate-500/10">Position {pos}</span>
      </div>

      <div className="space-y-2 h-[220px] overflow-y-auto pr-1">
        {preferences.map((pref) => {
          const isWt = pref.aa === wtRes;
          const isMut = pref.aa === mutRes;
          const widthPercent = `${Math.max(1, pref.prob * 100)}%`;
          return (
            <div key={pref.aa} className="flex items-center gap-3 text-xs">
              <span 
                className="w-6 text-center font-mono font-bold py-0.5 rounded border text-[10px]"
                style={
                  isWt 
                    ? { background: "rgba(2, 132, 199, 0.1)", color: "#0284C7", borderColor: "rgba(2, 132, 199, 0.2)" } 
                    : isMut 
                      ? { background: "var(--cs-bg-warning)", color: "var(--cs-text-warning)", borderColor: "rgba(217, 119, 6, 0.2)" } 
                      : { color: "var(--cs-text-secondary)", borderColor: "transparent" }
                }
              >
                {pref.aa}
              </span>
              <div className="flex-1 h-3 rounded overflow-hidden relative" style={{ background: "var(--cs-bg-subtle)" }}>
                <div 
                  className="h-full rounded-r transition-all duration-300" 
                  style={{ 
                    width: widthPercent,
                    background: isWt 
                      ? "#0284C7" 
                      : isMut 
                        ? "var(--cs-text-warning)" 
                        : "var(--cs-text-muted)"
                  }} 
                />
              </div>
              <span className="w-12 text-right font-mono text-[10px]" style={{ color: "var(--cs-text-muted)" }}>
                {(pref.prob * 100).toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
