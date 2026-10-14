import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Command } from "cmdk";
import {
  BarChart2, Settings, Sun, Moon, History, Sparkles, Trash2, ArrowUpRight, Compass,
  Search, Layers, PanelLeft, SearchX,
} from "lucide-react";
import {
  MasterView,
  MASTER_VIEW_ITEMS,
  EVIDENCE_SUB_ITEMS,
  STRUCTURE_SUB_ITEMS,
  isViewActive,
  sidebarToggleHint,
} from "./MasterSidebar";
import { useSettings } from "../context/SettingsContext";
import {
  useVariantAnalysisActions,
  useVariantAnalysisStore,
} from "../context/VariantAnalysisContext";
import { parseVariantQuery } from "../shared/variantQuery";
import { commandPaletteHint } from "../shared/platform";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViewChange: (view: MasterView) => void;
  onEvidenceTabChange: (tab: string) => void;
  onSelectHistory: (item: { gene: string; variant: string; uniprotId: string }) => void;
  /**
   * The App-level submit handler, which closes over the analysis pipeline. The palette writes
   * the parsed fields into the store itself, but running has to go through this so the run is
   * wired to fetch/auth/settings the same way the Search tab's own form is.
   */
  onRunQuery: (e: React.FormEvent) => void;
  /** The view on screen — the matching row is badged `current` instead of being another jump. */
  activeView?: MasterView;
  /** The evidence sub-tab on screen, for the same reason. */
  activeEvidenceTab?: string;
  /** Open onboarding and workspace orientation guide */
  onOpenOnboarding?: () => void;
  /** Collapse/expand the sidebar (or open the drawer on narrow viewports). */
  onToggleSidebar?: () => void;
}

/**
 * `handleSearchSubmit` reads only `preventDefault()` from its event and then reads the store.
 *
 * The members it does NOT use are defined as throwing getters rather than left `undefined`.
 * A plain object cast to `React.FormEvent` would let a future edit to that handler reach for
 * `e.currentTarget` and get `undefined` — which fails silently, as a run against the previous
 * variant rather than an error. This turns that mistake into a loud one in the first test
 * that touches it, and names the offender in the message.
 */
const SYNTHETIC_SUBMIT = {
  preventDefault: () => {},
} as unknown as React.FormEvent;

const NOT_ON_A_SYNTHETIC_EVENT = (member: string): never => {
  throw new Error(
    `CommandPalette: handleSearchSubmit read \`event.${member}\`, which the synthetic submit ` +
      `event does not carry. It only calls preventDefault() and then reads the store — extend ` +
      `this object if that ever changes, so the gap fails here instead of silently analysing ` +
      `the previous variant.`,
  );
};

/**
 * Arms the synthetic submit event's throwing getters.
 *
 * Exported so the guard can be tested as the pure function it is. Asserting it through a click
 * does not work: React's event system catches a throw from a handler and re-throws it
 * asynchronously, so the failure arrives as an unhandled error on the next tick rather than
 * out of `fireEvent`, and lands in the suite as noise attached to an unrelated test.
 */
export function armSyntheticSubmit(event: React.FormEvent): React.FormEvent {
  const members = ["currentTarget", "target", "nativeEvent", "bubbles", "defaultPrevented"] as const;
  for (const member of members) {
    Object.defineProperty(event, member, {
      configurable: true,
      get: () => NOT_ON_A_SYNTHETIC_EVENT(member),
    });
  }
  return event;
}

interface PaletteItemProps {
  value: string;
  label: string;
  icon: React.ReactNode;
  keywords?: string[];
  meta?: string;
  /** Monospace for identifiers (variants, accessions); descriptive text stays in the UI face. */
  mono?: boolean;
  metaMono?: boolean;
  /**
   * Marks the row that is already what the palette would navigate to. It renders the `current`
   * badge and is announced as the current item, so a screen reader is told which row is a
   * no-op instead of having to infer it from a word inside the row's name.
   */
  isCurrent?: boolean;
  /** Emphasised row (the Run action): accent icon tile. */
  primary?: boolean;
  onSelect: () => void;
}

/** One row. cmdk owns filtering and roving selection; this owns the house row anatomy. */
function PaletteItem({
  value,
  label,
  icon,
  keywords,
  meta,
  mono,
  metaMono,
  isCurrent,
  primary,
  onSelect,
}: PaletteItemProps) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      className="cs-palette-item"
      data-primary={primary || undefined}
      aria-current={isCurrent ? "true" : undefined}
      onSelect={onSelect}
    >
      <span className="cs-palette-item-icon" aria-hidden="true">{icon}</span>
      <span className={mono ? "cs-palette-item-label font-mono" : "cs-palette-item-label"}>{label}</span>
      {isCurrent && <span className="cs-palette-badge">current</span>}
      <span className="cs-palette-item-trail">
        {meta && (
          <span className={metaMono ? "cs-palette-item-meta font-mono" : "cs-palette-item-meta"}>{meta}</span>
        )}
        <kbd className="cs-kbd cs-palette-item-enter" aria-hidden="true">↵</kbd>
      </span>
    </Command.Item>
  );
}

/**
 * The command palette (Ctrl/Cmd + K).
 *
 * It is the app's quick-command surface, not only a menu: it jumps to views and evidence
 * tabs, runs system actions, replays recent analyses, and turns one typed line like
 * `BRCA1 R175H` or `20-23365054-G-A` into a pipeline run. cmdk provides the filtering and
 * roving selection; the styling is the house palette (hairline panel on --cs-surface). No
 * open animation — a keyboard-initiated, high-frequency surface animates never.
 */
export default function CommandPalette({
  open,
  onOpenChange,
  onViewChange,
  onEvidenceTabChange,
  onSelectHistory,
  onRunQuery,
  activeView,
  activeEvidenceTab,
  onOpenOnboarding,
  onToggleSidebar,
}: CommandPaletteProps) {
  const {
    settings,
    isDark,
    toggleTheme,
    setIsSettingsOpen,
  } = useSettings();
  const actions = useVariantAnalysisActions();
  const history = useVariantAnalysisStore((s) => s.history);

  /**
   * Whether an analysis is already in flight — the same flags the Search form aggregates for its
   * own disabled submit button. A run launched from here would otherwise abort the first one
   * mid-flight with nothing on screen to say why the stages went quiet.
   */
  const isPipelineActive = useVariantAnalysisStore(
    (s) =>
      Boolean(
        s.analysisState?.isLoading ||
          s.isBiophysicalLoading ||
          s.isClinicalLoading,
      ),
  );

  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);

  const isBrowsing = query.trim().length === 0;
  const parsed = useMemo(() => parseVariantQuery(query), [query]);
  const hint = commandPaletteHint();
  // Keyless-first: a run never needs a key (the narrative degrades to rule-based criteria).
  const canRun = parsed.recognised && parsed.runnable;

  /* Global toggle, mounted for the life of the shell rather than the life of the panel, so the
     advertised chord can OPEN the palette as well as close it. `openRef` keeps one listener
     attached while still reading the live state on each keypress. */
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      /* AltGr reports as ctrl+alt, and Shift is a different chord; neither is this hotkey. */
      if (e.altKey || e.shiftKey) return;

      /* Inside a text field the caret owns the keyboard — except the palette's own input,
         where the chord still lowers it. */
      const target = e.target as HTMLElement | null;
      const typingInField =
        !!target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (typingInField && !target.closest("[cmdk-root]")) return;
      if (e.defaultPrevented && !target?.closest('[cmdk-root]')) return;

      e.preventDefault();
      onOpenChange(!openRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  /**
   * Take the app behind the palette out of reach for keyboard, pointer and assistive technology
   * together — what `aria-modal="true"` promises. Declared BEFORE the focus effect so `inert`
   * lands first and the focus effect then moves focus to the input; on close the order reverses.
   */
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".app-shell");
    if (!shell) return;
    if (open) {
      shell.setAttribute("inert", "");
    } else {
      shell.removeAttribute("inert");
    }
    return () => {
      shell.removeAttribute("inert");
    };
  }, [open]);

  /* Every visit starts from a clean line, the input takes focus, and the trigger's focus is
     restored on close. */
  useEffect(() => {
    if (!open) return;
    setQuery("");
    lastActiveRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      lastActiveRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === "Escape") {
        e.preventDefault();
        /* Capture phase + stopPropagation: one Escape closes one layer, not the palette AND
           the settings drawer / nav drawer behind it. cmdk still receives its own keys. */
        e.stopPropagation();
        onOpenChange(false);
        return;
      }
      if (e.key === "Tab") {
        /* Single-input surface: Tab stays put instead of escaping into the page behind. */
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onOpenChange]);

  const runAndClose = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  const close = () => onOpenChange(false);

  const structureDefault: MasterView =
    settings.defaultStructureModel === "esmfold" ? "structure_esmfold" : "structure_alphafold";

  /** Write every parsed slot (including empty ones) so no stale field from a previous run survives. */
  const writeParsedFields = () => {
    actions.setCustomGene(parsed.gene ?? "");
    actions.setCustomVariant(parsed.variant ?? "");
    actions.setCustomGenomic(parsed.genomic ?? "");
    actions.setCustomUniprot(parsed.uniprot ?? "");
  };

  /** Write the parsed line into the query fields and launch the pipeline. */
  const analyzeQuery = () => {
    writeParsedFields();
    /* The Search workspace is where the pipeline reports its stages, so a run started from
       any view lands where its progress is legible. */
    runAndClose(() => {
      onViewChange("search");
      onRunQuery(armSyntheticSubmit(SYNTHETIC_SUBMIT));
    });
  };

  /** Fill the Search fields without running — the cue for a real but incomplete query. */
  const fillSearchFields = () => {
    writeParsedFields();
    runAndClose(() => onViewChange("search"));
  };

  const iconCls = "w-4 h-4";

  return open
    ? createPortal(
        <div
          className="cs-palette-overlay"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <Command
            label="Command palette"
            loop
            className="cs-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            {/* cmdk v1 renders a bare <input>; the field chrome (icon, rule, Esc) is ours. */}
            <div className="cs-palette-search">
              <Search className="cs-palette-search-icon" aria-hidden="true" />
              <Command.Input
                ref={inputRef}
                value={query}
                onValueChange={setQuery}
                className="cs-palette-input"
                placeholder="Search views and actions, or type BRCA1 R175H"
                aria-describedby="cs-palette-hints"
              />
              <button
                type="button"
                tabIndex={-1}
                className="cs-kbd cs-palette-esc"
                onClick={close}
                aria-label="Close command palette"
              >
                Esc
              </button>
            </div>

            <Command.List className="cs-palette-list">
              <Command.Empty className="cs-palette-empty">
                <SearchX className="w-5 h-5" aria-hidden="true" />
                <span className="cs-palette-empty-title">No results for “{query.trim()}”</span>
                <span>Try a view, an evidence tab, or a variant such as BRCA1 R175H.</span>
              </Command.Empty>

              {/* ── Run: one typed line becomes a pipeline run ── */}
              {parsed.recognised && (
                <Command.Group heading="Run">
                  {parsed.runnable ? (
                    <PaletteItem
                      mono
                      primary={!isPipelineActive}
                      value={`analyze ${parsed.label} ${query}`}
                      label={isPipelineActive ? `${parsed.label} · analysis already running` : parsed.label}
                      icon={<Sparkles className={iconCls} />}
                      meta={isPipelineActive ? "Busy" : parsed.needsResolution ? "VEP resolve" : "Analyse"}
                      onSelect={
                        isPipelineActive
                          ? () => runAndClose(() => onViewChange("search"))
                          : analyzeQuery
                      }
                    />
                  ) : (
                    <PaletteItem
                      value={`open search ${query}`}
                      label={`Open in Search · ${parsed.label}`}
                      icon={<ArrowUpRight className={iconCls} />}
                      meta="Fill fields"
                      onSelect={fillSearchFields}
                    />
                  )}
                </Command.Group>
              )}

              {/* ── Recent analyses: the empty palette's front page ── */}
              {history.length > 0 && (
                <Command.Group heading="Recent analyses">
                  {history.slice(0, isBrowsing ? 5 : 8).map((item) => (
                    <PaletteItem
                      key={`${item.gene}-${item.variant}-${item.uniprotId}`}
                      mono
                      metaMono
                      value={`recent ${item.gene} ${item.variant} ${item.uniprotId}`}
                      label={`${item.gene} · ${item.variant}`}
                      icon={<History className={iconCls} />}
                      meta={item.uniprotId || undefined}
                      onSelect={() => runAndClose(() => onSelectHistory(item))}
                    />
                  ))}
                </Command.Group>
              )}

              {/* ── Views: straight from the sidebar registry, so labels and order never drift ── */}
              <Command.Group heading="Views">
                {MASTER_VIEW_ITEMS.map((view) => (
                  <PaletteItem
                    key={`view-${view.id}`}
                    value={`view ${view.label} ${view.sublabel ?? ""}`}
                    label={view.label}
                    icon={<view.Icon className={iconCls} />}
                    isCurrent={isViewActive(view.id, activeView)}
                    meta={view.sublabel}
                    onSelect={() =>
                      runAndClose(() => onViewChange(view.id === "structure" ? structureDefault : view.id))
                    }
                  />
                ))}
                {/* The model sub-views are sidebar rows too; they surface once there is text to match. */}
                {!isBrowsing &&
                  STRUCTURE_SUB_ITEMS.map((model) => (
                    <PaletteItem
                      key={`model-${model.id}`}
                      value={`structure model 3d ${model.label}`}
                      label={`3D structure · ${model.label}`}
                      icon={<Layers className={iconCls} />}
                      isCurrent={activeView === model.id}
                      meta="Model"
                      onSelect={() => runAndClose(() => onViewChange(model.id))}
                    />
                  ))}
              </Command.Group>

              {/* Evidence tabs and system actions stay out of the way until there is something to
                  match against: the empty palette is a short list, not a directory. */}
              {!isBrowsing && (
                <Command.Group heading="Evidence tabs">
                  {EVIDENCE_SUB_ITEMS.map((tab) => (
                    <PaletteItem
                      key={`tab-${tab.id}`}
                      value={`evidence ${tab.label} ${tab.id}`}
                      keywords={[tab.id]}
                      label={tab.label}
                      icon={<BarChart2 className={iconCls} />}
                      isCurrent={activeView === "evidence" && tab.id === activeEvidenceTab}
                      meta="Evidence"
                      onSelect={() => runAndClose(() => onEvidenceTabChange(tab.id))}
                    />
                  ))}
                </Command.Group>
              )}

              {!isBrowsing && (
                <Command.Group heading="System">
                  <PaletteItem
                    value="open settings preferences"
                    label="Open settings"
                    icon={<Settings className={iconCls} />}
                    onSelect={() => runAndClose(() => setIsSettingsOpen(true))}
                  />
                  <PaletteItem
                    value="toggle theme dark light mode appearance"
                    label={`Switch to ${isDark ? "light" : "dark"} mode`}
                    icon={isDark ? <Sun className={iconCls} /> : <Moon className={iconCls} />}
                    onSelect={() => runAndClose(() => toggleTheme())}
                  />
                  {onToggleSidebar && (
                    <PaletteItem
                      value="toggle sidebar collapse expand navigation rail"
                      label="Toggle sidebar"
                      icon={<PanelLeft className={iconCls} />}
                      meta={sidebarToggleHint()}
                      onSelect={() => runAndClose(() => onToggleSidebar())}
                    />
                  )}
                  {onOpenOnboarding && (
                    <PaletteItem
                      value="workspace tour onboarding guide help start keys orientation"
                      label="Take the tour"
                      icon={<Compass className={iconCls} />}
                      onSelect={() => runAndClose(() => onOpenOnboarding())}
                    />
                  )}
                  {history.length > 0 && (
                    <PaletteItem
                      value="clear recent history reset list"
                      label="Clear recent analyses"
                      icon={<Trash2 className={iconCls} />}
                      onSelect={() => runAndClose(() => actions.clearHistory())}
                    />
                  )}
                </Command.Group>
              )}
            </Command.List>

            {/* The keyboard contract, written once. Not aria-hidden: the input points here as its
                description, so a screen reader learns what Enter will do with the field. */}
            <div id="cs-palette-hints" className="cs-palette-footer">
              <span className="cs-palette-hint">
                <kbd className="cs-kbd">↑</kbd>
                <kbd className="cs-kbd">↓</kbd>
                navigate
              </span>
              <span className="cs-palette-hint">
                <kbd className="cs-kbd">↵</kbd>
                {canRun ? "analyse" : "open"}
              </span>
              <span className="cs-palette-hint">
                <kbd className="cs-kbd">Esc</kbd>
                close
              </span>
              <span className="cs-palette-hint ml-auto">
                <kbd className="cs-kbd">{hint}</kbd>
                toggle
              </span>
            </div>
          </Command>
        </div>,
        document.body
      )
    : null;
}
