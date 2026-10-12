import React, { useEffect, useState, useSyncExternalStore } from "react";
import {
  RefreshCw,
  Settings,
  ChevronRight
} from "lucide-react";
import { useDiagnostics, type FallbackVerdictKind } from "../../hooks/useDiagnostics";
import { useSettings } from "../../context/SettingsContext";
import { useApiConnections } from "../../hooks/useApiConnections";
import { getAuthLapse, subscribeAuthLapse } from "../../api/authSession";

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
 *
 * Colours come from the semantic tokens in `variables.css` rather than raw Tailwind hues, so
 * they follow the theme (and print flattening) instead of running a second palette beside it.
 * The neutral is `--cs-text-muted`, a WARM grey: the Tailwind `slate` it replaces was a cool
 * blue-grey that clashed with the cream ramp.
 */
function statusDotClass(svc: ServiceStatusCard): string {
  if (svc.isDown) return "bg-[var(--cs-text-danger)]";
  if (svc.isWarning) return "bg-[var(--cs-text-warning)] animate-pulse";
  if (svc.isDegraded) return "bg-[var(--cs-text-warning)]";
  if (svc.isUnknown) return "bg-cs-text-muted";
  if (svc.isReady) return "bg-[var(--cs-text-success)]";
  return "bg-cs-border";
}

/** Tinted chip for the states that need attention. Nominal states never reach this. */
function statusPillClass(svc: ServiceStatusCard): string {
  if (svc.isDown) return "bg-[var(--cs-bg-danger)] text-[var(--cs-text-danger-on-soft)]";
  if (svc.isWarning || svc.isDegraded) {
    return "bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning-on-soft)]";
  }
  return "bg-cs-surface-2 text-cs-text-secondary";
}

/** Ready with nothing to flag: rendered as quiet text rather than a coloured chip. */
function isNominal(svc: ServiceStatusCard): boolean {
  return svc.isReady && !svc.isWarning && !svc.isDegraded && !svc.isDown && !svc.isUnknown;
}

export const LiveTelemetryPanel: React.FC<LiveTelemetryPanelProps> = ({
  onConfigureClick,
  className = ""
}) => {
  const { diagnostics, capabilities, loading, refresh } = useDiagnostics();
  const { settings, serverGeminiReady, openSettingsTab } = useSettings();
  const { linking, linkError, linkGeminiKey } = useApiConnections();

  /**
   * The Gemini row's session states move with the clock while nothing re-renders the panel. A
   * 15 s tick is what keeps "Session active · 12 min" counting down and what flips the row to
   * "expired" the moment the 15-minute session lapses — without it the row could claim an active
   * session for hours, which is precisely the lie that hid the expiry from the reader before.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const authLapse = useSyncExternalStore(subscribeAuthLapse, getAuthLapse, getAuthLapse);

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
    ? "E-utilities live"
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
  //
  // The session is a 15-minute token that renews only while queries flow; idle and it lapses
  // silently. The old derivation folded "had a session, and it died" into "Key Ready" with a
  // green dot — the exact state that hid an expiry from the reader until a background 401
  // surfaced in the dev console and nothing else. States that a click can fix from here relink
  // inline; states the reader can reach on their own stay in Settings.
  const isGeminiSessionActive = Boolean(
    settings.geminiSessionId && now < (settings.geminiSessionExpiresAt || 0)
  );
  const sessionMinutesLeft = Math.max(
    0,
    Math.ceil(((settings.geminiSessionExpiresAt || 0) - now) / 60000)
  );
  const keyLinkable = Boolean(settings.geminiApiKey?.trim());
  const sessionLapsed = keyLinkable && Boolean(settings.geminiSessionId) && !isGeminiSessionActive;
  // A refused authorization that survived re-auth, regardless of which credential it was.
  const authLost = authLapse !== null;
  // Ready means nothing needs a reader's action: a server environment key, a live session, or a
  // stored key that self-heals into one on the next query. A session that EXPIRED is different —
  // background calls with no route through a Gemini endpoint keep getting refused — so only
  // that, and a live auth refusal, wear the warning.
  const geminiReady = serverGeminiReady || isGeminiSessionActive || (keyLinkable && !sessionLapsed);
  const geminiWarning = authLost || sessionLapsed || (!serverGeminiReady && !keyLinkable && !isGeminiSessionActive);
  const geminiStatusText = linking
    ? "Linking…"
    : authLost
    ? "Authorization refused — Relink"
    : serverGeminiReady
    ? "Server Key Active"
    : isGeminiSessionActive
    ? `Session Active · ${sessionMinutesLeft} min`
    : sessionLapsed
    ? "Session Lapsed — Relink"
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
      actionIcon: ensemblReady ? undefined : <RefreshCw className="w-3.5 h-3.5" />,
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
      description: linkError && !linking
        ? `Relink failed: ${linkError}`
        : "DeepMind clinical ACMG interpretation",
      statusText: geminiStatusText,
      isReady: geminiReady,
      isWarning: geminiWarning,
      actionLabel:
        linking
          ? "Linking the Gemini key…"
          : sessionLapsed || authLost
          ? "Relink the stored Gemini key now"
          : undefined,
      /**
       * The row is the action. A lapsed session or a refused authorization needs no Settings
       * trip when the key is on file: a click re-runs the same link handshake Settings does,
       * and the row flips back to its counted-ready state. Anything the row cannot self-serve
       * keeps the old route into Settings.
       */
      onAction: (sessionLapsed || authLost) && keyLinkable && !linking
        ? () => linkGeminiKey()
        : () => handleConfigure(keyLinkable ? "api" : "connections")
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
    ? `${onlineCount}/${totalCount} online · ${coveredCount} on fallback`
    : `${onlineCount}/${totalCount} online`;

  /**
   * One tone for the summary, derived in one place.
   *
   * The previous header sent `onlineCount === totalCount` to AMBER, so the only fully healthy
   * state on the page wore the warning colour and green was reachable only when something was
   * NOT online — the tone was inverted for the case the reader sees most. Order matters: an
   * uncovered outage outranks everything, then any partial state, then all-clear.
   */
  const isChecking = !isLoaded && loading;
  const summaryTone: "checking" | "danger" | "warn" | "ok" = isChecking
    ? "checking"
    : uncoveredServices.length > 0
    ? "danger"
    : coveredCount > 0 || unknownServices.length > 0 || onlineCount < totalCount
    ? "warn"
    : "ok";
  const summaryLabel = isChecking
    ? "Checking services…"
    : summaryTone === "ok"
    ? `All ${totalCount} services online`
    : counterLabel;

  const groups: Array<{ id: string; label: string; items: ServiceStatusCard[] }> = [
    { id: "data", label: "Data sources", items: services.filter(s => s.category !== "compute") },
    { id: "compute", label: "Models & engines", items: services.filter(s => s.category === "compute") },
  ];

  /**
   * Sweep footer facts, both derived rather than tracked: the diagnostics payload carries the
   * sweep's own timestamp, and the slowest responder falls out of the latencies already on the
   * cards. This anchors the rail's bottom edge — the height-locked rail always has some slack
   * below the list, and an unanchored gap read as dead space; one settled line of facts makes
   * the same slack read as breathing room above a finished edge.
   */
  const sweptAtRaw = diagnostics?.timestamp ? new Date(diagnostics.timestamp) : null;
  const sweptAtLabel =
    sweptAtRaw && !isNaN(sweptAtRaw.getTime())
      ? sweptAtRaw.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : null;
  const slowestSweep = services
    .map(s => ({ name: s.name, ms: typeof s.latency === "string" ? parseInt(s.latency, 10) : NaN }))
    .filter(s => !isNaN(s.ms))
    .reduce<{ name: string; ms: number } | null>(
      (best, s) => (best === null || s.ms > best.ms ? s : best),
      null
    );

  return (
    <div className={`flex flex-col h-full gap-3 text-cs-text-primary ${className}`}>
      {/* ── Summary: one sentence, one tone, and the two actions ── */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="sr-only">Service status</h2>
          <span
            className={`inline-flex items-center gap-2 text-[12px] font-medium min-w-0 ${SUMMARY_TEXT[summaryTone]}`}
            title={
              isChecking
                ? "Checking service reachability and engines…"
                : coverageNote
                ? `${onlineCount} of ${totalCount} services online — ${coverageNote}`
                : `${onlineCount} of ${totalCount} services online and responsive`
            }
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${SUMMARY_DOT[summaryTone]}`} aria-hidden="true" />
            <span className="truncate">{summaryLabel}</span>
          </span>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => refresh()}
            disabled={loading}
            title="Re-check all services"
            className={ICON_BUTTON}
            aria-label="Ping all services"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => handleConfigure("connections")}
            title="Connection settings"
            className={ICON_BUTTON}
            aria-label="Configure connection settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Grouped service list ── */}
      {/* Scrolls inside the rail only where the rail is height-locked (lg+); stacked on small screens
          the list simply flows, since a nested scroller in a scrolling page is a trap. Paddings are
          kept to what the full list needs — a taller phantom bottom padding used to push the content
          a few pixels past the rail floor, so a scrollbar appeared (and a row was clipped) even with
          visible space left in the panel. The fade stays paired with that padding as the scroll cue. */}
      <div className="relative flex-1 min-h-0">
      <div className="flex flex-col gap-3 lg:absolute lg:inset-0 lg:overflow-y-auto lg:pb-3 [scrollbar-width:thin] lg:[mask-image:linear-gradient(to_bottom,black_calc(100%-12px),transparent)]">
        {groups.map(group => (
          <section key={group.id} aria-label={group.label} className="flex flex-col gap-1.5">
            <h3 className="px-1 text-[11px] font-medium text-cs-text-muted">{group.label}</h3>
            <div className="rounded-[var(--cs-radius-card)] border border-cs-border-subtle bg-cs-surface divide-y divide-cs-border-subtle overflow-hidden">
              {group.items.map(svc => {
                const isClickable = Boolean(svc.onAction);
                const nominal = isNominal(svc);
                const slow = typeof svc.latency === "string" && parseInt(svc.latency, 10) >= 1000;
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
                    className={`group flex items-center gap-2.5 px-3 py-1 min-h-[42px] select-none transition-colors duration-150 ${
                      svc.isDown
                        ? "bg-[var(--cs-bg-danger)]"
                        : svc.isDegraded
                        ? "bg-[var(--cs-bg-warning)]"
                        : ""
                    } ${
                      isClickable
                        ? "cursor-pointer hover:bg-cs-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cs-accent-clay)]"
                        : ""
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotClass(svc)}`} aria-hidden="true" />

                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[12.5px] font-medium text-cs-text-primary truncate">{svc.name}</span>
                        {svc.tag && (
                          <span className="text-[10.5px] font-mono text-cs-text-muted shrink-0">{svc.tag}</span>
                        )}
                      </div>
                      <span
                        className="text-[11px] text-cs-text-muted truncate leading-snug"
                        title={svc.detail ?? svc.description}
                      >
                        {svc.description}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {svc.latency && (
                        <span
                          className={`text-[11px] tabular-nums ${slow ? "text-[var(--cs-text-warning-on-soft)]" : "text-cs-text-muted"}`}
                          title={slow ? "Responding slowly" : "Last round-trip"}
                        >
                          {svc.latency}
                        </span>
                      )}
                      {/* Nominal states are quiet text; only a state that needs a reader's eye gets a
                          tinted chip. Ten identical green chips said one thing ten times. */}
                      <span
                        className={
                          nominal
                            ? "text-[11px] text-cs-text-secondary whitespace-nowrap"
                            : `text-[11px] font-medium px-1.5 py-0.5 rounded-[var(--cs-radius-badge)] whitespace-nowrap ${statusPillClass(svc)}`
                        }
                      >
                        {svc.statusText}
                      </span>
                      {/* A clickable row must SAY what clicking does. Without this the Ensembl row's
                          only cue was its aria-label, and the settings rows had no cue at all. */}
                      {isClickable && (
                        <span
                          className="text-cs-text-muted group-hover:text-cs-text-primary transition-colors duration-150"
                          aria-hidden="true"
                        >
                          {svc.actionIcon ?? <ChevronRight className="w-3.5 h-3.5" />}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      </div>

      {/* ── Sweep footer ── pinned to the panel's bottom edge, outside the scroll container, so it
          stays put on short viewports where the list scrolls above it. Quietest possible voice:
          11px muted, tabular figures, no chip — it is context, not a state. */}
      <div className="shrink-0 flex items-center justify-between gap-3 pt-2.5 border-t border-cs-border-subtle">
        <span
          className="text-[11px] text-cs-text-muted tabular-nums whitespace-nowrap"
          title="Time of the last service reachability sweep"
        >
          Last sweep {sweptAtLabel ?? "—"}
        </span>
        {slowestSweep && (
          <span
            className="text-[11px] text-cs-text-muted tabular-nums truncate"
            title={`${slowestSweep.name} answered slowest in the last sweep (${slowestSweep.ms}ms)`}
          >
            Slowest {slowestSweep.name} {slowestSweep.ms}ms
          </span>
        )}
      </div>
    </div>
  );
};

const ICON_BUTTON =
  "relative cs-tap-44 w-7 h-7 inline-flex items-center justify-center rounded-[var(--cs-radius-input)] text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-bg-subtle transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]";

const SUMMARY_TEXT = {
  checking: "text-cs-text-muted",
  danger: "text-[var(--cs-text-danger-on-soft)]",
  warn: "text-[var(--cs-text-warning-on-soft)]",
  ok: "text-cs-text-primary",
} as const;

const SUMMARY_DOT = {
  checking: "bg-cs-text-muted animate-pulse",
  danger: "bg-[var(--cs-text-danger)]",
  warn: "bg-[var(--cs-text-warning)]",
  ok: "bg-[var(--cs-text-success)]",
} as const;

export default React.memo(LiveTelemetryPanel);
