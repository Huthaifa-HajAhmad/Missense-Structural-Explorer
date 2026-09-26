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
  Dna
} from "lucide-react";
import { useSettings } from "../../context/SettingsContext";

export interface OnboardingPreset {
  gene: string;
  variant: string;
  uniprotId: string;
  tag: string;
  description: string;
}

export const ONBOARDING_BENCHMARK_PRESETS: OnboardingPreset[] = [
  {
    gene: "BRAF",
    variant: "p.Val600Glu",
    uniprotId: "P15056",
    tag: "Oncology Hotspot",
    description: "V600E activation loop destabilization and constitutively active MAPK signaling."
  },
  {
    gene: "TP53",
    variant: "p.Arg175His",
    uniprotId: "P04637",
    tag: "Structural Clash",
    description: "R175H zinc-coordinating domain breakdown and DNA-binding scaffold distortion."
  },
  {
    gene: "PTEN",
    variant: "p.Cys124Ser",
    uniprotId: "P60484",
    tag: "Active Site Pocket",
    description: "C124S catalytic phosphatase pocket disruption and loss-of-function."
  },
  {
    gene: "CNNM2",
    variant: "p.Glu357Lys",
    uniprotId: "Q9H8M5",
    tag: "Charge Inversion",
    description: "E357K cyclic nucleotide binding homology domain salt-bridge disruption."
  }
];

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPreset?: (preset: OnboardingPreset) => void;
  onOpenSettings?: (tab?: string) => void;
}

const STEPS = [
  {
    id: "welcome",
    label: "Welcome",
    title: "Welcome to Missense & Fold",
    subtitle: "High-precision biophysical stability modeling & clinical variant interpretation"
  },
  {
    id: "zones",
    label: "Workspace Zones",
    title: "How the Workspace is Organised",
    subtitle: "Four integrated pipelines from single-letter mutations to clinical reports"
  },
  {
    id: "sovereign",
    label: "Biophysics Core",
    title: "Zero-Key Sovereign Core vs. AI Pipelines",
    subtitle: "Deep biophysical modeling runs locally and keyless out-of-the-box"
  },
  {
    id: "keys",
    label: "API Keys Guide",
    title: "API Keys Setup & Guidance",
    subtitle: "Unlock generative AI synthesis, DeepMind AlphaGenome & cloud accelerators"
  },
  {
    id: "quickstart",
    label: "Quick Start",
    title: "Ready to Explore",
    subtitle: "Launch a benchmark variant or configure your custom workspace preferences"
  }
] as const;

export function OnboardingModal({
  isOpen,
  onClose,
  onSelectPreset,
  onOpenSettings
}: OnboardingModalProps) {
  const { openSettingsTab, hasConfiguredGeminiKey, serverGeminiReady } = useSettings();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [copiedKeyCommand, setCopiedKeyCommand] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Reset wizard to Step 1 and sync preference with localStorage whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentStepIndex(0);
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem("cs-onboarding-completed-v1");
        setDontShowAgain(saved === "true");
      }
    }
  }, [isOpen]);

  const handleDismiss = useCallback(() => {
    if (typeof window !== "undefined" && dontShowAgain) {
      localStorage.setItem("cs-onboarding-completed-v1", "true");
    }
    onClose();
  }, [dontShowAgain, onClose]);

  const handleComplete = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("cs-onboarding-completed-v1", "true");
    }
    onClose();
  }, [onClose]);

  const handleToggleDontShowAgain = (checked: boolean) => {
    setDontShowAgain(checked);
    if (typeof window !== "undefined") {
      localStorage.setItem("cs-onboarding-completed-v1", checked ? "true" : "false");
    }
  };

  // Keyboard navigation: Escape closes, ArrowLeft/ArrowRight step through
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape") {
        e.preventDefault();
        handleDismiss();
      } else if (!isInput && window.getSelection()?.type !== "Range") {
        if (e.key === "ArrowRight" && currentStepIndex < STEPS.length - 1) {
          e.preventDefault();
          setCurrentStepIndex(i => i + 1);
        } else if (e.key === "ArrowLeft" && currentStepIndex > 0) {
          e.preventDefault();
          setCurrentStepIndex(i => i - 1);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, currentStepIndex, handleDismiss]);

  const copyBashCommand = async () => {
    const cmd = `printf "Enter GEMINI_API_KEY (typing hidden): " && read -s val && echo && echo "GEMINI_API_KEY=$val" >> ".env" && echo "Saved to .env"`;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedKeyCommand(true);
      window.setTimeout(() => setCopiedKeyCommand(false), 2200);
    } catch {
      // Fallback
    }
  };

  const handleLaunchPreset = (preset: OnboardingPreset) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("cs-onboarding-completed-v1", "true");
    }
    onClose();
    onSelectPreset?.(preset);
  };

  const handleOpenSettingsTab = (tab: string) => {
    onClose();
    if (onOpenSettings) {
      onOpenSettings(tab);
    } else {
      openSettingsTab(tab as any);
    }
  };

  const currentStep = STEPS[currentStepIndex];

  const content = (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-modal-title"
        >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
          onClick={handleDismiss}
        />

        {/* Modal Window Container */}
        <motion.div
          ref={modalRef}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
          className="relative max-w-2xl w-full rounded-2xl border shadow-2xl overflow-hidden flex flex-col z-10 my-auto bg-[var(--cs-surface)] border-[var(--cs-border)] text-[var(--cs-text-primary)]"
          style={{ maxHeight: "calc(100vh - 2rem)" }}
        >
          {/* Header Chrome */}
          <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[var(--cs-accent-clay)]/10 border border-[var(--cs-accent-clay)]/25 flex items-center justify-center text-[var(--cs-accent-clay)] shrink-0">
                <Compass className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 id="onboarding-modal-title" className="text-sm font-bold tracking-tight truncate">
                    Workspace Guide &amp; Orientation
                  </h2>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-[var(--cs-radius-badge)] bg-[var(--cs-accent-mag-soft)] text-[var(--cs-accent-clay)] border border-[var(--cs-accent-clay)]/20 font-semibold shrink-0">
                    Step {currentStepIndex + 1} of {STEPS.length}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--cs-text-muted)] truncate">
                  {currentStep.subtitle}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDismiss}
              className="p-1.5 rounded-lg text-[var(--cs-text-muted)] hover:text-[var(--cs-text-primary)] hover:bg-[var(--cs-bg-subtle)] transition-[color,background-color,transform] duration-150 active:scale-[0.96] cursor-pointer"
              title="Close guide (Esc)"
              aria-label="Close guide"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Stepper Progress Bar */}
          <div className="flex items-center gap-1 px-5 sm:px-6 py-2 border-b border-[var(--cs-border-subtle)] bg-[var(--cs-surface)] overflow-x-auto no-scrollbar">
            {STEPS.map((step, idx) => {
              const isPast = idx < currentStepIndex;
              const isCurrent = idx === currentStepIndex;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setCurrentStepIndex(idx)}
                  className={`flex-1 min-w-[70px] py-1.5 px-2 rounded-lg text-[10.5px] font-medium transition-[background-color,color,border-color] duration-150 text-center truncate border ${
                    isCurrent
                      ? "bg-[var(--cs-accent-mag-soft)] border-[var(--cs-accent-clay)] text-[var(--cs-accent-clay)] font-semibold shadow-xs"
                      : isPast
                      ? "bg-[var(--cs-surface-2)] border-transparent text-[var(--cs-text-secondary)] hover:text-[var(--cs-text-primary)]"
                      : "bg-transparent border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text-secondary)]"
                  }`}
                >
                  <span className="font-mono text-[9px] mr-1">{idx + 1}.</span>{" "}
                  {step.label}
                </button>
              );
            })}
          </div>

          {/* Body Content Slider */}
          <div className="p-5 sm:p-6 overflow-y-auto min-h-[320px] max-h-[58vh] space-y-4">
            {/* Step 1: Welcome */}
            {currentStep.id === "welcome" && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)] flex items-start gap-3.5">
                  <div className="w-9 h-9 rounded-lg bg-[var(--cs-accent-clay)] text-white flex items-center justify-center shrink-0 shadow-xs">
                    <Dna className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-[13.5px] font-bold text-[var(--cs-text-primary)]">
                      Explore the Structural Impact of Human Missense Variants
                    </h3>
                    <p className="text-[12px] leading-relaxed text-[var(--cs-text-secondary)]">
                      Missense &amp; Fold is an end-to-end biophysical exploration and clinical decision-support platform.
                      Given a gene symbol or HGVS genomic coordinates, it coordinates 3D folding models, atomic stability force fields,
                      evolutionary constraint metrics, and generative AI synthesis into an audit-ready clinical report.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="p-3.5 rounded-xl border border-[var(--cs-border-subtle)] bg-[var(--cs-surface)] space-y-1.5">
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--cs-text-primary)]">
                      <Zap className="w-4 h-4 text-[var(--cs-accent-clay)]" />
                      Multi-Modal Resolution
                    </div>
                    <p className="text-[11px] leading-relaxed text-[var(--cs-text-muted)]">
                      Instant translation of protein notations (e.g. <code className="font-mono text-[10px] text-[var(--cs-accent-clay)]">p.Val600Glu</code>),
                      transcript cDNA, or genomic coordinates via Ensembl VEP and UniProt.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-[var(--cs-border-subtle)] bg-[var(--cs-surface)] space-y-1.5">
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--cs-text-primary)]">
                      <Layers className="w-4 h-4 text-[var(--cs-accent-clay)]" />
                      Interactive 3D Structures
                    </div>
                    <p className="text-[11px] leading-relaxed text-[var(--cs-text-muted)]">
                      AlphaFold2 and ESMFold structures rendered live in Molstar with wild-type vs. mutant overlays and steric clash analysis.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-[var(--cs-border-subtle)] bg-[var(--cs-surface)] space-y-1.5">
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--cs-text-primary)]">
                      <Activity className="w-4 h-4 text-[var(--cs-accent-clay)]" />
                      Calibrated ΔΔG Stability
                    </div>
                    <p className="text-[11px] leading-relaxed text-[var(--cs-text-muted)]">
                      FoldX, RaSP, ThermoMPNN, and StabilityOracle consensus calculations with rigorous conformal prediction intervals.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl border border-[var(--cs-border-subtle)] bg-[var(--cs-surface)] space-y-1.5">
                    <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--cs-text-primary)]">
                      <FileText className="w-4 h-4 text-[var(--cs-accent-clay)]" />
                      ACMG &amp; Provenance
                    </div>
                    <p className="text-[11px] leading-relaxed text-[var(--cs-text-muted)]">
                      Automated ACMG/AMP rules classification, PubMed mining, and pinned provenance manifests for clinical reproducibility.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Workspace Zones */}
            {currentStep.id === "zones" && (
              <div className="space-y-3">
                <p className="text-[12px] text-[var(--cs-text-secondary)] leading-relaxed">
                  The master sidebar divides the workspace into 4 logical zones. Navigate across them as your analysis progresses:
                </p>

                <div className="space-y-2.5">
                  <div className="p-3 rounded-xl border border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)] flex items-start gap-3">
                    <span className="w-6 h-6 rounded-lg bg-[var(--cs-surface)] border border-[var(--cs-border)] font-mono text-[11px] font-bold flex items-center justify-center text-[var(--cs-accent-clay)] shrink-0">
                      1
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-bold text-[var(--cs-text-primary)]">
                        Input &amp; Search (Variant Query)
                      </p>
                      <p className="text-[11px] text-[var(--cs-text-muted)] leading-relaxed mt-0.5">
                        Type a gene and notation or paste directly from clipboard. Accepts protein HGVS (<code className="font-mono text-[10px]">p.Gly380Arg</code>),
                        cDNA (<code className="font-mono text-[10px]">c.1799T&gt;A</code>), or genomic coordinates (<code className="font-mono text-[10px]">7-140753336-A-T</code>).
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)] flex items-start gap-3">
                    <span className="w-6 h-6 rounded-lg bg-[var(--cs-surface)] border border-[var(--cs-border)] font-mono text-[11px] font-bold flex items-center justify-center text-[var(--cs-accent-clay)] shrink-0">
                      2
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-bold text-[var(--cs-text-primary)]">
                        Evidence &amp; Modeling (Multi-Modal Predictors)
                      </p>
                      <p className="text-[11px] text-[var(--cs-text-muted)] leading-relaxed mt-0.5">
                        Examine 10+ predictors (REVEL, AlphaMissense, ClinVar, gnomAD, CADD), Google DeepMind AlphaGenome Atlas AVI scores,
                        RNA splicing shifts, and residue contact networks.
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)] flex items-start gap-3">
                    <span className="w-6 h-6 rounded-lg bg-[var(--cs-surface)] border border-[var(--cs-border)] font-mono text-[11px] font-bold flex items-center justify-center text-[var(--cs-accent-clay)] shrink-0">
                      3
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-bold text-[var(--cs-text-primary)]">
                        3D Structure &amp; Energetics (Molstar &amp; ΔΔG)
                      </p>
                      <p className="text-[11px] text-[var(--cs-text-muted)] leading-relaxed mt-0.5">
                        Inspect rendered AlphaFold2 or ESMFold structures. Highlight substitution sites, measure polar contacts,
                        and inspect multi-engine thermodynamic stability (FoldX, RaSP, ThermoMPNN).
                      </p>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)] flex items-start gap-3">
                    <span className="w-6 h-6 rounded-lg bg-[var(--cs-surface)] border border-[var(--cs-border)] font-mono text-[11px] font-bold flex items-center justify-center text-[var(--cs-accent-clay)] shrink-0">
                      4
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-bold text-[var(--cs-text-primary)]">
                        Synthesis, Literature &amp; Clinical Reports
                      </p>
                      <p className="text-[11px] text-[var(--cs-text-muted)] leading-relaxed mt-0.5">
                        Automated ACMG classification rules (PVS1, PM1, PM2, PP3), live PubMed citation mining,
                        and clinician-tailored narrative synthesis generated via Gemini AI.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Sovereign Core vs Key-Enhanced */}
            {currentStep.id === "sovereign" && (
              <div className="space-y-3.5">
                <div className="p-3.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 space-y-1">
                  <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-[12.5px]">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    Zero-Key Sovereign Core operates out of the box
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-[var(--cs-text-secondary)]">
                    You do <strong>not</strong> need external API keys to start using this workspace.
                    Local biophysics engines and public biological databases run immediately with zero cloud cost.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Left: Zero Key */}
                  <div className="p-3.5 rounded-xl border border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)] space-y-2">
                    <div className="flex items-center justify-between pb-1 border-b border-[var(--cs-border-subtle)]">
                      <span className="text-[11.5px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                        Works With No Keys (Free)
                      </span>
                      <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        Active
                      </span>
                    </div>
                    <ul className="space-y-1.5 text-[11px] text-[var(--cs-text-secondary)]">
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span><strong>Molstar 3D:</strong> AlphaFold2 &amp; ESMFold viewer</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span><strong>FoldX:</strong> Local force-field repacking &amp; ΔΔG</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span><strong>RaSP:</strong> Indexed Zenodo SQLite biophysics DB</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span><strong>Databases:</strong> ClinVar, gnomAD, dbNSFP, Ensembl</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span><strong>JapanFold:</strong> Keyless sovereign fallback model</span>
                      </li>
                    </ul>
                  </div>

                  {/* Right: Key Enhanced */}
                  <div className="p-3.5 rounded-xl border border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)] space-y-2">
                    <div className="flex items-center justify-between pb-1 border-b border-[var(--cs-border-subtle)]">
                      <span className="text-[11.5px] font-bold text-[var(--cs-accent-clay)] uppercase tracking-wider">
                        Enhanced With Keys
                      </span>
                      <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-[var(--cs-accent-mag-soft)] text-[var(--cs-accent-clay)]">
                        Optional
                      </span>
                    </div>
                    <ul className="space-y-1.5 text-[11px] text-[var(--cs-text-secondary)]">
                      <li className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-[var(--cs-accent-clay)] shrink-0" />
                        <span><strong>Gemini AI:</strong> Clinical report narrative &amp; PubMed mining</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-[var(--cs-accent-clay)] shrink-0" />
                        <span><strong>AlphaGenome:</strong> DeepMind AVI &amp; 18-modality tracks</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-[var(--cs-accent-clay)] shrink-0" />
                        <span><strong>ESM3 Forge:</strong> Generative structural refinement</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-[var(--cs-accent-clay)] shrink-0" />
                        <span><strong>Hugging Face:</strong> SaProt &amp; GPN-Star phylogeny LM</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-[var(--cs-accent-clay)] shrink-0" />
                        <span><strong>Tamarind Bio:</strong> Cloud ThermoMPNN stability fallback</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: API Keys Guide */}
            {currentStep.id === "keys" && (
              <div className="space-y-3.5">
                <p className="text-[12px] text-[var(--cs-text-secondary)] leading-relaxed">
                  Configure keys in your local <code className="font-mono text-[11px] text-[var(--cs-accent-clay)]">.env</code> file
                  or directly in the browser via <strong>Settings &gt; Connections</strong> (stored securely for your session):
                </p>

                {/* Gemini Key Focus Card */}
                <div className="p-3.5 rounded-xl border border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-amber-500" />
                      <span className="text-[12.5px] font-bold text-[var(--cs-text-primary)]">
                        Google Gemini API Key (Recommended)
                      </span>
                    </div>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                      hasConfiguredGeminiKey || serverGeminiReady
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                    }`}>
                      {hasConfiguredGeminiKey || serverGeminiReady ? "Ready & Linked" : "Unconfigured"}
                    </span>
                  </div>

                  <p className="text-[11.5px] text-[var(--cs-text-secondary)] leading-relaxed">
                    Unlocks AI clinical synthesis, PubMed paper mining, and structured ACMG summaries.
                    You can obtain a free key from Google AI Studio in about 30 seconds.
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg text-[11.5px] font-semibold bg-[var(--cs-accent-clay)] text-white hover:brightness-105 active:scale-[0.96] transition-all flex items-center gap-1.5 shadow-xs"
                    >
                      <span>Get Free Key at AI Studio</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>

                    <button
                      type="button"
                      onClick={() => handleOpenSettingsTab("connections")}
                      className="px-3 py-1.5 rounded-lg text-[11.5px] font-medium border border-[var(--cs-border)] bg-[var(--cs-surface)] hover:bg-[var(--cs-surface-2)] text-[var(--cs-text-primary)] active:scale-[0.96] transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <Sliders className="w-3.5 h-3.5 text-[var(--cs-text-muted)]" />
                      <span>Link in Settings</span>
                    </button>
                  </div>
                </div>

                {/* Safe Terminal Setup Command (Protocol Compliant) */}
                <div className="p-3.5 rounded-xl border border-[var(--cs-border-subtle)] bg-[var(--cs-surface)] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[var(--cs-text-secondary)] flex items-center gap-1.5">
                      <span>Safe Terminal Injection (Typing Hidden)</span>
                    </span>
                    <button
                      type="button"
                      onClick={copyBashCommand}
                      className="flex items-center gap-1 text-[10.5px] font-medium text-[var(--cs-accent-clay)] hover:underline cursor-pointer"
                    >
                      {copiedKeyCommand ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy Bash Command</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-2.5 rounded-lg bg-[var(--cs-surface-2)] border border-[var(--cs-border-subtle)] text-[10.5px] font-mono text-[var(--cs-text-secondary)] overflow-x-auto whitespace-pre-wrap select-all">
                    printf &quot;Enter GEMINI_API_KEY (typing hidden): &quot; &amp;&amp; read -s val &amp;&amp; echo &amp;&amp; echo &quot;GEMINI_API_KEY=$val&quot; &gt;&gt; &quot;.env&quot; &amp;&amp; echo &quot;Saved to .env&quot;
                  </pre>
                  <p className="text-[10px] text-[var(--cs-text-muted)] leading-normal">
                    This command adheres to the secure credential protocol, hiding your keystrokes from terminal history.
                  </p>
                </div>
              </div>
            )}

            {/* Step 5: Quick Start Presets */}
            {currentStep.id === "quickstart" && (
              <div className="space-y-3.5">
                <p className="text-[12px] text-[var(--cs-text-secondary)] leading-relaxed">
                  Start by launching one of our validated benchmark controls to explore 3D folding, energetics, and clinical evidence:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {ONBOARDING_BENCHMARK_PRESETS.map((preset) => (
                    <button
                      key={`${preset.gene}-${preset.variant}`}
                      type="button"
                      onClick={() => handleLaunchPreset(preset)}
                      className="p-3 rounded-xl border border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)] hover:border-[var(--cs-accent-clay)]/50 hover:bg-[var(--cs-surface)] transition-[border-color,background-color,transform] duration-150 active:scale-[0.98] text-left cursor-pointer flex flex-col justify-between group shadow-xs"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-[13px] text-[var(--cs-text-primary)]">
                            {preset.gene}
                          </span>
                          <span className="font-mono text-[11.5px] text-[var(--cs-accent-clay)] font-semibold">
                            {preset.variant}
                          </span>
                        </div>
                        <span className="text-[9.5px] font-mono uppercase px-1.5 py-0.5 rounded bg-[var(--cs-surface)] border border-[var(--cs-border-subtle)] text-[var(--cs-text-muted)]">
                          {preset.tag}
                        </span>
                      </div>
                      <p className="text-[10.5px] text-[var(--cs-text-secondary)] line-clamp-2 leading-relaxed">
                        {preset.description}
                      </p>
                      <div className="flex items-center gap-1 text-[10px] font-semibold text-[var(--cs-accent-clay)] pt-2 group-hover:translate-x-0.5 transition-transform">
                        <span>Load Variant &amp; Analyze</span>
                        <ArrowRight className="w-3 h-3" />
                      </div>
                    </button>
                  ))}
                </div>

                <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-[var(--cs-border-subtle)]">
                  <button
                    type="button"
                    onClick={() => handleOpenSettingsTab("connections")}
                    className="w-full sm:w-auto px-3.5 py-2 rounded-xl text-[12px] font-medium border border-[var(--cs-border)] bg-[var(--cs-surface)] hover:bg-[var(--cs-surface-2)] text-[var(--cs-text-primary)] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-[0.96]"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                    <span>Configure API Keys &amp; Telemetry</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleComplete}
                    className="w-full sm:w-auto px-4 py-2 rounded-xl text-[12px] font-semibold bg-[var(--cs-accent-clay)] text-white hover:brightness-105 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-[0.96]"
                  >
                    <span>Start Blank Query</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer Controls */}
          <div className="px-5 sm:px-6 py-3.5 border-t border-[var(--cs-border-subtle)] bg-[var(--cs-surface-2)] flex items-center justify-between gap-3">
            {/* Don't show again checkbox */}
            <label className="flex items-center gap-2 text-[11px] text-[var(--cs-text-muted)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => handleToggleDontShowAgain(e.target.checked)}
                className="rounded border-[var(--cs-border)] text-[var(--cs-accent-clay)] focus:ring-[var(--cs-accent-clay)] cursor-pointer"
              />
              <span>Don't show on startup</span>
            </label>

            {/* Stepper Actions */}
            <div className="flex items-center gap-2">
              {currentStepIndex > 0 && (
                <button
                  type="button"
                  onClick={() => setCurrentStepIndex(i => i - 1)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--cs-border)] bg-[var(--cs-surface)] text-[12px] font-medium text-[var(--cs-text-secondary)] hover:text-[var(--cs-text-primary)] hover:bg-[var(--cs-surface-2)] transition-all cursor-pointer flex items-center gap-1 active:scale-[0.96]"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
              )}

              {currentStepIndex < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setCurrentStepIndex(i => i + 1)}
                  className="px-4 py-1.5 rounded-lg bg-[var(--cs-accent-clay)] text-white text-[12px] font-semibold hover:brightness-105 transition-all cursor-pointer flex items-center gap-1 shadow-xs active:scale-[0.96]"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleComplete}
                  className="px-4 py-1.5 rounded-lg bg-[var(--cs-accent-clay)] text-white text-[12px] font-semibold hover:brightness-105 transition-all cursor-pointer flex items-center gap-1 shadow-xs active:scale-[0.96]"
                >
                  <span>Get Started</span>
                  <Check className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    )}
  </AnimatePresence>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : null;
}

export default OnboardingModal;
