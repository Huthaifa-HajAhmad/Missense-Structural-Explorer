import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import { NAV_ZONES, sidebarToggleHint } from "../MasterSidebar";
import { commandPaletteHint } from "../../shared/platform";
import { ACCEPTED_NOTATION_EXAMPLES } from "../../shared/variantNotation";

/*
 * The benchmark presets live in `shared/benchmarkPresets.ts` so the Search workspace can offer the
 * same one-click controls the tour advertises without importing this modal.
 * Re-exported here so existing imports keep working.
 */
export { ONBOARDING_BENCHMARK_PRESETS, type OnboardingPreset } from "../../shared/benchmarkPresets";
import type { OnboardingPreset } from "../../shared/benchmarkPresets";
import { ONBOARDING_BENCHMARK_PRESETS } from "../../shared/benchmarkPresets";

/** One key for "the tour has been seen", shared with App's first-visit auto-launch. */
export const ONBOARDING_STORAGE_KEY = "cs-onboarding-completed-v1";

export function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistCompletion() {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
  } catch {
    /* private window / full storage — the tour simply shows again next visit */
  }
}

export type TourPlacement = "top" | "bottom" | "left" | "right";

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Element to spotlight. `null` = a centred card with no spotlight (the welcome). */
  target: string | null;
  /** Preferred side for the card; the layout falls back to whichever side has room. */
  placement: TourPlacement;
}

/**
 * The tour is deliberately high level: one welcome, then five stops that each answer "where is
 * X and why would I use it". Copy is sentence case, says what the thing does for the reader, and
 * names no version numbers or vendors that will go stale.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Missense & Fold",
    body:
      "Give it one missense variant. It gathers clinical evidence, 3D structure, stability and " +
      "literature in parallel, then helps you weigh them against ACMG/AMP criteria.",
    target: null,
    placement: "bottom",
  },
  {
    id: "query",
    title: "Start with a variant",
    body:
      "Enter a gene and a protein change, or paste genomic coordinates. The gene and UniProt " +
      "accession are filled in for you when the notation already implies them.",
    target: '[data-tour="variant-input"]',
    placement: "right",
  },
  {
    id: "pipeline",
    title: "Watch it run",
    body:
      "Services shows which data sources and engines are reachable right now. Pipeline tracks " +
      "each stage of a run as it lands. Select a finished stage to open it.",
    target: '[data-tour="workflow-rail"]',
    placement: "left",
  },
  {
    id: "navigate",
    title: "Move between results",
    body:
      "Views are grouped in reading order: evidence and modelling first, then synthesis. Each " +
      "row says what it is for, and a marker shows its stage once a run starts.",
    target: '[data-tour="navigation-zones"]',
    placement: "right",
  },
  {
    id: "connections",
    title: "Keys are optional",
    body:
      "Every stage runs without an account. Without a Gemini key the interpretation is built from " +
      "rule-based ACMG criteria; add one for the written narrative. Other keys unlock specialist models.",
    target: '[data-tour="settings-trigger"]',
    placement: "bottom",
  },
  {
    id: "benchmarks",
    title: "Try a benchmark",
    body:
      "Four curated disease controls. Run one to watch every stage fill in. Your own analyses " +
      "collect here afterwards.",
    target: '[data-tour="recent-benchmarks"]',
    placement: "right",
  },
];

/** Stops counted in "Step n of m" — the welcome is a preface, not a stop. */
const STOP_COUNT = TOUR_STEPS.length - 1;

/* ───────────────────────────── Geometry ───────────────────────────── */

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SPOT_PAD = 6; // breathing room between the target and the spotlight edge
const GAP = 14; // between the spotlight and the card
const EDGE = 12; // minimum distance from the viewport edge
const SHEET_BREAKPOINT = 640; // below this the card docks to the bottom as a sheet

/**
 * Where the spotlight goes: the target plus padding, clipped to the viewport so a panel taller
 * than the screen still gets a visible outline. `null` when the target is absent or off screen
 * (e.g. the sidebar while it is an off-canvas drawer) — the card then centres itself.
 */
export function spotlightFor(rect: DOMRect | Box | null, vw: number, vh: number): Box | null {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  if (right <= 0 || bottom <= 0 || rect.left >= vw || rect.top >= vh) return null;

  const top = Math.max(4, rect.top - SPOT_PAD);
  const left = Math.max(4, rect.left - SPOT_PAD);
  return {
    top,
    left,
    width: Math.min(vw - 4, right + SPOT_PAD) - left,
    height: Math.min(vh - 4, bottom + SPOT_PAD) - top,
  };
}

export type CardLayout =
  | { mode: "centre"; top: number; left: number }
  | { mode: "sheet" }
  | { mode: "anchored"; top: number; left: number; side: TourPlacement };

const FALLBACK_ORDER: Record<TourPlacement, TourPlacement[]> = {
  right: ["right", "left", "bottom", "top"],
  left: ["left", "right", "bottom", "top"],
  bottom: ["bottom", "top", "right", "left"],
  top: ["top", "bottom", "right", "left"],
};

/**
 * Picks the first side (preferred first) where the whole card fits beside the spotlight without
 * covering it. If no side fits — a target that fills the screen, or a phone — the card docks to the
 * bottom as a sheet rather than being clamped on top of the thing it describes.
 */
export function layoutCard(
  spot: Box | null,
  card: { width: number; height: number },
  vw: number,
  vh: number,
  preferred: TourPlacement
): CardLayout {
  // Centred is expressed in pixels, not a CSS transform, so moving from the welcome to the first
  // stop is one continuous top/left transition instead of a jump when the transform drops away.
  const centre: CardLayout = {
    mode: "centre",
    top: Math.max(EDGE, Math.round((vh - card.height) / 2)),
    left: Math.max(EDGE, Math.round((vw - card.width) / 2)),
  };
  if (vw < SHEET_BREAKPOINT) return spot ? { mode: "sheet" } : centre;
  if (!spot) return centre;

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const alignV = clamp(spot.top, EDGE, vh - card.height - EDGE);
  const alignH = clamp(spot.left + spot.width / 2 - card.width / 2, EDGE, vw - card.width - EDGE);

  for (const side of FALLBACK_ORDER[preferred]) {
    if (side === "right" && spot.left + spot.width + GAP + card.width <= vw - EDGE) {
      return { mode: "anchored", side, top: alignV, left: spot.left + spot.width + GAP };
    }
    if (side === "left" && spot.left - GAP - card.width >= EDGE) {
      return { mode: "anchored", side, top: alignV, left: spot.left - GAP - card.width };
    }
    if (side === "bottom" && spot.top + spot.height + GAP + card.height <= vh - EDGE) {
      return { mode: "anchored", side, top: spot.top + spot.height + GAP, left: alignH };
    }
    if (side === "top" && spot.top - GAP - card.height >= EDGE) {
      return { mode: "anchored", side, top: spot.top - GAP - card.height, left: alignH };
    }
  }
  return { mode: "sheet" };
}

/* ───────────────────────────── Step content ───────────────────────────── */

function FlowPreview() {
  // The three sidebar zones, in order — the welcome previews the shape of the app, not a sales pitch.
  const stages = [
    { label: "Query", detail: "Gene + variant" },
    ...NAV_ZONES.filter((z) => z.zoneLabel).map((z) => ({
      label: z.zoneLabel as string,
      detail: z.items.map((i) => i.label).join(" · "),
    })),
  ];
  return (
    <ol className="tour-flow" aria-label="How an analysis flows">
      {stages.map((s, i) => (
        <li key={s.label} className="tour-flow-step">
          <span className="tour-flow-index" aria-hidden="true">{i + 1}</span>
          <span className="min-w-0">
            <span className="tour-flow-label">{s.label}</span>
            <span className="tour-flow-detail">{s.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function NotationList() {
  const rows = [
    { kind: "Protein", value: ACCEPTED_NOTATION_EXAMPLES.protein },
    { kind: "cDNA", value: ACCEPTED_NOTATION_EXAMPLES.cdna },
    { kind: "Genomic", value: ACCEPTED_NOTATION_EXAMPLES.genomicHgvs },
  ];
  return (
    <dl className="tour-list">
      {rows.map((r) => (
        <div key={r.kind} className="tour-list-row">
          <dt className="tour-list-key">{r.kind}</dt>
          <dd className="tour-list-value font-mono">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Shortcuts() {
  // The spotlit sidebar already shows every view; the card adds only what the rail can't: the keys.
  return (
    <p className="tour-shortcuts">
      <kbd className="cs-kbd">{commandPaletteHint()}</kbd> jump anywhere
      <span aria-hidden="true" className="tour-shortcuts-sep">·</span>
      <kbd className="cs-kbd">{sidebarToggleHint()}</kbd> collapse the sidebar
    </p>
  );
}

function ConnectionStatus({ onOpen }: { onOpen: () => void }) {
  const { hasConfiguredGeminiKey } = useSettings();
  return (
    <div className="tour-status">
      <span className="tour-status-dot" data-on={hasConfiguredGeminiKey || undefined} aria-hidden="true" />
      <span className="tour-status-text">
        {hasConfiguredGeminiKey ? "Gemini key linked" : "No Gemini key · rule-based interpretation"}
      </span>
      <button type="button" className="tour-btn tour-btn-quiet ml-auto" onClick={onOpen}>
        {hasConfiguredGeminiKey ? "Manage keys" : "Add a key"}
      </button>
    </div>
  );
}

function PresetList({ onSelect }: { onSelect: (preset: OnboardingPreset) => void }) {
  return (
    <ul className="tour-presets">
      {ONBOARDING_BENCHMARK_PRESETS.map((preset) => (
        <li key={preset.gene + preset.variant}>
          <button
            type="button"
            className="tour-preset"
            onClick={() => onSelect(preset)}
            aria-label={`Run ${preset.gene} ${preset.variant}`}
            title={preset.description}
          >
            <span className="tour-preset-gene">{preset.gene}</span>
            <span className="tour-preset-variant font-mono">{preset.variant}</span>
            <span className="tour-preset-tag">{preset.tag}</span>
            <ArrowRight className="tour-preset-go" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────────── Component ───────────────────────────── */

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPreset?: (preset: OnboardingPreset) => void;
  onOpenSettings?: (tab?: string) => void;
}

const FOCUSABLE = 'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function OnboardingModal({ isOpen, onClose, onSelectPreset, onOpenSettings }: OnboardingModalProps) {
  const { openSettingsTab } = useSettings();
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Box | null>(null);
  const [layout, setLayout] = useState<CardLayout>({ mode: "centre", top: 0, left: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef(0);
  const titleId = useId();
  const bodyId = useId();

  const step = TOUR_STEPS[index];
  const isWelcome = index === 0;
  const isLast = index === TOUR_STEPS.length - 1;

  /* Measure the target and place the card. Runs on step change, resize and any scroll. */
  const measure = useCallback((): boolean => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const el = step.target ? document.querySelector(step.target) : null;
    const nextSpot = spotlightFor(el ? el.getBoundingClientRect() : null, vw, vh);
    const card = cardRef.current;
    const size = { width: card?.offsetWidth ?? 380, height: card?.offsetHeight ?? 280 };
    setSpot(nextSpot);
    setLayout(layoutCard(nextSpot, size, vw, vh, step.placement));
    return Boolean(nextSpot) || !step.target;
  }, [step]);

  const scheduleMeasure = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      measure();
    });
  }, [measure]);

  // Open: remember focus, restart at the welcome. Close: hand focus back.
  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setIndex(0);
    return () => {
      const back = returnFocusRef.current;
      if (back && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, [isOpen]);

  // Step change: bring the target into view, then measure. The target may mount a beat late
  // (the tour opens the Search view first), so retry briefly before falling back to centred.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const el = step.target ? document.querySelector(step.target) : null;
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (measure()) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (measure() || tries >= 12) window.clearInterval(timer);
    }, 60);
    return () => window.clearInterval(timer);
  }, [isOpen, step, measure]);

  // Card content changes height between steps — re-place when it does.
  useEffect(() => {
    if (!isOpen || !cardRef.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(cardRef.current);
    return () => ro.disconnect();
  }, [isOpen, scheduleMeasure]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    return () => {
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      cancelAnimationFrame(rafRef.current);
    };
  }, [isOpen, scheduleMeasure]);

  // Each step lands focus on its primary action, so Enter always means "continue".
  useEffect(() => {
    if (isOpen) primaryRef.current?.focus({ preventScroll: true });
  }, [isOpen, index]);

  const finish = useCallback(() => {
    persistCompletion();
    onClose();
  }, [onClose]);

  const next = useCallback(() => {
    if (index < TOUR_STEPS.length - 1) setIndex(index + 1);
    else finish();
  }, [index, finish]);

  const back = useCallback(() => {
    if (index > 0) setIndex(index - 1);
  }, [index]);

  const runPreset = useCallback(
    (preset: OnboardingPreset) => {
      persistCompletion();
      onSelectPreset?.(preset);
      onClose();
    },
    [onClose, onSelectPreset]
  );

  const openConnections = useCallback(() => {
    persistCompletion();
    onClose();
    if (onOpenSettings) onOpenSettings("connections");
    else openSettingsTab("connections");
  }, [onClose, onOpenSettings, openSettingsTab]);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".app-shell");
    if (!shell) return;
    if (isOpen) {
      shell.setAttribute("inert", "");
    } else {
      shell.removeAttribute("inert");
    }
    return () => {
      shell.removeAttribute("inert");
    };
  }, [isOpen]);

  // Keyboard: Esc ends, ←/→ move, Tab stays inside the card.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish();
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (typing) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      } else if (e.key === "Tab" && cardRef.current) {
        const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const inside = cardRef.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, next, back, finish]);

  if (!isOpen) return null;

  const cardStyle: React.CSSProperties | undefined =
    layout.mode === "sheet" ? undefined : { top: layout.top, left: layout.left };

  // With no target the spotlight shrinks to the centre, so the scrim reads as one continuous dim.
  const spotStyle: React.CSSProperties = spot
    ? { top: spot.top, left: spot.left, width: spot.width, height: spot.height }
    : { top: "50%", left: "50%", width: 0, height: 0 };

  return createPortal(
    <div className="tour-root" data-testid="onboarding-tour">
      {/* Swallows clicks on the page behind: the tour ends only through its own controls or Esc,
          so a stray click on a first visit does not throw it away. */}
      <div className="tour-scrim" aria-hidden="true" />
      <div
        className="tour-spotlight"
        data-active={spot ? true : undefined}
        style={spotStyle}
        aria-hidden="true"
        data-testid="tour-spotlight"
      />

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="tour-card"
        data-mode={layout.mode}
        data-side={layout.mode === "anchored" ? layout.side : undefined}
        style={cardStyle}
      >
        <div key={step.id} className="tour-card-inner">
          <header className="tour-head">
            <span className="tour-eyebrow" aria-live="polite">
              {isWelcome ? "Quick tour · about a minute" : `Step ${index} of ${STOP_COUNT}`}
            </span>
            <button type="button" className="tour-icon-btn" onClick={finish} aria-label="Close tour" title="Close (Esc)">
              <X className="w-4 h-4" />
            </button>
          </header>

          <h2 id={titleId} className="tour-title">{step.title}</h2>
          <p id={bodyId} className="tour-body">{step.body}</p>

          {step.id === "welcome" && <FlowPreview />}
          {step.id === "query" && <NotationList />}
          {step.id === "navigate" && <Shortcuts />}
          {step.id === "connections" && <ConnectionStatus onOpen={openConnections} />}
          {step.id === "benchmarks" && <PresetList onSelect={runPreset} />}
        </div>

        <footer className="tour-foot">
          {isWelcome ? (
            <button type="button" className="tour-btn tour-btn-ghost" onClick={finish}>
              Skip tour
            </button>
          ) : (
            <div className="tour-dots" role="progressbar" aria-label="Tour progress" aria-valuemin={1} aria-valuemax={STOP_COUNT} aria-valuenow={index}>
              {TOUR_STEPS.slice(1).map((s, i) => (
                <span key={s.id} className="tour-dot" data-state={i + 1 === index ? "current" : i + 1 < index ? "done" : undefined} />
              ))}
            </div>
          )}

          <div className="tour-foot-actions">
            {!isWelcome && (
              <button type="button" className="tour-btn tour-btn-ghost" onClick={back}>
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                Back
              </button>
            )}
            <button ref={primaryRef} type="button" className="tour-btn tour-btn-primary" onClick={next}>
              {isWelcome ? "Show me around" : isLast ? "Done" : "Next"}
              {!isLast && <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}

export default React.memo(OnboardingModal);
