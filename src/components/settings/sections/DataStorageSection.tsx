import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  ArrowUpRight,
  Check,
  Database,
  Download,
  Eraser,
  HardDrive,
  RefreshCw,
  Server,
  Upload
} from "lucide-react";
import { useSettings } from "../../../context/SettingsContext";
import { useDiagnostics } from "../../../hooks/useDiagnostics";
import { SettingsRow, SettingsSection } from "../ui/Section";
import { DEFAULT_USER_SETTINGS, TRANSIENT_SETTING_KEYS } from "../defaults";
import { clearClientVariantCache } from "../../../services/pipeline/variantCache";
import type { UserSettings } from "../../../types";

const IMPORT_SCHEMA = z.object({
  __type: z.string().optional(),
  version: z.number().optional(),
  settings: z.record(z.string(), z.unknown()).optional()
});

function ActionButton({
  onClick,
  icon,
  children,
  danger = false
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cs-btn-ghost active:scale-[0.97] transition-all duration-150 ${
        danger ? "!text-rose-600 dark:!text-rose-400 hover:!bg-rose-500/10" : ""
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

export function DataStorageSection({ onNavigateAbout }: { onNavigateAbout?: () => void }) {
  const { settings, applySettings } = useSettings();
  const { version, diagnostics, refresh } = useDiagnostics();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dataStatus, setDataStatus] = useState<string | null>(null);
  const [confirmServerPurge, setConfirmServerPurge] = useState(false);
  const [confirmHistoryClear, setConfirmHistoryClear] = useState(false);

  const flashStatus = (message: string) => {
    setDataStatus(message);
    window.setTimeout(() => setDataStatus(null), 4000);
  };

  const historyStats = useMemo(() => {
    try {
      const raw = localStorage.getItem("variantHistoryObfuscated") || localStorage.getItem("variantHistory") || "";
      const count = raw ? (JSON.parse(raw) as unknown[]).length : 0;
      const bytes = new Blob([raw]).size;
      return { count, bytes: (bytes / 1024).toFixed(1) };
    } catch {
      return { count: 0, bytes: "0" };
    }
  }, [dataStatus]);

  const exportSettings = () => {
    const payload: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_USER_SETTINGS)) {
      if ((TRANSIENT_SETTING_KEYS as readonly string[]).includes(key)) continue;
      payload[key] = (settings as unknown as Record<string, unknown>)[key];
    }
    const blob = new Blob(
      [JSON.stringify({ __type: "missense-settings", version: 1, settings: payload }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "missense-settings.json";
    anchor.click();
    URL.revokeObjectURL(url);
    flashStatus("Settings exported. API tokens and credentials are never included.");
  };

  const importSettings = async (file: File) => {
    try {
      const parsed = IMPORT_SCHEMA.parse(JSON.parse(await file.text()));
      const incoming = parsed.settings && Object.keys(parsed.settings).length > 0
        ? parsed.settings
        : (() => {
            const { __type: _t, version: _v, settings: _s, ...rest } = parsed as Record<string, unknown>;
            return rest;
          })();

      const whitelisted: Partial<UserSettings> = {};
      const defaultsRecord = DEFAULT_USER_SETTINGS as unknown as Record<string, unknown>;
      for (const key of Object.keys(DEFAULT_USER_SETTINGS)) {
        if ((TRANSIENT_SETTING_KEYS as readonly string[]).includes(key)) continue;
        const value = incoming[key];
        if (value === undefined) continue;
        const expected = defaultsRecord[key];
        if (typeof expected === "object" && expected !== null) {
          if (typeof value === "object" && value !== null) {
            (whitelisted as unknown as Record<string, unknown>)[key] = value;
          }
        } else if (typeof value === typeof expected) {
          (whitelisted as unknown as Record<string, unknown>)[key] = value;
        }
      }
      const applied = Object.keys(whitelisted).length;
      if (applied === 0) {
        flashStatus("No recognizable settings found in that file.");
        return;
      }
      applySettings(whitelisted);
      flashStatus(`Imported ${applied} setting${applied === 1 ? "" : "s"} successfully.`);
    } catch {
      flashStatus("Import failed — file is not a valid settings export.");
    }
  };

  const handleClearSearchHistory = () => {
    if (!confirmHistoryClear) {
      setConfirmHistoryClear(true);
      window.setTimeout(() => setConfirmHistoryClear(false), 3000);
      return;
    }
    setConfirmHistoryClear(false);
    try {
      localStorage.removeItem("variantHistoryObfuscated");
      localStorage.removeItem("variantHistory");
      flashStatus("Search history cleared from this browser.");
    } catch {
      flashStatus("Could not clear search history.");
    }
  };

  const purgeClientCache = () => {
    clearClientVariantCache();
    flashStatus("Client variant session snapshots purged.");
  };

  const purgeServerCaches = async () => {
    if (!confirmServerPurge) {
      setConfirmServerPurge(true);
      window.setTimeout(() => setConfirmServerPurge(false), 3000);
      return;
    }
    setConfirmServerPurge(false);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (settings.appApiToken) headers["Authorization"] = `Bearer ${settings.appApiToken}`;
      if (settings.geminiSessionId) headers["X-Gemini-Session-ID"] = settings.geminiSessionId;
      const res = await fetch("/api/v1/debug/clear-caches", { method: "POST", headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.message || data.error || `HTTP ${res.status}`);
      clearClientVariantCache();
      flashStatus("All server and client variant caches purged.");
      refresh();
    } catch (err) {
      flashStatus(err instanceof Error ? err.message : "Server cache purge failed.");
    }
  };

  const totalCached = diagnostics?.cacheDiagnostics
    ? Object.values(diagnostics.cacheDiagnostics).reduce((sum, cache) => sum + cache.size, 0)
    : null;

  return (
    <div className="space-y-6">
      {/* ── Scientific Provenance Bridge Callout ── */}
      <div className="p-3.5 rounded-xl border border-cs-border-subtle bg-cs-surface-2 flex items-start gap-3">
        <div
          className="p-2 rounded-lg shrink-0 mt-0.5"
          style={{ background: "rgba(196, 104, 73, 0.12)" }}
        >
          <HardDrive className="w-4 h-4 text-cs-accent-clay" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[12px] font-semibold text-cs-text-primary">
              Scientific Provenance &amp; Attribution
            </h4>
            {onNavigateAbout && (
              <button
                type="button"
                onClick={onNavigateAbout}
                className="text-[11px] font-medium text-cs-accent-clay hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
              >
                Open About Guide
                <ArrowUpRight className="w-3 h-3" />
              </button>
            )}
          </div>
          <p className="text-[11px] text-cs-text-muted mt-1 leading-relaxed">
            Foundation model commit hashes, database versions (dbNSFP, ClinVar, gnomAD, FoldX), and BibTeX citations are centralized in the master <strong>About</strong> view.
          </p>
        </div>
      </div>

      {/* ── Backup & Synchronization ── */}
      <SettingsSection
        title="Settings backup"
        hint="Export customized thresholds, view preferences, and model configs. Credentials are never exported."
      >
        <div className="py-3 flex flex-wrap items-center gap-2.5">
          <ActionButton onClick={exportSettings} icon={<Download className="w-3.5 h-3.5" />}>
            Export settings JSON
          </ActionButton>
          <ActionButton onClick={() => fileInputRef.current?.click()} icon={<Upload className="w-3.5 h-3.5" />}>
            Import settings JSON
          </ActionButton>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importSettings(file);
              e.target.value = "";
            }}
          />
        </div>
      </SettingsSection>

      {/* ── Local Browser Storage & Privacy ── */}
      <SettingsSection
        title="Local storage & privacy"
        hint="Manage cached queries and session data stored in this browser."
      >
        <SettingsRow
          label="Search query history"
          description={`Locally stored queries: ${historyStats.count} item${historyStats.count === 1 ? "" : "s"} (${historyStats.bytes} KB).`}
        >
          <button
            type="button"
            onClick={handleClearSearchHistory}
            className={`cs-btn-ghost active:scale-[0.97] transition-all duration-150 ${
              confirmHistoryClear
                ? "!text-rose-600 dark:!text-rose-400 !border-rose-500/40 !bg-rose-500/10"
                : "!text-rose-600 dark:!text-rose-400 hover:!bg-rose-500/10"
            }`}
          >
            {confirmHistoryClear ? <Check className="w-3.5 h-3.5" /> : <Eraser className="w-3.5 h-3.5" />}
            {confirmHistoryClear ? "Confirm clear" : "Clear history"}
          </button>
        </SettingsRow>

        <SettingsRow
          label="Client variant snapshots"
          description="Session-scoped snapshots of analyzed variants, 3D structures, and energetics."
        >
          <ActionButton onClick={purgeClientCache} icon={<RefreshCw className="w-3.5 h-3.5" />} danger>
            Purge snapshots
          </ActionButton>
        </SettingsRow>
      </SettingsSection>

      {/* ── Server Pipeline & Model Caches ── */}
      <SettingsSection
        title="Lab server cache"
        hint="In-memory, FoldX repacking, and persistent SQLite lookup caches on the compute server."
      >
        <SettingsRow
          label="Pipeline registries"
          description={
            totalCached !== null
              ? `${diagnostics?.cacheDiagnostics ? Object.keys(diagnostics.cacheDiagnostics).length : 0} cache registries holding ${totalCached} entries.`
              : "Clear in-memory and disk caches on the lab server."
          }
        >
          <button
            type="button"
            onClick={purgeServerCaches}
            className={`cs-btn-ghost active:scale-[0.97] transition-all duration-150 ${
              confirmServerPurge
                ? "!text-rose-600 dark:!text-rose-400 !border-rose-500/40 !bg-rose-500/10"
                : "!text-rose-600 dark:!text-rose-400 hover:!bg-rose-500/10"
            }`}
          >
            {confirmServerPurge ? <Check className="w-3.5 h-3.5" /> : <Database className="w-3.5 h-3.5" />}
            {confirmServerPurge ? "Confirm purge" : "Purge server caches"}
          </button>
        </SettingsRow>

        <div className="py-2.5 flex items-center justify-between text-[11px] text-cs-text-muted border-t border-cs-border-subtle">
          <div className="flex items-center gap-2">
            <Server className="w-3.5 h-3.5 text-cs-text-muted" />
            <span>Missense Structural Explorer</span>
          </div>
          <span className="font-mono text-[10px] [font-variant-numeric:tabular-nums]">
            v{version?.version || "1.0.0"}{version?.env ? ` · ${version.env}` : ""}
          </span>
        </div>

        {dataStatus && (
          <p role="status" aria-live="polite" className="text-[11px] text-cs-text-secondary py-2">
            {dataStatus}
          </p>
        )}
      </SettingsSection>
    </div>
  );
}
