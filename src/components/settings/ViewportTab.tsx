import React from "react";
import { SettingsTabProps } from "./types";

export const ViewportTab: React.FC<SettingsTabProps> = ({ isDark, settings, updateSetting }) => {
  return (
    <div className="space-y-4">
      {/* Focus Swatch (Residual highlight) */}
      <div className="space-y-2">
        <label className="font-bold block text-[10px] uppercase tracking-wider text-slate-400">Target Residue Highlight Color</label>
        
        <div className="space-y-3">
          {/* Vibrant Swatches */}
          <div>
            <p className={`text-[9px] font-semibold mb-1.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Vibrant Colors</p>
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { name: "Sunset Orange", hex: "#F97316" },
                { name: "Emerald Green", hex: "#10B981" },
                { name: "Hot Pink", hex: "#EC4899" },
                { name: "Vibrant Gold", hex: "#F59E0B" },
                { name: "Deep Blue", hex: "#3B82F6" },
                { name: "Bright Indigo", hex: "#6366F1" }
              ].map((color) => (
                <button
                  key={color.hex}
                  type="button"
                  onClick={() => updateSetting("residueColor", color.hex)}
                  className={`px-2 py-1.5 text-[10px] font-medium rounded-md border flex items-center gap-1.5 transition-all cursor-pointer ${
                    settings.residueColor === color.hex
                      ? "border-indigo-550 ring-2 ring-indigo-550/20 font-bold"
                      : isDark
                        ? "border-slate-800 bg-slate-900/55 hover:bg-slate-800/80 text-slate-400"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600"
                  }`}
                  title={color.name}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color.hex }} />
                  {color.name.split(" ")[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Muted Colors (Low Saturation) */}
          <div>
            <p className={`text-[9px] font-semibold mb-1.5 ${isDark ? "text-slate-500" : "text-slate-400"}`}>Muted Pastel Colors (Low Saturation)</p>
            <div className="flex items-center gap-2 flex-wrap">
              {[
                { name: "Muted Rose", hex: "#C36A53" },
                { name: "Sage Green", hex: "#699C82" },
                { name: "Dusty Mauve", hex: "#BA7C93" },
                { name: "Muted Amber", hex: "#CC9E48" },
                { name: "Slate Blue", hex: "#5275A1" },
                { name: "Lavender Grey", hex: "#7E6EAC" }
              ].map((color) => (
                <button
                  key={color.hex}
                  type="button"
                  onClick={() => updateSetting("residueColor", color.hex)}
                  className={`px-2 py-1.5 text-[10px] font-medium rounded-md border flex items-center gap-1.5 transition-all cursor-pointer ${
                    settings.residueColor === color.hex
                      ? "border-indigo-550 ring-2 ring-indigo-550/20 font-bold"
                      : isDark
                        ? "border-slate-800 bg-slate-900/55 hover:bg-slate-800/80 text-slate-400"
                        : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600"
                  }`}
                  title={color.name}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color.hex }} />
                  {color.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Accent Swatch (App Accent Customization) */}
      <div className="space-y-2 pt-2">
        <label className="font-bold block text-[10px] uppercase tracking-wider text-slate-400">Primary Workspace Accent Color</label>
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { id: "indigo", name: "Indigo Theme", hex: "#6366F1" },
            { id: "purple", name: "Purple Theme", hex: "#A855F7" },
            { id: "rose", name: "Rose Theme", hex: "#F43F5E" },
            { id: "emerald", name: "Emerald Theme", hex: "#10B981" },
            { id: "amber", name: "Amber Theme", hex: "#F59E0B" },
            { id: "blue", name: "Blue Theme", hex: "#3B82F6" }
          ].map((accent) => (
            <button
              key={accent.id}
              type="button"
              onClick={() => updateSetting("primaryAccent", accent.id as any)}
              className={`px-2 py-1.5 text-[10px] font-medium rounded-md border flex items-center gap-1.5 transition-all cursor-pointer ${
                (settings.primaryAccent || "indigo") === accent.id
                  ? "border-indigo-550 ring-2 ring-indigo-550/20 font-bold bg-indigo-500/5"
                  : isDark
                    ? "border-slate-800 bg-slate-900/55 hover:bg-slate-800/80 text-slate-400"
                    : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600"
              }`}
              title={accent.name}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: accent.hex }} />
              {accent.name.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Camera Speed select */}
      <div className="space-y-1.5 pt-2">
        <label className="font-semibold block">Camera Transition Speed</label>
        <select
          value={settings.cameraDuration}
          onChange={(e) => updateSetting("cameraDuration", parseInt(e.target.value, 10))}
          className={`w-full p-2 rounded-lg border text-xs focus:ring-indigo-500/30 focus:ring-2 cursor-pointer transition-colors ${
            isDark 
              ? "bg-slate-900 border-slate-800 text-slate-200 focus:border-slate-700" 
              : "bg-white border-slate-200 text-slate-850 focus:border-indigo-400"
          }`}
        >
          <option value={0}>Snap-to (0ms - Instant)</option>
          <option value={800}>Fast (800ms)</option>
          <option value={1200}>Balanced Standard (1200ms)</option>
          <option value={2000}>Cinematic Slow (2000ms)</option>
        </select>
      </div>

      {/* Switches grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
        <label className={`flex items-center justify-between gap-3 p-2.5 rounded-lg border cursor-pointer hover:bg-slate-500/5 transition ${
          isDark ? "border-slate-800/80" : "border-slate-200"
        }`}>
          <div className="space-y-0.5">
            <span className="font-semibold block">Auto-Zoom Camera</span>
            <span className={`text-[10px] block leading-normal ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Re-center viewport on selection.
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.autoZoomOnSelect}
            onChange={(e) => updateSetting("autoZoomOnSelect", e.target.checked)}
            className="w-4 h-4 rounded text-indigo-500 focus:ring-indigo-500 focus:ring-1 cursor-pointer accent-indigo-500"
          />
        </label>

        <label className={`flex items-center justify-between gap-3 p-2.5 rounded-lg border cursor-pointer hover:bg-slate-500/5 transition ${
          isDark ? "border-slate-800/80" : "border-slate-200"
        }`}>
          <div className="space-y-0.5">
            <span className="font-semibold block">Show 3D Residue Labels</span>
            <span className={`text-[10px] block leading-normal ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Renders labels in 3D viewport.
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.show3DLabels}
            onChange={(e) => updateSetting("show3DLabels", e.target.checked)}
            className="w-4 h-4 rounded text-indigo-500 focus:ring-indigo-500 focus:ring-1 cursor-pointer accent-indigo-500"
          />
        </label>
      </div>
    </div>
  );
};
