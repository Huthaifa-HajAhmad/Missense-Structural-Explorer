import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Command } from "cmdk";
import {
  BarChart2, Info, Settings, Sun, Moon, History, Dna, Sparkles, Trash2, ArrowUpRight, KeyRound, Compass,
} from "lucide-react";
import { MasterView, MASTER_VIEW_ITEMS, EVIDENCE_SUB_ITEMS } from "./MasterSidebar";
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
}

interface PaletteEntry {
  id: string;
  label: string;
  hint?: string;
  Icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
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
  badge?: string;
  mono?: boolean;
  /**
   * Marks the row that is already what the palette would navigate to. It renders the `current`
   * badge and is announced as the current item, so a screen reader is told which row is a
   * no-op instead of having to infer it from a word inside the row's name.
   */
  isCurrent?: boolean;
  onSelect: () => void;
}

/** One row. cmdk owns filtering and roving selection; this owns the house row anatomy. */
function PaletteItem({
  value,
  label,
  icon,
  keywords,
  meta,
  badge,
  mono,
  isCurrent,
  onSelect,
}: PaletteItemProps) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      className="cs-palette-item"
      aria-current={isCurrent ? "true" : undefined}
      onSelect={onSelect}
    >
      <span className="cs-palette-item-icon">{icon}</span>
      <span className={mono ? "truncate font-mono text-[12px]" : "truncate"}>{label}</span>
      {badge && <span className="cs-palette-badge">{badge}</span>}
      {meta && <span className="cs-palette-item-meta truncate">{meta}</span>}
    </Command.Item>
  );
}

/**
 * The command palette (Ctrl/Cmd + K).
 *
 * It is the app's quick-command surface, not only a menu: it jumps to views and evidence
 * tabs, runs system actions, replays recent analyses, and — the job the removed header
 * dropdown used to do — turns one typed line like `BRCA1 R175H` or `20-23365054-G-A` into a
 * pipeline run. cmdk provides the filtering and roving selection; the styling is the house
 * palette (hairline panel on --cs-surface, no open animation — a keyboard-initiated,
 * high-frequency surface animates never).
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
}: CommandPaletteProps) {
  const {
    settings,
    isDark,
    toggleTheme,
    setIsSettingsOpen,
    hasConfiguredGeminiKey,
    openSettingsTab,
  } = useSettings();
  const actions = useVariantAnalysisActions();
  const history = useVariantAnalysisStore((s) => s.history);

  /**
   * Whether an analysis is already in flight — the same six flags the Search form aggregates
   * for its own disabled submit button (VariantSearchPanel.tsx).
   *
   * The palette is a second door into the same pipeline, so it has to honour that guard: the
   * form refuses a second run, and a run launched from here would instead abort the first one
   * mid-flight with nothing on screen to say why the stages went quiet.
   */
  const isPipelineActive = useVariantAnalysisStore(
    (s) =>
      Boolean(
        s.analysisState?.isLoading ||
          s.isBiophysicalLoading ||
          s.isStructuralLoading ||
          s.isClinicalLoading ||
          s.isNarrativeLoading,
      ),
  );

  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);

  const isBrowsing = query.trim().length === 0;
  const parsed = useMemo(() => parseVariantQuery(query), [query]);
  const hint = commandPaletteHint();

  /* Global toggle, mounted for the life of the shell rather than the life of the panel.
     This chord used to be registered inside the `open` branch, so it could only ever CLOSE a
     palette that was already open — the "Ctrl K" chip in the header advertised a hotkey that
     had no handler behind it. `openRef` keeps one listener attached while still reading the
     live state on each keypress. */
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      /* AltGr on a European layout reports as ctrl+alt, and Shift is a different chord entirely;
         neither is this hotkey, and swallowing them would eat the keystroke with nothing to
         show for it. */
      if (e.altKey || e.shiftKey) return;

      /* The chord is a launcher, not a takeover: inside a text field the user's caret is the
         thing that owns the keyboard. The search panel, the settings search box and the dev
         console all have one, and losing Ctrl+K mid-word was a real complaint. The palette's
         own input is the exception — the chord still lowers it. */
      const target = e.target as HTMLElement | null;
      const typingInField =
        !!target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (typingInField && !target.closest("[cmdk-root]")) return;

      e.preventDefault();
      onOpenChange(!openRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  /**
   * Put the app behind the palette out of reach — for the keyboard, the pointer, and assistive
   * technology together, which is what `aria-modal="true"` on the panel promises. Tab is already
   * trapped and the backdrop swallows clicks, but neither takes the background out of the
   * accessibility tree, so a screen reader in browse mode could still walk into it.
   *
   * `inert` does the whole job in one attribute, and is declared BEFORE the focus effect below
   * so it runs first: marking an element inert blurs whatever inside it held focus, and the
   * focus effect then moves focus to the input. On the way out the order reverses, so the shell
   * is interactive again before focus is restored into it.
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

  /* Focus management without Radix Dialog: every visit starts from a clean line, the input
     takes focus, and the trigger's focus is restored on close. */
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
      if (e.key === "Escape") {
        e.preventDefault();
        /* This listener sits on `document` in the CAPTURE phase, so it runs ahead of every
           bubble-phase handler in the app — the settings drawer and the narrow-viewport nav
           both close on Escape. Without this line one keypress tore down two layers at once.
           `stopPropagation` (not `stopImmediatePropagation`) is the right tool: it is scoped to
           this one branch, so cmdk still receives ArrowDown, Home/End and Enter, which it needs
           to move the selection and run the active row. */
        e.stopPropagation();
        onOpenChange(false);
        return;
      }
      if (e.key === "Tab") {
        /* Single-input surface: Tab stays put instead of escaping into the muted page behind
           the veil. */
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

  /* Mirrors the structure-row merge the sidebar and breadcrumb both make, so `current` lands
     on the 3D Structure row whichever model tab is on screen. */
  const isCurrentView = (id: string): boolean =>
    id === "structure"
      ? activeView === "structure" ||
        activeView === "structure_alphafold" ||
        activeView === "structure_esmfold"
      : id === activeView;

  /** Write the parsed line into the query fields and launch the pipeline. */
  const analyzeQuery = () => {
    actions.setCustomGene(parsed.gene ?? "");
    actions.setCustomVariant(parsed.variant ?? "");
    actions.setCustomGenomic(parsed.genomic ?? "");
    actions.setCustomUniprot(parsed.uniprot ?? "");
    /* The Search workspace is where the pipeline reports its stages, so a run started from
       any view lands where its progress is legible. */
    runAndClose(() => {
      onViewChange("search");
      onRunQuery(armSyntheticSubmit(SYNTHETIC_SUBMIT));
    });
  };

  /** Fill the Search fields without running — the cue for a real but incomplete query. */
  const fillSearchFields = () => {
    /* Every field is written, including the ones this query says nothing about. Writing only
       the present slots left a previous run's variant sitting in the form, so a row labelled
       `Open in Search · BRCA1` would fill BRCA1 over the top of a stale `R175H` and run a
       hybrid of the two. The row's label is a promise about what the form will hold. */
    actions.setCustomGene(parsed.gene ?? "");
    actions.setCustomVariant(parsed.variant ?? "");
    actions.setCustomGenomic(parsed.genomic ?? "");
    actions.setCustomUniprot(parsed.uniprot ?? "");
    runAndClose(() => onViewChange("search"));
  };

  /* Primary views, resolved the same way the sidebar resolves its rows. */
  const viewEntries: PaletteEntry[] = useMemo(() => {
    const items: PaletteEntry[] = [];
    for (const view of MASTER_VIEW_ITEMS) {
      if (view.id === "structure") {
        items.push({
          id: "structure",
          label: view.label,
          hint: view.sublabel,
          Icon: view.Icon,
          onSelect: () => runAndClose(() => onViewChange(structureDefault)),
        });
      } else {
        items.push({
          id: view.id,
          label: view.label,
          hint: view.sublabel,
          Icon: view.Icon,
          onSelect: () => runAndClose(() => onViewChange(view.id)),
        });
      }
    }
    items.push({
      id: "about",
      label: "About",
      hint: "Workspace guide & data sources",
      Icon: Info,
      onSelect: () => runAndClose(() => onViewChange("about")),
    });
    return items;
  }, [structureDefault, onViewChange, onOpenChange]);

  if (!open) return null;

  return createPortal(
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
        <Command.Input
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          className="cs-palette-input"
          placeholder="Search views and actions, or type BRCA1 R175H"
          aria-describedby="cs-palette-hints"
        />
        <Command.List className="cs-palette-list">
          <Command.Empty className="cs-palette-empty">
            No match for “{query.trim()}”. Try a view, a tab, or a gene and a substitution.
          </Command.Empty>

          {/* ── Run: one typed line becomes a pipeline run — the header dropdown's whole job ── */}
          {parsed.recognised && (
            <Command.Group heading="Run">
              {!hasConfiguredGeminiKey ? (
                <PaletteItem
                  value={`api key configure run ${query}`}
                  label="API key required · Configure to analyze"
                  icon={<KeyRound className="w-3.5 h-3.5" />}
                  meta="settings"
                  onSelect={() => runAndClose(() => openSettingsTab("api"))}
                />
              ) : parsed.runnable ? (
                <PaletteItem
                  mono
                  value={`analyze ${parsed.label} ${query}`}
                  label={isPipelineActive ? `${parsed.label} · analysis already running` : parsed.label}
                  icon={<Sparkles className="w-3.5 h-3.5" />}
                  meta={isPipelineActive ? "busy" : parsed.needsResolution ? "VEP resolve" : "analyze"}
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
                  icon={<ArrowUpRight className="w-3.5 h-3.5" />}
                  meta="fill fields"
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
                  value={`${item.gene} ${item.variant} ${item.uniprotId}`}
                  label={`${item.gene} · ${item.variant}`}
                  icon={<History className="w-3.5 h-3.5" />}
                  meta={item.uniprotId || "analysis"}
                  onSelect={() => runAndClose(() => onSelectHistory(item))}
                />
              ))}
            </Command.Group>
          )}

          {/* ── Primary views ── */}
          <Command.Group heading="Views">
            {viewEntries.map((entry) => (
              <PaletteItem
                key={`view-${entry.id}`}
                value={`${entry.label} ${entry.hint ?? ""}`}
                label={entry.label}
                icon={<entry.Icon className="w-3.5 h-3.5" />}
                badge={isCurrentView(entry.id) ? "current" : undefined}
                isCurrent={isCurrentView(entry.id)}
                meta={entry.hint}
                onSelect={entry.onSelect}
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
                  icon={<BarChart2 className="w-3.5 h-3.5" />}
                  badge={tab.id === activeEvidenceTab ? "current" : undefined}
                  isCurrent={tab.id === activeEvidenceTab}
                  meta="evidence"
                  onSelect={() => runAndClose(() => onEvidenceTabChange(tab.id))}
                />
              ))}
            </Command.Group>
          )}

          {!isBrowsing && (
            <Command.Group heading="System">
              {onOpenOnboarding && (
                <PaletteItem
                  value="workspace tour onboarding guide help start keys orientation"
                  label="Workspace guide & API keys tour"
                  icon={<Compass className="w-3.5 h-3.5 text-[var(--cs-accent-clay)]" />}
                  meta="guide"
                  onSelect={() => runAndClose(() => onOpenOnboarding())}
                />
              )}
              <PaletteItem
                value="open settings preferences"
                label="Open settings"
                icon={<Settings className="w-3.5 h-3.5" />}
                onSelect={() => runAndClose(() => setIsSettingsOpen(true))}
              />
              <PaletteItem
                value="toggle theme dark light mode"
                label={`Switch to ${isDark ? "light" : "dark"} mode`}
                icon={isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                onSelect={() => runAndClose(() => toggleTheme())}
              />
              <PaletteItem
                value="new variant search workspace"
                label="Start a new variant search"
                icon={<Dna className="w-3.5 h-3.5" />}
                onSelect={() => runAndClose(() => onViewChange("search"))}
              />
              {history.length > 0 && (
                <PaletteItem
                  value="clear recent history reset list"
                  label="Clear recent analyses"
                  icon={<Trash2 className="w-3.5 h-3.5" />}
                  meta="history"
                  onSelect={() => runAndClose(() => actions.clearHistory())}
                />
              )}
            </Command.Group>
          )}
        </Command.List>

        {/* Hints — the palette's only affordance row, mono/muted like the console.

            Not `aria-hidden`: these are the only place the keyboard contract is written down,
            and the `analyze`/`select` verb changes with the input. Hiding them left a screen
            reader with a combobox and no way to learn what Enter will do, which is the one
            thing a keyboard-first surface has to say out loud. The input points here as its
            description so the contract is announced with the field, not as loose text. */}
        <div id="cs-palette-hints" className="cs-palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ {parsed.runnable && hasConfiguredGeminiKey ? "analyze" : "select"}</span>
          <span>esc close</span>
          <span className="ml-auto">{hint}</span>
        </div>
      </Command>
    </div>,
    document.body
  );
}

