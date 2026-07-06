import { Dna, Sun, Moon, Settings as SettingsIcon } from "lucide-react";

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
    <header
      className={`px-4 py-3 border-b flex items-center justify-between transition-colors ${classHeader}`}
      id="main-header"
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "#C46849" }}
        >
          <Dna className="w-3.5 h-3.5 text-white stroke-[2.2]" />
        </div>
        <div className="flex items-center gap-2">
          <h1 className={`text-[15px] font-semibold tracking-tight ${classHeaderTitle}`}>
            Missense &amp; Fold
          </h1>
          <span className={`text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${classBadgeAccent}`}>
            V1.2
          </span>
        </div>
      </div>

      {/* Right: status indicators + controls */}
      <div className="flex items-center gap-2">

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          title={isDark ? "Switch to light" : "Switch to dark"}
          className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
            isDark
              ? "border-[#362B4A] text-[#7A6F90] hover:text-[#F0EBFA] hover:bg-[#2C2240]"
              : "border-[#DDD6ED] text-[#8E82A0] hover:text-[#1A1523] hover:bg-[#F2EEF9]"
          }`}
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Settings */}
        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          title="Settings"
          className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
            isDark
              ? "border-[#362B4A] text-[#7A6F90] hover:text-[#F0EBFA] hover:bg-[#2C2240]"
              : "border-[#DDD6ED] text-[#8E82A0] hover:text-[#1A1523] hover:bg-[#F2EEF9]"
          }`}
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
