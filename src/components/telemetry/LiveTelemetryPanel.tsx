import React, { useEffect, useState } from "react";
import { RefreshCw, Settings } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import { useApiConnections } from "../../hooks/useApiConnections";
import { ServiceRow } from "./ServiceRow";
import {
  ageLabel,
  buildServiceCards,
  summarizeServices,
  summaryLabel,
  summaryTitle,
  type ServiceSummary
} from "./serviceSummary";
import { useServiceCardContext } from "./useServiceCardContext";
import "../../styles/telemetry.css";

export type { ServiceSummary };

interface LiveTelemetryPanelProps {
  onConfigureClick?: (tab: "connections" | "api") => void;
  /** Called whenever the reading changes, so a parent never recomputes health from the raw diagnostics. */
  onSummary?: (summary: ServiceSummary) => void;
  className?: string;
}

export const LiveTelemetryPanel: React.FC<LiveTelemetryPanelProps> = ({
  onConfigureClick,
  onSummary,
  className = ""
}) => {
  const { openSettingsTab } = useSettings();
  const gemini = useApiConnections();

  /**
   * Which row is open. One at a time, because the rail is narrow and two open explanations would
   * push every other service out of view — the reader would lose the list they came to read in
   * order to understand one entry in it.
   */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpanded = (id: string) =>
    setExpandedId(prev => (prev === id ? null : id));

  const handleConfigure = (tab: "connections" | "api" = "connections") => {
    if (onConfigureClick) {
      onConfigureClick(tab);
    } else {
      openSettingsTab(tab);
    }
  };

  const { ctx, stale, sweptAtLabel, checkedAt, now, loading, refresh } = useServiceCardContext({ configure: handleConfigure, gemini });
  const { isLoaded, isChecking } = ctx;
  const services = buildServiceCards(ctx, stale);
  const summary = summarizeServices(services, isLoaded, isChecking, stale);
  const { online, total, tone } = summary;
  useEffect(() => {
    onSummary?.({ online, total, tone, stale });
  }, [onSummary, online, total, tone, stale]);
  const age = ageLabel(checkedAt, now);

  const groups: Array<{ id: string; label: string; items: typeof services }> = [
    { id: "data", label: "Data sources", items: services.filter(s => s.category !== "compute") },
    { id: "compute", label: "Models & engines", items: services.filter(s => s.category === "compute") },
  ];

  return (
    <div className={`telemetry-panel ${className}`}>
      {/* ── Summary: one sentence, one tone, and the two actions ── */}
      <div className="telemetry-summary">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="sr-only">Service status</h2>
          <span
            className={`inline-flex items-center gap-2 text-[12px] font-medium min-w-0 ${SUMMARY_TEXT[tone]}`}
            title={summaryTitle(services, summary, stale, age)}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${SUMMARY_DOT[tone]}`} aria-hidden="true" />
            <span className="truncate">{summaryLabel(services, summary, stale, age)}</span>
          </span>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => refresh()}
            disabled={loading}
            title="Re-check all services"
            className={ICON_BUTTON}
            aria-label="Ping all services"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => handleConfigure("connections")}
            title="Connection settings"
            className={ICON_BUTTON}
            aria-label="Configure connection settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Grouped service list ── */}
      {/* Scrolls inside the rail only where the rail is height-locked (lg+); stacked on small screens
          the list simply flows, since a nested scroller in a scrolling page is a trap. Paddings are
          kept to what the full list needs — a taller phantom bottom padding used to push the content
          a few pixels past the rail floor, so a scrollbar appeared (and a row was clipped) even with
          visible space left in the panel. The fade stays paired with that padding as the scroll cue. */}
      <div className="telemetry-scroll">
      <div className="telemetry-groups">
        {groups.map(group => (
          <section key={group.id} aria-label={group.label} className="flex flex-col gap-1.5">
            <h3 className="telemetry-group-title">{group.label}<span>{group.items.length}</span></h3>
            <div className="telemetry-service-list">
              {group.items.map(svc => (
                <ServiceRow
                  key={svc.id}
                  svc={svc}
                  isOpen={expandedId === svc.id}
                  onToggle={() => toggleExpanded(svc.id)}
                  sweptAtLabel={sweptAtLabel}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      </div>

    </div>
  );
};

const ICON_BUTTON =
  "relative cs-tap-44 w-7 h-7 inline-flex items-center justify-center rounded-[var(--cs-radius-input)] text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-bg-subtle transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)]";

const SUMMARY_TEXT = {
  checking: "text-cs-text-muted",
  danger: "text-[var(--cs-text-danger-on-soft)]",
  warn: "text-[var(--cs-text-warning-on-soft)]",
  ok: "text-cs-text-primary",
} as const;

const SUMMARY_DOT = {
  checking: "bg-cs-text-muted animate-pulse",
  danger: "bg-[var(--cs-text-danger)]",
  warn: "bg-[var(--cs-text-warning)]",
  ok: "bg-[var(--cs-text-success)]",
} as const;

export default React.memo(LiveTelemetryPanel);
