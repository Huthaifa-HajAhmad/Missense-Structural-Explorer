import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { BookOpen, X } from "lucide-react";
import { VARIANT_PRESETS } from "../../data";

interface HowToInspectModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDark: boolean;
  selectedResidueIndex: number | null;
  gene: string;
}

export function HowToInspectModal({
  isOpen,
  onClose,
  isDark,
  selectedResidueIndex,
  gene
}: HowToInspectModalProps) {
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
            className="relative max-w-md w-full rounded-2xl border shadow-xl p-6 transition-colors z-10 bg-cs-surface border-cs-border-subtle text-cs-text-primary"
          >
            <div className="flex items-center justify-between pb-3 border-b border-cs-border-subtle">
              <h3 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-cs-accent-clay" />
                How to inspect missense mutations
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
              <ul className="space-y-3.5 pl-4 list-disc marker:text-cs-accent-clay text-cs-text-secondary">
                <li>
                  Analyze residue <strong className="font-mono text-cs-accent-clay">#{selectedResidueIndex || "408"}</strong> inside the rendered 3D fold. Use right-click or scroll-wheel to zoom.
                </li>
                <li>
                  Determine structural state context: outer alpha-helices, beta-sheet strands, or loops.
                </li>
                <li>
                  Check for steric clashes or broken hydrogen bonds resulting from substitution size/charge differentials.
                </li>
                <li>
                  Compare structures by toggling between <strong className="font-semibold text-cs-text-primary">Wild-Type</strong> and simulated <strong className="text-cs-accent-mag font-semibold">Mutant</strong> views.
                </li>
              </ul>
              <div className="p-3 rounded-lg border border-cs-border-subtle bg-cs-surface-2">
                <p className="text-[11px] italic text-slate-500">
                  "{VARIANT_PRESETS.find(p => p.gene === gene)?.description || "Inspect chemical/geometric substitutions inside protein chain constructs."}"
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default HowToInspectModal;
