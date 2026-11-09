import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { PROVIDER_STATE_LABELS } from "../../shared/providerStatus";
import type { ServiceDetailRow, ServiceStatusCard } from "./serviceCardModel";

/** Dot colour for an opened detail line. Absent is deliberately the border token, not a warning. */
const DETAIL_DOT: Record<NonNullable<ServiceDetailRow["tone"]>, string> = {
  ready: "bg-[var(--cs-text-success)]",
  warming: "bg-[var(--cs-text-warning)]",
  absent: "bg-cs-border",
  info: "bg-cs-text-muted"
};

/**
 * The leading dot. Only `needs-action` pulses, because it is the only state the reader must act on.
 * The colours are semantic tokens, so they follow the theme and print flattening.
 */
function statusDotClass(svc: ServiceStatusCard): string {
  if (svc.state === "unreachable") return "bg-[var(--cs-text-danger)]";
  if (svc.emphasis === "needs-action") return "bg-[var(--cs-text-warning)] animate-pulse";
  if (svc.emphasis === "unknown" || svc.state === "stale") return "bg-cs-text-muted";
  if (svc.state === "degraded") return "bg-[var(--cs-text-warning)]";
  if (svc.state === "connected" || svc.state === "configured") return "bg-[var(--cs-text-success)]";
  return "bg-cs-border";
}

/** The tinted chip for the states that need attention. Nominal states never reach this. */
function statusPillClass(svc: ServiceStatusCard): string {
  if (svc.state === "unreachable") return "bg-[var(--cs-bg-danger)] text-[var(--cs-text-danger-on-soft)]";
  if (svc.emphasis !== "unknown" && (svc.state === "degraded" || svc.emphasis === "needs-action")) {
    return "bg-[var(--cs-bg-warning)] text-[var(--cs-text-warning-on-soft)]";
  }
  return "bg-cs-surface-2 text-cs-text-secondary";
}

/** Rendered as quiet text rather than a coloured chip. */
function isNominal(svc: ServiceStatusCard): boolean {
  return (svc.state === "connected" || svc.state === "configured") && !svc.emphasis;
}

interface ServiceRowProps {
  svc: ServiceStatusCard;
  isOpen: boolean;
  onToggle: () => void;
  /** When the reading was taken, already formatted for the reader. */
  sweptAtLabel: string | null;
}

export function ServiceRow({ svc, isOpen, onToggle, sweptAtLabel }: ServiceRowProps) {
  const isExpandable = Boolean(svc.explain);
  const nominal = isNominal(svc);
  const slow = typeof svc.latency === "string" && parseInt(svc.latency, 10) >= 1000;
  /**
   * A row may carry an action (re-check, open Settings), an explanation, or both, and
   * the two are never exposed on the same surface.
   *
   * An expandable row opens when its header is clicked. Its action moves into the
   * drawer as a plain button, so the reader sees what the click will do before doing it,
   * and a click on the row can never fire an action by accident. Only a row that cannot
   * expand keeps the whole-row action, because it has no drawer to hold a button.
   */
  const rowAction = svc.onAction;
  const rowOverlayAction = isExpandable ? undefined : rowAction;
  /**
   * The chevron is THE disclosure control: one role, one tab stop, one `aria-expanded`,
   * and a name that says what it opens. The row header is only a wider hit target for
   * the same action, never a second control — a row that is both a button and contains
   * a button gives a keyboard user two tab stops for one thing, and nesting the two is
   * invalid HTML. A row with nothing to do keeps no role even though it can open:
   * `LiveTelemetryFallback.test.tsx` pins this, and it is right — a row with nothing to
   * do must not look like a control.
   */
  const rowLabel = svc.actionLabel ?? `Configure ${svc.name} settings`;
  return (
    <div className="flex flex-col">
    <div
      data-service-id={svc.id}
      data-expanded={isExpandable ? (isOpen ? "true" : "false") : undefined}
      onClick={isExpandable ? onToggle : undefined}
      className={`telemetry-service group relative flex items-center gap-2.5 select-none transition-colors duration-150 ${
        svc.emphasis === "outage"
          ? "bg-[var(--cs-bg-danger)]"
          : svc.emphasis === "covered" || svc.emphasis === "warming"
          ? "bg-[var(--cs-bg-warning)]"
          : ""
      } ${
        rowAction || isExpandable
          ? "cursor-pointer hover:bg-cs-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cs-accent-clay)]"
          : ""
      }`}
    >
      {rowOverlayAction && <button type="button" aria-label={rowLabel}
        onClick={rowOverlayAction}
        className="absolute inset-0 rounded-[inherit] cursor-pointer active:bg-cs-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cs-accent-clay)]" />}
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotClass(svc)}`} aria-hidden="true" />

      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[12.5px] font-medium text-cs-text-primary truncate">{svc.name}</span>
        </div>
        <span
          className="text-[11px] text-cs-text-muted truncate leading-snug"
          title={svc.detail ?? svc.description}
        >
          {svc.description}
        </span>
      </div>

      <div className="telemetry-service-state">
        {/* Nominal states are quiet text; only a state that needs a reader's eye gets a
            tinted chip. Ten identical green chips said one thing ten times. */}
        <span
          className={
            nominal
              ? "text-[11px] text-cs-text-secondary whitespace-nowrap"
              : `text-[11px] font-medium px-1.5 py-0.5 rounded-[var(--cs-radius-badge)] whitespace-nowrap ${statusPillClass(svc)}`
          }
        >
          {PROVIDER_STATE_LABELS[svc.state]}
        </span>
        {/* A row whose whole surface is the action must SAY so. Only the non-expandable
            case lands here: an expandable row's gutter is its one disclosure chevron
            below, and a second glyph beside it read as two controls for one row. */}
        {rowOverlayAction && (
          <span
            className="text-cs-text-muted group-hover:text-cs-text-primary transition-colors duration-150"
            aria-hidden="true"
          >
            {svc.actionIcon ?? <ChevronRight className="w-3.5 h-3.5" />}
          </span>
        )}
        {/* The disclosure affordance, only on a row that opens, and the row's only glyph.
            A chevron that rotates rather than a "+"/"−" pair: one glyph, and its
            orientation states which way the panel will move.

            It is a real <button> because that is the only way a keyboard reader gets a
            control that is reachable and named. Its name states what it opens and its
            state, and says nothing about the row's action: that action lives in the
            drawer under its own name. `stopPropagation` keeps the chevron from also
            firing the row's own click. */}
        {isExpandable && (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onToggle();
            }}
            aria-label={`${isOpen ? "Hide" : "Show"} details for ${svc.name}`}
            aria-expanded={isOpen}
            data-tap-edge="end"
            className="relative z-10 cs-tap-44 w-7 h-7 inline-flex items-center justify-center rounded-[var(--cs-radius-input)] text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-bg-subtle active:bg-cs-surface-2 transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cs-accent-clay)]"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
            />
          </button>
        )}
      </div>
    </div>

    {/* ── Expanded detail ── */}
    {isExpandable && isOpen && (
      <div
        data-service-detail={svc.id}
        className="telemetry-detail"
      >
        {(svc.tag || svc.latency) && <p className="telemetry-detail-meta">
          {svc.tag && <span>{svc.tag}</span>}
          {svc.latency && <span title={slow ? "Responding slowly" : "Last round-trip"}>Response {svc.latency}</span>}
        </p>}
        <p className="text-[11.5px] font-medium text-cs-text-primary m-0">
          {svc.explain!.heading}
        </p>
        <p className="text-[11.5px] leading-relaxed text-cs-text-secondary m-0">
          {svc.explain!.body}
        </p>
        {/* The row's action, as a named button in the drawer. Its name is the action's own
            (re-check, relink, open Settings), so a reader reads what it does before
            pressing it. It is a real button, so the keyboard path is the platform's. */}
        {rowAction && (
          <button
            type="button"
            onClick={() => rowAction()}
            className="self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--cs-radius-input)] text-[11.5px] font-medium text-cs-text-primary bg-cs-surface-2 hover:bg-cs-bg-subtle active:bg-cs-surface-2 transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cs-accent-clay)]"
          >
            {svc.actionIcon}
            {svc.actionLabel ?? "Configure connection"}
          </button>
        )}
        {svc.detailRows && svc.detailRows.length > 0 && (
          <ul className="flex flex-col gap-1 m-0 p-0 list-none">
            {svc.detailRows.map(row => (
              <li key={row.label} className="flex items-baseline gap-2 min-w-0">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 translate-y-[-1px] ${DETAIL_DOT[row.tone ?? "info"]}`}
                  aria-hidden="true"
                />
                <span className="text-[11px] text-cs-text-muted min-w-0 flex-1 leading-snug">
                  {row.label}
                </span>
                <span className="text-[11px] font-medium text-cs-text-secondary whitespace-nowrap">
                  {row.value}
                </span>
              </li>
            ))}
          </ul>
        )}
        {/* How current this reading is. A cold start resolves itself, so an
            explanation with no timestamp cannot be distinguished from one the reader
            opened three minutes ago and never closed. */}
        {sweptAtLabel && (
          <span className="text-[10.5px] text-cs-text-muted tabular-nums">
            Checked at {sweptAtLabel}
          </span>
        )}
      </div>
    )}
    </div>
  );
}
