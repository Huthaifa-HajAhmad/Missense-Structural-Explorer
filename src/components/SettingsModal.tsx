import { useState, useEffect, useRef } from "react";
import { 
  Sliders, 
  Activity, 
  Layers, 
  Layout, 
  Key, 
  RotateCcw
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useSettings } from "../context/SettingsContext";
import { ViewportTab } from "./settings/ViewportTab";
import { BiophysicsTab } from "./settings/BiophysicsTab";
import { SequenceTab } from "./settings/SequenceTab";
import { WorkspaceTab } from "./settings/WorkspaceTab";
import { ApiKeysTab } from "./settings/ApiKeysTab";
import { ValidationStatus } from "./settings/types";

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
  const [biohubTesting, setBiohubTesting] = useState(false);
  const [biohubValidationStatus, setBiohubValidationStatus] = useState<ValidationStatus | null>(null);

  const testBiohubToken = async () => {
    const token = settings.biohubApiToken;
    if (!token) {
      setBiohubValidationStatus({ valid: false, message: "No Biohub API key entered." });
      return;
    }
    setBiohubTesting(true);
    setBiohubValidationStatus(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (settings.appApiToken) {
        headers["Authorization"] = `Bearer ${settings.appApiToken}`;
      }
      const res = await fetch("/api/v1/validate-biohub-token", {
        method: "POST",
        headers,
        body: JSON.stringify({ token })
      });
      const data = await res.json();
      if (res.status === 401 || data.error) {
        setBiohubValidationStatus({ 
          valid: false, 
          message: data.error?.message || "App authorization failed. Please check your App API Token." 
        });
      } else {
        setBiohubValidationStatus({ valid: data.valid, message: data.message });
      }
    } catch (err: any) {
      setBiohubValidationStatus({ valid: false, message: `Validation error: ${err.message || "Failed to reach server"}` });
    } finally {
      setBiohubTesting(false);
    }
  };

  const [showTamarindToken, setShowTamarindToken] = useState(false);
  const [tamarindTesting, setTamarindTesting] = useState(false);
  const [tamarindValidationStatus, setTamarindValidationStatus] = useState<ValidationStatus | null>(null);

  const [showHfToken, setShowHfToken] = useState(false);
  const [hfTesting, setHfTesting] = useState(false);
  const [hfValidationStatus, setHfValidationStatus] = useState<ValidationStatus | null>(null);

  const testHfToken = async () => {
    const token = settings.hfToken;
    if (!token) {
      setHfValidationStatus({ valid: false, message: "No Hugging Face token entered." });
      return;
    }
    setHfTesting(true);
    setHfValidationStatus(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (settings.appApiToken) {
        headers["Authorization"] = `Bearer ${settings.appApiToken}`;
      }
      const res = await fetch("/api/v1/test-hf-connection", {
        method: "POST",
        headers,
        body: JSON.stringify({ hfToken: token })
      });
      const data = await res.json();
      if (res.status === 401 || data.error) {
        setHfValidationStatus({ 
          valid: false, 
          message: data.error?.message || data.error || "App authorization failed. Please check your App API Token." 
        });
      } else {
        setHfValidationStatus({ valid: data.valid, message: data.message });
      }
    } catch (err: any) {
      setHfValidationStatus({ valid: false, message: `Validation error: ${err.message || "Failed to reach server"}` });
    } finally {
      setHfTesting(false);
    }
  };

  const testTamarindToken = async () => {
    const token = settings.tamarindApiKey;
    if (!token) {
      setTamarindValidationStatus({ valid: false, message: "No Tamarind Bio API key entered." });
      return;
    }
    setTamarindTesting(true);
    setTamarindValidationStatus(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (settings.appApiToken) {
        headers["Authorization"] = `Bearer ${settings.appApiToken}`;
      }
      const res = await fetch("/api/v1/test-tamarind-connection", {
        method: "POST",
        headers,
        body: JSON.stringify({ tamarindApiKey: token })
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid server response (HTTP ${res.status})`);
      }
      if (res.status === 401 || data.error) {
        setTamarindValidationStatus({ 
          valid: false, 
          message: data.error?.message || data.error || "App authorization failed. Please check your App API Token." 
        });
      } else {
        setTamarindValidationStatus({ valid: data.valid, message: data.message });
      }
    } catch (err: any) {
      setTamarindValidationStatus({ valid: false, message: `Validation error: ${err.message || "Failed to reach server"}` });
    } finally {
      setTamarindTesting(false);
    }
  };

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

    setTimeout(() => {
      if (modalRef.current) {
        const firstButton = modalRef.current.querySelector("button");
        if (firstButton) firstButton.focus();
      }
    }, 50);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSettingsOpen, setIsSettingsOpen]);

  const handleLinkApiKey = async () => {
    const apiKey = settings.geminiApiKey?.trim() || "";
    if (!apiKey) return;

    setIsLinking(true);
    setLinkError(null);

    // Do not leave an older token marked active while this key is being
    // validated. The server token is stateless and tied to the submitted key.
    updateSetting("geminiSessionId", "");
    updateSetting("geminiSessionExpiresAt", 0);

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
        body: JSON.stringify({ apiKey }),
      });
      const responseData = await response.json().catch(() => ({}));
      if (!response.ok) {
        const serverError = responseData.error;
        const code = serverError?.code ? `[${serverError.code}] ` : "";
        const requestId = serverError?.requestId ? ` (request ${serverError.requestId})` : "";
        throw new Error(`${code}${serverError?.message || `Failed to link API key (HTTP ${response.status}).`}${requestId}`);
      }
      if (responseData.sessionId) {
        updateSetting("geminiSessionId", responseData.sessionId);
        updateSetting("geminiSessionExpiresAt", responseData.expiresAt || (Date.now() + 15 * 60 * 1000));
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
                  <ViewportTab isDark={isDark} settings={settings} updateSetting={updateSetting} />
                )}

                {activeTab === "biophysics" && (
                  <BiophysicsTab isDark={isDark} settings={settings} updateSetting={updateSetting} />
                )}

                {activeTab === "sequence" && (
                  <SequenceTab isDark={isDark} settings={settings} updateSetting={updateSetting} />
                )}

                {activeTab === "workspace" && (
                  <WorkspaceTab isDark={isDark} settings={settings} updateSetting={updateSetting} />
                )}

                {activeTab === "api" && (
                  <ApiKeysTab
                    isDark={isDark}
                    settings={settings}
                    updateSetting={updateSetting}
                    showApiKey={showApiKey}
                    setShowApiKey={setShowApiKey}
                    showAppToken={showAppToken}
                    setShowAppToken={setShowAppToken}
                    showBiohubToken={showBiohubToken}
                    setShowBiohubToken={setShowBiohubToken}
                    showTamarindToken={showTamarindToken}
                    setShowTamarindToken={setShowTamarindToken}
                    showHfToken={showHfToken}
                    setShowHfToken={setShowHfToken}
                    isLinking={isLinking}
                    linkError={linkError}
                    setLinkError={setLinkError}
                    biohubTesting={biohubTesting}
                    biohubValidationStatus={biohubValidationStatus}
                    testBiohubToken={testBiohubToken}
                    tamarindTesting={tamarindTesting}
                    tamarindValidationStatus={tamarindValidationStatus}
                    testTamarindToken={testTamarindToken}
                    hfTesting={hfTesting}
                    hfValidationStatus={hfValidationStatus}
                    testHfToken={testHfToken}
                    handleLinkApiKey={handleLinkApiKey}
                  />
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
