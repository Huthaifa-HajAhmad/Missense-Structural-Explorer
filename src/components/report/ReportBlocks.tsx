/**
 * ReportBlocks.tsx — Presentational building blocks for the Clinical Report.
 *
 * Deliberately dumb: every one of these renders a value it is handed. All derivation lives in
 * `reportStatus.ts` so the logic is unit-testable without a DOM.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Cpu,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useApiClient } from "../../apiClient";
import type { AiStatusModel, EvidenceSource } from "./reportStatus";

// ---------------------------------------------------------------------------
// Section shell
// ---------------------------------------------------------------------------

interface ReportSectionProps {
  id: string;
  title: string;
  /** Optional trailing summary shown collapsed, so the report still scans without expanding. */
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * Disclosure section.
 *
 * Uses a `grid-template-rows: 0fr -> 1fr` transition rather than a keyframe so the animation is
 * interruptible if the reader toggles rapidly, and only the chevron's own properties animate.
 */
export const ReportSection: React.FC<ReportSectionProps> = ({
  id,
  title,
  meta,
  defaultOpen = true,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `${id}-panel`;
  const buttonId = `${id}-button`;

  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface)" }}
    >
      <h2 className="m-0">
        <button
          id={buttonId}
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-controls={panelId}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left cursor-pointer transition-colors hover:bg-cs-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
        >
          <span className="report-chevron" data-open={open} aria-hidden="true">
            <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
          </span>
          <span
            className="text-[10.5px] font-mono font-bold uppercase tracking-widest"
            style={{ color: "var(--cs-text-muted)" }}
          >
            {title}
          </span>
          {meta ? <span className="ml-auto flex items-center gap-2 text-[10.5px]">{meta}</span> : null}
        </button>
      </h2>

      <div id={panelId} role="region" aria-labelledby={buttonId} className="report-disclosure" data-open={open}>
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-0.5">{children}</div>
        </div>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// AI status
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<AiStatusModel["tone"], { border: string; bg: string; fg: string }> = {
  good: {
    border: "color-mix(in srgb, var(--cs-good) 28%, transparent)",
    bg: "color-mix(in srgb, var(--cs-good) 7%, transparent)",
    fg: "var(--cs-good)",
  },
  warn: {
    border: "color-mix(in srgb, var(--cs-warn) 30%, transparent)",
    bg: "color-mix(in srgb, var(--cs-warn) 7%, transparent)",
    fg: "var(--cs-warn)",
  },
  neutral: {
    border: "var(--cs-border)",
    bg: "var(--cs-surface-2)",
    fg: "var(--cs-text-muted)",
  },
  bad: {
    border: "color-mix(in srgb, var(--cs-warn) 42%, transparent)",
    bg: "color-mix(in srgb, var(--cs-warn) 10%, transparent)",
    fg: "var(--cs-warn)",
  },
};

const STATUS_ICON: Record<AiStatusModel["state"], React.ElementType> = {
  live: CheckCircle2,
  degraded: AlertTriangle,
  unconfigured: ShieldAlert,
  idle: Cpu,
};

interface AiStatusStripProps {
  status: AiStatusModel;
  onRetry: () => void;
  onOpenConsole?: () => void;
  className?: string;
}

/**
 * The single, honest statement of AI state.
 *
 * Replaces a banner that branched on "is a key configured" and therefore announced
 * "AI Session Token Ready" immediately above an offline fallback notice.
 */
export const AiStatusStrip: React.FC<AiStatusStripProps> = ({
  status,
  onRetry,
  onOpenConsole,
  className = "",
}) => {
  const tone = STATUS_TONE[status.tone];
  const Icon = STATUS_ICON[status.state];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3 ${className}`}
      style={{ borderColor: tone.border, background: tone.bg }}
    >
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
        style={{ background: "var(--cs-surface)", color: tone.fg }}
      >
        <Icon className="w-3.5 h-3.5" strokeWidth={2} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wider m-0" style={{ color: tone.fg }}>
          {status.label}
        </p>
        <p className="text-xs leading-relaxed mt-0.5 mb-0" style={{ color: "var(--cs-text-secondary)" }}>
          {status.detail}
        </p>

        {status.diagnostics?.attemptedModels?.length ? (
          <p
            className="text-[10px] font-mono mt-1.5 mb-0 truncate"
            style={{ color: "var(--cs-text-muted)" }}
            title={status.diagnostics.attemptedModels.join(" → ")}
          >
            models tried: {status.diagnostics.attemptedModels.join(" → ")}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2 shrink-0 self-stretch sm:self-center">
        {onOpenConsole ? (
          <button
            type="button"
            onClick={onOpenConsole}
            className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-cs-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
            style={{ color: "var(--cs-text-secondary)", border: "1px solid var(--cs-border)" }}
          >
            <Terminal className="w-3 h-3" strokeWidth={2} />
            Diagnostics
          </button>
        ) : null}

        {status.retryable && status.canSynthesize ? (
          <button
            type="button"
            onClick={onRetry}
            className="report-press flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60"
          >
            <RefreshCw className="w-3 h-3" strokeWidth={2.25} />
            Retry synthesis
          </button>
        ) : null}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ACMG evidence
// ---------------------------------------------------------------------------

interface AcmgEvidenceListProps {
  criteria: Array<{ code: string; reason?: string; source?: string }>;
}

const SOURCE_LABEL: Record<string, { label: string; tone: string }> = {
  database_verified: { label: "database", tone: "var(--cs-good)" },
  ai_suggested: { label: "AI", tone: "var(--cs-accent-clay)" },
};

/**
 * ACMG/AMP criteria rendered as evidence rows with their justification.
 *
 * The design this replaces showed bare code chips in three separate places and discarded the
 * per-criterion reasoning entirely, which is the part a curator actually needs.
 */
export const AcmgEvidenceList: React.FC<AcmgEvidenceListProps> = ({ criteria }) => {
  if (!criteria.length) {
    return (
      <p className="text-xs m-0" style={{ color: "var(--cs-text-muted)" }}>
        No ACMG/AMP criteria were applied. This typically means the available evidence did not reach
        a criteria threshold, or the required evidence sources were unavailable.
      </p>
    );
  }

  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-2">
      {criteria.map((criterion, index) => {
        const source = SOURCE_LABEL[criterion.source ?? ""] ?? null;
        return (
          <li
            key={`${criterion.code}-${index}`}
            className="flex items-start gap-2.5 rounded-lg px-2.5 py-2"
            style={{ background: "var(--cs-surface-2)", border: "1px solid var(--cs-border-subtle)" }}
          >
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-mono font-bold tabular-nums"
              style={{
                background: "var(--cs-surface)",
                border: "1px solid var(--cs-border)",
                color: "var(--cs-text-primary)",
              }}
            >
              {criterion.code}
            </span>
            <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
              {criterion.reason || "No justification recorded."}
            </span>
            {source ? (
              <span
                className="shrink-0 text-[9.5px] font-mono font-semibold uppercase tracking-wider"
                style={{ color: source.tone }}
              >
                {source.label}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};

// ---------------------------------------------------------------------------
// Evidence inventory
// ---------------------------------------------------------------------------

interface EvidenceInventoryProps {
  sources: EvidenceSource[];
  present: number;
  total: number;
}

export const EvidenceInventory: React.FC<EvidenceInventoryProps> = ({ sources, present, total }) => {
  const complete = present === total;

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11.5px] m-0 flex items-center gap-1.5" style={{ color: "var(--cs-text-secondary)" }}>
        {complete ? (
          <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--cs-good)" }} strokeWidth={2} />
        ) : (
          <CircleDashed className="w-3.5 h-3.5" style={{ color: "var(--cs-warn)" }} strokeWidth={2} />
        )}
        <span>
          <strong style={{ color: "var(--cs-text-primary)" }}>
            {present} of {total}
          </strong>{" "}
          evidence sources contributed to this report.
        </span>
      </p>

      <ul className="m-0 p-0 list-none grid grid-cols-1 md:grid-cols-2 gap-1.5">
        {sources.map((source) => {
          const isPresent = source.status === "present";
          return (
            <li
              key={source.id}
              className="flex items-start gap-2 rounded-lg px-2.5 py-1.5"
              style={{ background: "var(--cs-surface-2)", border: "1px solid var(--cs-border-subtle)" }}
            >
              <span
                aria-hidden="true"
                className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background: isPresent ? "var(--cs-good)" : "transparent",
                  border: isPresent ? "none" : "1px solid var(--cs-text-muted)",
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-[11.5px] font-medium" style={{ color: "var(--cs-text-primary)" }}>
                    {source.label}
                  </span>
                  <span className="sr-only">{isPresent ? "— retrieved" : "— not retrieved"}</span>
                </span>
                <span className="block text-[10.5px] leading-snug" style={{ color: "var(--cs-text-muted)" }}>
                  {source.detail}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Structural context
// ---------------------------------------------------------------------------

interface StructuralContextProps {
  metadata?: any;
  foldingStatus?: string | null;
}

export const StructuralContext: React.FC<StructuralContextProps> = ({ metadata, foldingStatus }) => {
  const rows: Array<[string, string]> = [
    ["Model", metadata?.pdbId ? String(metadata.pdbId) : "—"],
    ["Source", metadata?.pdbSource ? String(metadata.pdbSource) : "—"],
    ["Residue", metadata?.residueIndex != null ? `#${metadata.residueIndex}` : "—"],
    ["Substitution", metadata?.wildType && metadata?.mutant ? `${metadata.wildType} → ${metadata.mutant}` : "—"],
  ];

  const hasModel = Boolean(metadata?.pdbId || metadata?.pdbSource);

  return (
    <div className="flex flex-col gap-2.5">
      {!hasModel ? (
        <p className="text-xs m-0" style={{ color: "var(--cs-text-muted)" }}>
          No macromolecular model is loaded for this variant, so structural reasoning is not part of
          this report. Open the <strong style={{ color: "var(--cs-text-secondary)" }}>3D Structure</strong> tab
          to retrieve or fold a model.
        </p>
      ) : null}

      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-[10.5px] uppercase tracking-wider font-mono m-0" style={{ color: "var(--cs-text-muted)" }}>
              {label}
            </dt>
            <dd className="text-[11.5px] font-mono m-0 tabular-nums" style={{ color: "var(--cs-text-primary)" }}>
              {value}
            </dd>
          </React.Fragment>
        ))}
      </dl>

      {foldingStatus ? (
        <p className="text-[10.5px] m-0" style={{ color: "var(--cs-text-muted)" }}>
          Mutant model status: <span className="font-mono">{foldingStatus}</span>
        </p>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Energetics
// ---------------------------------------------------------------------------

interface EnergeticsProps {
  result: any;
  formatDeltaG: (value: number | null | undefined) => string;
}

const ENERGETIC_ROWS: Array<{ key: string; label: string; note: string }> = [
  { key: "foldingDdG", label: "FoldX ΔΔG", note: "Protein stability change on mutation" },
  { key: "dynamut2", label: "DynaMut2 ΔΔG", note: "Consensus predictor stability change" },
  { key: "ddmut", label: "DDMut ΔΔG", note: "Deep-learning stability change" },
  { key: "thermompnn", label: "ThermoMPNN ΔΔG", note: "Graph-neural stability change" },
];

export const EnergeticsSummary: React.FC<EnergeticsProps> = ({ result, formatDeltaG }) => {
  const available = ENERGETIC_ROWS.filter(
    (row) => typeof result?.[row.key] === "number" && Number.isFinite(result[row.key])
  );

  if (!available.length) {
    return (
      <p className="text-xs m-0" style={{ color: "var(--cs-text-muted)" }}>
        No free-energy calculations are available for this variant. Run{" "}
        <strong style={{ color: "var(--cs-text-secondary)" }}>FoldX</strong> or{" "}
        <strong style={{ color: "var(--cs-text-secondary)" }}>DynaMut2</strong> from the 3D Structure
        tab to add biophysical evidence — this is what distinguishes a destabilising variant from a
        functionally disruptive one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
        {available.map((row) => (
          <li
            key={row.key}
            className="flex items-baseline justify-between gap-3 rounded-lg px-2.5 py-1.5"
            style={{ background: "var(--cs-surface-2)", border: "1px solid var(--cs-border-subtle)" }}
          >
            <span className="min-w-0">
              <span className="block text-[11.5px] font-medium" style={{ color: "var(--cs-text-primary)" }}>
                {row.label}
              </span>
              <span className="block text-[10.5px]" style={{ color: "var(--cs-text-muted)" }}>
                {row.note}
              </span>
            </span>
            <span
              className="shrink-0 text-[12px] font-mono font-semibold tabular-nums"
              style={{ color: "var(--cs-text-primary)" }}
            >
              {formatDeltaG(result[row.key])}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[10.5px] m-0 leading-relaxed" style={{ color: "var(--cs-text-muted)" }}>
        Positive ΔΔG indicates destabilisation. A variant can alter folding energetics without being
        pathogenic, and can be pathogenic without destabilising the fold.
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Bibliography
// ---------------------------------------------------------------------------

interface ReportBibliographyProps {
  gene: string;
  variant: string;
}

interface Citation {
  id: string;
  title: string;
  authors: string;
  journal: string;
  year: number | null;
}

/**
 * Bibliography is fetched lazily and only when its section is enabled, so it never delays the
 * report body. The previous design printed a "Scientific Literature Bibliography" checklist item
 * while never including any bibliography at all.
 */
export const ReportBibliography: React.FC<ReportBibliographyProps> = ({ gene, variant }) => {
  const { apiClient } = useApiClient();
  const [citations, setCitations] = useState<Citation[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!gene) return;
    setState("loading");
    setError(null);
    try {
      const data = await apiClient.getLiterature(gene, false, undefined, `${gene} ${variant} variant function`);
      setCitations(Array.isArray(data?.citations) ? data.citations.slice(0, 8) : []);
      setState("ready");
    } catch (err: any) {
      setError(err?.message || "Failed to load literature.");
      setState("error");
    }
  }, [apiClient, gene, variant]);

  useEffect(() => {
    if (gene) void load();
  }, [gene, load]);

  if (state === "loading") {
    return (
      <p className="text-xs m-0 flex items-center gap-2" style={{ color: "var(--cs-text-muted)" }}>
        <RefreshCw className="w-3 h-3 animate-spin" strokeWidth={2} />
        Retrieving indexed publications…
      </p>
    );
  }

  if (state === "error") {
    return (
      <p className="text-xs m-0" style={{ color: "var(--cs-text-muted)" }}>
        {error}{" "}
        <button
          type="button"
          onClick={() => void load()}
          className="underline cursor-pointer"
          style={{ color: "var(--cs-accent-clay)" }}
        >
          Retry
        </button>
      </p>
    );
  }

  if (!citations.length) {
    return (
      <p className="text-xs m-0" style={{ color: "var(--cs-text-muted)" }}>
        No indexed publications were retrieved for <span className="font-mono">{gene}</span>. Open the{" "}
        <strong style={{ color: "var(--cs-text-secondary)" }}>Literature</strong> tab to broaden the query.
      </p>
    );
  }

  return (
    <ol className="m-0 p-0 list-none flex flex-col gap-2">
      {citations.map((citation) => (
        <li key={citation.id} className="flex items-start gap-2.5">
          <BookOpen className="mt-[3px] w-3.5 h-3.5 shrink-0" style={{ color: "var(--cs-text-muted)" }} strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block text-[11.5px] leading-snug" style={{ color: "var(--cs-text-primary)" }}>
              {citation.title}
            </span>
            <span className="block text-[10.5px] mt-0.5" style={{ color: "var(--cs-text-muted)" }}>
              {[citation.authors, citation.journal, citation.year].filter(Boolean).join(" · ")}
              {citation.id ? (
                <a
                  href={`https://pubmed.ncbi.nlm.nih.gov/${citation.id}/`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="ml-1.5 inline-flex items-center gap-0.5 underline"
                  style={{ color: "var(--cs-accent-clay)" }}
                >
                  PMID {citation.id}
                  <ExternalLink className="w-2.5 h-2.5" strokeWidth={2} />
                </a>
              ) : null}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
};

// ---------------------------------------------------------------------------
// Compact header chips
// ---------------------------------------------------------------------------

export const VerdictChip: React.FC<{ verdict: string; tone: "pathogenic" | "benign" | "uncertain" | "none" }> = ({
  verdict,
  tone,
}) => {
  const palette = {
    pathogenic: { fg: "#B91C1C", bg: "color-mix(in srgb, #EF4444 10%, transparent)", dot: "#EF4444" },
    benign: { fg: "#15803D", bg: "color-mix(in srgb, #22C55E 10%, transparent)", dot: "#22C55E" },
    uncertain: { fg: "#B45309", bg: "color-mix(in srgb, #F59E0B 12%, transparent)", dot: "#F59E0B" },
    none: { fg: "var(--cs-text-muted)", bg: "var(--cs-surface-2)", dot: "var(--cs-text-muted)" },
  }[tone];

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold"
      style={{ background: palette.bg, color: palette.fg, border: `1px solid ${palette.dot}33` }}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: palette.dot }} />
      {verdict}
    </span>
  );
};

export const SynthesisProvenance: React.FC<{ model?: string | null; isAi: boolean }> = ({ model, isAi }) => {
  if (!isAi) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-mono font-medium"
      style={{
        background: "color-mix(in srgb, var(--cs-accent-clay) 10%, transparent)",
        color: "var(--cs-accent-clay)",
        border: "1px solid color-mix(in srgb, var(--cs-accent-clay) 24%, transparent)",
      }}
    >
      <Sparkles className="w-3 h-3" strokeWidth={2} />
      {model ? `AI synthesis · ${model}` : "AI synthesis"}
    </span>
  );
};
