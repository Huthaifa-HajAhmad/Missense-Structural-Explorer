import React from "react";
import { SettingsTabProps } from "./types";

export const BiophysicsTab: React.FC<SettingsTabProps> = ({ isDark, settings, updateSetting }) => {
  return (
    <div className="space-y-4">
      {/* ACMG Weighting Model */}
      <div className="space-y-1.5">
        <label className="font-semibold block">ACMG Pathfinder Weighting Model</label>
        <select
          value={settings.acmgWeighting}
          onChange={(e) => updateSetting("acmgWeighting", e.target.value as any)}
          className={`w-full p-2 rounded-lg border text-xs focus:ring-indigo-500/30 focus:ring-2 cursor-pointer transition-colors ${
            isDark 
              ? "bg-slate-900 border-slate-800 text-slate-200 focus:border-slate-700" 
              : "bg-white border-slate-200 text-slate-850 focus:border-indigo-400"
          }`}
        >
          <option value="standard">Standard (app default)</option>
          <option value="conservative">Conservative (Downgrade speculative criteria)</option>
          <option value="strict-structural">Strict-Structural (Strong weight to PM1/PS3 hotspots)</option>
        </select>
      </div>

      {/* Energy Units select */}
      <div className="space-y-1.5 pt-1.5">
        <label className="font-semibold block">Stability Delta Energy Unit (ΔΔG)</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { name: "Kcal/mol (Standard)", val: "kcal/mol" },
            { name: "KJ/mol (Metric)", val: "kJ/mol" }
          ].map((unit) => (
            <button
              key={unit.val}
              type="button"
              onClick={() => updateSetting("energyUnit", unit.val as any)}
              className={`py-2 text-[10px] rounded-lg border transition-all cursor-pointer font-semibold ${
                settings.energyUnit === unit.val
                  ? isDark
                    ? "bg-indigo-600/35 text-indigo-300 border-indigo-500 ring-1 ring-indigo-500/30 font-bold"
                    : "bg-indigo-50 text-indigo-700 border-indigo-400 font-bold"
                  : isDark
                    ? "bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800"
                    : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
              }`}
            >
              {unit.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
