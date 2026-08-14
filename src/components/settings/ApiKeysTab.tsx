import React from "react";
import { Eye, EyeOff, Sparkles } from "lucide-react";
import { ApiKeysTabProps } from "./types";

export const ApiKeysTab: React.FC<ApiKeysTabProps> = ({
  isDark,
  settings,
  updateSetting,
  showApiKey,
  setShowApiKey,
  showAppToken,
  setShowAppToken,
  showBiohubToken,
  setShowBiohubToken,
  showTamarindToken,
  setShowTamarindToken,
  showHfToken,
  setShowHfToken,
  isLinking,
  linkError,
  setLinkError,
  biohubTesting,
  biohubValidationStatus,
  testBiohubToken,
  tamarindTesting,
  tamarindValidationStatus,
  testTamarindToken,
  hfTesting,
  hfValidationStatus,
  testHfToken,
  handleLinkApiKey
}) => {
  const handleGeminiApiKeyChange = (value: string) => {
    const nextKey = value.trim();
    const previousKey = settings.geminiApiKey || "";

    updateSetting("geminiApiKey", nextKey);

    // A stateless session is bound to the key used to create it. Clear the
    // old session immediately when the user edits the key so the UI cannot
    // report a stale session as active or send the wrong token to the API.
    if (nextKey !== previousKey) {
      updateSetting("geminiSessionId", "");
      updateSetting("geminiSessionExpiresAt", 0);
    }

    setLinkError(null);
  };

  return (
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
        <div className="flex items-center justify-between">
          <label className="font-semibold block text-xs">Biohub API Token</label>
          <button
            type="button"
            onClick={testBiohubToken}
            disabled={biohubTesting}
            className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-semibold border transition-all cursor-pointer ${
              biohubTesting
                ? "opacity-50 cursor-wait"
                : isDark
                  ? "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300"
                  : "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700"
            }`}
          >
            {biohubTesting ? "Testing..." : "Test Token Connection"}
          </button>
        </div>
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
        {biohubValidationStatus && (
          <div className={`p-2.5 rounded-lg text-[11px] font-mono border flex items-center gap-2 ${
            biohubValidationStatus.valid
              ? isDark ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300" : "bg-emerald-50 border-emerald-300 text-emerald-800"
              : isDark ? "bg-rose-950/40 border-rose-500/40 text-rose-300" : "bg-rose-50 border-rose-300 text-rose-800 font-semibold"
          }`}>
            <span className="shrink-0 text-xs">{biohubValidationStatus.valid ? "✓" : "⚠️"}</span>
            <span className="font-sans font-medium text-[11px]">
              {biohubValidationStatus.message || (biohubValidationStatus.valid ? "API token active & valid" : "Endpoint unreachable / invalid token")}
            </span>
          </div>
        )}
        <p className={`text-[10px] leading-normal ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          Enables ESM3 3D structural refinement, ESM3 allosteric perturbations, and ESMC deep representation metrics directly from the Biohub Platform API.
        </p>
      </div>

      {/* Tamarind Bio API Key input */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="font-semibold block text-xs">Tamarind Bio API Key</label>
          <button
            type="button"
            onClick={testTamarindToken}
            disabled={tamarindTesting}
            className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-semibold border transition-all cursor-pointer ${
              tamarindTesting
                ? "opacity-50 cursor-wait"
                : isDark
                  ? "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300"
                  : "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700"
            }`}
          >
            {tamarindTesting ? "Testing..." : "Test Connection"}
          </button>
        </div>
        <div className="relative">
          <input
            type={showTamarindToken ? "text" : "password"}
            placeholder={settings.tamarindApiKey ? "••••••••••••••••••••••••••••••••" : "Enter Tamarind Bio API key..."}
            value={settings.tamarindApiKey || ""}
            onChange={(e) => {
              updateSetting("tamarindApiKey", e.target.value.trim());
            }}
            className={`w-full rounded-lg pl-3 pr-10 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 border transition-all ${
              isDark 
                ? "bg-slate-900 border-slate-800 text-indigo-300 placeholder-slate-500 focus:border-slate-700" 
                : "bg-slate-50 border-slate-200 text-indigo-700 placeholder-slate-400 focus:border-indigo-400"
            }`}
          />
          <button
            type="button"
            onClick={() => setShowTamarindToken(!showTamarindToken)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-500 cursor-pointer"
          >
            {showTamarindToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {tamarindValidationStatus && (
          <div className={`p-2.5 rounded-lg text-[11px] font-mono border flex items-center gap-2 ${
            tamarindValidationStatus.valid
              ? isDark ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300" : "bg-emerald-50 border-emerald-300 text-emerald-800"
              : isDark ? "bg-rose-950/40 border-rose-500/40 text-rose-300" : "bg-rose-50 border-rose-300 text-rose-800 font-semibold"
          }`}>
            <span className="shrink-0 text-xs">{tamarindValidationStatus.valid ? "✓" : "⚠️"}</span>
            <span className="font-sans font-medium text-[11px]">
              {tamarindValidationStatus.message || (tamarindValidationStatus.valid ? "API key active & valid" : "Endpoint unreachable / invalid key")}
            </span>
          </div>
        )}
        <p className={`text-[10px] leading-normal ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          Enables remote neural ThermoMPNN $\Delta\Delta G^\circ$ thermodynamic stability calculations via Tamarind Bio REST API.
        </p>
      </div>

      {/* Hugging Face Access Token input */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="font-semibold block text-xs">Hugging Face Access Token</label>
          <button
            type="button"
            onClick={testHfToken}
            disabled={hfTesting}
            className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-semibold border transition-all cursor-pointer ${
              hfTesting
                ? "opacity-50 cursor-wait"
                : isDark
                  ? "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300"
                  : "bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700"
            }`}
          >
            {hfTesting ? "Testing..." : "Test Token Connection"}
          </button>
        </div>
        <div className="relative">
          <input
            type={showHfToken ? "text" : "password"}
            placeholder={settings.hfToken ? "••••••••••••••••••••••••••••••••" : "Enter HF_TOKEN..."}
            value={settings.hfToken || ""}
            onChange={(e) => {
              updateSetting("hfToken", e.target.value.trim());
            }}
            className={`w-full rounded-lg pl-3 pr-10 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 border transition-all ${
              isDark 
                ? "bg-slate-900 border-slate-800 text-indigo-300 placeholder-slate-500 focus:border-slate-700" 
                : "bg-slate-50 border-slate-200 text-indigo-700 placeholder-slate-400 focus:border-indigo-400"
            }`}
          />
          <button
            type="button"
            onClick={() => setShowHfToken(!showHfToken)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-500 cursor-pointer"
          >
            {showHfToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {hfValidationStatus && (
          <div className={`p-2.5 rounded-lg text-[11px] font-mono border flex items-center gap-2 ${
            hfValidationStatus.valid
              ? isDark ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300" : "bg-emerald-50 border-emerald-300 text-emerald-800"
              : isDark ? "bg-rose-950/40 border-rose-500/40 text-rose-300" : "bg-rose-50 border-rose-300 text-rose-800 font-semibold"
          }`}>
            <span className="shrink-0 text-xs">{hfValidationStatus.valid ? "✓" : "⚠️"}</span>
            <span className="font-sans font-medium text-[11px]">
              {hfValidationStatus.message || (hfValidationStatus.valid ? "Token active & valid" : "Token validation failed")}
            </span>
          </div>
        )}
        <p className={`text-[10px] leading-normal ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          Required to download and execute ESM-2 3B and structure-aware SaProt predictions remotely via Hugging Face Serverless Inference API.
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
              onChange={(e) => handleGeminiApiKeyChange(e.target.value)}
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
            Paste the key in the input box above and click **"Link API Key"**. Your key is exchanged for a short-lived (15-minute) session token on the server. Your raw API key is never saved to disk.
          </li>
        </ol>
      </div>
    </div>
  );
};
