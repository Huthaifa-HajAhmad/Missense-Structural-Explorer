import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  Check,
  Database,
  Dna,
  FlaskConical,
  KeyRound,
  LayoutGrid,
  Palette,
  RotateCcw,
  Search,
  SearchX,
  Settings2,
  SlidersHorizontal,
  X
} from "lucide-react";
import { useSettings, SettingsTabId } from "../../context/SettingsContext";
import { AppearanceSection } from "./sections/AppearanceSection";
import { ViewportSection } from "./sections/ViewportSection";
import { SequenceSection } from "./sections/SequenceSection";
import { AnalysisSection } from "./sections/AnalysisSection";
import { WorkspaceSection } from "./sections/WorkspaceSection";
import { ConnectionsSection } from "./sections/ConnectionsSection";
import { DataStorageSection } from "./sections/DataStorageSection";

const FOCUSABLE_SELECTOR =
  'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex="0"], [contenteditable]';

interface SectionConfig {
  id: SettingsTabId;
  label: string;
  description: string;
  group: "Display" | "Workflow" | "System";
  icon: React.ComponentType<{ className?: string }>;
  Component: React.ComponentType<{ onNavigateAbout?: () => void }>;
}

const SECTIONS: readonly SectionConfig[] = [
  { id: "appearance", group: "Display", label: "Appearance", description: "Theme, accent color, and accessibility.", icon: Palette, Component: AppearanceSection },
  { id: "viewport", group: "Display", label: "Viewport", description: "3D highlight color, camera, and rendering.", icon: SlidersHorizontal, Component: ViewportSection },
  { id: "sequence", group: "Display", label: "Sequence", description: "Ribbon coloring and residue window size.", icon: Dna, Component: SequenceSection },
  { id: "analysis", group: "Workflow", label: "Analysis", description: "Evidence weighting, default models, and simulation conditions.", icon: FlaskConical, Component: AnalysisSection },
  { id: "workspace", group: "Workflow", label: "Workspace", description: "Notifications and local search history.", icon: LayoutGrid, Component: WorkspaceSection },
  { id: "connections", group: "System", label: "Connections", description: "API keys, AI session, and server service status.", icon: KeyRound, Component: ConnectionsSection },
  { id: "data", group: "System", label: "Data & storage", description: "Backup, local caches, and lab-server storage.", icon: Database, Component: DataStorageSection }
] as const;

interface SearchableItem {
  id: string;
  sectionId: SettingsTabId;
  sectionLabel: string;
  title: string;
  description: string;
  keywords: string;
  /** data-setting-title of the row to scroll to and flash after navigating. */
  anchor: string;
}

const SEARCHABLE_SETTINGS: SearchableItem[] = [
  { id: "theme-mode", sectionId: "appearance", sectionLabel: "Appearance", title: "Color scheme", description: "Light, dark, or follow system theme", keywords: "theme dark light mode appearance", anchor: "Color scheme" },
  { id: "theme-accent", sectionId: "appearance", sectionLabel: "Appearance", title: "Workspace accent", description: "Tints selection highlights and interactive buttons app-wide", keywords: "accent color clay indigo purple rose emerald amber blue", anchor: "Workspace accent" },
  { id: "reduce-motion", sectionId: "appearance", sectionLabel: "Appearance", title: "Reduce motion", description: "Disables animations, transitions, and camera easing", keywords: "motion animation performance speed accessible", anchor: "Reduce motion" },
  { id: "high-contrast", sectionId: "appearance", sectionLabel: "Appearance", title: "High-contrast viewport", description: "Boosts residue color saturation and outline strength", keywords: "contrast vision neon bright accessible", anchor: "High-contrast viewport" },
  { id: "residue-color", sectionId: "viewport", sectionLabel: "Viewport", title: "Target residue highlight", description: "Color used to mark missense residue in 3D viewport", keywords: "residue color target 3d highlight sphere vibrant muted", anchor: "Target residue highlight" },
  { id: "camera-speed", sectionId: "viewport", sectionLabel: "Viewport", title: "Camera transition speed", description: "Snap, fast, balanced, or cinematic camera interpolation", keywords: "camera speed transition zoom snap cinematic", anchor: "Transition speed" },
  { id: "auto-zoom", sectionId: "viewport", sectionLabel: "Viewport", title: "Auto-zoom on selection", description: "Re-centers and zooms viewport onto selected residue", keywords: "zoom center focus selection residue", anchor: "Auto-zoom on selection" },
  { id: "3d-labels", sectionId: "viewport", sectionLabel: "Viewport", title: "3D residue labels", description: "Renders residue identity labels inside 3D viewport", keywords: "labels names text 3d residue molstar", anchor: "3D residue labels" },
  { id: "polar-contacts", sectionId: "viewport", sectionLabel: "Viewport", title: "Polar contacts & hydrogen bonds", description: "Draws hydrogen bonds and non-covalent interactions", keywords: "polar contacts bonds hydrogen interactions hbond", anchor: "Polar contacts" },
  { id: "seq-color", sectionId: "sequence", sectionLabel: "Sequence", title: "Residue color scheme", description: "Chemical properties, hydrophobicity gradient, or monochrome", keywords: "sequence ribbon track chemical hydrophobic monochrome amino acid", anchor: "Color scheme" },
  { id: "seq-slice", sectionId: "sequence", sectionLabel: "Sequence", title: "Ribbon slice size", description: "Number of residues visible per ribbon viewport (15, 21, 31, 41)", keywords: "slice size window length scroll ribbon", anchor: "Visible slice size" },
  { id: "acmg-model", sectionId: "analysis", sectionLabel: "Analysis", title: "ACMG weighting model", description: "Standard, conservative, or strict-structural evidence weights", keywords: "acmg classification pathogenicity clinical weighting hotspot pm1 ps3", anchor: "ACMG weighting model" },
  { id: "energy-unit", sectionId: "analysis", sectionLabel: "Analysis", title: "ΔΔG energy unit", description: "Stability free energy in kcal/mol or kJ/mol", keywords: "ddg delta delta g energy unit kcal kj mol stability", anchor: "ΔΔG energy unit" },
  { id: "default-structure", sectionId: "analysis", sectionLabel: "Analysis", title: "Default structure model", description: "AlphaFold2 or ESMFold as primary 3D source", keywords: "alphafold esmfold structure pdb model 3d", anchor: "Structure source" },
  { id: "perturbation-model", sectionId: "analysis", sectionLabel: "Analysis", title: "Default perturbation model", description: "SaProt, ESM-2, or ESMc sequence perturbation", keywords: "perturbation saprot esm2 esmc language model plm", anchor: "Perturbation model" },
  { id: "saprot-engine", sectionId: "analysis", sectionLabel: "Analysis", title: "SaProt inference engine", description: "Local CPU 650M, 35M, or Hugging Face cloud inference", keywords: "saprot engine cpu memory cloud hf tier", anchor: "SaProt execution tier" },
  { id: "simulation-conditions", sectionId: "analysis", sectionLabel: "Analysis", title: "Simulation conditions", description: "pH, temperature (°C), and ionic strength (mM) for FoldX", keywords: "ph temperature ionic conditions salt foldx simulation biophysics physiological", anchor: "Simulation conditions" },
  { id: "auto-alerts", sectionId: "workspace", sectionLabel: "Workspace", title: "Show alert banners automatically", description: "Raises warning and error banners as analysis arrives", keywords: "alerts notifications warnings banners", anchor: "Show alert banners automatically" },
  { id: "search-history-toggle", sectionId: "workspace", sectionLabel: "Workspace", title: "Save variant search history", description: "Stores recent queries locally (obfuscated at rest)", keywords: "history save recent queries privacy", anchor: "Save variant search history" },
  { id: "history-limit", sectionId: "workspace", sectionLabel: "Workspace", title: "History limit", description: "Maximum number of recent queries kept (5–50)", keywords: "history limit max items recent", anchor: "History limit" },
  { id: "gemini-key", sectionId: "connections", sectionLabel: "Connections", title: "Google Gemini API key", description: "Session token for AI clinical interpretation and literature synthesis", keywords: "gemini api key ai token llm clinical interpretation session", anchor: "Google Gemini API key" },
  { id: "app-token", sectionId: "connections", sectionLabel: "Connections", title: "Lab server API token", description: "Authorizes structural mutations and AlphaFold proxies", keywords: "app api token lab server credential auth", anchor: "Application / Lab API token" },
  { id: "forge-token", sectionId: "connections", sectionLabel: "Connections", title: "EvolutionaryScale Forge token", description: "ESM3 generative structural refinement", keywords: "esm3 forge evolutionaryscale biohub token", anchor: "EvolutionaryScale (Forge) token" },
  { id: "hf-token", sectionId: "connections", sectionLabel: "Connections", title: "Hugging Face access token", description: "GPN-Star, SaProt 650M, and ESM-2 inference", keywords: "hugging face hf token gpn saprot esm2 inference", anchor: "Hugging Face access token" },
  { id: "alphagenome-key", sectionId: "connections", sectionLabel: "Connections", title: "AlphaGenome Atlas API key", description: "Variant impact scoring and SHAP attributions", keywords: "alphagenome deepmind atlas avi shap splicing key", anchor: "AlphaGenome Atlas API key" },
  { id: "tamarind-key", sectionId: "connections", sectionLabel: "Connections", title: "Tamarind Bio API key", description: "Remote ThermoMPNN ΔΔG predictions", keywords: "tamarind thermompnn ddg stability remote key", anchor: "Tamarind Bio API key" },
  { id: "settings-backup", sectionId: "data", sectionLabel: "Data & storage", title: "Settings backup", description: "Export or import preferences JSON file", keywords: "export import backup json restore settings", anchor: "Settings backup" },
  { id: "clear-history", sectionId: "data", sectionLabel: "Data & storage", title: "Clear search history", description: "Remove locally stored variant queries", keywords: "clear delete history queries privacy local", anchor: "Search query history" },
  { id: "purge-cache", sectionId: "data", sectionLabel: "Data & storage", title: "Purge client & server caches", description: "Clear local variant snapshots and compute server caches", keywords: "cache clear purge delete storage disk memory server", anchor: "Pipeline registries" }
];

function isTypingTarget(el: Element | null) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

export default function SettingsDrawer({ onNavigateAbout }: { onNavigateAbout?: () => void }) {
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    settingsTab,
    setSettingsTab,
    resetSettingsToDefault,
    hasConfiguredGeminiKey,
    serverGeminiReady,
    settings
  } = useSettings();

  const reduceMotion = Boolean(settings?.reducedMotion);

  const drawerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const resetTimer = useRef<number | undefined>(undefined);

  // Latest values for the window-level key handler without re-binding it.
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  const activeIndex = useMemo(() => {
    const idx = SECTIONS.findIndex((section) => section.id === settingsTab);
    return idx >= 0 ? idx : 0;
  }, [settingsTab]);

  const activeSection = SECTIONS[activeIndex];
  const ActiveSection = activeSection.Component;

  // Search results filtered across title, description, and keywords
  const filteredSettings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return SEARCHABLE_SETTINGS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q) ||
        item.sectionLabel.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const groupedResults = useMemo(() => {
    if (!filteredSettings) return null;
    return SECTIONS.map((section) => ({
      section,
      items: filteredSettings.filter((item) => item.sectionId === section.id)
    })).filter((group) => group.items.length > 0);
  }, [filteredSettings]);

  // ── Open / close lifecycle: scroll lock, initial focus, focus restore ──
  useEffect(() => {
    if (!isSettingsOpen) {
      setSearchQuery("");
      setConfirmingReset(false);
      setPendingAnchor(null);
      window.clearTimeout(resetTimer.current);
      return;
    }

    openerRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusActive = () => {
      const current = drawerRef.current;
      if (!current || current.contains(document.activeElement)) return;
      const activeTab = current.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      (activeTab || current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR))?.focus();
    };
    focusActive();
    const frame = requestAnimationFrame(focusActive);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // First Escape clears an active search; the next one closes.
        if (searchQueryRef.current && document.activeElement === searchRef.current) {
          setSearchQuery("");
          e.preventDefault();
          return;
        }
        setIsSettingsOpen(false);
        return;
      }

      // "/" jumps to search from anywhere in the dialog (unless typing).
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !isTypingTarget(document.activeElement)) {
        searchRef.current?.focus();
        searchRef.current?.select();
        e.preventDefault();
        return;
      }

      if (e.key === "Tab" && drawerRef.current) {
        const focusable = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter(
          (el) =>
            el.tabIndex >= 0 &&
            !el.hasAttribute("disabled") &&
            (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus?.();
    };
  }, [isSettingsOpen, setIsSettingsOpen]);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  // Reset scroll to top whenever the section changes (unless a search jump will position it).
  const pendingAnchorRef = useRef(pendingAnchor);
  pendingAnchorRef.current = pendingAnchor;
  useEffect(() => {
    if (!pendingAnchorRef.current) panelRef.current?.scrollTo?.({ top: 0 });
  }, [settingsTab, searchQuery]);

  // After a search jump: scroll the target row into view, flash it, focus its control.
  useEffect(() => {
    if (!pendingAnchor || filteredSettings) return;
    let flashTimer: number | undefined;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const safe = pendingAnchor.replace(/["\\]/g, "\\$&");
      const target = panel.querySelector<HTMLElement>(`[data-setting-title="${safe}"]`);
      setPendingAnchor(null);
      if (!target) return;
      target.scrollIntoView?.({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      target.classList.add("settings-flash");
      flashTimer = window.setTimeout(() => target.classList.remove("settings-flash"), 1800);
      const control = target.querySelector<HTMLElement>(
        '[role="switch"], [role="radio"][aria-checked="true"], button[aria-pressed="true"], input, button'
      );
      control?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(flashTimer);
    };
  }, [pendingAnchor, filteredSettings, settingsTab, reduceMotion]);

  const goToSection = (id: SettingsTabId, anchor?: string) => {
    setSettingsTab(id);
    setSearchQuery("");
    setPendingAnchor(anchor ?? null);
  };

  const handleNavKeyDown = (e: React.KeyboardEvent) => {
    let next: number;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (activeIndex + 1) % SECTIONS.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (activeIndex - 1 + SECTIONS.length) % SECTIONS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = SECTIONS.length - 1;
    else return;

    goToSection(SECTIONS[next].id);
    const focusNext = () => {
      drawerRef.current?.querySelector<HTMLElement>(`#settings-tab-${SECTIONS[next].id}`)?.focus();
    };
    focusNext();
    requestAnimationFrame(focusNext);
    e.preventDefault();
  };

  const handleResetClick = () => {
    if (!confirmingReset) {
      setConfirmingReset(true);
      resetTimer.current = window.setTimeout(() => setConfirmingReset(false), 3000);
      return;
    }
    window.clearTimeout(resetTimer.current);
    setConfirmingReset(false);
    resetSettingsToDefault();
  };

  const spring = reduceMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 420, damping: 36, mass: 0.9 };
  const fade = reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.23, 1, 0.32, 1] as const };
  const HeaderIcon = filteredSettings ? Search : activeSection.icon;

  return createPortal(
    <AnimatePresence>
      {isSettingsOpen && (
        <>
          <motion.div
            key="settings-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
            onClick={() => setIsSettingsOpen(false)}
            className="settings-backdrop fixed inset-0 z-50 cursor-pointer"
            aria-hidden
          />

          <div
            key="settings-shell"
            className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-6 pointer-events-none"
          >
            <motion.div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-drawer-title"
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 4, transition: reduceMotion ? { duration: 0 } : { duration: 0.14 } }}
              transition={spring}
              className="settings-dialog pointer-events-auto relative flex flex-col md:flex-row w-full h-full md:max-w-[1000px] md:max-h-[min(700px,calc(100dvh-3rem))] md:rounded-2xl overflow-hidden"
            >
              {/* ════════ Sidebar ════════ */}
              <aside className="settings-sidebar flex flex-col shrink-0 md:w-[248px] border-b md:border-b-0 md:border-r border-cs-border-subtle">
                <div className="flex items-center gap-2.5 px-4 md:px-5 pt-4 md:pt-5 pb-3 pr-14 md:pr-5">
                  <div className="grid place-items-center w-8 h-8 rounded-lg bg-cs-accent-clay/12 text-cs-accent-clay shrink-0">
                    <Settings2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h2
                      id="settings-drawer-title"
                      className="text-[15px] font-semibold leading-tight tracking-tight text-cs-text-primary"
                    >
                      Settings
                    </h2>
                    <p className="text-[11.5px] leading-tight text-cs-text-muted truncate">Missense Structural Explorer</p>
                  </div>
                </div>

                {/* Search */}
                <div className="px-3 md:px-4 pb-2 md:pb-3">
                  <div className="settings-search relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-cs-text-muted pointer-events-none" />
                    <input
                      ref={searchRef}
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search settings…"
                      aria-label="Filter settings"
                      // focus-guard-allow: this ring lives in CSS — `.settings-search input:focus` in src/styles/settings.css draws a clay border plus a 3px box-shadow.
                      className="w-full h-9 text-[13px] rounded-lg pl-8.5 pr-9 text-cs-text-primary placeholder:text-cs-text-muted focus:outline-none [&::-webkit-search-cancel-button]:hidden"
                    />
                    {searchQuery ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery("");
                          searchRef.current?.focus();
                        }}
                        aria-label="Clear search"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 grid place-items-center w-6 h-6 rounded-md text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-bg-subtle cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <kbd
                        aria-hidden
                        className="hidden md:grid absolute right-2 top-1/2 -translate-y-1/2 place-items-center min-w-5 h-5 px-1 rounded border border-cs-border-subtle bg-cs-surface font-mono text-[10.5px] text-cs-text-muted"
                      >
                        /
                      </kbd>
                    )}
                  </div>
                </div>

                {/* Section nav */}
                <nav
                  role="tablist"
                  aria-label="Settings sections"
                  aria-orientation="vertical"
                  onKeyDown={handleNavKeyDown}
                  className="settings-nav flex md:flex-col gap-0.5 px-3 pb-3 md:pb-4 overflow-x-auto md:overflow-x-visible md:overflow-y-auto"
                >
                  {SECTIONS.map((section, index) => {
                    const Icon = section.icon;
                    const startsGroup = index === 0 || SECTIONS[index - 1].group !== section.group;
                    const selected = section.id === settingsTab;
                    const active = selected && !filteredSettings;
                    const hasStatusDot =
                      section.id === "connections" && (hasConfiguredGeminiKey || serverGeminiReady);

                    return (
                      <Fragment key={section.id}>
                      {startsGroup && (
                        <span
                          aria-hidden
                          className={`hidden md:block px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-cs-text-muted/80 ${
                            index === 0 ? "pt-1" : "pt-4"
                          }`}
                        >
                          {section.group}
                        </span>
                      )}
                      <button
                        id={`settings-tab-${section.id}`}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-controls="settings-panel"
                        tabIndex={selected ? 0 : -1}
                        onClick={() => goToSection(section.id)}
                        className={`settings-nav-item group relative flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-[13px] whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                          active
                            ? "text-cs-text-primary font-semibold"
                            : "text-cs-text-secondary font-medium hover:text-cs-text-primary hover:bg-cs-bg-subtle/70"
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="settings-nav-pill"
                            transition={spring}
                            aria-hidden
                            className="settings-nav-pill absolute inset-0 rounded-lg"
                          />
                        )}
                        <Icon
                          className={`relative w-4 h-4 shrink-0 transition-colors ${
                            active ? "text-cs-accent-clay" : "text-cs-text-muted group-hover:text-cs-text-secondary"
                          }`}
                        />
                        <span className="relative">{section.label}</span>
                        {hasStatusDot && (
                          <span
                            title="Connection active"
                            aria-label="Active"
                            className="relative ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)] shrink-0"
                          />
                        )}
                      </button>
                      </Fragment>
                    );
                  })}
                </nav>

                {/* Both footer bands share one 60px floor (nav note: 2 wrapped lines + py-2;
                    actions: 36px button + py-3), so the two bottom borders meet level across the
                    drawer. min-h, not h: a third wrapped line on a narrow nav grows the band
                    instead of clipping it. */}
                <div className="hidden md:flex mt-auto items-center gap-1.5 px-5 py-2 min-h-[60px] border-t border-cs-border-subtle text-[11.5px] text-cs-text-muted">
                  <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  Changes save automatically to this browser.
                </div>
              </aside>

              {/* ════════ Content ════════ */}
              <div className="settings-main flex flex-col flex-1 min-w-0 min-h-0">
                <header className="settings-main-header shrink-0 flex items-center gap-3 px-5 md:px-8 pt-4 md:pt-6 pb-4 border-b border-cs-border-subtle">
                  <div className="hidden sm:grid place-items-center w-9 h-9 rounded-xl bg-cs-accent-clay/10 text-cs-accent-clay shrink-0">
                    <HeaderIcon className="w-[18px] h-[18px]" />
                  </div>
                  <div className="min-w-0 pr-10">
                    <p className="text-[17px] font-semibold leading-tight tracking-tight text-cs-text-primary">
                      {filteredSettings ? "Search results" : activeSection.label}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-cs-text-muted truncate">
                      {filteredSettings
                        ? `${filteredSettings.length} setting${filteredSettings.length === 1 ? "" : "s"} found`
                        : activeSection.description}
                    </p>
                  </div>
                </header>

                <div
                  ref={panelRef}
                  id="settings-panel"
                  role="tabpanel"
                  aria-labelledby={filteredSettings ? undefined : `settings-tab-${settingsTab}`}
                  aria-label={filteredSettings ? "Search results" : undefined}
                  tabIndex={-1}
                  // focus-guard-allow: programmatic focus target (tabIndex={-1} on the panel) — a ring here would mark a surface the user never tabbed to.
                  className="settings-canvas flex-1 min-h-0 overflow-y-auto overscroll-contain focus:outline-none"
                >
                  <div className="px-4 md:pl-8 md:pr-6 py-5 md:py-7 max-w-[760px]">
                    {groupedResults ? (
                      groupedResults.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <div className="grid place-items-center w-11 h-11 rounded-full bg-cs-bg-subtle text-cs-text-muted mb-3">
                            <SearchX className="w-5 h-5" />
                          </div>
                          <p className="text-[13px] font-medium text-cs-text-primary">
                            No settings match &ldquo;{searchQuery}&rdquo;
                          </p>
                          <p className="mt-1 text-[12px] text-cs-text-muted">
                            Try a broader term like “color”, “cache”, or “token”.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-6">
                          {groupedResults.map(({ section, items }) => {
                            const Icon = section.icon;
                            return (
                              <section key={section.id}>
                                <h3 className="flex items-center gap-1.5 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-cs-text-muted">
                                  <Icon className="w-3.5 h-3.5" />
                                  {section.label}
                                </h3>
                                <div className="settings-card divide-y divide-cs-border-subtle">
                                  {items.map((item) => (
                                    <button
                                      key={item.id}
                                      type="button"
                                      aria-label={`Configure ${item.title} in ${item.sectionLabel}`}
                                      onClick={() => goToSection(item.sectionId, item.anchor)}
                                      className="group w-full flex items-center justify-between gap-4 px-4 py-3 text-left cursor-pointer hover:bg-cs-bg-subtle/50 focus-visible:bg-cs-bg-subtle/60 focus-visible:outline-none transition-colors"
                                    >
                                      <span className="min-w-0">
                                        <span className="block text-[13px] font-medium text-cs-text-primary">
                                          {item.title}
                                        </span>
                                        <span className="mt-0.5 block text-[12px] leading-snug text-cs-text-muted">
                                          {item.description}
                                        </span>
                                      </span>
                                      <span className="inline-flex items-center gap-1 shrink-0 text-[12px] font-medium text-cs-text-muted group-hover:text-cs-text-accent group-focus-visible:text-cs-text-accent transition-colors">
                                        Configure
                                        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </section>
                            );
                          })}
                        </div>
                      )
                    ) : (
                      <motion.div
                        key={settingsTab}
                        initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={fade}
                      >
                        <ActiveSection onNavigateAbout={onNavigateAbout} />
                      </motion.div>
                    )}
                  </div>
                </div>

                <footer className="settings-main-footer shrink-0 flex items-center justify-between gap-3 px-4 md:px-8 py-3 min-h-[60px] border-t border-cs-border-subtle">
                  <button
                    type="button"
                    onClick={handleResetClick}
                    className={`inline-flex items-center gap-1.5 h-8 px-2.5 -ml-2.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-colors active:scale-[0.97] ${
                      confirmingReset
                        ? "text-rose-600 dark:text-rose-400 bg-rose-500/10 ring-1 ring-inset ring-rose-500/30"
                        : "text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-bg-subtle"
                    }`}
                  >
                    {confirmingReset ? <Check className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    {confirmingReset ? "Confirm reset" : "Reset defaults"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(false)}
                    className="cs-btn-primary h-9 !px-5 active:scale-[0.97] transition-transform duration-150"
                  >
                    Done
                  </button>
                </footer>
              </div>

              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                aria-label="Close settings"
                className="absolute top-3.5 right-3.5 md:top-5 md:right-5 grid place-items-center w-8 h-8 rounded-lg text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-bg-subtle active:scale-[0.94] transition-all cursor-pointer z-10"
              >
                <X className="w-[18px] h-[18px]" />
              </button>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
