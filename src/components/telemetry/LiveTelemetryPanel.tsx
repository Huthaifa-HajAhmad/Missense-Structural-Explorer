import React, { useEffect, useState, useSyncExternalStore } from "react";
import {
  RefreshCw,
  Settings,
  ChevronRight,
  ChevronDown,
  ArrowRight
} from "lucide-react";
import { useDiagnostics, type FallbackVerdictKind } from "../../hooks/useDiagnostics";
import { useSettings } from "../../context/SettingsContext";
import { useApiConnections } from "../../hooks/useApiConnections";
import { getAuthLapse, subscribeAuthLapse } from "../../api/authSession";

interface LiveTelemetryPanelProps {
  onConfigureClick?: (tab: "connections" | "api") => void;
  className?: string;
}

/**
 * One "label — value" line inside an expanded row. `tone` drives its leading dot; `info` is for a
 * fact that is neither a state nor a value (a technical name, a caveat).
 */
interface ServiceDetailRow {
  label: string;
  value: string;
  tone?: "ready" | "warming" | "absent" | "info";
}

/**
 * The plain-language explanation shown when a row is expanded.
 *
 * Split from `statusText` on purpose: the collapsed row has room for three or four words beside a
 * dot, which is not enough to explain anything. Every row is therefore expandable, so a reader is
 * never left holding a status word with no way to find out what it means or whether they must act.
 */
interface ServiceExplanation {
  /** A short verdict in the reader's terms, not the engine's. */
  heading: string;
  /** What this means for the reader, and whether they need to do anything. */
  body: string;
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
  /**
   * Up but not yet serving — a cold start loading weights. Amber, steady, and counted as NOT
   * online: it is neither ready nor broken, and rendering it as either is a lie about whether the
   * next request will succeed.
   */
  isWarming?: boolean;
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
  /** Opens the row to reveal `explain` and `detailRows`. */
  explain?: ServiceExplanation;
  /** Per-component breakdown, rendered beneath the explanation. */
  detailRows?: ServiceDetailRow[];
}

/** Dot colour for an expanded detail line. Absent is deliberately the border token, not a warning. */
const DETAIL_DOT: Record<NonNullable<ServiceDetailRow["tone"]>, string> = {
  ready: "bg-[var(--cs-text-success)]",
  warming: "bg-[var(--cs-text-warning)]",
  absent: "bg-cs-border",
  info: "bg-cs-text-muted"
};

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
  // Warming sits below the pulse: an outage outranks a cold start, and a cold start outranks
  // "degraded but covered". Steady amber, because nothing here needs the reader's action.
  if (svc.isWarming) return "bg-[var(--cs-text-warning)]";
  if (svc.isDegraded) return "bg-[var(--cs-text-warning)]";
  if (svc.isUnknown) return "bg-cs-text-muted";
  if (svc.isReady) return "bg-[var(--cs-text-success)]";
  return "bg-cs-border";
}

/** Tinted chip for the states that need attention. Nominal states never reach this. */
function statusPillClass(svc: ServiceStatusCard): string {
  if (svc.isDown) return "bg-[var(--cs-bg-danger)] text-[var(--cs-text-danger-on-soft)]";
  if (svc.isWarning || svc.isDegraded || svc.isWarming) {
    return "bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning-on-soft)]";
  }
  return "bg-cs-surface-2 text-cs-text-secondary";
}

/** Ready with nothing to flag: rendered as quiet text rather than a coloured chip. */
function isNominal(svc: ServiceStatusCard): boolean {
  return (
    svc.isReady &&
    !svc.isWarning &&
    !svc.isDegraded &&
    !svc.isDown &&
    !svc.isUnknown &&
    !svc.isWarming
  );
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

  /**
   * Which row is open. One at a time, because the rail is narrow and two open explanations would
   * push every other service out of view — the reader would lose the list they came to read in
   * order to understand one entry in it.
   */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /**
   * A warming sidecar resolves itself, but nothing here needs to actively close an open
   * explanation: the copy is derived from the current probe on every render, so the panel flips to
   * the ready wording the moment the sidecar does. There is no latched state to go stale.
   */
  const toggleExpanded = (id: string) =>
    setExpandedId(prev => (prev === id ? null : id));

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
  /**
   * Cold start is its own state, and it is the one the rail used to have no word for.
   *
   * The sidecar answers `/health` with `status: "healthy"` from the moment uvicorn binds, up to
   * ~180 s before the weights it was spawned to load become usable (`sidecar-supervisor.ts` opens
   * exactly that grace window on spawn). `modelServerReady` counted that window as ready, so the
   * row wore a green dot and read "Neural Sidecar Live" while every ML-backed feature in it
   * failed — the reader was told the opposite of the truth, in the one place they would look to
   * check. Warming is now reported separately by both probes that can see it, and rendered as its
   * own state below: amber, counted as NOT online, and named.
   *
   * Warming is deliberately NOT `isWarning`: that tone pulses, and the panel reserves the pulse for
   * a state the operator must act on. A cold start needs no action — it resolves itself — so a
   * steady amber beside a lapsed-key pulse keeps the one pulse that means something.
   */
  const sidecarWarming =
    diagnostics?.modelServerState === "warming_up" ||
    sidecarHealth?.state === "warming_up" ||
    capabilities?.engines?.some(
      e => (e.id === "thermompnn" || e.id === "stabilityoracle") && e.status === "warming_up"
    ) === true;
  const sidecarReady =
    !sidecarWarming && Boolean(diagnostics?.modelServerReady || sidecarHealth?.healthy);
  const japanFoldCap = capabilities?.engines?.find(e => e.id === "japanfold");
  const isJapanFoldReady = japanFoldCap?.status === "ready";
  const sidecarStatusText = !isLoaded && loading
    ? "Checking…"
    : sidecarWarming
    ? "Starting up"
    : sidecarReady
    ? "Predictions ready"
    : isJapanFoldReady
    ? "JapanFold Sovereign"
    : "Standby / Cloud";
  const sidecarDescription = sidecarWarming
    ? "Some models are loading; check individual availability"
    : "ThermoMPNN, SaProt & StabilityOracle";
  /**
   * What the row means when opened, in words that assume no knowledge of what a sidecar is.
   *
   * The collapsed row has room for three words beside a dot, so it cannot say any of this — which
   * is exactly why it must be expandable. The three questions a non-specialist actually has are
   * answered in order: what is this, is it broken, and what do I do. "Cold start", "warming" and
   * "sidecar" appear nowhere; the technical name is kept as a quiet parenthetical for the reader
   * who does want it, which is the same pattern the rest of this app uses for method names.
   *
   * No progress estimate is offered. The sidecar reports only `warming_up` — not how far in, and
   * not how long remains — so any figure here would be invented, and an invented countdown is the
   * defect `doc/UNMAPPING_DEFECT_SPLICE_AUDIT.md` records: a banner that guessed its stage from
   * elapsed seconds and drew a fake progress bar.
   */
  const sidecarExplain: ServiceExplanation | undefined = sidecarWarming
    ? {
        heading: "Not broken — just starting up",
        body:
          "Some prediction models are loading into memory. This can happen when the service " +
          "starts; the service has not reported how long remains. You " +
          "can keep reading evidence and results now; stability and structure predictions will " +
          "become available as each model finishes loading successfully."
      }
    : sidecarReady
    ? {
        heading: "Ready",
        body:
          "The prediction service is responding. Check the model-specific status below for availability. Predictions run " +
          "on demand — the first one after startup may take a little longer than the rest."
      }
    : {
        heading: "Not running",
        body:
          "The local prediction service could not be reached on the last check. Local predictions " +
          "may be unavailable; cloud availability is listed below. Re-check the service status, " +
          "and check the connection settings if it remains unavailable."
      };
  /**
   * Per-model breakdown, taken only from what the server actually reported.
   *
   * `capabilities.engines[].status` is the sidecar's own per-model state, so this is the one place
   * a reader can see *which* model is still loading rather than just that "something" is. An engine
   * the server did not report is omitted rather than guessed at, so the list can be as short as
   * the technical name alone — the explanation above always stands on its own without it.
   */
  const sidecarDetailRows: ServiceDetailRow[] | undefined = (() => {
    const rows: ServiceDetailRow[] = [];
    const statusOf = (id: string) =>
      capabilities?.engines?.find(e => e.id === id)?.status;
    const engineRows: Array<[string, string]> = [
      ["thermompnn", "Stability prediction (ThermoMPNN)"],
      ["stabilityoracle", "Structure stability (StabilityOracle)"],
      ["saprot", "Structure-aware language model (SaProt)"]
    ];
    for (const [id, label] of engineRows) {
      const st = statusOf(id);
      if (!st) continue; // the server did not report this one; say nothing rather than guess
      rows.push({
        label,
        value:
          st === "ready" ? "Available" : st === "warming_up" ? "Still loading" : "Not available",
        tone: st === "ready" ? "ready" : st === "warming_up" ? "warming" : "absent"
      });
    }
    const jf = statusOf("japanfold");
    if (jf) {
      rows.push({
        label: "Cloud structure folding (JapanFold)",
        value: jf === "ready" ? "Available" : "Not available",
        tone: jf === "ready" ? "ready" : "absent"
      });
    }
    /**
     * The technical name, for the reader who wants it.
     *
     * Every plain phrase above had to avoid "sidecar", so the reader who meets that word in a log
     * line or a bug report needs somewhere to learn it means this row. `info` tone is a neutral
     * grey dot: it is a fact, not a state, and must not read as a fourth colour of health.
     */
    rows.push({
      label: "Technical name",
      value: "Python ML sidecar",
      tone: "info"
    });
    return rows.length > 0 ? rows : undefined;
  })();

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
      onAction: ensemblReady ? undefined : () => refresh(),
      explain: {
        heading: ensemblDegraded
          ? "Answered by a backup service"
          : ensemblUncovered
          ? "Not answering"
          : ensemblCoverageUnknown
          ? "Could not be determined"
          : "Working normally",
        body:
          "Translates the genomic position you searched for into the matching transcript and " +
          "protein change, and checks the coordinates against the genome build. " +
          (ensemblDegraded
            ? "The main service did not answer. A backup service responded to the health check; coverage for your specific variant still depends on that source."
            : ensemblUncovered
            ? "Searches that need this translation will not complete until it responds again. Anything already on screen is unaffected."
            : ensemblCoverageUnknown
            ? "The main service did not answer and the backup could not be checked either. This is not confirmed as an outage — trying again may well succeed."
            : "Genomic coordinates and protein changes are resolving normally.")
      }
    },
    {
      id: "alphagenome",
      name: "AlphaGenome Atlas",
      category: "compute",
      description: "DeepMind multimodal variant impact",
      statusText: alphagenomeStatusText,
      isReady: alphagenomeReady,
      latency: formatLatency(alphagenomeLatency),
      onAction: () => handleConfigure("connections"),
      explain: alphagenomeReady
        ? {
            heading: "Working normally",
            body:
              "Scores how a change is likely to affect regulatory activity, using DeepMind's " +
              "multimodal model. This feeds the Insights view; the rest of the app does not depend on it."
          }
        : {
            heading: "No API key connected",
            body:
              "Regulatory-impact scoring is switched off because no API key is connected. This " +
              "limits the Insights view only — every other view works normally. Add a key in " +
              "Settings to enable it."
          }
    },
    {
      id: "myvariant",
      name: "MyVariant.info & dbNSFP",
      category: "genomic",
      description: "REVEL, CADD, AlphaMissense, MetaRNN",
      statusText: myvariantStatusText,
      isReady: myvariantReady,
      latency: formatLatency(myvariantLatency),
      explain: {
        heading: myvariantReady ? "Working normally" : "Not answering",
        body: myvariantReady
          ? "Supplies the published computational predictor scores you see in Evidence — REVEL, " +
            "CADD, AlphaMissense and others. Each score keeps its own name and citation."
          : "The published predictor scores are unavailable, so the Predictors view will be empty " +
            "for now. A search or a retry may succeed — this is usually temporary."
      }
    },
    {
      id: "clinvar",
      name: "NCBI ClinVar",
      category: "genomic",
      description: "Pathogenicity & VCV classifications",
      statusText: clinvarStatusText,
      isReady: clinvarReady,
      latency: formatLatency(clinvarLatency),
      explain: {
        heading: clinvarReady ? "Working normally" : "Not answering",
        body: clinvarReady
          ? "Aggregates submitted clinical classifications of a variant. Submissions can disagree " +
            "or become outdated; review the condition, review status, dates and conflicts before " +
            "interpreting a classification. A ClinVar record does not by itself establish causality."
          : "Laboratory classifications are unavailable, so the Evidence view will not show how " +
            "this change has been classified elsewhere. Everything else still works."
      }
    },
    {
      id: "europepmc",
      name: "PubMed & Europe PMC",
      category: "literature",
      description: "Biomedical literature mining & citations",
      statusText: europePmcStatusText,
      isReady: europePmcReady,
      latency: formatLatency(europePmcLatency),
      explain: {
        heading: europePmcReady ? "Working normally" : "Not answering",
        body: europePmcReady
          ? "Finds published papers about this gene or change, with their citations. Results are " +
            "screened for relevance before they are shown."
          : "Literature search is unavailable, so the Literature view will be empty. The evidence " +
            "from every other source is unaffected."
      }
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
        : () => handleConfigure(keyLinkable ? "api" : "connections"),
      explain: sessionLapsed || authLost
        ? {
            heading: "Your key needs reconnecting",
            body:
              "The stored key is no longer accepted, so written interpretations are paused. " +
              "Nothing has been lost — click this line to reconnect with the same key."
          }
        : geminiWarning
        ? {
            heading: "Needs an API key",
            body:
              "Written clinical interpretations are switched off because no API key is connected. " +
              "All measured evidence, scores and structure still work. Add a key in Settings to " +
              "enable the written summaries."
          }
        : {
            heading: "Working normally",
            body:
              "Writes the plain-language interpretation that summarises the evidence you have " +
              "gathered. Generated summaries can contain errors, and proposed mechanisms are " +
              "hypotheses. Check each claim against the cited evidence."
          }
    },
    {
      id: "foldx",
      name: "FoldX Engine",
      category: "compute",
      description: "Empirical structural ΔΔG forcefield",
      statusText: foldxReady ? "Forcefield Live" : "Local Standby",
      isReady: foldxReady,
      tag: foldxTag,
      onAction: () => handleConfigure("connections"),
      explain: foldxReady
        ? {
            heading: "Working normally",
            body:
              "Estimates a change in protein stability using an empirical energy function and " +
              "a structural model. This is a prediction, not a measured folding energy."
          }
        : {
            heading: "Not installed in this setup",
            body:
              "This engine runs as a separate program on the server, and it is not installed here. " +
              "Stability estimates that rely on it will be missing; any other stability engine " +
              "that is available still contributes, and the app says which ones did."
          }
    },
    {
      id: "p2rank",
      name: "P2Rank Pocket Engine",
      category: "compute",
      description: "ML ligand binding site detection",
      statusText: p2rankStatusText,
      isReady: p2rankReady,
      isWarning: p2rankWarning,
      onAction: () => handleConfigure("connections"),
      explain: p2rankReady
        ? {
            heading: "Working normally",
            body:
              "Predicts where other molecules are likely to bind on the protein surface, which " +
              "helps interpret whether a change sits in a functionally important spot."
          }
        : p2rankWarning
        ? {
            heading: "Installed, but needs Java",
            body:
              "The pocket-detection program needs a Java runtime, which is missing or too old. " +
              "Binding-site predictions are unavailable until that is fixed. Everything else is unaffected."
          }
        : {
            heading: "Not installed in this setup",
            body:
              "The pocket-detection program is not installed on this server, so binding-site " +
              "predictions are unavailable. Other structural evidence still works."
          }
    },
    {
      id: "sidecar",
      name: "AI prediction models / JapanFold",
      category: "compute",
      description: sidecarDescription,
      statusText: sidecarStatusText,
      isReady: !sidecarWarming && (sidecarReady || isJapanFoldReady),
      isWarming: sidecarWarming,
      latency: sidecarLatency,
      explain: sidecarExplain,
      detailRows: sidecarDetailRows
    },
    {
      id: "uniprot",
      name: "UniProtKB",
      category: "genomic",
      description: "Functional domains & catalytic residues",
      statusText: uniprotStatusText,
      isReady: uniprotReady,
      latency: formatLatency(uniprotLatency),
      explain: {
        heading: uniprotReady ? "Working normally" : "Not answering",
        body: uniprotReady
          ? "Provides the protein's known functional regions and active sites, which is how the app " +
            "judges whether a change sits somewhere that matters. Domains and boundaries keep their " +
            "source and the residue numbers they were defined on."
          : "Functional regions and active sites are unavailable, so the app cannot yet say whether " +
            "this change falls inside a known functional region. Every other source of evidence is unaffected."
      }
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
   * A service that is still warming is counted out of the online total, so the header's bare
   * fraction would otherwise name a deficit with no cause. Naming it here is what stops the reader
   * from concluding that an ML engine is broken during a cold start — and stops them waiting for a
   * prediction that cannot arrive yet.
   */
  const warmingNote = services
    .filter(s => s.isWarming)
    .map(s => `${s.name} is still starting up`)
    .join("; ");

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
                : [coverageNote, warmingNote].filter(Boolean).length > 0
                ? `${onlineCount} of ${totalCount} services online — ${[coverageNote, warmingNote]
                    .filter(Boolean)
                    .join(" — ")}`
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
                const isExpandable = Boolean(svc.explain);
                const isOpen = expandedId === svc.id;
                const nominal = isNominal(svc);
                const slow = typeof svc.latency === "string" && parseInt(svc.latency, 10) >= 1000;
                /**
                 * A row may carry an action (re-check, open Settings), an explanation, or both.
                 * Native action and disclosure buttons are siblings with distinct names.
                 */
                const rowAction = svc.onAction;
                /**
                 * The row's own accessible name, and whether it is a control at all.
                 *
                 * The chevron is THE disclosure control: one role, one tab stop, one `aria-expanded`,
                 * and a name that says what it opens. The row header is only a wider hit target for
                 * the same action, never a second control — a row that is both a button and contains
                 * a button gives a keyboard user two tab stops for one thing, and nesting the two is
                 * invalid HTML.
                 *
                 * A native action button stretches over the row beside the disclosure button.
                 * A row with no action keeps no role
                 * even though it opens: `LiveTelemetryFallback.test.tsx` pins this for a healthy
                 * Ensembl row, and it is right — a row with nothing to do must not look like a control.
                 */
                const rowLabel = rowAction
                  ? (svc.actionLabel ?? `Configure ${svc.name} settings`)
                  : svc.name;
                return (
                  <div key={svc.id} className="flex flex-col">
                  <div
                    data-service-id={svc.id}
                    data-expanded={isExpandable ? (isOpen ? "true" : "false") : undefined}
                    onClick={
                      !rowAction && isExpandable
                        ? () => toggleExpanded(svc.id)
                        : undefined
                    }
                    className={`group relative flex items-center gap-2.5 px-3 py-1 min-h-[42px] select-none transition-colors duration-150 ${
                      svc.isDown
                        ? "bg-[var(--cs-bg-danger)]"
                        : svc.isDegraded || svc.isWarming
                        ? "bg-[var(--cs-bg-warning)]"
                        : ""
                    } ${
                      rowAction || isExpandable
                        ? "cursor-pointer hover:bg-cs-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cs-accent-clay)]"
                        : ""
                    }`}
                  >
                    {rowAction && <button type="button" aria-label={rowLabel}
                      onClick={rowAction}
                      className="absolute inset-0 rounded-[inherit] cursor-pointer active:bg-cs-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cs-accent-clay)]" />}
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
                      {rowAction && (
                        <span
                          className="text-cs-text-muted group-hover:text-cs-text-primary transition-colors duration-150"
                          aria-hidden="true"
                        >
                          {svc.actionIcon ?? (isExpandable ? <ArrowRight className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />)}
                        </span>
                      )}
                      {/* The disclosure affordance, only on a row that opens. A chevron that rotates
                          rather than a "+"/"−" pair: one glyph, and its orientation states which way
                          the panel will move.

                          It is a real <button> because that is the only way a keyboard reader gets a
                          control that is reachable and named. The name states what it opens and its
                          current state, which the row's own label cannot: on an action row the row's
                          label already names the action (re-check, open Settings), so a second
                          meaning there would announce the wrong thing. `stopPropagation` keeps the
                          chevron from also firing the row's own click. */}
                      {isExpandable && (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            toggleExpanded(svc.id);
                          }}
                          aria-label={`${isOpen ? "Hide" : "Show"} details for ${svc.name}`}
                          aria-expanded={isOpen}
                          className="relative z-10 cs-tap-44 w-7 h-7 -mr-1 inline-flex items-center justify-center rounded-[var(--cs-radius-input)] text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-bg-subtle active:bg-cs-surface-2 transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cs-accent-clay)]"
                        >
                          <ChevronDown
                            className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
                          />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── Expanded detail ── */}
                  {isExpandable && isOpen && (
                    <div
                      data-service-detail={svc.id}
                      className="px-3 pb-2.5 pt-0.5 flex flex-col gap-2 border-l-2 border-[var(--cs-accent-clay)] ml-[7px]"
                    >
                      <p className="text-[11.5px] font-medium text-cs-text-primary m-0">
                        {svc.explain!.heading}
                      </p>
                      <p className="text-[11.5px] leading-relaxed text-cs-text-secondary m-0">
                        {svc.explain!.body}
                      </p>
                      {svc.detailRows && svc.detailRows.length > 0 && (
                        <ul className="flex flex-col gap-1 m-0 p-0 list-none">
                          {svc.detailRows.map(row => (
                            <li key={row.label} className="flex items-baseline gap-2 min-w-0">
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 translate-y-[-1px] ${DETAIL_DOT[row.tone ?? "info"]}`}
                                aria-hidden="true"
                              />
                              <span className="text-[11px] text-cs-text-muted min-w-0 flex-1 leading-snug">
                                {row.label}
                              </span>
                              <span className="text-[11px] font-medium text-cs-text-secondary whitespace-nowrap">
                                {row.value}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {/* How current this reading is. A cold start resolves itself, so an
                          explanation with no timestamp cannot be distinguished from one the reader
                          opened three minutes ago and never closed. */}
                      {sweptAtLabel && (
                        <span className="text-[10.5px] text-cs-text-muted tabular-nums">
                          Checked at {sweptAtLabel}
                        </span>
                      )}
                    </div>
                  )}
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
