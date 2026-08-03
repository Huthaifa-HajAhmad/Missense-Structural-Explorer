import React from "react";
import { SettingsTabProps } from "./types";

export const WorkspaceTab: React.FC<SettingsTabProps> = ({ isDark, settings, updateSetting }) => {
  return (
    <div className="space-y-4">
      {/* Bento direction swap switch */}
      <label className={`flex items-center justify-between gap-3 p-2.5 rounded-lg border cursor-pointer hover:bg-slate-500/5 transition ${
        isDark ? "border-slate-800/80" : "border-slate-200"
      }`}>
        <div className="space-y-0.5">
          <span className="font-semibold block">Primary Controls on Left-hand Side</span>
          <span className={`text-[10px] block leading-normal ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Toggle this switch to swap the position of primary inputs and 3D molecular viewports.
          </span>
        </div>
        <input
          type="checkbox"
          checked={settings.bentoLeftControls}
          onChange={(e) => updateSetting("bentoLeftControls", e.target.checked)}
          className="w-4 h-4 rounded text-indigo-500 focus:ring-indigo-500 focus:ring-1 cursor-pointer accent-indigo-500"
        />
      </label>

      {/* Save History Toggle */}
      <label className="flex items-center justify-between p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/40 transition cursor-pointer select-none">
        <div className="flex-1 pr-4">
          <span className="font-semibold block text-xs">Save Variant Search History</span>
          <span className={`text-[10px] block leading-normal ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Enable to save variant queries locally for autocomplete and history (Opt-in, stored as obfuscated PHI-at-rest).
          </span>
        </div>
        <input
          type="checkbox"
          checked={settings.saveHistory || false}
          onChange={(e) => updateSetting("saveHistory", e.target.checked)}
          className="w-4 h-4 rounded text-indigo-500 focus:ring-indigo-500 focus:ring-1 cursor-pointer accent-indigo-500"
        />
      </label>

      {/* History Limit */}
      <div className="space-y-1.5 pt-1.5">
        <label className="font-semibold block">Max Presets History Cache Limit</label>
        <select
          value={settings.maxHistoryItems}
          onChange={(e) => updateSetting("maxHistoryItems", parseInt(e.target.value, 10))}
          className={`w-full p-2 rounded-lg border text-xs focus:ring-indigo-500/30 focus:ring-2 cursor-pointer transition-colors ${
            isDark 
              ? "bg-slate-900 border-slate-800 text-slate-200 focus:border-slate-700" 
              : "bg-white border-slate-200 text-slate-800 focus:border-indigo-400"
          }`}
        >
          <option value={5}>5 variants (Minimal)</option>
          <option value={10}>10 variants (Standard)</option>
          <option value={20}>20 variants (Recommended power log)</option>
          <option value={50}>50 variants (Maximum cache limit)</option>
        </select>
        <p className={`text-[10px] leading-normal ${isDark ? "text-slate-500" : "text-slate-400"}`}>
          LocalStorage query caches are optimized. Higher limit sizes consume negligible memory (under 50KB total).
        </p>
      </div>
    </div>
  );
};
