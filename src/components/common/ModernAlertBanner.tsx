import React, { useState } from "react";
import { 
  ShieldAlert, 
  KeyRound, 
  WifiOff, 
  AlertCircle, 
  X, 
  ChevronRight, 
  RotateCw, 
  Settings 
} from "lucide-react";
import { useSettings } from "../../context/SettingsContext";

export interface ModernAlertBannerProps {
  error: string | null;
  onDismiss: () => void;
  onRetry?: () => void;
}

type ErrorCategory = "auth" | "rate_limit" | "network" | "data" | "general";

interface ClassifiedError {
  category: ErrorCategory;
  categoryLabel: string;
  title: string;
  message: string;
  actionText?: string;
  actionType?: "settings_api" | "retry" | "none";
}

function classifyErrorMessage(rawError: string): ClassifiedError {
  const lower = rawError.toLowerCase();

  // 1. Authentication / Unauthorized
  if (
    lower.includes("unauthorized") || 
    lower.includes("401") || 
    lower.includes("api key") || 
    lower.includes("unauthenticated") ||
    lower.includes("forbidden") ||
    lower.includes("403")
  ) {
    return {
      category: "auth",
      categoryLabel: "Authentication Required",
      title: "API Key Not Configured or Expired",
      message: "Biophysical analysis and narrative synthesis require a valid API key.",
      actionText: "Configure API Key",
      actionType: "settings_api",
    };
  }

  // 2. Quota / Rate Limiting
  if (lower.includes("rate limit") || lower.includes("quota") || lower.includes("429") || lower.includes("resource exhausted")) {
    return {
      category: "rate_limit",
      categoryLabel: "Quota Exceeded",
      title: "API Rate Limit Reached",
      message: "The model request was throttled by the provider. Please wait a moment or update your API key.",
      actionText: "Check Settings",
      actionType: "settings_api",
    };
  }

  // 3. Network / Connection
  if (lower.includes("network") || lower.includes("timeout") || lower.includes("failed to fetch") || lower.includes("econnrefused")) {
    return {
      category: "network",
      categoryLabel: "Network Degradation",
      title: "Service Connection Interrupted",
      message: "Unable to reach the biophysical predictor endpoint. Please verify server connectivity.",
      actionText: "Retry",
      actionType: "retry",
    };
  }

  // 4. Variant / Data Not Found
  if (lower.includes("not found") || lower.includes("404") || lower.includes("unsupported format")) {
    return {
      category: "data",
      categoryLabel: "Input Warning",
      title: "Variant Record Not Resolved",
      message: rawError.replace(/^Error:\s*/i, ""),
      actionType: "none",
    };
  }

  // 5. General Fallback
  return {
    category: "general",
    categoryLabel: "Pipeline Notice",
    title: "Analysis Step Notice",
    message: rawError.replace(/^Error:\s*/i, ""),
    actionType: "none",
  };
}

export function ModernAlertBanner({ error, onDismiss, onRetry }: ModernAlertBannerProps) {
  const { openSettingsTab } = useSettings();
  const [isExpanded, setIsExpanded] = useState(false);

  if (!error) return null;

  const info = classifyErrorMessage(error);

  const handleAction = () => {
    if (info.actionType === "settings_api") {
      openSettingsTab("api");
    } else if (info.actionType === "retry" && onRetry) {
      onRetry();
    }
  };

  // Color theme mapping
  const badgeStyles = {
    auth: "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400",
    rate_limit: "bg-orange-500/10 border-orange-500/30 text-orange-600 dark:text-orange-400",
    network: "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400",
    data: "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400",
    general: "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400",
  }[info.category];

  const IconComponent = {
    auth: KeyRound,
    rate_limit: AlertCircle,
    network: WifiOff,
    data: AlertCircle,
    general: ShieldAlert,
  }[info.category];

  return (
    <div className="w-full px-4 pt-2.5 pb-1 flex justify-center z-20 shrink-0">
      <div 
        role="alert"
        aria-live="assertive"
        className="w-full max-w-5xl rounded-xl border border-amber-500/25 dark:border-amber-500/20 bg-amber-50/70 dark:bg-[#1a1714]/90 backdrop-blur-md shadow-xs transition-all duration-200 overflow-hidden"
      >
        <div className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Left info block */}
          <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
            <span className={`p-1.5 rounded-lg shrink-0 border ${badgeStyles}`}>
              <IconComponent className="w-4 h-4" />
            </span>

            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2.5 min-w-0 flex-1">
              <span className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded border self-start shrink-0 ${badgeStyles}`}>
                {info.categoryLabel}
              </span>

              <p className="text-[12px] font-medium text-cs-text-primary leading-snug truncate">
                <span className="font-semibold">{info.title}:</span>{" "}
                <span className="text-cs-text-secondary">{info.message}</span>
              </p>
            </div>
          </div>

          {/* Right Action buttons */}
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            {info.actionType === "settings_api" && (
              <button
                type="button"
                onClick={handleAction}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11.5px] font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
                {info.actionText || "Configure Key"}
                <ChevronRight className="w-3 h-3 opacity-75" />
              </button>
            )}

            {info.actionType === "retry" && onRetry && (
              <button
                type="button"
                onClick={handleAction}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11.5px] font-semibold bg-cs-surface-2 hover:bg-cs-surface border border-cs-border text-cs-text-primary transition-all active:scale-95 cursor-pointer"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Retry
              </button>
            )}

            {/* Expand technical details toggle */}
            <button
              type="button"
              onClick={() => setIsExpanded(prev => !prev)}
              title="Toggle Technical Error Details"
              className="text-[11px] font-mono text-cs-text-muted hover:text-cs-text-secondary px-1.5 py-1 rounded transition-colors cursor-pointer"
            >
              {isExpanded ? "Hide Details" : "Details"}
            </button>

            {/* Dismiss button */}
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss alert"
              className="p-1 rounded-md text-cs-text-muted hover:text-cs-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Technical stack trace drawer */}
        {isExpanded && (
          <div className="px-3.5 pb-3 pt-1 border-t border-amber-500/15 dark:border-amber-500/10 text-[11px] font-mono text-cs-text-muted bg-black/5 dark:bg-black/25">
            <span className="block text-[10px] uppercase font-bold tracking-wider mb-1 opacity-70">
              Raw Pipeline Exception:
            </span>
            <div className="p-2 rounded bg-cs-surface border border-cs-border-subtle select-text overflow-x-auto text-rose-600 dark:text-rose-400">
              {error}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ModernAlertBanner;
