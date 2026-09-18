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
  /**
   * Wild-type, mutant and background use one palette across this panel and the adjacent
   * embedding-shift trace: sky for the native residue, clay for the variant of interest,
   * muted grey for everything else. Highlighting the mutant in amber previously clashed
   * with the shared warning colour used for genuine caution states.
   */
  const WT_COLOR = "#0284C7";
  const MUT_COLOR = "var(--cs-accent-clay)";
  const BG_COLOR = "var(--cs-text-muted)";

  const wtProb = preferences.find(p => p.aa === wtRes)?.prob ?? null;
  const mutProb = preferences.find(p => p.aa === mutRes)?.prob ?? null;

  return (
    <div className="p-4 rounded-xl border transition-all duration-300 shadow-sm space-y-3 text-left flex flex-col h-full" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
      <div className="flex justify-between items-center border-b pb-2" style={{ borderColor: "var(--cs-border-subtle)" }}>
        <span className="text-[11px] uppercase font-bold tracking-wider font-sans text-cs-text-muted">Residue Preference Distribution</span>
        <span className="text-[9px] px-2 py-0.5 rounded font-mono font-medium border bg-slate-500/5 text-slate-400 border-slate-500/10">Position {pos}</span>
      </div>

      {/* Legend: names the two highlighted rows so the colour coding needs no inference. */}
      <div className="flex items-center gap-3 text-[9.5px] font-mono text-cs-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: WT_COLOR }} />
          Native {wtRes}
          {wtProb !== null && <span className="text-cs-text-secondary">{(wtProb * 100).toFixed(1)}%</span>}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: MUT_COLOR }} />
          Variant {mutRes}
          {mutProb !== null && <span className="text-cs-text-secondary">{(mutProb * 100).toFixed(2)}%</span>}
        </span>
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
                    ? { background: "rgba(2, 132, 199, 0.1)", color: WT_COLOR, borderColor: "rgba(2, 132, 199, 0.2)" } 
                    : isMut 
                      ? { background: "rgba(196, 104, 73, 0.12)", color: MUT_COLOR, borderColor: "rgba(196, 104, 73, 0.25)" } 
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
                    background: isWt ? WT_COLOR : isMut ? MUT_COLOR : BG_COLOR
                  }} 
                />
              </div>
              <span className="w-12 text-right font-mono text-[10px] tabular-nums" style={{ color: isWt || isMut ? "var(--cs-text-primary)" : "var(--cs-text-muted)" }}>
                {(pref.prob * 100).toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
