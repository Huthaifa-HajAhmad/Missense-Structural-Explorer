import { useState, useEffect, useRef } from "react";
import { 
  Sliders, 
  Activity, 
  Layers, 
  Layout, 
  Key, 
  Eye, 
  EyeOff, 
  RotateCcw,
  Sparkles
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useSettings } from "../context/SettingsContext";

type TabId = "viewport" | "biophysics" | "sequence" | "workspace" | "api";

export default function SettingsModal() {
  const {
    isDark,
    isSettingsOpen,
    setIsSettingsOpen,
    settings,
    updateSetting,
    resetSettingsToDefault,
  } = useSettings();

  const [activeTab, setActiveTab] = useState<TabId>("viewport");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showAppToken, setShowAppToken] = useState(false);
  const [showBiohubToken, setShowBiohubToken] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSettingsOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsSettingsOpen(false);
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex="0"], [contenteditable]'
        );
        if (focusableElements.length === 0) return;
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            lastElement.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement) {
            firstElement.focus();
            e.preventDefault();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    // Focus first button (or tab) on open
    setTimeout(() => {
      if (modalRef.current) {
        const firstButton = modalRef.current.querySelector("button");
        if (firstButton) firstButton.focus();
      }
    }, 50);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSettingsOpen, setIsSettingsOpen]);

  const handleLinkApiKey = async () => {
    if (!settings.geminiApiKey) return;
    setIsLinking(true);
    setLinkError(null);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (settings.appApiToken) {
        headers["Authorization"] = `Bearer ${settings.appApiToken}`;
      }
      const response = await fetch("/api/v1/session/keys", {
        method: "POST",
        headers,
        body: JSON.stringify({ apiKey: settings.geminiApiKey }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || "Failed to link API key.");
      }
      const data = await response.json();
      if (data.sessionId) {
        updateSetting("geminiSessionId", data.sessionId);
        updateSetting("geminiSessionExpiresAt", data.expiresAt || (Date.now() + 3600000));
      } else {
        throw new Error("No session ID returned from server.");
      }
    } catch (err: any) {
      setLinkError(err.message || "An unexpected error occurred.");
    } finally {
      setIsLinking(false);
    }
  };

  const tabs = [
    { id: "viewport", label: "Viewport", icon: Sliders },
    { id: "biophysics", label: "Biophysics", icon: Activity },
    { id: "sequence", label: "Sequence", icon: Layers },
    { id: "workspace", label: "Workspace", icon: Layout },
    { id: "api", label: "Gemini API", icon: Key },
  ] as const;

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
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 cursor-pointer"
          />

          {/* Centered Modal Container */}
          <div className="fixed inset-0 flex items-center justify-center p-4 z-50 pointer-events-none">
            <motion.div
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-title"
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: "spring", duration: 0.3 }}
              className={`w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden border pointer-events-auto flex flex-col transition-colors ${
                isDark 
                  ? "bg-[#0f172a] border-slate-800 text-slate-100" 
                  : "bg-white border-slate-200 text-slate-800"
              }`}
            >
              {/* Header */}
              <div className={`flex items-center justify-between p-5 border-b ${
                isDark ? "border-slate-800/60" : "border-slate-100"
              }`}>
                <div>
                  <h2 id="settings-title" className="text-base font-bold tracking-tight flex items-center gap-2">
                    <Sliders className="w-5 h-5 text-indigo-500" />
                    System Configuration
                  </h2>
                  <p className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                    Personalize 3D graphics, biophysical weights, and API keys.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className={`p-1.5 rounded-lg border transition-all cursor-pointer text-sm ${
                    isDark 
                      ? "border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white" 
                      : "border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-slate-900"
                  }`}
                >
                  ✕
                </button>
              </div>

              {/* Horizontal Tabs Bar */}
              <div className={`flex items-center gap-1 px-5 pt-3 border-b overflow-x-auto ${
                isDark ? "border-slate-800/60 bg-slate-900/30" : "border-slate-100 bg-slate-50/50"
              }`}>
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-3 py-2 text-xs font-semibold rounded-t-xl transition-all border-b-2 flex items-center gap-1.5 cursor-pointer shrink-0 -mb-[1px] ${
                        isActive
                          ? "border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-transparent font-bold"
                          : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Modal Body / Tab Content */}
              <div className="p-6 overflow-y-auto max-h-[380px] text-xs space-y-5">
                {activeTab === "viewport" && (
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
                )}

                {activeTab === "biophysics" && (
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
                )}

                {activeTab === "sequence" && (
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
                )}

                {activeTab === "workspace" && (
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
                )}

                {activeTab === "api" && (
                  <div className="space-y-4">
                    {/* Application API Token input */}
                    <div className="space-y-1.5">
                      <label className="font-semibold block text-xs">Application / Lab API Token</label>
                      <div className="relative">
                        <input
                          type={showAppToken ? "text" : "password"}
                          placeholder={settings.appApiToken ? "••••••••••••••••••••••••••••••••" : "Enter APP_API_TOKEN..."}
                          value={settings.appApiToken || ""}
                          onChange={(e) => {
                            updateSetting("appApiToken", e.target.value.trim());
                            setLinkError(null);
                          }}
                          className={`w-full rounded-lg pl-3 pr-10 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 border transition-all ${
                            isDark 
                              ? "bg-slate-900 border-slate-800 text-indigo-300 placeholder-slate-500 focus:border-slate-700" 
                              : "bg-slate-55 border-slate-200 text-indigo-705 placeholder-slate-400 focus:border-indigo-400"
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowAppToken(!showAppToken)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-500 cursor-pointer"
                        >
                          {showAppToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className={`text-[9px] leading-normal ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                        Required to authorize structural mutations, AlphaFold proxies, and session creation on this private lab server.
                      </p>
                    </div>

                    {/* Biohub API Token input */}
                    <div className="space-y-1.5">
                      <label className="font-semibold block text-xs">Biohub API Token</label>
                      <div className="relative">
                        <input
                          type={showBiohubToken ? "text" : "password"}
                          placeholder={settings.biohubApiToken ? "••••••••••••••••••••••••••••••••" : "Enter Biohub API key..."}
                          value={settings.biohubApiToken || ""}
                          onChange={(e) => {
                            updateSetting("biohubApiToken", e.target.value.trim());
                            setLinkError(null);
                          }}
                          className={`w-full rounded-lg pl-3 pr-10 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 border transition-all ${
                            isDark 
                              ? "bg-slate-900 border-slate-800 text-indigo-300 placeholder-slate-500 focus:border-slate-700" 
                              : "bg-slate-50 border-slate-200 text-indigo-700 placeholder-slate-400 focus:border-indigo-400"
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowBiohubToken(!showBiohubToken)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-500 cursor-pointer"
                        >
                          {showBiohubToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className={`text-[9px] leading-normal ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                        Enables ESMFold2 structure folding and ESMC deep representation metrics directly from Biohub.ai. Fallback applied if empty.
                      </p>
                    </div>

                    {/* Gemini API Key input */}
                    <div className="space-y-1.5">
                      <label className="font-semibold block">Google Gemini API Key</label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={showApiKey ? "text" : "password"}
                            placeholder={settings.geminiApiKey ? "••••••••••••••••••••••••••••••••" : "Enter GEMINI_API_KEY..."}
                            value={settings.geminiApiKey || ""}
                            onChange={(e) => {
                              updateSetting("geminiApiKey", e.target.value.trim());
                              setLinkError(null);
                            }}
                            className={`w-full rounded-lg pl-3 pr-10 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 border transition-all ${
                              isDark 
                                ? "bg-slate-900 border-slate-800 text-indigo-300 placeholder-slate-500 focus:border-slate-700" 
                                : "bg-slate-50 border-slate-200 text-indigo-705 placeholder-slate-400 focus:border-indigo-400"
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-500 cursor-pointer"
                          >
                            {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <button
                          type="button"
                          disabled={!settings.geminiApiKey || isLinking}
                          onClick={handleLinkApiKey}
                          className={`px-4 py-2 font-sans font-bold text-xs rounded-lg transition-colors cursor-pointer border ${
                            settings.geminiApiKey && !isLinking
                              ? "bg-indigo-600 text-white hover:bg-indigo-500 border-indigo-600"
                              : isDark
                                ? "bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed"
                                : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                          }`}
                        >
                          {isLinking ? "Linking..." : "Link API Key"}
                        </button>
                      </div>
                      {settings.geminiSessionId && settings.geminiSessionExpiresAt ? (
                        Date.now() < settings.geminiSessionExpiresAt ? (
                          <p className="text-[10px] text-emerald-500 dark:text-emerald-400 flex items-center gap-1 font-medium mt-1">
                            ✓ Session active. Valid for {Math.max(1, Math.round((settings.geminiSessionExpiresAt - Date.now()) / 60000))} minutes.
                          </p>
                        ) : (
                          <p className="text-[10px] text-rose-500 dark:text-rose-400 flex items-center gap-1 font-medium mt-1">
                            ⚠ Session expired. Please link again.
                          </p>
                        )
                      ) : null}
                      {linkError && (
                        <p className="text-[10px] text-rose-500 dark:text-rose-400 font-medium mt-1">
                          ⚠ {linkError}
                        </p>
                      )}
                    </div>

                    {/* Directions block */}
                    <div className={`p-4 rounded-xl border leading-relaxed space-y-2.5 ${
                      isDark 
                        ? "bg-indigo-950/20 border-indigo-900/50 text-indigo-300" 
                        : "bg-indigo-50/70 border-indigo-150 text-indigo-850 shadow-indigo-100/10"
                    }`}>
                      <p className="font-bold flex items-center gap-1 text-[11px] uppercase tracking-wide">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
                        How to obtain a Google Gemini API Key:
                      </p>
                      <ol className="list-decimal pl-4 space-y-1.5 text-[11px]">
                        <li>
                          Visit the official <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="underline font-bold hover:text-indigo-500">Google AI Studio</a>.
                        </li>
                        <li>
                          Sign in with a standard Google or Workspace account.
                        </li>
                        <li>
                          Click the blue **"Get API Key"** button in the top menu bar.
                        </li>
                        <li>
                          Click **"Create API Key"**, choose a project, and copy your generated key.
                        </li>
                        <li>
                          Paste the key in the input box above and click **"Link API Key"**. Your key is exchanged for a short-lived (1-hour) session token on the server. Your raw API key is never saved to disk.
                        </li>
                      </ol>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className={`p-5 border-t flex flex-col sm:flex-row gap-3 items-center justify-between ${
                isDark ? "border-slate-800/60 bg-slate-900/10" : "border-slate-100 bg-slate-50/30"
              }`}>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Are you sure you want to reset all configurations to standard clinical defaults?")) {
                      resetSettingsToDefault();
                    }
                  }}
                  className={`w-full sm:w-auto px-4 py-2 font-mono font-bold text-[10px] tracking-wide uppercase transition rounded-lg border flex items-center justify-center gap-1.5 cursor-pointer ${
                    isDark
                      ? "border-amber-500/20 text-amber-500 hover:bg-amber-500/10 bg-transparent"
                      : "border-amber-405 text-amber-600 hover:bg-amber-50 bg-transparent"
                  }`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Defaults
                </button>

                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="w-full sm:w-auto px-6 py-2 font-sans font-bold text-xs tracking-wide text-white bg-indigo-600 hover:bg-indigo-500 transition rounded-lg shadow-md cursor-pointer text-center"
                >
                  Apply & Close
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
