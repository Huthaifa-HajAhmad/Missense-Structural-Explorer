import type { ProviderState } from "../../shared/providerStatus";
import { geminiCredentials } from "../../shared/geminiCredentials";
import { CHECKING_EXPLAIN, NOT_REPORTED_EXPLAIN, formatLatency, type ServiceCardContext, type ServiceStatusCard } from "./serviceCardModel";

export function alphagenomeCard(ctx: ServiceCardContext): ServiceStatusCard {
  const health = ctx.diagnostics?.serviceHealth?.alphagenome;
  const hasBrowserUrl = Boolean(ctx.settings.alphagenomeApiUrl?.trim());
  const keySource = health?.keySource;
  // The probe only sees the server's key. A key typed here is sent with each request but nothing has
  // checked it, so it is "Configured", and only an answering probe may say "Connected".
  const browserKey = Boolean(ctx.settings.alphagenomeApiKey?.trim()) && keySource !== "server";
  const configured = browserKey || hasBrowserUrl;
  const state: ProviderState = ctx.isChecking
    ? "checking"
    : health?.healthy
    ? "connected"
    : configured
    ? "configured"
    // `keySource: "none"` is a fact about setup, so that case stays not-configured.
    : (health && keySource !== "none") || ctx.noReadout
    ? "unreachable"
    : "not-configured";
  const source = health?.healthy
    ? "via server bridge"
    : browserKey
    ? "key set in this browser"
    : hasBrowserUrl
    ? "endpoint set in this browser"
    : state === "unreachable"
    ? "server bridge not answering"
    : null;
  return {
    id: "alphagenome",
    name: "AlphaGenome Atlas",
    category: "compute",
    description: source ? `DeepMind multimodal variant impact · ${source}` : "DeepMind multimodal variant impact",
    state,
    latency: formatLatency(health?.latencyMs),
    onAction: () => ctx.configure("connections"),
    explain: state === "checking"
      ? CHECKING_EXPLAIN
      : state === "unreachable"
      ? {
          heading: "Not answering",
          body:
            "Regulatory-impact scoring is unavailable: the server's connection to AlphaGenome did not " +
            "answer on the last check. This limits the Insights view only — every other view works " +
            "normally. Try again later, or check the connection settings."
        }
      : state === "connected"
      ? {
          heading: "Working normally",
          body:
            "Scores how a change is likely to affect regulatory activity, using DeepMind's " +
            "multimodal model. This feeds the Insights view; the rest of the app does not depend on it."
        }
      : state === "configured"
      ? {
          heading: "Set up, not yet checked",
          body:
            "Your setting is sent with each analysis, but nothing has tested it yet. If regulatory-impact " +
            "scores do not appear in Insights, check it with the connection test in Settings."
        }
      : {
          heading: "No API key connected",
          body:
            "Regulatory-impact scoring is switched off because no API key is connected. This " +
            "limits the Insights view only — every other view works normally. Add a key in " +
            "Settings to enable it."
        },
    // Named when it is why the row is set up, so a reader can tell their own key from the server's.
    detailRows: browserKey ? [{ label: "Key source", value: "API key configured (this browser)", tone: "ready" }] : undefined
  };
}

export function geminiCard(ctx: ServiceCardContext): ServiceStatusCard {
  const { serverKey, keyStored, sessionActive, sessionLapsed } = geminiCredentials(ctx.settings, ctx.serverGeminiReady, ctx.now);
  const minutesLeft = Math.max(0, Math.ceil(((ctx.settings.geminiSessionExpiresAt || 0) - ctx.now) / 60000));
  const needsRelink = ctx.authLost || sessionLapsed;
  const noKey = !serverKey && !keyStored && !sessionActive;
  // A refused or lapsed credential is degraded: the service exists but will not serve until relinked.
  const state: ProviderState = ctx.linking
    ? "checking"
    : needsRelink
    ? "degraded"
    : serverKey || sessionActive
    ? "connected"
    : keyStored
    ? "configured"
    : ctx.noReadout
    ? "unreachable"
    : "not-configured";
  const credential = ctx.linking
    ? "linking the stored key"
    : ctx.authLost
    ? "authorization refused, relink"
    : serverKey
    ? "server key"
    : sessionActive
    ? `session active, ${minutesLeft} min left`
    : sessionLapsed
    ? "session lapsed, relink"
    : keyStored
    ? "key stored in this browser"
    : "no key connected";
  return {
    id: "gemini",
    name: "Gemini Clinical AI",
    category: "compute",
    description: `${ctx.linkError && !ctx.linking ? `Relink failed: ${ctx.linkError}` : "DeepMind clinical ACMG interpretation"} · ${credential}`,
    state,
    localState: true,
    emphasis: needsRelink || noKey ? "needs-action" : undefined,
    actionLabel: ctx.linking ? "Linking the Gemini key…" : needsRelink ? "Relink the stored Gemini key now" : undefined,
    // A lapse with the key on file is fixed from here; anything else goes to Settings.
    onAction: needsRelink && keyStored && !ctx.linking
      ? () => ctx.linkGeminiKey()
      : () => ctx.configure(keyStored ? "api" : "connections"),
    explain: needsRelink
      ? {
          heading: "Your key needs reconnecting",
          body:
            "The stored key is no longer accepted, so written interpretations are paused. " +
            "Nothing has been lost — use the button below to reconnect with the same key."
        }
      : noKey
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
  };
}

export function foldxCard(ctx: ServiceCardContext): ServiceStatusCard {
  const ready = Boolean(ctx.diagnostics?.foldxReady);
  const detail = ctx.diagnostics?.foldxDetail;
  // Named apart, so "its parameter file is missing" does not send someone looking for a binary they have.
  const incomplete = !ready && detail?.binaryFound === true;
  const engine = ctx.capabilities?.engines?.find(e => e.id.startsWith("foldx_") && e.status === "ready");
  const state: ProviderState = ctx.isChecking
    ? "checking"
    : ready
    ? "connected"
    : incomplete
    ? "degraded"
    : ctx.noReadout
    ? "unreachable"
    : "not-configured";
  const base = "Empirical structural ΔΔG forcefield";
  return {
    id: "foldx",
    name: "FoldX Engine",
    category: "compute",
    description: state === "degraded"
      ? `${base} · installed, cannot run yet`
      : state === "not-configured" && ctx.isLoaded
      ? `${base} · not installed here`
      : base,
    state,
    emphasis: incomplete ? "needs-action" : undefined,
    tag: ready ? (engine?.id.includes("linux") ? "ELF x64" : "Windows EXE") : undefined,
    // No action: a server-side program that client Settings cannot install.
    explain: state === "checking"
      ? CHECKING_EXPLAIN
      : !ctx.isLoaded
      ? NOT_REPORTED_EXPLAIN
      : ready
      ? {
          heading: "Working normally",
          body:
            "Estimates a change in protein stability using an empirical energy function and " +
            "a structural model. This is a prediction, not a measured folding energy."
        }
      : incomplete
      ? {
          heading: "Installed, but cannot run yet",
          body: detail?.rotabasePresent === false
            ? "The FoldX program is present, but its parameter file (rotabase.txt) is missing " +
              "beside it, so the server cannot run it. Stability estimates that rely on it are " +
              "unavailable until the file is added. Everything else is unaffected."
            : detail?.box64Required && !detail.box64Present
            ? "The FoldX program is built for x86 and this server runs on ARM, so it needs Box64 " +
              "to run, and Box64 is not installed. Stability estimates that rely on it are " +
              "unavailable until it is. Everything else is unaffected."
            : "The FoldX program is present but the server cannot run it. Stability estimates " +
              "that rely on it are unavailable. Everything else is unaffected."
        }
      : {
          heading: "Not installed in this setup",
          body:
            "This engine runs as a separate program on the server, and it is not installed here. " +
            "Stability estimates that rely on it will be missing; any other stability engine " +
            "that is available still contributes, and the app says which ones did."
        }
  };
}

export function p2rankCard(ctx: ServiceCardContext): ServiceStatusCard {
  const ready = Boolean(ctx.diagnostics?.p2rankReady);
  const needsJava = !ready && ctx.diagnostics?.p2rankStatus === "unavailable";
  const java = ctx.diagnostics?.p2rankJavaVersion ? `Java ${ctx.diagnostics.p2rankJavaVersion.split(".")[0]}` : "Java 17+";
  const state: ProviderState = ctx.isChecking
    ? "checking"
    : ready
    ? "connected"
    : needsJava
    ? "degraded"
    : ctx.noReadout
    ? "unreachable"
    : "not-configured";
  const base = "ML ligand binding site detection";
  return {
    id: "p2rank",
    name: "P2Rank Pocket Engine",
    category: "compute",
    description: state === "connected"
      ? `${base} · ${java}`
      : state === "degraded"
      ? `${base} · Java 17+ missing`
      : state === "not-configured" && ctx.isLoaded
      ? `${base} · not installed here`
      : base,
    state,
    emphasis: needsJava ? "needs-action" : undefined,
    // No action: a server-side Java program, not something Settings can change.
    explain: state === "checking"
      ? CHECKING_EXPLAIN
      : !ctx.isLoaded
      ? NOT_REPORTED_EXPLAIN
      : ready
      ? {
          heading: "Working normally",
          body:
            "Predicts where other molecules are likely to bind on the protein surface, which " +
            "helps interpret whether a change sits in a functionally important spot."
        }
      : needsJava
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
  };
}
