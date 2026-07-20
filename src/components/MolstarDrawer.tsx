import React, { useRef, useEffect } from "react";
import { Pin, X, HelpCircle, AlertTriangle } from "lucide-react";
import MolstarViewer from "./MolstarViewer";

interface MolstarDrawerProps {
  isOpen: boolean;
  isPinned: boolean;
  onTogglePin: () => void;
  onClose: () => void;
  // MolstarViewer props
  pdbId: string | null;
  uniprotId: string;
  residueIndex: number | null;
  landscapeData: any[] | null;
  currentAM: number | null;
  currentREVEL: number | null;
  isOffline: boolean;
  variant: string;
}

export const MolstarDrawer: React.FC<MolstarDrawerProps> = ({
  isOpen,
  isPinned,
  onTogglePin,
  onClose,
  pdbId,
  uniprotId,
  residueIndex,
  landscapeData,
  currentAM,
  currentREVEL,
  isOffline,
  variant,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on Escape or click outside if not pinned
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (isOpen && !isPinned && containerRef.current && !containerRef.current.contains(event.target as Node)) {
        // Prevent closing if clicking on the toggle button itself
        const target = event.target as HTMLElement;
        if (!target.closest("#header-structure-trigger") && !target.closest(".molstar-toggle-btn")) {
          onClose();
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, isPinned, onClose]);

  // Keep it permanently mounted to prevent WebGL context destruction,
  // toggle visibility classes dynamically.
  const visibilityClass = isOpen || isPinned
    ? "translate-x-0 opacity-100 pointer-events-auto"
    : "translate-x-full opacity-0 pointer-events-none";

  const modeClass = isPinned
    ? "border-l border-slate-800/80 shadow-none bg-slate-900/60"
    : "shadow-2xl bg-slate-900/95 backdrop-blur-md";

  return (
    <div
      ref={containerRef}
      className={`fixed top-[44px] right-0 bottom-[28px] w-[380px] z-40 flex flex-col transition-all duration-300 transform border-l border-slate-800/60 ${visibilityClass} ${modeClass}`}
    >
      {/* Drawer Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-950/40 border-b border-slate-800/60">
        <div className="flex flex-col">
          <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5 uppercase tracking-wider font-mono">
            3D Structural View
            {pdbId ? (
              <span className="text-[9px] bg-teal-500/10 text-teal-400 border border-teal-500/20 px-1.5 py-0.5 rounded font-normal font-sans">
                PDB: {pdbId}
              </span>
            ) : (
              <span className="text-[9px] bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.5 rounded font-normal font-sans">
                AlphaFold
              </span>
            )}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onTogglePin}
            className={`p-1.5 rounded hover:bg-slate-800/80 transition-colors cursor-pointer active:scale-95 ${
              isPinned ? "text-teal-400" : "text-slate-400 hover:text-slate-200"
            }`}
            title={isPinned ? "Unpin structural drawer (float overlay)" : "Pin structural drawer (split screen)"}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-800/80 transition-colors cursor-pointer active:scale-95 text-slate-400 hover:text-slate-200"
            title="Close Drawer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Viewer Content Area - always rendered in DOM to preserve WebGL context */}
      <div className="flex-1 relative overflow-hidden bg-slate-950">
        <MolstarViewer
          residueIndex={residueIndex}
          variant={variant}
        />
      </div>

      {/* Helper Legend / Info */}
      <div className="p-2.5 bg-slate-950/20 border-t border-slate-800/60 flex items-start gap-2">
        <HelpCircle className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Drag/rotate 3D model to inspect residue surroundings. Yellow halo highlights the queried variant residue position.
        </p>
      </div>
    </div>
  );
};
