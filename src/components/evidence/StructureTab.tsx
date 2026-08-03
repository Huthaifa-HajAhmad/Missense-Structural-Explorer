import React from "react";
import { Info } from "lucide-react";
import { TabComponentProps } from "./types";
import { AMINO_ACID_PROPERTIES, AMINO_ACID_NAMES_MAP } from "../../useVariantAnalysis";
import { AMINO_ACID_3_TO_1 } from "../../aminoAcids";

export function StructureTab({
  analysisState,
  setSelectedMetric
}: TabComponentProps) {
  const result = analysisState.result;
  if (!result) return null;

  const normalWt = result.metadata?.wildType ? (result.metadata.wildType.charAt(0).toUpperCase() + result.metadata.wildType.slice(1).toLowerCase()) : "";
  const normalMut = result.metadata?.mutant ? (result.metadata.mutant.charAt(0).toUpperCase() + result.metadata.mutant.slice(1).toLowerCase()) : "";
  const wt1 = normalWt.length === 3 ? AMINO_ACID_3_TO_1[normalWt] : normalWt;
  const mut1 = normalMut.length === 3 ? AMINO_ACID_3_TO_1[normalMut] : normalMut;
  const wtProp = wt1 ? AMINO_ACID_PROPERTIES[wt1] : null;
  const mutProp = mut1 ? AMINO_ACID_PROPERTIES[mut1] : null;

  const renderContrastBar = (wtVal: number, mutVal: number) => {
    const minVal = Math.min(wtVal, mutVal);
    const maxVal = Math.max(wtVal, mutVal);
    const isDecrease = wtVal > mutVal;
    const baseColor = "bg-[#ad5e6d]/90";
    const changeColor = isDecrease ? "bg-[#50c8a5]" : "bg-[#ff6f91]";
    return (
      <div className="relative h-2 bg-slate-200 dark:bg-slate-850 rounded-full overflow-hidden">
        <div 
          className={`absolute h-full left-0 ${baseColor}`} 
          style={{ width: `${minVal}%` }} 
        />
        <div 
          className={`absolute h-full ${changeColor}`} 
          style={{ left: `${minVal}%`, width: `${maxVal - minVal}%` }} 
        />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="screen-title">Structure</h1>
        <p className="screen-tab-description">Residue property shifts, burial status, contact density, and pocket proximity derived from the folded 3D model.</p>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 rounded-lg border flex flex-col items-center justify-center" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <span className="block text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Wild-Type Residue</span>
          <span className="text-3xl font-black text-emerald-500 mt-1">{normalWt}</span>
          <p className="text-xs mt-1.5 leading-normal" style={{ color: "var(--cs-text-muted)" }}>
            {AMINO_ACID_NAMES_MAP[wt1] || wt1}
          </p>
        </div>

        <div className="p-3 rounded-lg border flex flex-col items-center justify-center" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <span className="block text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-muted)" }}>Mutant Substitution</span>
          <span className="text-3xl font-black text-rose-500 mt-1">{normalMut}</span>
          <p className="text-xs mt-1.5 leading-normal" style={{ color: "var(--cs-text-muted)" }}>
            {AMINO_ACID_NAMES_MAP[mut1] || mut1}
          </p>
        </div>
      </div>

      {wtProp && mutProp && (
        <div className="p-4 rounded-lg border space-y-3" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <span className="block text-[10px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-secondary)" }}>Biochemical Property Contrast (Scale: 0-100)</span>
          
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span style={{ color: "var(--cs-text-secondary)" }}>Hydrophobicity</span>
              <span className="font-bold">{wtProp.hydrophobicity} → {mutProp.hydrophobicity}</span>
            </div>
            {renderContrastBar(wtProp.hydrophobicity, mutProp.hydrophobicity)}
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span style={{ color: "var(--cs-text-secondary)" }}>Residue Volume / Size</span>
              <span className="font-bold">{wtProp.size} → {mutProp.size}</span>
            </div>
            {renderContrastBar(wtProp.size, mutProp.size)}
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span style={{ color: "var(--cs-text-secondary)" }}>Polarity</span>
              <span className="font-bold">{wtProp.polarity} → {mutProp.polarity}</span>
            </div>
            {renderContrastBar(wtProp.polarity, mutProp.polarity)}
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span style={{ color: "var(--cs-text-secondary)", cursor: "help" }} title="Normalized scale: 0 = negative, 50 = neutral, 100 = positive">Isoelectric Charge Index ⓘ</span>
              <span className="font-bold">{wtProp.charge} → {mutProp.charge}</span>
            </div>
            {renderContrastBar(wtProp.charge, mutProp.charge)}
          </div>
        </div>
      )}

      {result.insights?.biochemicalShift && (
        <div className="p-3 rounded-lg border text-[12px] font-sans leading-relaxed" style={{ background: "rgba(196,104,73,0.05)", borderColor: "var(--cs-border)", color: "var(--cs-text-primary)" }}>
          <span className="font-bold block uppercase text-[11px] mb-1 tracking-wider" style={{ color: "var(--cs-accent-clay)" }}>Biochemical Shift Narrative:</span>
          {result.insights.biochemicalShift}
        </div>
      )}

      {result.disruptionPredictor && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => setSelectedMetric("contact_density")}
            className="p-4 rounded-lg border text-left flex flex-col justify-between hover:border-[#C46849]/50 transition-all cursor-pointer focus:outline-none w-full"
            style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
          >
            <div className="w-full">
              <div className="flex items-center justify-between w-full mb-1">
                <span className="block text-[11px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-secondary)" }}>Burial / Exposure Status</span>
                <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded border badge-metric-neutral">
                  {result.disruptionPredictor.burialStatus ?? "Unknown"}
                </span>
                {result.disruptionPredictor.rsa !== undefined && result.disruptionPredictor.rsa !== null && (
                  <span className="text-[11px] font-mono opacity-80" style={{ color: "var(--cs-text-secondary)" }}>
                    RSA: {(result.disruptionPredictor.rsa * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              <p className="text-[12px] leading-relaxed mt-2 font-sans" style={{ color: "var(--cs-text-secondary)" }}>
                {result.disruptionPredictor.burialStatus === "core"
                  ? "Residue is deeply buried in the hydrophobic core (<15% RSA)."
                  : result.disruptionPredictor.burialStatus === "surface"
                  ? "Residue is solvent-exposed on the protein surface (>35% RSA)."
                  : "Residue is located at a boundary or partial burial site."}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setSelectedMetric("contact_density")}
            className="p-4 rounded-lg border text-left flex flex-col justify-between hover:border-[#C46849]/50 transition-all cursor-pointer focus:outline-none w-full"
            style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}
          >
            <div className="w-full">
              <div className="flex items-center justify-between w-full mb-1">
                <span className="block text-[11px] uppercase font-bold tracking-wider" style={{ color: "var(--cs-text-secondary)" }}>Spatial Neighbor Density</span>
                <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </div>
              <div className="text-xl font-bold font-mono mt-1" style={{ color: "var(--cs-text-primary)" }}>
                {result.disruptionPredictor.neighborCount ?? 0}{" "}
                <span className="text-[10px] font-medium" style={{ color: "var(--cs-text-muted)" }}>neighbors (&lt;10Å)</span>
              </div>
              <p className="text-[10px] leading-normal mt-2" style={{ color: "var(--cs-text-secondary)" }}>
                Quantifies local packing density. Core is defined as &ge; 15 neighbors, boundary as 8-14, and surface as &lt; 8.
              </p>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
