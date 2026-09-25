import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Layers, X } from "lucide-react";

interface StructuralLegendModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDark: boolean;
  showPolarContacts: boolean;
  setShowPolarContacts: (show: boolean) => void;
  selectedResidueIndex: number | null;
  viewMode: string;
  foldingStatus: string | null;
}

export function StructuralLegendModal({
  isOpen,
  onClose,
  isDark,
  showPolarContacts,
  setShowPolarContacts,
  selectedResidueIndex,
  viewMode,
  foldingStatus
}: StructuralLegendModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative max-w-lg w-full rounded-2xl border shadow-xl p-6 transition-colors z-10 bg-cs-surface border-cs-border-subtle text-cs-text-primary"
          >
            <div className="flex items-center justify-between pb-3 border-b border-cs-border-subtle">
              <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-cs-accent-clay" />
                Structural Legend & Controls
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="text-cs-text-muted hover:text-cs-text-secondary rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-4 space-y-4 text-xs select-none">
              {/* Interactive analytical toggle */}
              <div className="p-3 rounded-lg border transition-colors bg-cs-surface-2 border-cs-border-subtle">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPolarContacts}
                    onChange={(e) => setShowPolarContacts(e.target.checked)}
                    className="w-4 h-4 rounded cursor-pointer accent-cs-accent-clay focus:ring-cs-accent-clay/30"
                  />
                  <div className="flex-1">
                    <span className="font-bold block text-[11px] uppercase tracking-wide font-mono">Show Polar Contacts</span>
                    <span className="text-[10px] block mt-0.5 leading-tight text-cs-text-secondary">
                      Dynamically calculate and visualize hydrogen bonds formed by target residue {selectedResidueIndex ?? ""}.
                    </span>
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Left Sub-legend */}
                <div className="space-y-4">
                  {/* Highlight Key */}
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-cs-text-muted">
                      Mutation Site Highlight
                    </p>
                    <div className="space-y-1 p-2 rounded-lg border bg-cs-surface-2 border-cs-border">
                      <div className="flex items-start gap-1.5">
                        <span className="w-3 h-3 rounded bg-cs-accent-clay shrink-0 flex items-center justify-center mt-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                        </span>
                        <div>
                          <span className="font-semibold block font-mono text-[9px] text-cs-accent-clay">
                            Clay Sidechain
                          </span>
                          <span className="text-[9px] leading-snug block text-cs-text-secondary">
                            Residue #{selectedResidueIndex ?? "N/A"} rendered in sunset clay to reveal orientation.
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Pocket Atoms elements */}
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-cs-text-muted">
                      Atomic Elements (CPK)
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 p-2 rounded-lg border text-[9px] font-mono bg-cs-surface-2 border-cs-border-subtle text-cs-text-secondary">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 rounded-full h-2 bg-neutral-400 shrink-0"></span>
                        <span>Carbon (C)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 rounded-full h-2 bg-rose-500 shrink-0"></span>
                        <span>Oxygen (O)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 rounded-full h-2 bg-blue-500 shrink-0"></span>
                        <span>Nitrogen (N)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 rounded-full h-2 bg-yellow-500 shrink-0"></span>
                        <span>Sulfur (S)</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Sub-legend */}
                <div className="space-y-4">
                  {/* Contacts Map */}
                  {showPolarContacts && (
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-cs-text-muted">
                        Interactive Contacts
                      </p>
                      <div className="space-y-1 p-2 rounded-lg border text-[9px] font-mono bg-cs-surface-2 border-cs-border text-cs-text-secondary">
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 h-0.5 border-t border-dashed border-sky-400 shrink-0"></span>
                          <span className="text-sky-500 font-bold">H-Bonds / Polar</span>
                        </div>
                        <p className="text-[8px] leading-tight text-cs-text-secondary">
                          Cyan dashed vectors computed by Molstar. Identifies pocket residues with broken polarity.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* pLDDT Score heat key */}
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-cs-text-muted">
                      AlphaFold pLDDT Confidence
                    </p>
                    <div className="p-2 rounded-lg border space-y-1.5 bg-cs-surface-2 border-cs-border">
                      <div className="h-1.5 w-full rounded-full bg-gradient-to-r from-orange-500 via-yellow-400 to-indigo-600"></div>
                      <div className="flex items-center justify-between text-[8px] text-cs-text-secondary font-mono">
                        <span>Low (&lt;50)</span>
                        <span>High (&gt;90)</span>
                      </div>
                      {viewMode !== "wildtype" && (
                        <div className="text-[8.5px] leading-normal pt-1.5 border-t border-cs-border-subtle text-cs-text-muted">
                          <span className="font-semibold text-amber-500">⚠ Inherited pLDDT:</span> Color confidence is inherited from the wild-type template.
                        </div>
                      )}
                    </div>
                  </div>

                  {viewMode !== "wildtype" && (
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5 font-mono text-cs-text-muted">
                        Scaffold Status
                      </p>
                      <div className="p-2 rounded-lg border text-[9px] leading-relaxed bg-cs-surface-2 border-cs-border text-cs-text-secondary">
                        {foldingStatus === "success"
                          ? "Computed via FoldX biophysical modeling. Geometries represent atomic force-field alignments."
                          : "Structure coordinates represent wild-type backbone."}
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default StructuralLegendModal;
