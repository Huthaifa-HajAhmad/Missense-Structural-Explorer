import React, { useEffect, useRef, useState } from "react";
import {
  MasterView, MASTER_VIEW_ITEMS, EVIDENCE_SUB_ITEMS, STRUCTURE_SUB_ITEMS, isViewActive,
} from "./MasterSidebar";
import {
  AlertTriangle, KeyRound, X, Settings, Sun, Moon, PanelLeft, CircleHelp, Search, Link2, Check, WifiOff, ChevronRight,
} from "lucide-react";
import { useSettings, SettingsTabId, LegacySettingsTabId } from "../context/SettingsContext";
import { useVariantAnalysisStore } from "../context/VariantAnalysisContext";
import { commandPaletteHint } from "../shared/platform";
import { isShareable, withVariantParams } from "../shared/shareLink";
import { CHROME_DIVIDER, CHROME_ICON_BUTTON } from "./ui/chrome";
import { VariantIdentity } from "./header/VariantIdentity";
import { useVariantHeaderModel, type VariantHeaderInput } from "./header/variantHeaderModel";

interface HeaderBarProps {
  masterView: MasterView;
  isBiophysicalLoading: boolean;
  isOffline: boolean;
  /** The Evidence sub-tab on screen, so the breadcrumb can name the page and not just the section. */
  activeEvidenceTab?: string;
  /** Narrow-viewport drawer trigger (App gates it via matchMedia). */
  showNavToggle?: boolean;
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
   * The variant on screen, when the view is an analysis view. The bar then TITLES itself with the
   * variant's identity instead of a breadcrumb: on those views the variant is the subject of the page,
   * the sidebar already says where you are, and the page's H1 names the page.
   */
  variant?: VariantHeaderInput | null;
}

/**
 * The breadcrumb for the view on screen, read from the sidebar's own registries so the header and
 * the nav can never name the same place differently. A single "Evidence" only repeated the sidebar's
 * highlighted row; the sub-page ("Population data", "AlphaFold2") is the part the reader needs.
 */
export function viewCrumbs(view: MasterView, evidenceTab?: string): string[] {
  const section = MASTER_VIEW_ITEMS.find(item => isViewActive(item.id, view))?.label;
  if (!section) return [];
  const page =
    view === "evidence"
      ? EVIDENCE_SUB_ITEMS.find(item => item.id === evidenceTab)?.label
      : STRUCTURE_SUB_ITEMS.find(item => item.id === view)?.label;
  return page ? [section, page] : [section];
}

/* ──────────────────────────────────────────────────────────────────────────────────────────────
   Header layout — three zones on one 56px bar:

     [nav] Section › Page        [ 🔍 Search or run a variant…   Ctrl K ]          notices · ⎘ ? ☾ ⚙

   Left says WHERE you are, centre is the one way IN (the palette, now labelled — the bare "Ctrl K"
   chip it replaces told nobody what it opened), right is state and global actions. Every icon
   button is the same 32px control (`CHROME_ICON_BUTTON`), shared with the sidebar's toggle.
   ────────────────────────────────────────────────────────────────────────────────────────────── */

export function HeaderBar({
  masterView,
  isBiophysicalLoading,
  isOffline,
  activeEvidenceTab,
  showNavToggle = false,
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
  let openSettingsTab = (_tab?: SettingsTabId | LegacySettingsTabId) => {};
  let isDark = isDarkProp ?? false;
  let toggleTheme = onToggleTheme ?? (() => {});

  try {
    const settings = useSettings();
    hasConfiguredGeminiKey = settings.hasConfiguredGeminiKey;
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

  const crumbs = viewCrumbs(masterView, activeEvidenceTab);
  // Built unconditionally (hooks), rendered only when a variant is on screen.
  const variantModel = useVariantHeaderModel(
    variantChrome ?? { gene: "", variant: "", uniprotId: "", analysisResult: null }
  );
  const showIdentity = Boolean(variantChrome?.gene);
  /* One source for the chord label — the palette footer prints the same string. */
  const paletteHint = commandPaletteHint();
  const errorText = error?.replace(/^Error:\s*/i, "") ?? "";
  const errorIsKey = /unauthori[sz]ed|api key/i.test(errorText);

  return (
    <header className="app-header" id="main-header">
      {/* ── Left: the variant on analysis views, otherwise where you are ──
          With a variant the zone takes twice the share of the free width and becomes a size
          container, so its identifiers can drop in order as the bar narrows (`.vid` rules). */}
      <div
        className={`flex items-center gap-2 min-w-0 basis-0 ${showIdentity ? "flex-[2_1_0%] vid-zone" : "flex-1"}`}
      >
        {showNavToggle && (
          <button
            type="button"
            onClick={onToggleNavDrawer}
            className={CHROME_ICON_BUTTON}
            title="Open navigation"
            aria-label="Open navigation"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
        {/* Hidden on Search: the page's own H1 names it, and the header repeating it was the third
            copy of the same word on one screen. */}
        {showIdentity && <VariantIdentity model={variantModel} />}
        {!showIdentity && masterView !== "search" && crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex items-center gap-1.5 min-w-0 text-[13px]">
              {crumbs.map((crumb, i) => {
                const isCurrent = i === crumbs.length - 1;
                return (
                  <li key={crumb} className={`flex items-center gap-1.5 min-w-0 ${isCurrent ? "" : "shrink-0"}`}>
                    {i > 0 && <ChevronRight className="w-3.5 h-3.5 shrink-0 text-cs-text-muted" aria-hidden="true" />}
                    <span
                      className={isCurrent ? "font-medium text-cs-text-primary truncate" : "text-cs-text-muted"}
                      aria-current={isCurrent ? "page" : undefined}
                    >
                      {crumb}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
      </div>

      {/* ── Centre: the palette, labelled ──
          The chord is the fast path; this control exists so the palette is discoverable and has a
          visible name. Full field from `md`, icon-only below. */}
      <button
        type="button"
        onClick={onOpenPalette}
        className={`group hidden md:flex items-center gap-2 h-8 ${showIdentity ? "w-[clamp(180px,20vw,300px)]" : "w-[clamp(200px,32vw,420px)]"} min-w-0 shrink pl-2.5 pr-1.5 rounded-[var(--cs-radius-input)] border border-cs-border-subtle bg-cs-surface-2 text-cs-text-muted hover:border-cs-border hover:text-cs-text-secondary cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]`}
        title={`Open command palette (${paletteHint})`}
        aria-label={`Open command palette (${paletteHint})`}
        aria-keyshortcuts={paletteHint === "⌘K" ? "Meta+K" : "Control+K"}
      >
        <Search className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 text-left text-[12.5px] truncate">{showIdentity ? "Search or run…" : "Search views or run a variant…"}</span>
        <kbd className="cs-kbd">
          {paletteHint}
        </kbd>
      </button>

      {/* ── Right: state, then actions ── */}
      {/* `min-w-max`: the right zone may grow past its half of the bar (a long error, several notices)
          and push the palette narrower, but it can never overlap it. */}
      <div className="flex items-center justify-end gap-1 min-w-max flex-1 basis-0">
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
                className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]"
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
        {!hasConfiguredGeminiKey && !errorIsKey && (
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

        {/* A wordless in-flight cue. Everything that can say it already does — the pipeline rail,
            the stage rows, the submit button — so a labelled "Computing" here repeated them for a
            third surface. The bare spinner survives as quiet chrome for a reader whose eyes are
            away from the workspace, and it is decorative: the rail's aria-live step line carries
            the announcement. */}
        {isBiophysicalLoading && (
          <span className="inline-flex items-center h-7 px-2 shrink-0" aria-hidden="true">
            <span className="cs-spinner cs-spinner-sm" />
          </span>
        )}
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
        {(error || !hasConfiguredGeminiKey || isBiophysicalLoading || isOffline) && (
          <span className={`${CHROME_DIVIDER} mx-1.5`} aria-hidden="true" />
        )}

        {/* Palette, icon-only, below `md` where the labelled field is hidden. */}
        <button
          type="button"
          onClick={onOpenPalette}
          className={`${CHROME_ICON_BUTTON} md:hidden`}
          title={`Search (${paletteHint})`}
          aria-label="Search views or run a variant"
        >
          <Search className="w-4 h-4" />
        </button>

        {canShare && (
          <button
            type="button"
            onClick={copyLink}
            className={CHROME_ICON_BUTTON}
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
            className={CHROME_ICON_BUTTON}
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
          className={CHROME_ICON_BUTTON}
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
          className={CHROME_ICON_BUTTON}
          title="Settings"
          aria-label="Open settings"
          id="header-settings-btn"
          data-tour="settings-trigger"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}

export default React.memo(HeaderBar);
