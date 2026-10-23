import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, KeyRound, X, Settings, Sun, Moon, PanelLeft, CircleHelp, Search, Link2, Check, WifiOff,
} from "lucide-react";
import { useSettings, SettingsTabId, LegacySettingsTabId } from "../context/SettingsContext";
import { useVariantAnalysisStore } from "../context/VariantAnalysisContext";
import { commandPaletteHint } from "../shared/platform";
import { isShareable, withVariantParams } from "../shared/shareLink";
import { CHROME_DIVIDER, HEADER_ICON_BUTTON } from "./ui/chrome";
import { VariantIdentity } from "./header/VariantIdentity";
import { useVariantHeaderModel, type VariantHeaderInput } from "./header/variantHeaderModel";
import { AccountMenu } from "./account/AccountMenu";
import { JobsMenu } from "./jobs/JobsMenu";

interface HeaderBarProps {
  isOffline: boolean;
  /** Narrow-viewport drawer trigger (App gates it via matchMedia). */
  showNavToggle?: boolean;
  /** The drawer's state, so the trigger can expose it (aria-expanded). Undefined in
      isolated renders; the attribute is only meaningful when the trigger is shown. */
  navDrawerOpen?: boolean;
  onToggleNavDrawer?: () => void;
  /** Opens the command palette, which owns the query line and every jump. */
  onOpenPalette?: () => void;
  error?: string | null;
  onDismissError?: () => void;
  /** Optional overrides — when omitted the bar reads SettingsContext directly. */
  isDark?: boolean;
  onToggleTheme?: () => void;
  onOpenSettings?: () => void;
  /** Opens the high-level onboarding walkthrough and API keys guide */
  onOpenOnboarding?: () => void;
  /**
   * The variant on screen, when the view is an analysis view. The bar then titles itself with the
   * variant's identity: it is the subject of the page, the sidebar says where you are, and the
   * page's H1 names the page.
   */
  variant?: VariantHeaderInput | null;
}

/** The variant's identity on the left when one is on screen, otherwise the labelled palette
 * trigger; global actions on the right. The header never names the page: the sidebar marks it and
 * the page's H1 titles it, so a breadcrumb was a third copy of the same words. */
export function HeaderBar({
  isOffline,
  showNavToggle = false,
  navDrawerOpen,
  onToggleNavDrawer,
  onOpenPalette,
  error,
  onDismissError,
  isDark: isDarkProp,
  onToggleTheme,
  onOpenSettings,
  onOpenOnboarding,
  variant: variantChrome = null,
}: HeaderBarProps) {
  let hasConfiguredGeminiKey = true;
  let showAiSetupNotice = true;
  let openSettingsTab = (_tab?: SettingsTabId | LegacySettingsTabId) => {};
  let isDark = isDarkProp ?? false;
  let toggleTheme = onToggleTheme ?? (() => {});

  try {
    const settings = useSettings();
    hasConfiguredGeminiKey = settings.hasConfiguredGeminiKey;
    showAiSetupNotice = !settings.settings?.narrativeMode || settings.settings.narrativeMode === "automatic";
    openSettingsTab = settings.openSettingsTab;
    // Props win when provided (e.g. isolated tests); context is the live source otherwise.
    if (isDarkProp === undefined) isDark = settings.isDark;
    if (onToggleTheme === undefined) toggleTheme = settings.toggleTheme;
    if (onOpenSettings === undefined) onOpenSettings = () => settings.setIsSettingsOpen(true);
  } catch {
    // Gracefully handle rendering when outside of SettingsProvider (e.g. isolated test environments)
  }

  const gene = useVariantAnalysisStore(s => s.gene ?? "");
  const variant = useVariantAnalysisStore(s => s.variant ?? "");
  const uniprotId = useVariantAnalysisStore(s => s.uniprotId ?? "");
  const canShare = isShareable({ gene, variant });

  /* Copy-link feedback: the icon turns into a check for 1.6s. Announced politely for AT. */
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);
  const copyLink = async () => {
    try {
      const href = withVariantParams(window.location.href, { gene, variant, uniprotId });
      await navigator.clipboard.writeText(href);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      console.warn("[Share] Could not copy link:", err);
    }
  };

  // Built unconditionally (hooks), rendered only when a variant is on screen.
  const variantModel = useVariantHeaderModel(
    variantChrome ?? { gene: "", variant: "", uniprotId: "", analysisResult: null }
  );
  const showIdentity = Boolean(variantChrome?.gene);
  /* One source for the chord label — the palette footer prints the same string. */
  const paletteHint = commandPaletteHint();
  const errorText = error?.replace(/^Error:\s*/i, "") ?? "";
  const errorIsKey = /unauthori[sz]ed|api key/i.test(errorText);

  const paletteTrigger = (prominent: boolean) => (
    <button
      type="button"
      onClick={onOpenPalette}
      className={prominent ? "header-search" : HEADER_ICON_BUTTON}
      data-palette-trigger
      title={`Search views or run a variant (${paletteHint})`}
      aria-label={`Search views or run a variant (${paletteHint})`}
      aria-keyshortcuts={paletteHint.includes("Ctrl") ? "Control+K" : "Meta+K"}
    >
      <Search className="w-4 h-4 shrink-0" />
      {prominent && <><span>Search views or run a variant</span><kbd className="cs-kbd">{paletteHint}</kbd></>}
    </button>
  );

  return (
    <header className="app-header" id="main-header">
      {/* ── Left: the variant on analysis views, otherwise the way to find one ──
          With a variant the zone takes twice the share of the free width and becomes a size
          container, so its identifiers can drop in order as the bar narrows (`.vid` rules). */}
      <div
        className={`flex items-center gap-2 min-w-0 basis-0 ${showIdentity ? "flex-[2_1_0%] vid-zone" : "flex-1"}`}
      >
        {showNavToggle && (
          <button
            type="button"
            onClick={onToggleNavDrawer}
            className={HEADER_ICON_BUTTON}
            title="Open navigation"
            aria-label="Open navigation"
            aria-expanded={navDrawerOpen ?? false}
            aria-controls={navDrawerOpen === undefined ? undefined : "main-navigation"}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
        {showIdentity ? <VariantIdentity model={variantModel} /> : paletteTrigger(true)}
      </div>

      {/* ── Right: state, then actions ── */}
      {/* Actions keep their intrinsic width; identity uses the remaining space. */}
      <div className="header-actions">
        {/* Notices first, so they sit next to the thing they are about (settings). */}
        {error && (
          <div
            role="alert"
            className="flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-[var(--cs-radius-input)] text-[12px] bg-[var(--cs-bg-danger)] text-[var(--cs-text-danger-on-soft)] max-w-[min(420px,34vw)]"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate" title={errorText}>{errorText}</span>
            {errorIsKey && (
              <button
                type="button"
                onClick={() => openSettingsTab("api")}
                className="shrink-0 px-1.5 h-5 rounded font-medium underline underline-offset-2 hover:no-underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
              >
                Configure
              </button>
            )}
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                className="relative cs-tap-44 shrink-0 w-5 h-5 inline-flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
                title="Dismiss notice"
                aria-label="Dismiss notice"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* An invitation, not a warning: analyses run without a key and the interpretation falls
            back to rule-based criteria, so this is neutral chrome rather than amber alarm. */}
        {(!hasConfiguredGeminiKey && showAiSetupNotice) && !errorIsKey && (
          <button
            type="button"
            onClick={() => openSettingsTab("connections")}
            data-tour="api-key-badge"
            title="No Gemini key: interpretations are rule-based. Add one in Settings for the written narrative."
            aria-label="Add a Gemini key"
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[var(--cs-radius-input)] border border-cs-border-subtle text-[12px] font-medium text-cs-text-secondary hover:text-cs-text-primary hover:bg-cs-bg-subtle cursor-pointer shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
          >
            <KeyRound className="w-3.5 h-3.5 shrink-0 text-cs-text-muted" />
            <span className="hidden lg:inline">Add Gemini key</span>
            <span className="lg:hidden">Key</span>
          </button>
        )}

        {/* No in-flight cue here at all. The labelled "Computing" was a third surface repeating
            the same fact as the pipeline rail and the submit button; its wordless spinner
            successor was a leftover nobody needed — a bare arc appearing alone in exactly this
            gap says nothing to a reader who is not already looking at the pipeline rail, which
            carries the stage list and the aria-live step line. The rail owns the progress
            story; the header keeps only notices and actions. */}
        {isOffline && (
          <span
            className="inline-flex items-center gap-1.5 h-7 px-2 rounded-[var(--cs-radius-input)] text-[12px] font-medium bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning-on-soft)] shrink-0"
            role="status"
          >
            <WifiOff className="w-3.5 h-3.5" />
            Offline
          </span>
        )}

        {/* The divider only separates notices from actions, so it exists only when there are notices. */}
        {(error || (!hasConfiguredGeminiKey && showAiSetupNotice) || isOffline) && (
          <span className={`${CHROME_DIVIDER} mx-1.5`} aria-hidden="true" />
        )}

        {showIdentity && paletteTrigger(false)}

        {canShare && (
          <button
            type="button"
            onClick={copyLink}
            className={HEADER_ICON_BUTTON}
            title={copied ? "Link copied" : `Copy link to ${gene} ${variant}`}
            aria-label={copied ? "Link copied" : `Copy link to ${gene} ${variant}`}
          >
            {copied ? <Check className="w-4 h-4 text-[var(--cs-text-success)]" /> : <Link2 className="w-4 h-4" />}
            <span className="sr-only" aria-live="polite">{copied ? "Link copied to clipboard" : ""}</span>
          </button>
        )}

        {onOpenOnboarding && (
          <button
            type="button"
            onClick={onOpenOnboarding}
            className={HEADER_ICON_BUTTON}
            title="Take the tour"
            aria-label="Take the tour"
          >
            <CircleHelp className="w-4 h-4" />
          </button>
        )}

        {/* Both glyphs stay mounted and cross-fade with a quarter turn, so the toggle reads as one
            control changing state rather than two different buttons swapping places. */}
        <button
          type="button"
          onClick={toggleTheme}
          className={HEADER_ICON_BUTTON}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          <Moon
            className={`absolute w-4 h-4 transition-[opacity,rotate] duration-200 ease-out ${isDark ? "opacity-0 -rotate-90" : "opacity-100 rotate-0"}`}
            aria-hidden="true"
          />
          <Sun
            className={`absolute w-4 h-4 transition-[opacity,rotate] duration-200 ease-out ${isDark ? "opacity-100 rotate-0" : "opacity-0 rotate-90"}`}
            aria-hidden="true"
          />
        </button>

        <button
          type="button"
          onClick={() => onOpenSettings?.()}
          className={HEADER_ICON_BUTTON}
          title="Settings"
          aria-label="Open settings"
          id="header-settings-btn"
          data-tour="settings-trigger"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* My jobs: the signed-in reader's queued and running calculations, with cancel. Renders
            nothing without an account (there is no "mine" to list). */}
        <JobsMenu />

        {/* Account: "Sign in", or the reader's initials and menu. Renders nothing until the workspace
            uses accounts, so a server still on AUTH_MODE=legacy looks exactly as before. */}
        <AccountMenu />
      </div>
    </header>
  );
}

export default React.memo(HeaderBar);
