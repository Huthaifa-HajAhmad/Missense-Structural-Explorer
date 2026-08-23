import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  Dna,
  FlaskConical,
  Info,
  KeyRound,
  LayoutGrid,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  X
} from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import { AppearanceSection } from "./sections/AppearanceSection";
import { ViewportSection } from "./sections/ViewportSection";
import { SequenceSection } from "./sections/SequenceSection";
import { AnalysisSection } from "./sections/AnalysisSection";
import { WorkspaceSection } from "./sections/WorkspaceSection";
import { ConnectionsSection } from "./sections/ConnectionsSection";
import { AboutSection } from "./sections/AboutSection";

const FOCUSABLE_SELECTOR =
  'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex="0"], [contenteditable]';

const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: Palette, Component: AppearanceSection },
  { id: "viewport", label: "Viewport", icon: SlidersHorizontal, Component: ViewportSection },
  { id: "sequence", label: "Sequence", icon: Dna, Component: SequenceSection },
  { id: "analysis", label: "Analysis", icon: FlaskConical, Component: AnalysisSection },
  { id: "workspace", label: "Workspace", icon: LayoutGrid, Component: WorkspaceSection },
  { id: "connections", label: "Connections", icon: KeyRound, Component: ConnectionsSection },
  { id: "about", label: "About & data", icon: Info, Component: AboutSection }
] as const;

export default function SettingsDrawer() {
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    settingsTab,
    setSettingsTab,
    resetSettingsToDefault
  } = useSettings();

  const drawerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  const activeIndex = useMemo(
    () => Math.max(0, SECTIONS.findIndex((section) => section.id === settingsTab)),
    [settingsTab]
  );
  const ActiveSection = SECTIONS[activeIndex].Component;

  useEffect(() => {
    if (!isSettingsOpen) return;

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
              {/* Header */}
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-cs-border bg-cs-surface-2 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="p-2.5 rounded-xl border shrink-0"
                    style={{
                      background: "rgba(196, 104, 73, 0.12)",
                      borderColor: "rgba(196, 104, 73, 0.25)"
                    }}
                  >
                    <SlidersHorizontal className="w-4.5 h-4.5 text-cs-accent-clay" />
                  </div>
                  <div className="min-w-0">
                    <h2
                      id="settings-drawer-title"
                      className="text-[15px] font-semibold tracking-tight text-cs-text-primary"
                    >
                      Settings
                    </h2>
                    <p className="text-[11px] text-cs-text-muted mt-0.5">
                      Changes apply instantly and stay on this device.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  aria-label="Close settings"
                  className="w-7 h-7 rounded-lg border border-cs-border flex items-center justify-center text-cs-text-secondary hover:text-cs-text-primary hover:bg-cs-bg-subtle transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Nav rail + content */}
              <div className="flex flex-col md:flex-row flex-1 min-h-0">
                <nav
                  role="tablist"
                  aria-label="Settings sections"
                  onKeyDown={handleNavKeyDown}
                  className="flex md:flex-col gap-1 p-2 shrink-0 border-b md:border-b-0 md:border-r border-cs-border-subtle bg-cs-surface-2 overflow-x-auto md:overflow-y-auto w-full md:w-48"
                >
                  {SECTIONS.map((section) => {
                    const Icon = section.icon;
                    const active = section.id === settingsTab;
                    return (
                      <button
                        key={section.id}
                        id={`settings-tab-${section.id}`}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-controls="settings-panel"
                        tabIndex={active ? 0 : -1}
                        onClick={() => setSettingsTab(section.id)}
                        className={`relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                          active
                            ? "bg-cs-surface text-cs-accent-clay font-semibold shadow-sm"
                            : "text-cs-text-secondary hover:text-cs-text-primary hover:bg-cs-surface/70"
                        }`}
                      >
                        {active && (
                          <span
                            aria-hidden
                            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full hidden md:block"
                            style={{ background: "var(--cs-accent-clay)" }}
                          />
                        )}
                        <Icon className="w-4 h-4 shrink-0" />
                        {section.label}
                      </button>
                    );
                  })}
                </nav>

                <div
                  id="settings-panel"
                  role="tabpanel"
                  aria-labelledby={`settings-tab-${settingsTab}`}
                  tabIndex={-1}
                  className="flex-1 overflow-y-auto px-5 py-5"
                >
                  <motion.div
                    key={settingsTab}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                  >
                    <ActiveSection />
                  </motion.div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-cs-border bg-cs-surface-2 shrink-0">
                <button
                  type="button"
                  onClick={handleResetClick}
                  className={`cs-btn-ghost ${
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
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="cs-btn-primary"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
