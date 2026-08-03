import React from "react";
import { SettingsTabProps } from "./types";

export const SequenceTab: React.FC<SettingsTabProps> = ({ isDark, settings, updateSetting }) => {
  return (
    <div className="space-y-4">
      {/* Color schemes select */}
      <div className="space-y-1.5">
        <label className="font-semibold block">Residue Color Scheme</label>
        <select
          value={settings.seqColorScheme}
          onChange={(e) => updateSetting("seqColorScheme", e.target.value as any)}
          className={`w-full p-2 rounded-lg border text-xs focus:ring-indigo-500/30 focus:ring-2 cursor-pointer transition-colors ${
            isDark 
              ? "bg-slate-900 border-slate-800 text-slate-200 focus:border-slate-700" 
              : "bg-white border-slate-200 text-slate-800 focus:border-indigo-400"
          }`}
        >
          <option value="chemical">Chemical Properties (Polar, Acidic, Basic, Aliphatic)</option>
          <option value="hydrophobic">Hydrophobicity Intensity Gradient</option>
          <option value="minimal">Minimalist Monochrome (Theme slate/white)</option>
        </select>
      </div>

      {/* Window Scroll Step size */}
      <div className="space-y-1.5 pt-1.5">
        <label className="font-semibold block">Default Ribbons Slice Size</label>
        <select
          value={settings.seqScrollStep}
          onChange={(e) => updateSetting("seqScrollStep", parseInt(e.target.value, 10))}
          className={`w-full p-2 rounded-lg border text-xs focus:ring-indigo-500/30 focus:ring-2 cursor-pointer transition-colors ${
            isDark 
              ? "bg-slate-900 border-slate-800 text-slate-200 focus:border-slate-700" 
              : "bg-white border-slate-200 text-slate-800 focus:border-indigo-400"
          }`}
        >
          <option value={15}>15 residues viewport</option>
          <option value={21}>21 residues viewport (Standard compact)</option>
          <option value={31}>31 residues viewport</option>
          <option value={41}>41 residues viewport (Wide screen detail)</option>
        </select>
      </div>
    </div>
  );
};
