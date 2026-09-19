import React from "react";
import {
  Activity,
  RefreshCw,
  Settings,
  Clock
} from "lucide-react";
import { useDiagnostics, type FallbackVerdictKind } from "../../hooks/useDiagnostics";
import { useSettings } from "../../context/SettingsContext";

interface LiveTelemetryPanelProps {
  onConfigureClick?: (tab: "connections" | "api") => void;
  className?: string;
}

interface ServiceStatusCard {
  id: string;
  name: string;
  category: "genomic" | "compute" | "literature";
  description: string;
  statusText: string;
  isReady: boolean;
  isWarning?: boolean;
  /** Primary unreachable but its fallback tier is live: degraded, not broken. */
  isDegraded?: boolean;
  /** Every tier of this service's ladder answered that it cannot serve. */
  isDown?: boolean;
  /** Primary unreachable and coverage could not be determined — explicitly not an outage. */
  isUnknown?: boolean;
  latency?: number | string | null;
  tag?: string;
  /** Extra detail for the row's tooltip, e.g. how old a coverage verdict is. */
  detail?: string;
  /** Visible affordance for clickable rows, so the action is not discoverable only via AT. */
  actionIcon?: React.ReactNode;
  /** Overrides the default "Configure <name> settings" accessible label. */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Leading status dot. `isWarning` pulses because it marks a state the operator must act on
 * (a missing key); `isDegraded` and `isUnknown` deliberately do not, because neither needs
 * action — and a permanently pulsing dot beside a steady state competes with the one pulse
 * that means something.
 */
function statusDotClass(svc: ServiceStatusCard): string {
  if (svc.isDown) return "bg-rose-500";
  if (svc.isWarning) return "bg-amber-500 animate-pulse";
  if (svc.isDegraded) return "bg-amber-500";
  if (svc.isUnknown) return "bg-slate-400";
  if (svc.isReady) return "bg-emerald-500";
  return "bg-slate-400";
}

function statusPillClass(svc: ServiceStatusCard): string {
  if (svc.isDown) return "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30";
  if (svc.isWarning || svc.isDegraded) {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30";
  }
  if (svc.isReady) {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
  }
  return "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20";
}

export const LiveTelemetryPanel: React.FC<LiveTelemetryPanelProps> = ({
  onConfigureClick,
  className = ""
}) => {
  const { diagnostics, capabilities, loading, refresh } = useDiagnostics();
  const { settings, serverGeminiReady, openSettingsTab } = useSettings();

  const handleConfigure = (tab: "connections" | "api" = "connections") => {
    if (onConfigureClick) {
      onConfigureClick(tab);
    } else {
      openSettingsTab(tab);
    }
  };

  const isLoaded = Boolean(diagnostics);

  /**
   * 1. Ensembl VEP — the head of the coordinate-translation ladder.
   *
   * Ensembl is the primary tier of a two-tier resolver (Ensembl VEP -> VariantValidator,
   * see services/translation/coordinate-resolver.ts). Its health alone is therefore the
   * wrong thing to render: a dead Ensembl does NOT mean coordinate translation is down,
   * and the server only reports a `fallback` block once Ensembl has actually failed. Those
   * two facts give three distinct states, and collapsing them into one "Offline" pill is
   * what made a covered outage look identical to an uncovered one.
   */
  const ensemblHealth = diagnostics?.serviceHealth?.ensembl;
  const ensemblReady = Boolean(ensemblHealth?.healthy);
  const ensemblFallbackRaw = ensemblHealth?.fallback;
  /**
   * Validate the fallback block rather than trusting its shape.
   *
   * This is an unvalidated boundary: an older producer, a future one, or a hand-rolled payload
   * can send `{}`, a missing `name`, or a string `healthy`. Reading those naively turned an
   * empty block into a definitive "both tiers are unreachable" — the opposite of the truth —
   * and a missing name into the literal "undefined taking over" in a clinical readout.
   */
  const ensemblFallback =
    ensemblFallbackRaw && typeof ensemblFallbackRaw.healthy === "boolean" ? ensemblFallbackRaw : undefined;
  const fallbackVerdict: FallbackVerdictKind | null = ensemblFallback
    ? ensemblFallback.verdict ?? (ensemblFallback.healthy ? "ready" : "unavailable")
    : null;
  /** Primary down, tier 2 confirmed live: the ladder still answers, so this is degraded, not broken. */
  const ensemblDegraded = Boolean(ensemblHealth && !ensemblReady && fallbackVerdict === "ready");
  /** Primary down and tier 2 answered that it cannot: coordinate queries genuinely fail. */
  const ensemblUncovered = Boolean(ensemblHealth && !ensemblReady && fallbackVerdict === "unavailable");
  /**
   * Primary down and the probe could not tell — a timeout, an abort, a transport error. This is
   * deliberately NOT rendered as an outage: announcing "no provider reachable" and advising the
   * clinician to switch notation, on the strength of a probe that merely timed out, is a wrong
   * instruction about a provider that may answer real queries perfectly well.
   */
  const ensemblCoverageUnknown = Boolean(ensemblHealth && !ensemblReady && fallbackVerdict === "unknown");
  // While degraded, the latency that matters is the tier actually answering.
  const ensemblLatency = ensemblDegraded ? ensemblFallback?.latencyMs : ensemblHealth?.latencyMs;
  const ensemblStatusText = !isLoaded && loading
    ? "Connecting…"
    : ensemblReady
    ? "REST Live"
    : ensemblDegraded
    ? "Fallback Ready"
    : ensemblUncovered
    ? "No Fallback"
    : ensemblCoverageUnknown
    ? "Coverage Unknown"
    : ensemblHealth
    ? "Offline"
    : "Standby";
  const ensemblFallbackName = ensemblFallback?.name || "the fallback provider";
  const ensemblDescription = ensemblDegraded
    ? `${ensemblFallbackName} taking over`
    : ensemblUncovered
    ? "No provider reachable — use p.Glu433Lys style notation"
    : ensemblCoverageUnknown
    ? "Fallback not verified — coordinate queries may still work"
    : "Transcript & consequence mapping";
  /** Age of the coverage verdict, so an old claim is not presented as a current one. */
  const ensemblCoverageTitle = ensemblFallback
    ? [
        ensemblFallback.message,
        typeof ensemblFallback.ageMs === "number" && ensemblFallback.ageMs >= 0
          ? `verified ${Math.round(ensemblFallback.ageMs / 1000)}s ago`
          : null,
        ensemblFallback.stale ? "no longer current" : null,
      ]
        .filter(Boolean)
        .join(" — ")
    : undefined;

  // 2. AlphaGenome Atlas
  const alphagenomeHealth = diagnostics?.serviceHealth?.alphagenome;
  const hasClientAlphaGenome = Boolean(
    (settings.alphagenomeApiKey && settings.alphagenomeApiKey.trim().length > 0) ||
    (settings.alphagenomeApiUrl && settings.alphagenomeApiUrl.trim().length > 0)
  );
  const alphagenomeReady = Boolean(alphagenomeHealth?.healthy || hasClientAlphaGenome);
  const alphagenomeLatency = alphagenomeHealth?.latencyMs;
  const alphagenomeStatusText = !isLoaded && loading
    ? "Connecting…"
    : alphagenomeHealth?.healthy
    ? "Bridge Active"
    : hasClientAlphaGenome
    ? "Key Ready"
    : "Standby";

  // 3. MyVariant.info & dbNSFP
  const myvariantHealth = diagnostics?.serviceHealth?.myvariant;
  const dbnsfpHealth = diagnostics?.serviceHealth?.dbnsfp;
  const myvariantReady = Boolean(myvariantHealth?.healthy || dbnsfpHealth?.healthy);
  const myvariantLatency = myvariantHealth?.latencyMs ?? dbnsfpHealth?.latencyMs;
  const myvariantStatusText = !isLoaded && loading
    ? "Connecting…"
    : myvariantHealth?.healthy
    ? "REST Live"
    : dbnsfpHealth?.healthy
    ? "Local dbNSFP"
    : "Offline";

  // 4. NCBI ClinVar
  const clinvarHealth = diagnostics?.serviceHealth?.clinvar;
  const clinvarReady = Boolean(clinvarHealth?.healthy);
  const clinvarLatency = clinvarHealth?.latencyMs;
  const clinvarStatusText = !isLoaded && loading
    ? "Connecting…"
    : clinvarReady
    ? "E-Fetch Live"
    : "Offline";

  // 5. UniProtKB
  const uniprotHealth = diagnostics?.serviceHealth?.uniprot;
  const uniprotReady = Boolean(uniprotHealth?.healthy);
  const uniprotLatency = uniprotHealth?.latencyMs;
  const uniprotStatusText = !isLoaded && loading
    ? "Connecting…"
    : uniprotReady
    ? "API Live"
    : "Offline";

  // 6. Gemini Clinical AI
  const isGeminiSessionActive = Boolean(
    settings.geminiSessionId && Date.now() < (settings.geminiSessionExpiresAt || 0)
  );
  const geminiReady = serverGeminiReady || isGeminiSessionActive || Boolean(settings.geminiApiKey);
  const geminiWarning = !serverGeminiReady && !isGeminiSessionActive && !settings.geminiApiKey;
  const geminiStatusText = serverGeminiReady
    ? "Server Key Active"
    : isGeminiSessionActive
    ? "Session Active"
    : settings.geminiApiKey
    ? "Key Ready"
    : "Key Required";

  // 7. FoldX Biophysical Engine
  const foldxReady = Boolean(diagnostics?.foldxReady);
  const foldxEngineCap = capabilities?.engines?.find(
    e => e.id.startsWith("foldx_") && e.status === "ready"
  );
  const foldxTag = foldxReady
    ? foldxEngineCap?.id.includes("linux")
      ? "ELF x64"
      : "Windows EXE"
    : "Standby";

  // 8. P2Rank Pocket Engine
  const p2rankReady = Boolean(diagnostics?.p2rankReady);
  const p2rankJava = diagnostics?.p2rankJavaVersion
    ? `Java ${diagnostics.p2rankJavaVersion.split(".")[0]}`
    : "Java 17+";
  const p2rankStatusText = !isLoaded && loading
    ? "Checking…"
    : p2rankReady
    ? `${p2rankJava} Live`
    : diagnostics?.p2rankStatus === "unavailable"
    ? "Java 17+ Missing"
    : "Local Standby";
  const p2rankWarning = !p2rankReady && diagnostics?.p2rankStatus === "unavailable";

  // 9. Python ML Sidecar & Sovereign Cloud
  const sidecarHealth = diagnostics?.serviceHealth?.sidecar;
  const sidecarReady = Boolean(diagnostics?.modelServerReady || sidecarHealth?.healthy);
  const japanFoldCap = capabilities?.engines?.find(e => e.id === "japanfold");
  const isJapanFoldReady = japanFoldCap?.status === "ready";
  const sidecarStatusText = !isLoaded && loading
    ? "Checking…"
    : sidecarReady
    ? "Neural Sidecar Live"
    : isJapanFoldReady
    ? "JapanFold Sovereign"
    : "Standby / Cloud";
  const formatLatency = (ms?: number | null) => {
    if (typeof ms !== "number" || isNaN(ms) || ms < 0) return null;
    return ms < 1 ? "< 1ms" : `${Math.round(ms)}ms`;
  };

  const sidecarLatencyVal = sidecarHealth?.latencyMs ?? capabilities?.system?.sidecarLatencyMs;
  const sidecarLatency = formatLatency(sidecarLatencyVal);

  // 10. PubMed & Europe PMC
  const europePmcHealth = diagnostics?.serviceHealth?.europepmc;
  const europePmcReady = Boolean(europePmcHealth?.healthy);
  const europePmcLatency = europePmcHealth?.latencyMs;
  const europePmcStatusText = !isLoaded && loading
    ? "Connecting…"
    : europePmcReady
    ? "REST Live"
    : "Standby";

  const services: ServiceStatusCard[] = [
    {
      id: "ensembl",
      name: "Ensembl VEP",
      category: "genomic",
      description: ensemblDescription,
      statusText: ensemblStatusText,
      isReady: ensemblReady,
      isDegraded: ensemblDegraded,
      isDown: ensemblUncovered,
      isUnknown: ensemblCoverageUnknown,
      latency: formatLatency(ensemblLatency),
      detail: ensemblCoverageTitle,
      actionIcon: ensemblReady ? undefined : <RefreshCw className="w-3 h-3" />,
      // Only when the primary has failed: re-probing re-runs the whole ladder, including
      // the conditional fallback check, so the pill can flip back to REST Live.
      actionLabel: "Re-check Ensembl VEP and its fallback",
      onAction: ensemblReady ? undefined : () => refresh()
    },
    {
      id: "alphagenome",
      name: "AlphaGenome Atlas",
      category: "compute",
      description: "DeepMind multimodal variant impact",
      statusText: alphagenomeStatusText,
      isReady: alphagenomeReady,
      latency: formatLatency(alphagenomeLatency),
      onAction: () => handleConfigure("connections")
    },
    {
      id: "myvariant",
      name: "MyVariant.info & dbNSFP",
      category: "genomic",
      description: "REVEL, CADD, AlphaMissense, MetaRNN",
      statusText: myvariantStatusText,
      isReady: myvariantReady,
      latency: formatLatency(myvariantLatency)
    },
    {
      id: "clinvar",
      name: "NCBI ClinVar",
      category: "genomic",
      description: "Pathogenicity & VCV classifications",
      statusText: clinvarStatusText,
      isReady: clinvarReady,
      latency: formatLatency(clinvarLatency)
    },
    {
      id: "europepmc",
      name: "PubMed & Europe PMC",
      category: "literature",
      description: "Biomedical literature mining & citations",
      statusText: europePmcStatusText,
      isReady: europePmcReady,
      latency: formatLatency(europePmcLatency)
    },
    {
      id: "gemini",
      name: "Gemini Clinical AI",
      category: "compute",
      description: "DeepMind clinical ACMG interpretation",
      statusText: geminiStatusText,
      isReady: geminiReady,
      isWarning: geminiWarning,
      onAction: () => handleConfigure("api")
    },
    {
      id: "foldx",
      name: "FoldX Engine",
      category: "compute",
      description: "Empirical structural ΔΔG forcefield",
      statusText: foldxReady ? "Forcefield Live" : "Local Standby",
      isReady: foldxReady,
      tag: foldxTag,
      onAction: () => handleConfigure("connections")
    },
    {
      id: "p2rank",
      name: "P2Rank Pocket Engine",
      category: "compute",
      description: "ML ligand binding site detection",
      statusText: p2rankStatusText,
      isReady: p2rankReady,
      isWarning: p2rankWarning,
      onAction: () => handleConfigure("connections")
    },
    {
      id: "sidecar",
      name: "Neural Sidecar / JapanFold",
      category: "compute",
      description: "ThermoMPNN, SaProt & StabilityOracle",
      statusText: sidecarStatusText,
      isReady: sidecarReady || isJapanFoldReady,
      latency: sidecarLatency
    },
    {
      id: "uniprot",
      name: "UniProtKB",
      category: "genomic",
      description: "Functional domains & catalytic residues",
      statusText: uniprotStatusText,
      isReady: uniprotReady,
      latency: formatLatency(uniprotLatency)
    }
  ];

  const onlineCount = isLoaded ? services.filter(s => s.isReady).length : 0;
  const totalCount = services.length;
  /** Degraded services are covered by a live fallback, so the header should say so rather than just "not online". */
  const degradedServices = services.filter(s => s.isDegraded);
  const uncoveredServices = services.filter(s => s.isDown);
  const unknownServices = services.filter(s => s.isUnknown);
  const coverageNote = [
    ...degradedServices.map(s => `${s.name} offline — ${s.description}`),
    ...uncoveredServices.map(s => `${s.name} and its fallback are both unreachable`),
    ...unknownServices.map(s => `${s.name} offline and its fallback could not be verified`)
  ].join("; ");
  /**
   * A covered outage is degraded, not offline. Showing the plain online count made the header
   * contradict the row beneath it ("9/10 Online" amber next to "Fallback Ready"), and because
   * the rose threshold is totalCount - 2, one covered outage plus one unrelated failure flipped
   * the header to rose — a much louder claim than the facts support.
   */
  const coveredCount = services.filter(s => s.isDegraded).length;
  const counterLabel = coveredCount > 0
    ? `${onlineCount}/${totalCount} Online · ${coveredCount} on fallback`
    : `${onlineCount}/${totalCount} Online`;

  return (
    <div className={`flex flex-col h-full justify-between gap-3 text-cs-text-primary ${className}`}>
      {/* ── Top Bar: Title, Count, Ping & Configure Actions ── */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[var(--cs-accent-clay)]" />
          <h2 className="text-[13.5px] font-semibold tracking-tight" style={{ color: "var(--cs-text-primary)" }}>
            Service & Engine Telemetry
          </h2>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border flex items-center gap-1.5 ${
              !isLoaded && loading
                ? "bg-cs-surface-2 text-cs-text-muted border-cs-border-subtle"
                : uncoveredServices.length > 0
                ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20"
                : onlineCount === totalCount || coveredCount > 0 || unknownServices.length > 0
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
            }`}
            title={
              !isLoaded && loading
                ? "Checking service reachability and engines…"
                : coverageNote
                ? `${onlineCount} of ${totalCount} services online — ${coverageNote}`
                : `${onlineCount} of ${totalCount} services online and responsive`
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                !isLoaded && loading
                  ? "bg-cs-accent-clay animate-pulse"
                  : uncoveredServices.length > 0
                  ? "bg-rose-500"
                  : onlineCount === totalCount || coveredCount > 0 || unknownServices.length > 0
                  ? "bg-amber-500"
                  : "bg-emerald-500"
              }`}
            />
            {!isLoaded && loading ? "Checking…" : counterLabel}
          </span>

          <button
            type="button"
            onClick={() => refresh()}
            disabled={loading}
            title="Ping all services & refresh telemetry"
            className="min-w-6 min-h-6 p-1 inline-flex items-center justify-center rounded-md text-cs-text-muted hover:text-cs-accent-clay hover:bg-cs-bg-subtle transition-[color,background-color,scale] duration-150 ease-out cursor-pointer disabled:opacity-50 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
            aria-label="Ping all services"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-cs-accent-clay" : ""}`} />
          </button>

          <button
            type="button"
            onClick={() => handleConfigure("connections")}
            title="Open Connection Settings"
            className="min-w-6 min-h-6 p-1 inline-flex items-center justify-center rounded-md text-cs-text-muted hover:text-cs-accent-clay hover:bg-cs-bg-subtle transition-[color,background-color,scale] duration-150 ease-out cursor-pointer active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
            aria-label="Configure connection settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Services Grid / List ── */}
      <div className="flex-1 overflow-y-auto no-scrollbar space-y-1.5 pr-0.5">
        {services.map(svc => {
          const isClickable = Boolean(svc.onAction);
          return (
            <div
              key={svc.id}
              data-service-id={svc.id}
              onClick={svc.onAction}
              role={isClickable ? "button" : undefined}
              tabIndex={isClickable ? 0 : undefined}
              aria-label={isClickable ? (svc.actionLabel ?? `Configure ${svc.name} settings`) : svc.name}
              onKeyDown={e => {
                if (isClickable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  svc.onAction?.();
                }
              }}
              className={`min-h-[46px] px-3 py-2 rounded-lg border transition-[border-color,background-color,scale] duration-150 ease-out flex items-center justify-between gap-2.5 select-none bg-[var(--cs-surface)] ${
                svc.isDown
                  ? "border-rose-500/30 bg-rose-500/5 dark:bg-rose-950/10"
                  : svc.isDegraded
                  ? "border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/10"
                  : "border-[var(--cs-border-subtle)]"
              } ${
                isClickable
                  ? "cursor-pointer hover:border-[var(--cs-accent-clay)]/70 hover:bg-[var(--cs-surface-2)] shadow-xs active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
                  : "hover:border-[var(--cs-border)]"
              }`}
            >
              {/* Left: Indicator Dot + Name + Subtitle */}
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass(svc)}`}
                  aria-hidden="true"
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11.5px] font-semibold text-cs-text-primary truncate">
                      {svc.name}
                    </span>
                    {svc.tag && (
                      <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-cs-surface-2 text-cs-text-muted border border-cs-border-subtle">
                        {svc.tag}
                      </span>
                    )}
                  </div>
                  <span
                    className="text-[9.5px] text-cs-text-secondary truncate font-sans leading-tight"
                    title={svc.detail ?? svc.description}
                  >
                    {svc.description}
                  </span>
                </div>
              </div>

              {/* Right: Latency & Status Pill */}
              <div className="flex items-center gap-1.5 shrink-0">
                {svc.latency && (
                  <span className="text-[9px] font-mono text-cs-text-muted px-1.5 py-0.5 rounded bg-cs-surface-2 border border-cs-border-subtle flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5 opacity-60" />
                    {svc.latency}
                  </span>
                )}
                <span
                  className={`text-[9.5px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${statusPillClass(svc)}`}
                >
                  {svc.statusText}
                </span>
                {/* A clickable row must SAY what clicking does. Without this the Ensembl row's
                    only cue was its aria-label, so sighted users could not tell a re-check from
                    the "opens Settings" behaviour every other clickable row has. */}
                {svc.actionIcon && (
                  <span className="p-0.5 rounded text-cs-text-muted" aria-hidden="true">
                    {svc.actionIcon}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default React.memo(LiveTelemetryPanel);
