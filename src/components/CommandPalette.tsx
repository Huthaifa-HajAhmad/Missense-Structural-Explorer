import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Command } from "cmdk";
import {
  BarChart2, Info, Settings, Sun, Moon, History, Dna, Sparkles, Trash2, ArrowUpRight, KeyRound,
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
  /** The view on screen — the matching row is badged `current` instead of being another jump. */
  activeView?: MasterView;
  /** The evidence sub-tab on screen, for the same reason. */
  activeEvidenceTab?: string;
}

interface PaletteEntry {
  id: string;
  label: string;
  hint?: string;
  Icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
}

interface PaletteItemProps {
  value: string;
  label: string;
  icon: React.ReactNode;
  keywords?: string[];
  meta?: string;
  badge?: string;
  mono?: boolean;
  onSelect: () => void;
}

/** One row. cmdk owns filtering and roving selection; this owns the house row anatomy. */
function PaletteItem({ value, label, icon, keywords, meta, badge, mono, onSelect }: PaletteItemProps) {
  return (
    <Command.Item value={value} keywords={keywords} className="cs-palette-item" onSelect={onSelect}>
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
  activeView,
  activeEvidenceTab,
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!openRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

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
      onSelectHistory({
        gene: parsed.gene ?? "",
        variant: parsed.genomic ?? parsed.variant ?? "",
        uniprotId: parsed.uniprot ?? "",
      });
    });
  };

  /** Fill the Search fields without running — the cue for a real but incomplete query. */
  const fillSearchFields = () => {
    if (parsed.gene) actions.setCustomGene(parsed.gene);
    if (parsed.variant) actions.setCustomVariant(parsed.variant);
    if (parsed.genomic) actions.setCustomGenomic(parsed.genomic);
    if (parsed.uniprot) actions.setCustomUniprot(parsed.uniprot);
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
          aria-label="Search views, actions and variants"
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
                  label={parsed.label}
                  icon={<Sparkles className="w-3.5 h-3.5" />}
                  meta={parsed.needsResolution ? "VEP resolve" : "analyze"}
                  onSelect={analyzeQuery}
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
                  meta="evidence"
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

        {/* Hints — the palette's only affordance row, mono/muted like the console */}
        <div className="cs-palette-footer" aria-hidden="true">
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

