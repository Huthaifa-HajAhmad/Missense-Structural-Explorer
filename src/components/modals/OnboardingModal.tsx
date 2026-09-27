import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Compass,
  X,
  Search,
  Layers,
  Activity,
  Sparkles,
  KeyRound,
  ShieldCheck,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  Copy,
  Check,
  Zap,
  ArrowRight,
  FileText,
  Sliders,
  HelpCircle,
  Dna,
  BarChart2
} from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import { useVariantAnalysisActions } from "../../context/VariantAnalysisContext";

export interface OnboardingPreset {
  gene: string;
  variant: string;
  uniprotId: string;
  tag: string;
  description: string;
}

/**
 * Curated Rare Disease Missense Controls.
 * Strictly aligned with monogenic rare disease genomics & deep biophysical phenotypes.
 */
export const ONBOARDING_BENCHMARK_PRESETS: OnboardingPreset[] = [
  {
    gene: "PAH",
    variant: "p.Arg408Trp",
    uniprotId: "P00439",
    tag: "Inborn Error of Metabolism",
    description: "Phenylketonuria (PKU): Catalytic domain substitution abolishing salt bridges with Asp315/Asp320, disrupting tetramer stability."
  },
  {
    gene: "FGFR3",
    variant: "p.Gly380Arg",
    uniprotId: "P22607",
    tag: "Skeletal Dysplasia",
    description: "Achondroplasia: Transmembrane domain mutation stabilizing ligand-independent helix dimerization and constitutive kinase arrest."
  },
  {
    gene: "GBA1",
    variant: "p.Leu483Pro",
    uniprotId: "P04062",
    tag: "Lysosomal Storage Disorder",
    description: "Gaucher Disease: Beta-sheet breaker in the Ig-like domain triggering structural folding collapse and glucocerebrosidase deficiency."
  },
  {
    gene: "CNNM2",
    variant: "p.Glu357Lys",
    uniprotId: "Q9H8M5",
    tag: "Ion Channelopathy",
    description: "Familial Hypomagnesemia: Bateman domain cyclic nucleotide-binding homology salt-bridge loss, impairing renal Mg²⁺ reabsorption."
  }
];

export interface TourStep {
  id: string;
  label: string;
  badge: string;
  title: string;
  subtitle: string;
  targetSelector: string;
  placement: "bottom" | "top" | "left" | "right" | "center";
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "variant-input",
    label: "Query Input",
    badge: "Zone 1 · Input",
    title: "Variant Query & Genomic Coordinates",
    subtitle: "Submit target gene symbols, protein HGVS, transcript cDNA, or genomic VCF coordinates.",
    targetSelector: '[data-tour="variant-input"]',
    placement: "bottom"
  },
  {
    id: "navigation-zones",
    label: "Workspace Zones",
    badge: "Zones 2–4 · Architecture",
    title: "Multimodal Analysis Rail & 4 Zones",
    subtitle: "Navigate seamlessly between Deterministic Evidence, 3D Molstar, Energetics, and Clinical Reports.",
    targetSelector: '[data-tour="navigation-zones"]',
    placement: "right"
  },
  {
    id: "workflow-rail",
    label: "Sovereign Core",
    badge: "100% Free & Keyless",
    title: "Zero-Key Sovereign Biophysical Core",
    subtitle: "Local FoldX, RaSP SQLite, WebGL 3D, and JapanFold sovereign fallback run with zero credentials.",
    targetSelector: '[data-tour="workflow-rail"]',
    placement: "left"
  },
  {
    id: "settings-trigger",
    label: "API Gateway",
    badge: "Key-Enhanced Features",
    title: "API Keys & Diagnostic AI Gateway",
    subtitle: "Enable Google Gemini 2.5 Flash for ACMG synthesis & AlphaGenome for regulatory variant scoring.",
    targetSelector: '[data-tour="settings-trigger"]',
    placement: "bottom"
  },
  {
    id: "curated-presets",
    label: "Rare Disease Controls",
    badge: "Quick Start · Controls",
    title: "Curated Landmark Controls & Instant Launch",
    subtitle: "1-click launch canonical rare disease missense benchmarks to inspect live structural and clinical pipelines.",
    targetSelector: '[data-tour="curated-presets"]',
    placement: "top"
  }
];

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPreset?: (preset: OnboardingPreset) => void;
  onOpenSettings?: (tab?: string) => void;
}

export function OnboardingModal({
  isOpen,
  onClose,
  onSelectPreset,
  onOpenSettings
}: OnboardingModalProps) {
  const { openSettingsTab, hasConfiguredGeminiKey } = useSettings();
  const actions = useVariantAnalysisActions();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [copiedKeyCommand, setCopiedKeyCommand] = useState(false);
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // Spotlight geometry state
  const [highlightRect, setHighlightRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    borderRadius: number;
  } | null>(null);

  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
    placement: string;
  } | null>(null);

  // Measure and compute spotlight geometry
  const updatePosition = useCallback(() => {
    if (!isOpen) return;
    const step = TOUR_STEPS[currentStepIndex];
    if (!step) return;

    const targetEl = document.querySelector(step.targetSelector);
    if (!targetEl) {
      setHighlightRect(null);
      setPopoverPos(null);
      return;
    }

    const rect = targetEl.getBoundingClientRect();
    const PADDING = 8;
    const top = Math.max(0, rect.top - PADDING);
    const left = Math.max(0, rect.left - PADDING);
    const width = rect.width + PADDING * 2;
    const height = rect.height + PADDING * 2;

    setHighlightRect({
      top,
      left,
      width,
      height,
      borderRadius: 12
    });

    // Compute Popover Position
    const cardWidth = Math.min(460, window.innerWidth - 32);
    const cardHeight = 360;
    const margin = 12;
    const screenPad = 16;

    let computedTop = top + height + margin;
    let computedLeft = left + width / 2 - cardWidth / 2;
    let finalPlacement = step.placement;

    if (step.placement === "right") {
      computedLeft = left + width + margin;
      computedTop = Math.max(screenPad, top + Math.min(30, height / 4));
      if (computedLeft + cardWidth > window.innerWidth - screenPad) {
        if (left - cardWidth - margin >= screenPad) {
          computedLeft = left - cardWidth - margin;
          finalPlacement = "left";
        } else {
          computedLeft = Math.max(screenPad, (window.innerWidth - cardWidth) / 2);
          computedTop = top + height + margin;
          finalPlacement = "bottom";
        }
      }
    } else if (step.placement === "left") {
      computedLeft = left - cardWidth - margin;
      computedTop = Math.max(screenPad, top + Math.min(30, height / 4));
      if (computedLeft < screenPad) {
        computedLeft = Math.max(screenPad, (window.innerWidth - cardWidth) / 2);
        computedTop = top + height + margin;
        finalPlacement = "bottom";
      }
    } else if (step.placement === "top") {
      computedTop = top - cardHeight - margin;
      if (computedTop < screenPad) {
        computedTop = top + height + margin;
        finalPlacement = "bottom";
      }
    } else {
      // Bottom placement
      if (computedTop + cardHeight > window.innerHeight - screenPad) {
        if (top - cardHeight - margin >= screenPad) {
          computedTop = top - cardHeight - margin;
          finalPlacement = "top";
        }
      }
    }

    // Clamp within screen boundaries
    computedLeft = Math.max(screenPad, Math.min(window.innerWidth - cardWidth - screenPad, computedLeft));
    computedTop = Math.max(screenPad, Math.min(window.innerHeight - cardHeight - screenPad, computedTop));

    setPopoverPos({
      top: computedTop,
      left: computedLeft,
      placement: finalPlacement
    });
  }, [isOpen, currentStepIndex]);

  // Reset to Step 0 and sync preference on open
  useEffect(() => {
    if (isOpen) {
      setCurrentStepIndex(0);
      setSampleLoaded(false);
      try {
        const hasCompleted = localStorage.getItem("cs-onboarding-completed-v1");
        setDontShowAgain(hasCompleted === "true");
      } catch {}
    }
  }, [isOpen]);

  // Auto-scroll target into view and update position
  useEffect(() => {
    if (!isOpen) return;
    const step = TOUR_STEPS[currentStepIndex];
    if (!step) return;

    const targetEl = document.querySelector(step.targetSelector);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }

    const timer = setTimeout(updatePosition, 100);
    return () => clearTimeout(timer);
  }, [isOpen, currentStepIndex, updatePosition]);

  // Window resize & scroll listeners
  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  const persistCompletion = useCallback((completed: boolean) => {
    try {
      if (completed) {
        localStorage.setItem("cs-onboarding-completed-v1", "true");
      } else {
        localStorage.removeItem("cs-onboarding-completed-v1");
      }
    } catch {}
  }, []);

  const handleClose = useCallback(() => {
    persistCompletion(true);
    onClose();
  }, [onClose, persistCompletion]);

  const handleNext = useCallback(() => {
    if (currentStepIndex < TOUR_STEPS.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    } else {
      handleClose();
    }
  }, [currentStepIndex, handleClose]);

  const handlePrev = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  }, [currentStepIndex]);

  const handleSelectPreset = useCallback((preset: OnboardingPreset) => {
    persistCompletion(true);
    onSelectPreset?.(preset);
    onClose();
  }, [onClose, onSelectPreset, persistCompletion]);

  // Interactive Live Sample: Load PAH p.Arg408Trp directly into store
  const handleLoadSample = useCallback(() => {
    actions.setCustomGene("PAH");
    actions.setCustomVariant("p.Arg408Trp");
    actions.setCustomUniprot("P00439");
    actions.setCustomGenomic("");
    setSampleLoaded(true);
  }, [actions]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (isInput) return;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrev();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleNext, handlePrev, handleClose]);

  const copyBashSnippet = () => {
    const cmd = `printf "Enter GEMINI_API_KEY (typing hidden): " && read -s val && echo && echo "GEMINI_API_KEY=$val" >> ".env" && echo "Saved to .env"`;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(cmd);
      setCopiedKeyCommand(true);
      setTimeout(() => setCopiedKeyCommand(false), 2500);
    }
  };

  const currentStep = TOUR_STEPS[currentStepIndex];

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="cs-tour-root fixed inset-0 z-[60] overflow-hidden" role="dialog" aria-modal="true" aria-label="Interactive Workspace Tour">
          {/* ── Spotlight SVG Mask Overlay ── */}
          <svg
            className="fixed inset-0 w-full h-full pointer-events-none z-[60]"
            aria-hidden="true"
            data-testid="tour-spotlight-svg"
          >
            <defs>
              <mask id="tour-spotlight-mask">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                {highlightRect && (
                  <rect
                    x={highlightRect.left}
                    y={highlightRect.top}
                    width={highlightRect.width}
                    height={highlightRect.height}
                    rx={highlightRect.borderRadius}
                    ry={highlightRect.borderRadius}
                    fill="black"
                  />
                )}
              </mask>
            </defs>
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="currentColor"
              className="text-black/55 dark:text-black/75 pointer-events-auto transition-colors duration-200"
              mask="url(#tour-spotlight-mask)"
              onClick={handleClose}
            />
          </svg>

          {/* ── Animated Target Focus Ring ── */}
          {highlightRect && (
            <motion.div
              layoutId="tour-focus-ring"
              initial={false}
              animate={{
                top: highlightRect.top,
                left: highlightRect.left,
                width: highlightRect.width,
                height: highlightRect.height
              }}
              transition={{ type: "spring", duration: 0.35, bounce: 0 }}
              className="fixed pointer-events-none z-[61] rounded-xl border-2 border-[var(--cs-accent-clay)] shadow-[0_0_24px_rgba(196,104,73,0.35)]"
            >
              <div className="absolute -inset-1 rounded-2xl border border-[var(--cs-accent-clay)]/35 animate-pulse pointer-events-none" />
            </motion.div>
          )}

          {/* ── Floating Contextual Tour Card ── */}
          <motion.div
            key={currentStep.id}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", duration: 0.28, bounce: 0 }}
            className={`fixed z-[62] w-[92vw] max-w-[460px] bg-[var(--cs-surface)] border border-[var(--cs-border)] rounded-2xl shadow-xl flex flex-col transition-[top,left] duration-200 ease-out ${
              !popoverPos ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" : ""
            }`}
            style={
              popoverPos
                ? {
                    top: popoverPos.top,
                    left: popoverPos.left
                  }
                : undefined
            }
          >
            {/* ── Card Header ── */}
            <div className="flex items-center justify-between px-5 pt-4 pb-2.5 border-b border-[var(--cs-border-subtle)]">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-md bg-[var(--cs-accent-mag-soft)] text-[var(--cs-accent-clay)]">
                  <Compass className="w-4 h-4" />
                </span>
                <span className="text-[12px] font-semibold tracking-tight text-[var(--cs-text-primary)]">
                  Workspace Orientation
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-[var(--cs-surface-2)] border border-[var(--cs-border)] text-[var(--cs-text-muted)]">
                  {currentStepIndex + 1} / {TOUR_STEPS.length}
                </span>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="p-1 rounded-lg text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-[var(--cs-bg-subtle)] transition-all cursor-pointer active:scale-[0.96]"
                title="Skip tour (Esc)"
                aria-label="Close tour"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* ── Progress Track ── */}
            <div className="flex gap-1 px-5 pt-2">
              {TOUR_STEPS.map((step, idx) => (
                <div
                  key={step.id}
                  className={`h-1 flex-1 rounded-full transition-all duration-200 ${
                    idx === currentStepIndex
                      ? "bg-[var(--cs-accent-clay)]"
                      : idx < currentStepIndex
                      ? "bg-[var(--cs-accent-clay)]/40"
                      : "bg-[var(--cs-border-subtle)]"
                  }`}
                />
              ))}
            </div>

            {/* ── Step Body ── */}
            <div className="p-5 flex flex-col gap-3">
              <div>
                <span className="inline-block px-2 py-0.5 mb-1 rounded-md text-[10.5px] font-semibold uppercase tracking-wider bg-[var(--cs-accent-mag-soft)] text-[var(--cs-accent-clay)]">
                  {currentStep.badge}
                </span>
                <h3 className="text-[15px] font-semibold text-[var(--cs-text-primary)] tracking-tight">
                  {currentStep.title}
                </h3>
                <p className="text-[12px] text-[var(--cs-text-secondary)] leading-relaxed mt-0.5">
                  {currentStep.subtitle}
                </p>
              </div>

              {/* ── In-Situ Interactive Feature Widgets ── */}
              {currentStep.id === "variant-input" && (
                <div className="p-3 rounded-xl bg-[var(--cs-surface-2)] border border-[var(--cs-border)] flex flex-col gap-2">
                  <div className="flex items-center justify-between text-[11px] text-[var(--cs-text-muted)]">
                    <span className="font-mono">Flagship Control</span>
                    <span className="text-[var(--cs-accent-clay)] font-medium">Rare Disease Monogenic</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[12.5px] font-semibold text-[var(--cs-text-primary)]">
                        PAH · p.Arg408Trp
                      </div>
                      <div className="text-[10.5px] text-[var(--cs-text-secondary)]">
                        Phenylketonuria (PKU) · P00439
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleLoadSample}
                      className="px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold bg-[var(--cs-accent-clay)] text-white hover:brightness-105 transition-all shadow-xs active:scale-[0.96] flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      {sampleLoaded ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Loaded!</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Load Sample</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-[10.5px] text-[var(--cs-text-muted)]">
                    Tip: Coordinates also accept cDNA (<code className="font-mono text-[10px]">c.1222C&gt;T</code>) or genomic VCF (<code className="font-mono text-[10px]">12-102844883-C-T</code>).
                  </p>
                </div>
              )}

              {currentStep.id === "navigation-zones" && (
                <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                  <div className="p-2.5 rounded-xl bg-[var(--cs-surface-2)] border border-[var(--cs-border)] flex flex-col gap-0.5">
                    <span className="font-semibold text-[var(--cs-text-primary)] flex items-center gap-1">
                      <BarChart2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      Zone 2: Evidence
                    </span>
                    <span className="text-[10.5px] text-[var(--cs-text-secondary)]">ClinVar, gnomAD, AlphaMissense</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--cs-surface-2)] border border-[var(--cs-border)] flex flex-col gap-0.5">
                    <span className="font-semibold text-[var(--cs-text-primary)] flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                      Zone 3: 3D Molstar
                    </span>
                    <span className="text-[10.5px] text-[var(--cs-text-secondary)]">AlphaFold, FoldX &amp; RaSP ΔΔG</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--cs-surface-2)] border border-[var(--cs-border)] flex flex-col gap-0.5">
                    <span className="font-semibold text-[var(--cs-text-primary)] flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      Zone 4: Synthesis
                    </span>
                    <span className="text-[10.5px] text-[var(--cs-text-secondary)]">ACMG diagnostic criteria &amp; reports</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[var(--cs-surface-2)] border border-[var(--cs-border)] flex flex-col gap-0.5">
                    <span className="font-semibold text-[var(--cs-text-primary)] flex items-center gap-1">
                      <Sliders className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      Zone 5: Console
                    </span>
                    <span className="text-[10.5px] text-[var(--cs-text-secondary)]">Telemetry &amp; real-time execution logs</span>
                  </div>
                </div>
              )}

              {currentStep.id === "workflow-rail" && (
                <div className="p-3 rounded-xl bg-[var(--cs-surface-2)] border border-[var(--cs-border)] flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold text-[11.5px]">
                    <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600" />
                    <span>Sovereignty: 0 Tokens &amp; 0 Billing Required</span>
                  </div>
                  <ul className="text-[11px] text-[var(--cs-text-secondary)] space-y-1 list-disc list-inside">
                    <li><strong className="text-[var(--cs-text-primary)]">FoldX Mechanics</strong>: Runs locally (Windows EXE or Linux ARM64 Box64).</li>
                    <li><strong className="text-[var(--cs-text-primary)]">RaSP SQLite</strong>: Instant pre-indexed ΔΔG lookup database.</li>
                    <li><strong className="text-[var(--cs-text-primary)]">JapanFold Fallback</strong>: Remote sovereign protein folding without keys.</li>
                  </ul>
                </div>
              )}

              {currentStep.id === "settings-trigger" && (
                <div className="p-3 rounded-xl bg-[var(--cs-surface-2)] border border-[var(--cs-border)] flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--cs-text-primary)]">
                      <KeyRound className="w-4 h-4 text-amber-500" />
                      <span>Google Gemini 2.5 Flash</span>
                    </div>
                    <a
                      href="https://aistudio.google.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-[var(--cs-accent-clay)] hover:underline flex items-center gap-1 font-medium"
                    >
                      <span>Free Key</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenSettings ? onOpenSettings("api") : openSettingsTab("api");
                      }}
                      className="flex-1 py-1.5 rounded-lg text-[11.5px] font-semibold bg-[var(--cs-surface)] border border-[var(--cs-border)] hover:border-[var(--cs-accent-clay)] text-[var(--cs-text-primary)] transition-all active:scale-[0.96] flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Sliders className="w-3.5 h-3.5 text-[var(--cs-accent-clay)]" />
                      <span>Open Settings API Tab</span>
                    </button>
                    <button
                      type="button"
                      onClick={copyBashSnippet}
                      className="py-1.5 px-2.5 rounded-lg text-[11.5px] font-medium bg-[var(--cs-surface)] border border-[var(--cs-border)] hover:border-[var(--cs-accent-clay)] text-[var(--cs-text-secondary)] transition-all active:scale-[0.96] flex items-center gap-1 cursor-pointer"
                      title="Copy safe terminal command"
                    >
                      {copiedKeyCommand ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKeyCommand ? "Copied" : "Bash CLI"}</span>
                    </button>
                  </div>
                </div>
              )}

              {currentStep.id === "curated-presets" && (
                <div className="flex flex-col gap-1.5 max-h-[170px] overflow-y-auto no-scrollbar">
                  {ONBOARDING_BENCHMARK_PRESETS.map((preset) => (
                    <button
                      key={preset.gene + preset.variant}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className="w-full p-2 rounded-xl text-left border border-[var(--cs-border)] bg-[var(--cs-surface-2)] hover:bg-[var(--cs-surface)] hover:border-[var(--cs-accent-clay)]/50 transition-all cursor-pointer flex items-center justify-between group active:scale-[0.96]"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-[12px] text-[var(--cs-text-primary)]">
                            {preset.gene}
                          </span>
                          <span className="font-mono text-[11px] text-[var(--cs-accent-clay)]">
                            {preset.variant}
                          </span>
                          <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-[var(--cs-border-subtle)] text-[var(--cs-text-muted)] font-medium">
                            {preset.tag}
                          </span>
                        </div>
                        <p className="text-[10px] text-[var(--cs-text-secondary)] truncate mt-0.5">
                          {preset.description}
                        </p>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-[var(--cs-text-muted)] group-hover:text-[var(--cs-accent-clay)] group-hover:translate-x-0.5 transition-all shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Card Footer ── */}
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)]/40">
              <button
                type="button"
                onClick={handleClose}
                className="text-[11.5px] font-medium text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] transition-colors cursor-pointer"
              >
                Skip Tour
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentStepIndex === 0}
                  onClick={handlePrev}
                  className="p-1.5 rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface)] text-[var(--cs-text-secondary)] hover:text-[var(--cs-text-primary)] hover:border-[var(--cs-border-subtle)] disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.96] cursor-pointer"
                  title="Previous step (ArrowLeft)"
                  aria-label="Previous step"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleNext}
                  className="px-3.5 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--cs-accent-clay)] text-white hover:brightness-105 transition-all shadow-xs active:scale-[0.96] flex items-center gap-1.5 cursor-pointer"
                  title="Next step (ArrowRight)"
                >
                  <span>{currentStepIndex === TOUR_STEPS.length - 1 ? "Finish Tour" : "Next"}</span>
                  {currentStepIndex === TOUR_STEPS.length - 1 ? (
                    <Sparkles className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

export default React.memo(OnboardingModal);
