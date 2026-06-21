import { Settings as SettingsIcon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useSettings } from "../context/SettingsContext";

export default function SettingsDrawer() {
  const {
    isDark,
    isSettingsOpen,
    setIsSettingsOpen,
    settings,
    updateSetting,
    resetSettingsToDefault,
  } = useSettings();
  return (
    <AnimatePresence>
      {isSettingsOpen && (
        <>
          {/* Backdrop Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSettingsOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 cursor-pointer"
          />

          {/* Sidebar drawer container */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
            className={`fixed top-0 right-0 h-full w-full max-w-md shadow-2xl z-50 p-6 flex flex-col justify-between overflow-y-auto border-l transition-colors ${
              isDark 
                ? "bg-[#0f172a] border-slate-800 text-slate-100" 
                : "bg-white border-slate-200 text-slate-850"
            }`}
          >
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-800/20 mb-5">
                <div className="flex items-center gap-2">
                  <SettingsIcon className="w-5 h-5 text-indigo-500" />
                  <h2 className="text-lg font-bold tracking-tight">Frontend Configuration</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                    isDark 
                      ? "border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white" 
                      : "border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-slate-900"
                  }`}
                >
                  ✕
                </button>
              </div>

              <div className="space-y-6 text-xs">
                {/* Category 1: 3D Viewport Controls */}
                <div className="space-y-3">
                  <p className={`font-mono text-[10px] uppercase font-bold tracking-wider ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    🔬 3D Viewport Controls & Graphics
                  </p>
                  
                  {/* Color Swatch */}
                  <div className="space-y-2">
                    <label className="font-semibold block">Focus Highlight Color</label>
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
                              ? "border-indigo-500 ring-2 ring-indigo-500/20 font-bold"
                              : isDark
                                ? "border-slate-800 bg-slate-900/55 hover:bg-slate-800/80 text-slate-400"
                                : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600"
                          }`}
                          title={color.name}
                        >
                          <span 
                            className="w-2.5 h-2.5 rounded-full shrink-0" 
                            style={{ backgroundColor: color.hex }}
                          />
                          {color.name.split(" ")[0]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Camera Speed select */}
                  <div className="space-y-1.5 pt-1.5">
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

                  {/* Auto Zoom On Select switch */}
                  <label className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-transparent hover:bg-slate-800/20 cursor-pointer pt-2">
                    <div className="space-y-0.5">
                      <span className="font-semibold block">Auto-Zoom Camera on Select</span>
                      <span className={`text-[10px] block leading-normal ${isDark ? "text-slate-400" : "text-slate-550"}`}>
                        Immediately re-center and zoom the 3D viewport of the selected index.
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.autoZoomOnSelect}
                      onChange={(e) => updateSetting("autoZoomOnSelect", e.target.checked)}
                      className="w-4 h-4 rounded text-indigo-500 focus:ring-indigo-500 focus:ring-1 cursor-pointer accent-indigo-500"
                    />
                  </label>

                  {/* Atom Interactions default checkbox */}
                  <label className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-transparent hover:bg-slate-800/20 cursor-pointer">
                    <div className="space-y-0.5">
                      <span className="font-semibold block">Enable Polar Hydrogen Bonds</span>
                      <span className={`text-[10px] block leading-normal ${isDark ? "text-slate-400" : "text-slate-550"}`}>
                        Renders hydrogen bond cylinders around selected target sites by default.
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.showAtomInteractions}
                      onChange={(e) => updateSetting("showAtomInteractions", e.target.checked)}
                      className="w-4 h-4 rounded text-indigo-500 focus:ring-indigo-500 focus:ring-1 cursor-pointer accent-indigo-500"
                    />
                  </label>

                  {/* 3D Residue Labels checkbox */}
                  <label className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-transparent hover:bg-slate-800/20 cursor-pointer">
                    <div className="space-y-0.5">
                      <span className="font-semibold block">Enable 3D Residue Labels</span>
                      <span className={`text-[10px] block leading-normal ${isDark ? "text-slate-400" : "text-slate-550"}`}>
                        Renders 3D residue labels with sequence numbers directly in the 3D viewport.
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

                {/* Category 2: Biophysics & ACMG Weightings */}
                <div className="space-y-3 pt-3 border-t border-slate-850/10">
                  <p className={`font-mono text-[10px] uppercase font-bold tracking-wider ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    🧬 Biophysics & ACMG Evidence Weighting
                  </p>

                  {/* ACMG rules weighting select */}
                  <div className="space-y-1.5">
                    <label className="font-semibold block">ACMG Pathfinder Weighting Model</label>
                    <select
                      value={settings.acmgWeighting}
                      onChange={(e) => updateSetting("acmgWeighting", e.target.value as "standard" | "conservative" | "strict-structural")}
                      className={`w-full p-2 rounded-lg border text-xs focus:ring-indigo-500/30 focus:ring-2 cursor-pointer transition-colors ${
                        isDark 
                          ? "bg-slate-900 border-slate-800 text-slate-200 focus:border-slate-700" 
                          : "bg-white border-slate-200 text-slate-850 focus:border-indigo-400"
                      }`}
                    >
                      <option value="standard">Standard (Default Clinician rules)</option>
                      <option value="conservative">Conservative (Downgrade speculative criteria)</option>
                      <option value="strict-structural">Strict-Structural (Strong weight to PM1/PS3 hotspots)</option>
                    </select>
                  </div>

                  {/* Energy Units select */}
                  <div className="space-y-1.5 pt-1">
                    <label className="font-semibold block">Stability Delta Energy Unit ($\Delta\Delta G$)</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { name: "Kcal/mol (Standard)", val: "kcal/mol" },
                        { name: "KJ/mol (Metric)", val: "kJ/mol" }
                      ].map((unit) => (
                        <button
                          key={unit.val}
                          type="button"
                          onClick={() => updateSetting("energyUnit", unit.val as "kcal/mol" | "kJ/mol")}
                          className={`py-2 text-[10px] rounded-lg border transition-all cursor-pointer font-semibold ${
                            settings.energyUnit === unit.val
                              ? isDark
                                ? "bg-indigo-600/30 text-indigo-300 border-indigo-505 ring-1 ring-indigo-500/30 font-bold"
                                : "bg-indigo-50 text-indigo-700 border-indigo-450 font-bold"
                              : isDark
                                ? "bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-850"
                                : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                          }`}
                        >
                          {unit.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Category 3: Sequence Strip Display */}
                <div className="space-y-3 pt-3 border-t border-slate-850/10">
                  <p className={`font-mono text-[10px] uppercase font-bold tracking-wider ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    📊 Sequence Alignment Strip Preferences
                  </p>

                  {/* Color schemes select */}
                  <div className="space-y-1.5">
                    <label className="font-semibold block">Residue Color Scheme</label>
                    <select
                      value={settings.seqColorScheme}
                      onChange={(e) => updateSetting("seqColorScheme", e.target.value as "chemical" | "hydrophobic" | "minimal")}
                      className={`w-full p-2 rounded-lg border text-xs focus:ring-indigo-500/30 focus:ring-2 cursor-pointer transition-colors ${
                        isDark 
                          ? "bg-slate-900 border-slate-800 text-slate-200 focus:border-slate-700" 
                          : "bg-white border-slate-200 text-slate-850 focus:border-indigo-400"
                      }`}
                    >
                      <option value="chemical">Chemical Properties (Polar, Acidic, Basic, Aliphatic)</option>
                      <option value="hydrophobic">Hydrophobicity Intensity Gradient</option>
                      <option value="minimal">Minimalist Monochrome (Theme slate/white)</option>
                    </select>
                  </div>

                  {/* Window Scroll Step size */}
                  <div className="space-y-1.5 pt-1">
                    <label className="font-semibold block">Default Ribbons Slice Size</label>
                    <select
                      value={settings.seqScrollStep}
                      onChange={(e) => updateSetting("seqScrollStep", parseInt(e.target.value, 10))}
                      className={`w-full p-2 rounded-lg border text-xs focus:ring-indigo-500/30 focus:ring-2 cursor-pointer transition-colors ${
                        isDark 
                          ? "bg-slate-900 border-slate-800 text-slate-200 focus:border-slate-700" 
                          : "bg-white border-slate-200 text-slate-850 focus:border-indigo-400"
                      }`}
                    >
                      <option value={15}>15 residues viewport</option>
                      <option value={21}>21 residues viewport (Standard compact)</option>
                      <option value={31}>31 residues viewport</option>
                      <option value={41}>41 residues viewport (Wide screen detail)</option>
                    </select>
                  </div>
                </div>

                {/* Category 4: General Dashboard Setup */}
                <div className="space-y-3 pt-3 border-t border-slate-850/10">
                  <p className={`font-mono text-[10px] uppercase font-bold tracking-wider ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    🖥️ Workspace Panels & Cache Layout
                  </p>

                  {/* Bento direction swap switch */}
                  <label className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-transparent hover:bg-slate-800/20 cursor-pointer">
                    <div className="space-y-0.5">
                      <span className="font-semibold block">Primary Controls on Left-hand Side</span>
                      <span className={`text-[10px] block leading-normal ${isDark ? "text-slate-400" : "text-slate-550"}`}>
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

                  {/* History items select */}
                  <div className="space-y-1.5 pt-1">
                    <label className="font-semibold block">Max Presets History Cache Limit</label>
                    <select
                      value={settings.maxHistoryItems}
                      onChange={(e) => updateSetting("maxHistoryItems", parseInt(e.target.value, 10))}
                      className={`w-full p-2 rounded-lg border text-xs focus:ring-indigo-500/30 focus:ring-2 cursor-pointer transition-colors ${
                        isDark 
                          ? "bg-slate-900 border-slate-800 text-slate-200 focus:border-slate-705" 
                          : "bg-white border-slate-200 text-slate-850 focus:border-indigo-400"
                      }`}
                    >
                      <option value={3}>3 variants cached</option>
                      <option value={5}>5 variants cached</option>
                      <option value={10}>10 variants cached</option>
                      <option value={15}>15 variants cached (Power user log)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Reset defaults and close buttons section */}
            <div className="pt-4 border-t border-slate-800/20 mt-5 space-y-3">
              <button
                type="button"
                onClick={() => {
                  if (confirm("Are you sure you want to reset all configurations to standard clinical defaults?")) {
                    resetSettingsToDefault();
                  }
                }}
                className={`w-full py-2 font-mono font-bold text-[10px] tracking-wide uppercase transition rounded-lg border cursor-pointer ${
                  isDark
                    ? "border-amber-500/20 text-amber-500 hover:bg-amber-500/10 bg-transparent"
                    : "border-amber-400 text-amber-600 hover:bg-amber-50 bg-transparent"
                }`}
              >
                Reset Factory Clinical Defaults
              </button>
              
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="w-full py-2.5 font-sans font-bold text-xs tracking-wide text-white bg-indigo-600 hover:bg-indigo-500 transition rounded-lg shadow-md cursor-pointer"
              >
                Apply Settings & Close
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
