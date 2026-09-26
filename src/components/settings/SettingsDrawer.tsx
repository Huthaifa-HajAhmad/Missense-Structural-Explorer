import { useEffect, useMemo, useRef, useState } from "react";
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
  icon: React.ComponentType<{ className?: string }>;
  Component: React.ComponentType<{ onNavigateAbout?: () => void }>;
}

const SECTIONS: readonly SectionConfig[] = [
  { id: "appearance", label: "Appearance", icon: Palette, Component: AppearanceSection },
  { id: "viewport", label: "Viewport", icon: SlidersHorizontal, Component: ViewportSection },
  { id: "sequence", label: "Sequence", icon: Dna, Component: SequenceSection },
  { id: "analysis", label: "Analysis", icon: FlaskConical, Component: AnalysisSection },
  { id: "workspace", label: "Workspace", icon: LayoutGrid, Component: WorkspaceSection },
  { id: "connections", label: "Connections", icon: KeyRound, Component: ConnectionsSection },
  { id: "data", label: "Data & storage", icon: Database, Component: DataStorageSection }
] as const;

interface SearchableItem {
  id: string;
  sectionId: SettingsTabId;
  sectionLabel: string;
  title: string;
  description: string;
  keywords: string;
}

const SEARCHABLE_SETTINGS: SearchableItem[] = [
  { id: "theme-mode", sectionId: "appearance", sectionLabel: "Appearance", title: "Color scheme", description: "Light, dark, or follow system theme", keywords: "theme dark light mode appearance" },
  { id: "theme-accent", sectionId: "appearance", sectionLabel: "Appearance", title: "Workspace accent", description: "Tints selection highlights and interactive buttons app-wide", keywords: "accent color clay indigo purple rose emerald amber blue" },
  { id: "reduce-motion", sectionId: "appearance", sectionLabel: "Appearance", title: "Reduce motion", description: "Disables animations, transitions, and camera easing", keywords: "motion animation performance speed accessible" },
  { id: "high-contrast", sectionId: "appearance", sectionLabel: "Appearance", title: "High-contrast viewport", description: "Boosts residue color saturation and outline strength", keywords: "contrast vision neon bright accessible" },
  { id: "residue-color", sectionId: "viewport", sectionLabel: "Viewport", title: "Target residue highlight", description: "Color used to mark missense residue in 3D viewport", keywords: "residue color target 3d highlight sphere vibrant muted" },
  { id: "camera-speed", sectionId: "viewport", sectionLabel: "Viewport", title: "Camera transition speed", description: "Snap, fast, balanced, or cinematic camera interpolation", keywords: "camera speed transition zoom snap cinematic" },
  { id: "auto-zoom", sectionId: "viewport", sectionLabel: "Viewport", title: "Auto-zoom on selection", description: "Re-centers and zooms viewport onto selected residue", keywords: "zoom center focus selection residue" },
  { id: "3d-labels", sectionId: "viewport", sectionLabel: "Viewport", title: "3D residue labels", description: "Renders residue identity labels inside 3D viewport", keywords: "labels names text 3d residue molstar" },
  { id: "polar-contacts", sectionId: "viewport", sectionLabel: "Viewport", title: "Polar contacts & hydrogen bonds", description: "Draws hydrogen bonds and non-covalent interactions", keywords: "polar contacts bonds hydrogen interactions hbond" },
  { id: "seq-color", sectionId: "sequence", sectionLabel: "Sequence", title: "Residue color scheme", description: "Chemical properties, hydrophobicity gradient, or monochrome", keywords: "sequence ribbon track chemical hydrophobic monochrome amino acid" },
  { id: "seq-slice", sectionId: "sequence", sectionLabel: "Sequence", title: "Ribbon slice size", description: "Number of residues visible per ribbon viewport (15, 21, 31, 41)", keywords: "slice size window length scroll ribbon" },
  { id: "acmg-model", sectionId: "analysis", sectionLabel: "Analysis", title: "ACMG weighting model", description: "Standard, conservative, or strict-structural evidence weights", keywords: "acmg classification pathogenicity clinical weighting hotspot pm1 ps3" },
  { id: "energy-unit", sectionId: "analysis", sectionLabel: "Analysis", title: "ΔΔG energy unit", description: "Stability free energy in kcal/mol or kJ/mol", keywords: "ddg delta delta g energy unit kcal kj mol stability" },
  { id: "default-structure", sectionId: "analysis", sectionLabel: "Analysis", title: "Default structure model", description: "AlphaFold2 or ESMFold as primary 3D source", keywords: "alphafold esmfold structure pdb model 3d" },
  { id: "perturbation-model", sectionId: "analysis", sectionLabel: "Analysis", title: "Default perturbation model", description: "SaProt, ESM-2, or ESMc sequence perturbation", keywords: "perturbation saprot esm2 esmc language model plm" },
  { id: "saprot-engine", sectionId: "analysis", sectionLabel: "Analysis", title: "SaProt inference engine", description: "Local CPU 650M, 35M, or Hugging Face cloud inference", keywords: "saprot engine cpu memory cloud hf" },
  { id: "simulation-conditions", sectionId: "analysis", sectionLabel: "Analysis", title: "Simulation conditions", description: "pH, temperature (°C), and ionic strength (mM) for FoldX", keywords: "ph temperature ionic conditions salt foldx simulation biophysics" },
  { id: "auto-alerts", sectionId: "workspace", sectionLabel: "Workspace", title: "Show alert banners automatically", description: "Raises warning and error banners as analysis arrives", keywords: "alerts notifications warnings banners" },
  { id: "search-history-toggle", sectionId: "workspace", sectionLabel: "Workspace", title: "Save variant search history", description: "Stores recent queries locally (obfuscated at rest)", keywords: "history save recent queries privacy" },
  { id: "gemini-key", sectionId: "connections", sectionLabel: "Connections", title: "Google Gemini API key", description: "Session token for AI clinical interpretation and literature synthesis", keywords: "gemini api key ai token llm clinical interpretation" },
  { id: "settings-backup", sectionId: "data", sectionLabel: "Data & storage", title: "Settings backup", description: "Export or import preferences JSON file", keywords: "export import backup json restore settings" },
  { id: "purge-cache", sectionId: "data", sectionLabel: "Data & storage", title: "Purge client & server caches", description: "Clear local variant snapshots and compute server caches", keywords: "cache clear purge delete storage disk memory server" },
];

export default function SettingsDrawer({ onNavigateAbout }: { onNavigateAbout?: () => void }) {
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    settingsTab,
    setSettingsTab,
    resetSettingsToDefault,
    hasConfiguredGeminiKey,
    serverGeminiReady
  } = useSettings();

  const drawerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const resetTimer = useRef<number | undefined>(undefined);

  const activeIndex = useMemo(() => {
    const idx = SECTIONS.findIndex((section) => section.id === settingsTab);
    return idx >= 0 ? idx : 0;
  }, [settingsTab]);

  const ActiveSection = SECTIONS[activeIndex].Component;

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

  useEffect(() => {
    if (!isSettingsOpen) {
      setSearchQuery("");
      return;
    }

    openerRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusActive = () => {
      const activeTab = drawerRef.current?.querySelector<HTMLElement>(`#settings-tab-${settingsTab}`);
      (activeTab || drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR))?.focus();
    };
    focusActive();
    const frame = requestAnimationFrame(focusActive);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsSettingsOpen(false);
        return;
      }

      if (e.key === "Tab" && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
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
  }, [isSettingsOpen, setIsSettingsOpen, settingsTab]);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const handleNavKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") {
      return;
    }
    const direction = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    const next = (activeIndex + direction + SECTIONS.length) % SECTIONS.length;
    setSettingsTab(SECTIONS[next].id);
    const focusNext = () => {
      drawerRef.current
        ?.querySelector<HTMLElement>(`#settings-tab-${SECTIONS[next].id}`)
        ?.focus();
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

  return createPortal(
    <AnimatePresence>
      {isSettingsOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setIsSettingsOpen(false)}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 cursor-pointer"
            aria-hidden
          />

          <div className="fixed inset-0 z-50 flex justify-end pointer-events-none">
            <motion.div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-drawer-title"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="pointer-events-auto h-full w-[min(720px,94vw)] bg-cs-surface border-l border-cs-border shadow-2xl rounded-l-2xl flex flex-col overflow-hidden"
            >
              {/* ── Header with Instant Search & Close ── */}
              <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-cs-border bg-cs-surface-2 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="p-2 rounded-xl border shrink-0"
                    style={{
                      background: "rgba(196, 104, 73, 0.12)",
                      borderColor: "rgba(196, 104, 73, 0.25)"
                    }}
                  >
                    <SlidersHorizontal className="w-4 h-4 text-cs-accent-clay" />
                  </div>
                  <div className="min-w-0 hidden sm:block">
                    <h2
                      id="settings-drawer-title"
                      className="text-[14px] font-semibold tracking-tight text-cs-text-primary"
                    >
                      Settings
                    </h2>
                    <p className="text-[11px] text-cs-text-muted">
                      Changes apply instantly to this browser.
                    </p>
                  </div>
                </div>

                {/* Instant Search Bar */}
                <div className="relative flex-1 max-w-64 mx-2">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-cs-text-muted pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search settings…"
                    aria-label="Filter settings"
                    className="w-full text-[12px] bg-cs-surface border border-cs-border rounded-lg pl-8 pr-7 py-1 text-cs-text-primary placeholder:text-cs-text-muted focus:outline-none focus:border-cs-accent-clay transition-colors"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-cs-text-muted hover:text-cs-text-primary p-0.5 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  aria-label="Close settings"
                  className="w-8 h-8 rounded-lg border border-cs-border flex items-center justify-center text-cs-text-secondary hover:text-cs-text-primary hover:bg-cs-surface active:scale-[0.96] transition-all cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* ── Nav Rail + Content Area ── */}
              <div className="flex flex-col md:flex-row flex-1 min-h-0">
                <nav
                  role="tablist"
                  aria-label="Settings sections"
                  onKeyDown={handleNavKeyDown}
                  className="flex md:flex-col gap-1 p-2 shrink-0 border-b md:border-b-0 md:border-r border-cs-border-subtle bg-cs-surface-2 overflow-x-auto md:overflow-y-auto w-full md:w-48"
                >
                  {SECTIONS.map((section) => {
                    const Icon = section.icon;
                    const active = section.id === settingsTab && !filteredSettings;
                    const hasStatusDot = section.id === "connections" && (hasConfiguredGeminiKey || serverGeminiReady);

                    return (
                      <button
                        key={section.id}
                        id={`settings-tab-${section.id}`}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-controls="settings-panel"
                        tabIndex={active ? 0 : -1}
                        onClick={() => {
                          setSettingsTab(section.id);
                          setSearchQuery("");
                        }}
                        className={`relative flex items-center justify-between px-3 py-2 rounded-lg text-[12px] font-medium whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                          active
                            ? "bg-cs-surface text-cs-accent-clay font-semibold shadow-sm"
                            : "text-cs-text-secondary hover:text-cs-text-primary hover:bg-cs-surface/70"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {active && (
                            <span
                              aria-hidden
                              className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full hidden md:block"
                              style={{ background: "var(--cs-accent-clay)" }}
                            />
                          )}
                          <Icon className="w-4 h-4 shrink-0" />
                          <span>{section.label}</span>
                        </div>

                        {hasStatusDot && (
                          <span
                            title="Connection active"
                            aria-label="Active"
                            className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 ml-1.5"
                          />
                        )}
                      </button>
                    );
                  })}
                </nav>

                <div
                  id="settings-panel"
                  role="tabpanel"
                  aria-labelledby={filteredSettings ? undefined : `settings-tab-${settingsTab}`}
                  tabIndex={-1}
                  className="flex-1 overflow-y-auto px-5 py-5"
                >
                  {filteredSettings ? (
                    /* Search Results View */
                    <div className="space-y-4">
                      <div className="flex items-center justify-between pb-2 border-b border-cs-border-subtle">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-cs-accent-clay">
                          Search results
                        </span>
                        <span className="text-[11px] text-cs-text-muted">
                          {filteredSettings.length} setting{filteredSettings.length === 1 ? "" : "s"} found
                        </span>
                      </div>

                      {filteredSettings.length === 0 ? (
                        <div className="py-12 text-center text-cs-text-muted text-[12px]">
                          No settings matching &ldquo;{searchQuery}&rdquo;
                        </div>
                      ) : (
                        <div className="divide-y divide-cs-border-subtle">
                          {filteredSettings.map((item) => (
                            <div key={item.id} className="py-3 flex items-center justify-between gap-4">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px] font-medium text-cs-text-primary">
                                    {item.title}
                                  </span>
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-cs-border-subtle bg-cs-surface-2 text-cs-text-muted">
                                    {item.sectionLabel}
                                  </span>
                                </div>
                                <p className="text-[11px] text-cs-text-muted mt-0.5">
                                  {item.description}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setSettingsTab(item.sectionId);
                                  setSearchQuery("");
                                }}
                                className="cs-btn-ghost text-[11px] shrink-0 active:scale-[0.97]"
                              >
                                Configure
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Active Section View */
                    <motion.div
                      key={settingsTab}
                      initial={{ opacity: 0, y: 4, filter: "blur(2px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <ActiveSection onNavigateAbout={onNavigateAbout} />
                    </motion.div>
                  )}
                </div>
              </div>

              {/* ── Footer ── */}
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-cs-border bg-cs-surface-2 shrink-0">
                <button
                  type="button"
                  onClick={handleResetClick}
                  className={`cs-btn-ghost active:scale-[0.97] transition-all duration-150 ${
                    confirmingReset
                      ? "!text-rose-600 dark:!text-rose-400 !border-rose-500/40 !bg-rose-500/10"
                      : ""
                  }`}
                >
                  {confirmingReset ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5" />
                  )}
                  {confirmingReset ? "Confirm reset" : "Reset defaults"}
                </button>

                <div className="flex items-center gap-4">
                  <span className="text-[11px] text-cs-text-muted hidden sm:inline-flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    Auto-saved
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(false)}
                    className="cs-btn-primary active:scale-[0.97] transition-transform duration-150"
                  >
                    Done
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
