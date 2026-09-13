import React from "react";
import {
  Activity,
  RefreshCw,
  Settings,
  Clock
} from "lucide-react";
import { useDiagnostics } from "../../hooks/useDiagnostics";
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
  latency?: number | string | null;
  tag?: string;
  onAction?: () => void;
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

  // 1. Ensembl VEP
  const ensemblHealth = diagnostics?.serviceHealth?.ensembl;
  const ensemblReady = Boolean(ensemblHealth?.healthy);
  const ensemblLatency = ensemblHealth?.latencyMs;
  const ensemblStatusText = !isLoaded && loading
    ? "Connecting…"
    : ensemblReady
    ? "REST Live"
    : ensemblHealth
    ? "Offline"
    : "Standby";

  // 2. AlphaGenome Atlas
  const alphagenomeHealth = diagnostics?.serviceHealth?.alphagenome;
  const alphagenomeReady = Boolean(alphagenomeHealth?.healthy);
  const alphagenomeLatency = alphagenomeHealth?.latencyMs;
  const alphagenomeStatusText = !isLoaded && loading
    ? "Connecting…"
    : alphagenomeReady
    ? "Bridge Active"
    : alphagenomeHealth
    ? "Standby"
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
      description: "Transcript & consequence mapping",
      statusText: ensemblStatusText,
      isReady: ensemblReady,
      latency: formatLatency(ensemblLatency)
    },
    {
      id: "alphagenome",
      name: "AlphaGenome Atlas",
      category: "compute",
      description: "DeepMind multimodal variant impact",
      statusText: alphagenomeStatusText,
      isReady: alphagenomeReady,
      latency: formatLatency(alphagenomeLatency)
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

  return (
    <div className={`flex flex-col h-full justify-between gap-3 text-cs-text-primary ${className}`}>
      {/* ── Top Bar: Title, Count, Ping & Configure Actions ── */}
      <div className="flex items-center justify-between pb-2 border-b border-[var(--cs-border-subtle)] shrink-0">
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
                : onlineCount === totalCount
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : onlineCount >= totalCount - 2
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
            }`}
            title={!isLoaded && loading ? "Checking service reachability and engines…" : `${onlineCount} of ${totalCount} services online and responsive`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                !isLoaded && loading
                  ? "bg-cs-accent-clay animate-pulse"
                  : onlineCount === totalCount
                  ? "bg-emerald-500"
                  : onlineCount >= totalCount - 2
                  ? "bg-amber-500"
                  : "bg-rose-500"
              }`}
            />
            {!isLoaded && loading ? "Checking…" : `${onlineCount}/${totalCount} Online`}
          </span>

          <button
            type="button"
            onClick={() => refresh()}
            disabled={loading}
            title="Ping all services & refresh telemetry"
            className="p-1 rounded-md text-cs-text-muted hover:text-cs-accent-clay hover:bg-cs-bg-subtle transition-all cursor-pointer disabled:opacity-50"
            aria-label="Ping all services"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-cs-accent-clay" : ""}`} />
          </button>

          <button
            type="button"
            onClick={() => handleConfigure("connections")}
            title="Open Connection Settings"
            className="p-1 rounded-md text-cs-text-muted hover:text-cs-accent-clay hover:bg-cs-bg-subtle transition-all cursor-pointer"
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
              onClick={svc.onAction}
              role={isClickable ? "button" : undefined}
              tabIndex={isClickable ? 0 : undefined}
              aria-label={isClickable ? `Configure ${svc.name} settings` : svc.name}
              onKeyDown={e => {
                if (isClickable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  svc.onAction?.();
                }
              }}
              className={`p-2 px-2.5 rounded-lg border transition-all flex items-center justify-between gap-2.5 select-none bg-[var(--cs-surface)] ${
                isClickable
                  ? "border-[var(--cs-border-subtle)] cursor-pointer hover:border-[var(--cs-accent-clay)]/70 hover:bg-[var(--cs-surface-2)] shadow-xs active:scale-[0.99] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cs-accent-clay)]"
                  : "border-[var(--cs-border-subtle)] hover:border-[var(--cs-border)]"
              }`}
            >
              {/* Left: Indicator Dot + Name + Subtitle */}
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    svc.isWarning
                      ? "bg-amber-500 animate-pulse"
                      : svc.isReady
                      ? "bg-emerald-500"
                      : "bg-slate-400"
                  }`}
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
                  <span className="text-[9.5px] text-cs-text-secondary truncate font-sans leading-tight">
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
                  className={`text-[9.5px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${
                    svc.isWarning
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                      : svc.isReady
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                      : "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20"
                  }`}
                >
                  {svc.statusText}
                </span>
                {isClickable && (
                  <span
                    className="p-1 rounded bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] hover:text-[var(--cs-accent-clay)] border border-[var(--cs-border-subtle)] transition-colors"
                    title={`Configure ${svc.name} settings`}
                  >
                    <Settings className="w-2.5 h-2.5" />
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
