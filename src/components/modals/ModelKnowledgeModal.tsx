import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  BookOpen,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Layers,
  Dna,
  Sparkles,
  Copy,
  Check,
  Cpu,
  Info
} from "lucide-react";
import { METRIC_EXPLANATIONS } from "../evidence/MetricExplanations";

interface ModelKnowledgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelKey: string | null;
  isDark?: boolean;
}

export function ModelKnowledgeModal({
  isOpen,
  onClose,
  modelKey,
  isDark = true
}: ModelKnowledgeModalProps) {
  const [copied, setCopied] = useState(false);

  if (!modelKey) return null;
  const detail = METRIC_EXPLANATIONS[modelKey];
  if (!detail) return null;

  const handleCopyCitation = () => {
    const textToCopy = detail.citation || `${detail.paperTitle}. ${detail.paperUrl}`;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative max-w-xl w-full max-h-[85vh] overflow-hidden flex flex-col rounded-2xl border shadow-2xl z-10"
            style={{
              background: "var(--cs-surface)",
              borderColor: "var(--cs-border)",
              color: "var(--cs-text-primary)"
            }}
          >
            {/* Header */}
            <div
              className="p-5 border-b flex items-start justify-between relative"
              style={{
                borderColor: "var(--cs-border)",
                background: "var(--cs-surface-2)"
              }}
            >
              <div className="flex items-start space-x-3">
                <div
                  className="p-2.5 rounded-xl border flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{
                    background: "rgba(196,104,73,0.12)",
                    borderColor: "rgba(196,104,73,0.25)",
                    color: "var(--cs-accent-clay)"
                  }}
                >
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[10px] font-bold uppercase font-mono px-2 py-0.5 rounded"
                      style={{
                        background: "rgba(196,104,73,0.15)",
                        color: "var(--cs-accent-clay)"
                      }}
                    >
                      {detail.category}
                    </span>
                    {detail.modality && (
                      <span className="text-[10px] font-medium font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <Dna className="w-3 h-3" />
                        {detail.modality.split("+")[0].trim()}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-bold tracking-tight mt-1" style={{ color: "var(--cs-text-primary)" }}>
                    {detail.name}
                  </h3>
                  {detail.architecture && (
                    <p className="text-xs mt-0.5 font-mono opacity-75" style={{ color: "var(--cs-text-muted)" }}>
                      {detail.architecture}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center border transition-colors hover:bg-white/10 cursor-pointer text-sm font-bold opacity-75 hover:opacity-100"
                style={{ borderColor: "var(--cs-border)" }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Content Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs leading-relaxed">
              {/* Scientific Description */}
              <div>
                <span className="block text-[10px] uppercase font-mono font-bold tracking-wider mb-1" style={{ color: "var(--cs-accent-clay)" }}>
                  Model Overview & Architecture
                </span>
                <p className="leading-relaxed text-[12.5px]" style={{ color: "var(--cs-text-secondary)" }}>
                  {detail.description}
                </p>
              </div>

              {/* Biological Modality & Interpretation */}
              <div className="p-3.5 rounded-xl border" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                <span className="block text-[10px] uppercase font-mono font-bold tracking-wider mb-1 text-slate-400">
                  Biological Interpretation & Scoring
                </span>
                <p className="text-[12px] leading-relaxed" style={{ color: "var(--cs-text-primary)" }}>
                  {detail.interpretation}
                </p>
              </div>

              {/* Strengths Section */}
              {detail.strengths && detail.strengths.length > 0 && (
                <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                  <div className="flex items-center gap-1.5 mb-2 text-emerald-400 font-bold text-xs uppercase tracking-wider font-mono">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Key Capabilities & Strengths</span>
                  </div>
                  <ul className="space-y-1.5 pl-1">
                    {detail.strengths.map((st, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-[11.5px] text-emerald-200/90 leading-normal">
                        <span className="text-emerald-400 font-bold">•</span>
                        <span>{st}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Weaknesses & Limitations Section */}
              {detail.weaknesses && detail.weaknesses.length > 0 && (
                <div className="p-3.5 rounded-xl border border-amber-500/20 bg-amber-500/5">
                  <div className="flex items-center gap-1.5 mb-2 text-amber-400 font-bold text-xs uppercase tracking-wider font-mono">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Known Limitations & Assumptions</span>
                  </div>
                  <ul className="space-y-1.5 pl-1">
                    {detail.weaknesses.map((wk, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-[11.5px] text-amber-200/90 leading-normal">
                        <span className="text-amber-400 font-bold">•</span>
                        <span>{wk}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Literature Reference / Citation */}
              <div className="p-3.5 rounded-xl border space-y-2" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-mono font-bold tracking-wider flex items-center gap-1.5" style={{ color: "var(--cs-accent-clay)" }}>
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Peer-Reviewed Literature Citation</span>
                  </span>
                  {detail.provider && (
                    <span className="text-[10px] font-mono text-slate-400">
                      Provider: {detail.provider}
                    </span>
                  )}
                </div>

                <p className="text-[11.5px] italic text-slate-300 font-serif leading-snug">
                  {detail.citation || detail.paperTitle}
                </p>

                <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
                  <a
                    href={detail.paperUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold hover:underline transition-colors"
                    style={{
                      borderColor: "rgba(196,104,73,0.3)",
                      background: "rgba(196,104,73,0.1)",
                      color: "var(--cs-accent-clay)"
                    }}
                  >
                    <span>View Publication / Repository</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>

                  <button
                    type="button"
                    onClick={handleCopyCitation}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer hover:bg-white/5"
                    style={{
                      borderColor: "var(--cs-border)",
                      background: "var(--cs-surface)",
                      color: "var(--cs-text-primary)"
                    }}
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied to Clipboard</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                        <span>Copy Citation</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div
              className="p-3.5 border-t flex justify-end"
              style={{
                borderColor: "var(--cs-border)",
                background: "var(--cs-surface-2)"
              }}
            >
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer hover:bg-white/5"
                style={{
                  borderColor: "var(--cs-border)",
                  background: "var(--cs-surface)",
                  color: "var(--cs-text-primary)"
                }}
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default ModelKnowledgeModal;
