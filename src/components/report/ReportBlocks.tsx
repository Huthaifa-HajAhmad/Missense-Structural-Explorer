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
  ExternalLink,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useApiClient } from "../../apiClient";
import type { EvidenceSource } from "./reportStatus";
import type { EnergeticsData } from "../../shared/contracts";
import { ACMG_SOURCE_LABEL } from "../../shared/acmgCriteriaView";

// ---------------------------------------------------------------------------
// Section shell
// ---------------------------------------------------------------------------

interface ReportSectionProps {
  id: string;
  title: string;
  /** Optional trailing summary shown collapsed, so the report still scans without expanding. */
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onToggle?: (open: boolean) => void;
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
  isOpen,
  onToggle,
  children,
}) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const toggle = useCallback(() => {
    if (onToggle) {
      onToggle(!open);
    } else {
      setInternalOpen((prev) => !prev);
    }
  }, [onToggle, open]);

  const panelId = `${id}-panel`;
  const buttonId = `${id}-button`;

  return (
    <section
      id={id}
      className="rounded-xl border overflow-hidden shrink-0 report-section"
      style={{ borderColor: "var(--cs-border-subtle)", background: "var(--cs-surface)" }}
    >
      <h2 className="m-0">
        <button
          id={buttonId}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left cursor-pointer transition-colors hover:bg-cs-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent-clay/50"
        >
          <span className="report-chevron" data-open={open} aria-hidden="true">
            <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
          </span>
          <span
            className="text-[11px] font-mono font-bold uppercase tracking-widest transition-colors"
            style={{ color: open ? "var(--cs-text-primary)" : "var(--cs-text-secondary)" }}
          >
            {title}
          </span>
          {meta ? <span className="ml-auto flex items-center gap-2 text-[10.5px]">{meta}</span> : null}
        </button>
      </h2>

      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        className="report-disclosure"
        data-open={open}
        inert={!open ? true : undefined}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-0.5">{children}</div>
        </div>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// ACMG evidence
// ---------------------------------------------------------------------------

interface AcmgEvidenceListProps {
  criteria: Array<{ code: string; reason?: string; source?: string }>;
}

/**
 * Provenance tags for a criterion, on the one vocabulary every surface uses.
 *
 * These read "database" / "AI" while the Insights rail read "Rule Engine" / "AI Inferred" and the
 * card between them read "DATABASE-VERIFIED" — one fact in three words, which is part of why the
 * rail's mislabelling survived review. See `shared/acmgCriteriaView.ts`.
 */
const SOURCE_LABEL: Record<string, { label: string; tone: string }> = {
  database_verified: { label: ACMG_SOURCE_LABEL.database_verified, tone: "var(--cs-good)" },
  ai_suggested: { label: ACMG_SOURCE_LABEL.ai_suggested, tone: "var(--cs-accent-clay)" },
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
  onNavigateSection?: (sectionId: string) => void;
}

export const EvidenceInventory: React.FC<EvidenceInventoryProps> = ({ sources, present, total, onNavigateSection }) => {
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
                <span className="flex items-baseline justify-between gap-1.5">
                  <span className="text-[11.5px] font-medium" style={{ color: "var(--cs-text-primary)" }}>
                    {source.label}
                  </span>
                  {source.feeds ? (
                    <a
                      href={`#report-${source.feeds}`}
                      onClick={(e) => {
                        if (onNavigateSection) {
                          e.preventDefault();
                          onNavigateSection(source.feeds);
                        }
                      }}
                      className="report-press text-[10px] font-mono hover:underline report-screen-only inline-flex items-center gap-0.5"
                      style={{ color: "var(--cs-accent-clay)" }}
                      title={`Jump to ${source.feeds} section`}
                    >
                      View section &rarr;
                    </a>
                  ) : null}
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
  energetics?: EnergeticsData | null;
  foldingDdG?: number | null;
  result?: any;
  formatDeltaG: (value: number | null | undefined) => string;
}

const ENERGETIC_ENGINES: Array<{
  id: string;
  label: string;
  note: string;
  getValue: (energetics?: EnergeticsData | null, foldingDdG?: number | null, result?: any) => number | null | undefined;
}> = [
  {
    id: "foldx",
    label: "FoldX ΔΔG",
    note: "Protein stability change on mutation (empirical force field)",
    getValue: (e, fd, r) => e?.foldx ?? e?.foldxMean ?? fd ?? r?.foldingDdG,
  },
  {
    id: "dynamut2",
    label: "DynaMut2 ΔΔG",
    note: "Normal mode & distance network consensus",
    getValue: (e, _, r) => e?.dynamut2 ?? r?.dynamut2,
  },
  {
    id: "ddmut",
    label: "DDMut ΔΔG",
    note: "Deep learning & graph-based stability",
    getValue: (e, _, r) => e?.ddmut ?? r?.ddmut,
  },
  {
    id: "thermompnn",
    label: "ThermoMPNN ΔΔG",
    note: "ProteinMPNN neural transfer embeddings",
    getValue: (e, _, r) => e?.thermompnn ?? r?.thermompnn,
  },
  {
    id: "rasp",
    label: "RaSP ΔΔG",
    note: "Rapid stability perturbation (Rosetta-trained CNN)",
    getValue: (e, _, r) => e?.rasp ?? r?.rasp,
  },
  {
    id: "stabilityoracle",
    label: "StabilityOracle ΔΔG",
    note: "3D Siamese Graphormer structural model",
    getValue: (e, _, r) => e?.stabilityoracle ?? r?.stabilityoracle,
  },
];

export const EnergeticsSummary: React.FC<EnergeticsProps> = ({ energetics, foldingDdG, result, formatDeltaG }) => {
  const available = ENERGETIC_ENGINES.map((eng) => ({
    ...eng,
    val: eng.getValue(energetics, foldingDdG, result),
  })).filter((eng) => typeof eng.val === "number" && Number.isFinite(eng.val));

  const hasConsensus = Boolean(energetics?.consensusVerdict);

  if (!available.length && !hasConsensus) {
    return (
      <div className="space-y-2">
        <p className="text-xs m-0" style={{ color: "var(--cs-text-muted)" }}>
          No free-energy calculations are available for this variant. Run{" "}
          <strong style={{ color: "var(--cs-text-secondary)" }}>FoldX</strong> or{" "}
          <strong style={{ color: "var(--cs-text-secondary)" }}>DynaMut2</strong> from the 3D Structure
          tab to add biophysical evidence — this is what distinguishes a destabilising variant from a
          functionally disruptive one.
        </p>
        {energetics?.pendingTools && energetics.pendingTools.length > 0 && (
          <div className="flex items-center gap-2 text-xs py-1.5 px-3 rounded-lg border border-dashed border-cs-border bg-cs-surface-2" style={{ color: "var(--cs-text-muted)" }}>
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-cs-accent-clay" strokeWidth={1.75} />
            <span>Calculations in progress: {energetics.pendingTools.join(", ")}</span>
          </div>
        )}
        {energetics?.foldxBinaryMissing && (
          <div className="flex items-center gap-2 text-xs py-1.5 px-3 rounded-lg border border-cs-border bg-cs-surface-2 text-cs-text-muted">
            <AlertTriangle className="w-3.5 h-3.5 text-cs-warn" strokeWidth={1.75} />
            <span>FoldX binary is not installed on the server host.</span>
          </div>
        )}
        {(energetics?.foldxRepairFailed || energetics?.foldxError) && (
          <div className="flex items-center gap-2 text-xs py-1.5 px-3 rounded-lg border border-cs-border bg-cs-surface-2 text-cs-text-muted">
            <AlertTriangle className="w-3.5 h-3.5 text-cs-warn" strokeWidth={1.75} />
            <span>{energetics.foldxError || "FoldX structure repair failed."}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Calibrated Thermodynamic Consensus Header */}
      {hasConsensus && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border"
          style={{
            background: "color-mix(in srgb, var(--cs-accent-clay) 8%, transparent)",
            borderColor: "color-mix(in srgb, var(--cs-accent-clay) 25%, transparent)",
          }}
        >
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider font-bold block" style={{ color: "var(--cs-accent-clay)" }}>
              Calibrated Thermodynamic Consensus
            </span>
            <span className="text-xs font-semibold" style={{ color: "var(--cs-text-primary)" }}>
              {energetics?.consensusVerdict}
            </span>
            {typeof energetics?.consensusProbability === "number" && Number.isFinite(energetics.consensusProbability) && (
              <span className="text-[11px] ml-2 font-mono" style={{ color: "var(--cs-text-muted)" }}>
                (P = {((energetics.consensusProbability as number) * 100).toFixed(0)}%)
              </span>
            )}
          </div>
          {typeof energetics?.consensusConfMin === "number" &&
            typeof energetics?.consensusConfMax === "number" &&
            Number.isFinite(energetics.consensusConfMin) &&
            Number.isFinite(energetics.consensusConfMax) && (
              <span
                className="text-[11px] font-mono font-medium px-2 py-1 rounded-md bg-cs-surface border border-cs-border-subtle"
                style={{ color: "var(--cs-text-secondary)" }}
              >
                95% CI: [{formatDeltaG(energetics.consensusConfMin)}, {formatDeltaG(energetics.consensusConfMax)}]
              </span>
            )}
        </div>
      )}

      {available.length > 0 && (
        <ul className="m-0 p-0 list-none grid grid-cols-1 sm:grid-cols-2 gap-2">
          {available.map((row) => (
            <li
              key={row.id}
              className="flex items-baseline justify-between gap-3 rounded-lg px-3 py-2"
              style={{ background: "var(--cs-surface-2)", border: "1px solid var(--cs-border-subtle)" }}
            >
              <span className="min-w-0">
                <span className="block text-[11.5px] font-medium" style={{ color: "var(--cs-text-primary)" }}>
                  {row.label}
                </span>
                <span className="block text-[10px] leading-snug" style={{ color: "var(--cs-text-muted)" }}>
                  {row.note}
                </span>
              </span>
              <span
                className="shrink-0 text-[12px] font-mono font-semibold tabular-nums"
                style={{ color: "var(--cs-text-primary)" }}
              >
                {formatDeltaG(row.val)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {energetics?.pendingTools && energetics.pendingTools.length > 0 && (
        <div className="flex items-center gap-2 text-xs py-1.5 px-3 rounded-lg border border-dashed border-cs-border bg-cs-surface-2" style={{ color: "var(--cs-text-muted)" }}>
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-cs-accent-clay" strokeWidth={1.75} />
          <span>Calculations in progress: {energetics.pendingTools.join(", ")}</span>
        </div>
      )}

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
  const [reloadTrigger, setReloadTrigger] = useState(0);

  useEffect(() => {
    let active = true;
    if (!gene) return;
    setState("loading");
    setError(null);
    apiClient
      .getLiterature(gene, false, undefined, `${gene} ${variant} variant function`)
      .then((data) => {
        if (!active) return;
        setCitations(Array.isArray(data?.citations) ? data.citations.slice(0, 8) : []);
        setState("ready");
      })
      .catch((err: any) => {
        if (!active) return;
        setError(err?.message || "Failed to load literature.");
        setState("error");
      });
    return () => {
      active = false;
    };
  }, [apiClient, gene, variant, reloadTrigger]);

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
          onClick={() => setReloadTrigger((t) => t + 1)}
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
    pathogenic: {
      fg: "var(--cs-text-danger-on-soft)",
      bg: "var(--cs-bg-danger)",
      border: "color-mix(in srgb, var(--cs-text-danger) 28%, transparent)",
      dot: "var(--cs-text-danger)",
    },
    benign: {
      fg: "var(--cs-text-success)",
      bg: "var(--cs-bg-success)",
      border: "color-mix(in srgb, var(--cs-text-success) 28%, transparent)",
      dot: "var(--cs-text-success)",
    },
    uncertain: {
      fg: "var(--cs-text-warning-on-soft)",
      bg: "var(--cs-bg-warning)",
      border: "color-mix(in srgb, var(--cs-text-warning) 28%, transparent)",
      dot: "var(--cs-text-warning)",
    },
    none: {
      fg: "var(--cs-text-muted)",
      bg: "var(--cs-surface-2)",
      border: "var(--cs-border)",
      dot: "var(--cs-text-muted)",
    },
  }[tone];

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold"
      style={{ background: palette.bg, color: palette.fg, border: `1px solid ${palette.border}` }}
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
