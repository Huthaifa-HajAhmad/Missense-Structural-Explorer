import { Dna, Sun, Moon, Settings as SettingsIcon, Sparkles } from "lucide-react";

interface HeaderProps {
  isDark: boolean;
  toggleTheme: () => void;
  setIsSettingsOpen: (isOpen: boolean) => void;
  classHeader: string;
  classHeaderTitle: string;
  classHeaderSub: string;
  classBadgeAccent: string;
}

export default function Header({
  isDark,
  toggleTheme,
  setIsSettingsOpen,
  classHeader,
  classHeaderTitle,
  classHeaderSub,
  classBadgeAccent,
}: HeaderProps) {
  return (
    <header className={`border-b px-6 py-4 sticky top-0 z-20 flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors ${classHeader}`} id="main-header">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30 shrink-0 select-none animate-pulse">
          <Dna className="w-5 h-5 stroke-[2.2]" />
        </div>
        <div>
          <h1 className={`text-xl font-bold tracking-tight flex items-center gap-2 ${classHeaderTitle}`}>
            Missense & Fold
            <span className={`text-[10px] font-mono font-medium tracking-wider uppercase px-1.5 py-0.5 rounded-full transition-all ${classBadgeAccent}`}>
              V1.2 Clinical Lab
            </span>
          </h1>
          <p className={`text-xs ${classHeaderSub}`}>
            Instant 3D biophysical modeling for clinical variant interpretation.
          </p>
        </div>
      </div>

      {/* Diagnostic Metadata strip with Theme Toggle */}
      <div className="flex items-center gap-4 text-xs font-mono">
        {/* Theme Switcher Toggle button */}
        <button
          type="button"
          onClick={toggleTheme}
          className={`p-2 rounded-lg border transition-all flex items-center gap-2 cursor-pointer ${
            isDark
              ? "bg-slate-900 border-slate-800 text-amber-400 hover:text-amber-300 hover:bg-slate-800/80"
              : "bg-slate-100 border-slate-200 text-indigo-600 hover:text-indigo-500 hover:bg-slate-200/55"
          }`}
          title={isDark ? "Switch to light theme" : "Switch to dark theme"}
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          <span className="text-[11px] font-semibold font-sans hidden sm:inline">
            {isDark ? "Light Mode" : "Dark Mode"}
          </span>
        </button>

        {/* User Configuration Settings button */}
        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          className={`p-2 rounded-lg border transition-all flex items-center gap-2 cursor-pointer ${
            isDark
              ? "bg-slate-900 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800"
              : "bg-slate-100 border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-200/55"
          }`}
          title="Open settings configuration panel"
        >
          <SettingsIcon className="w-4 h-4" />
          <span className="text-[11px] font-semibold font-sans hidden sm:inline">Settings</span>
        </button>

        <div className={`hidden md:flex items-center p-2 rounded-lg gap-2 border transition-colors ${
          isDark ? "bg-slate-900 border-slate-800" : "bg-slate-100 border-slate-200"
        }`}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className={isDark ? "text-slate-500" : "text-slate-400"}>Database:</span>
          <span className={isDark ? "text-slate-300 font-semibold" : "text-slate-700 font-semibold"}>AlphaFold 3D API</span>
        </div>

        <div className={`hidden md:flex items-center p-2 rounded-lg gap-2 border transition-colors ${
          isDark ? "bg-slate-900 border-slate-800" : "bg-slate-100 border-slate-200"
        }`}>
          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
          <span className={isDark ? "text-slate-500" : "text-slate-400"}>Biophysical:</span>
          <span className="text-indigo-500 font-semibold">Gemini 3.5 AI</span>
        </div>
      </div>
    </header>
  );
}
