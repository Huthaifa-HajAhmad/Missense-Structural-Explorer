import React, { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Command } from "cmdk";
import { BarChart2, Info, Settings, Sun, Moon, History, Dna } from "lucide-react";
import { MasterView, MASTER_VIEW_ITEMS, EVIDENCE_SUB_ITEMS } from "./MasterSidebar";
import { useSettings } from "../context/SettingsContext";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViewChange: (view: MasterView) => void;
  onEvidenceTabChange: (tab: string) => void;
  onSelectHistory: (item: { gene: string; variant: string; uniprotId: string }) => void;
}

interface PaletteEntry {
  id: string;
  label: string;
  hint?: string;
  Icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
}

/**
 * The command palette (Ctrl/Cmd + K) — navigation, evidence tabs, recent
 * variants and system actions in one fuzzy-searchable surface. cmdk provides
 * the filtering and roving selection; the styling is the house palette
 * (hairline panel on --cs-surface, no open animation — a keyboard-initiated,
 * high-frequency surface animates never).
 */
export default function CommandPalette({
  open,
  onOpenChange,
  onViewChange,
  onEvidenceTabChange,
  onSelectHistory,
}: CommandPaletteProps) {
  const { settings, isDark, toggleTheme, setIsSettingsOpen } = useSettings();
  const history = useVariantAnalysisStore((s) => s.history);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);

  /* Global toggle. The listener lives at window level so the palette opens from
     any view, including while the drawer or settings are open. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  /* Focus management without Radix Dialog: focus the input on open, restore the
     trigger's focus on close, and keep Tab cycling inside the palette (cmdk
     items are not tab stops — arrows move the selection). */
  useEffect(() => {
    if (!open) return;
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
        /* The palette is a single-input surface: Tab stays put instead of
           escaping into the muted page behind the veil. */
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

  const structureDefault: MasterView =
    settings.defaultStructureModel === "esmfold" ? "structure_esmfold" : "structure_alphafold";

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

  const close = () => onOpenChange(false);

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="cs-palette-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <Command label="Command menu" loop className="cs-palette">
        <Command.Input
          ref={inputRef}
          className="cs-palette-input"
          placeholder="Search views, evidence tabs, variants…"
        />
        <Command.List className="cs-palette-list">
          <Command.Empty className="cs-palette-empty">
            No matches. Try a gene symbol, or "settings".
          </Command.Empty>

          {/* ── Primary views ── */}
          <Command.Group heading="Views">
            {viewEntries.map((entry) => (
              <Command.Item
                key={`view-${entry.id}`}
                value={`${entry.label} ${entry.hint ?? ""}`}
                className="cs-palette-item"
                onSelect={entry.onSelect}
              >
                <span className="cs-palette-item-icon"><entry.Icon className="w-3.5 h-3.5" /></span>
                <span className="truncate">{entry.label}</span>
                {entry.hint && <span className="cs-palette-item-meta truncate">{entry.hint}</span>}
              </Command.Item>
            ))}
          </Command.Group>

          {/* ── Evidence sub-tabs ── */}
          <Command.Group heading="Evidence tabs">
            {EVIDENCE_SUB_ITEMS.map((tab) => (
              <Command.Item
                key={`tab-${tab.id}`}
                value={`evidence ${tab.label}`}
                keywords={[tab.id]}
                className="cs-palette-item"
                onSelect={() => runAndClose(() => onEvidenceTabChange(tab.id))}
              >
                <span className="cs-palette-item-icon"><BarChart2 className="w-3.5 h-3.5" /></span>
                <span className="truncate">{tab.label}</span>
                <span className="cs-palette-item-meta">evidence</span>
              </Command.Item>
            ))}
          </Command.Group>

          {/* ── Recent analyses ── */}
          {history.length > 0 && (
            <Command.Group heading="Recent analyses">
              {history.slice(0, 4).map((item) => (
                <Command.Item
                  key={`${item.gene}-${item.variant}-${item.uniprotId}`}
                  value={`${item.gene} ${item.variant} ${item.uniprotId}`}
                  className="cs-palette-item"
                  onSelect={() => runAndClose(() => onSelectHistory(item))}
                >
                  <span className="cs-palette-item-icon"><History className="w-3.5 h-3.5" /></span>
                  <span className="truncate font-mono text-[12px]">
                    {item.gene} · {item.variant}
                  </span>
                  <span className="cs-palette-item-meta truncate">{item.uniprotId || "analysis"}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {/* ── System actions ── */}
          <Command.Group heading="System">
            <Command.Item
              value="open settings preferences"
              className="cs-palette-item"
              onSelect={() => runAndClose(() => setIsSettingsOpen(true))}
            >
              <span className="cs-palette-item-icon"><Settings className="w-3.5 h-3.5" /></span>
              <span className="truncate">Open settings</span>
            </Command.Item>
            <Command.Item
              value="toggle theme dark light mode"
              className="cs-palette-item"
              onSelect={() => runAndClose(() => toggleTheme())}
            >
              <span className="cs-palette-item-icon">
                {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </span>
              <span className="truncate">Switch to {isDark ? "light" : "dark"} mode</span>
            </Command.Item>
            <Command.Item
              value="new variant search workspace"
              className="cs-palette-item"
              onSelect={() => runAndClose(() => onViewChange("search"))}
            >
              <span className="cs-palette-item-icon"><Dna className="w-3.5 h-3.5" /></span>
              <span className="truncate">Start a new variant search</span>
            </Command.Item>
          </Command.Group>
        </Command.List>

        {/* Hints — the palette's only affordance row, mono/muted like the console */}
        <div className="cs-palette-footer" aria-hidden="true">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
          <span className="ml-auto">Ctrl K</span>
        </div>
      </Command>
    </div>,
    document.body
  );
}
