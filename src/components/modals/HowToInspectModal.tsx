import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { BookOpen, X } from "lucide-react";

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
              <h3 className="text-sm font-semibold flex items-center gap-2 font-sans">
                <BookOpen className="w-4 h-4 text-cs-accent-clay" aria-hidden="true" />
                Reading the 3D view
              </h3>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close the guide"
                className="p-1 text-cs-text-muted hover:text-cs-text-secondary rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            {/*
              * Rewritten. The old guide told the reader to "analyze residue #408" whenever nothing was
              * selected (a hard-coded default from one preset variant), gave the wrong mouse controls, and
              * quoted a preset's marketing line.
              */}
            <div className="mt-4 space-y-3 text-[13px] leading-relaxed font-sans text-cs-text-secondary">
              <p>
                <strong className="text-cs-text-primary font-semibold">Move.</strong> Drag to rotate, right-drag to pan, scroll to zoom.
                The variant chip in the toolbar frames the site{selectedResidueIndex ? ` (residue ${selectedResidueIndex} is selected)` : ""}; clicking a residue selects it without changing the variant.
              </p>
              <p>
                <strong className="text-cs-text-primary font-semibold">Colours.</strong> pLDDT is the model&apos;s confidence in its own coordinates, not a measure of importance.
                A crystal structure&apos;s B-factor measures mobility in the crystal and is coloured relative to its own entry. Every colouring has a key on the canvas that says where its bands come from.
              </p>
              <p>
                <strong className="text-cs-text-primary font-semibold">Wild type against variant.</strong> FoldX keeps the template backbone fixed, so look at the side chains at the site; the superposition always pairs the variant with FoldX&apos;s own template.
                In the ESMFold view the two structures are separate predictions, so part of any difference is the predictions&apos; own.
              </p>
              <p>
                <strong className="text-cs-text-primary font-semibold">Evidence.</strong> No ACMG criterion reads the 3D view. The inspector traces where each structure and number came from.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default HowToInspectModal;
