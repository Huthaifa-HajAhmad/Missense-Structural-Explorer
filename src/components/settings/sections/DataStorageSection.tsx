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
import { SettingsBlock, SettingsRow, SettingsSection } from "../ui/Section";
import { DEFAULT_USER_SETTINGS, TRANSIENT_SETTING_KEYS } from "../defaults";
import { clearClientVariantCache } from "../../../services/pipeline/variantCache";
import type { UserSettings } from "../../../types";

const IMPORT_SCHEMA = z.object({
  __type: z.string().optional(),
  version: z.number().optional(),
  settings: z.record(z.string(), z.unknown()).optional()
}).passthrough();

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
      className={`cs-btn-ghost h-8 active:scale-[0.97] transition-all duration-150 ${
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
      const raw = localStorage.getItem("variantHistoryObfuscated")
        || localStorage.getItem("variant_search_history")
        || localStorage.getItem("variantHistory")
        || "";
      if (!raw) return { count: 0, bytes: "0" };

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        try {
          parsed = JSON.parse(decodeURIComponent(escape(atob(raw))));
        } catch {
          parsed = null;
        }
      }

      const count = Array.isArray(parsed) ? parsed.length : 0;
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
      localStorage.removeItem("variant_search_history");
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

  const dangerBtn = (confirming: boolean) =>
    `cs-btn-ghost h-8 active:scale-[0.97] transition-all duration-150 !text-rose-600 dark:!text-rose-400 ${
      confirming ? "!border-rose-500/50 !bg-rose-500/10" : "hover:!bg-rose-500/10"
    }`;

  return (
    <div className="space-y-7">
      {/* ── Backup ── */}
      <SettingsSection
        title="Settings backup"
        hint="Export thresholds, view preferences, and model choices. Credentials are never exported."
      >
        <SettingsRow label="Preferences file" description="A portable JSON snapshot of this browser's settings.">
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton onClick={exportSettings} icon={<Download className="w-3.5 h-3.5" />}>
              Export
            </ActionButton>
            <ActionButton onClick={() => fileInputRef.current?.click()} icon={<Upload className="w-3.5 h-3.5" />}>
              Import
            </ActionButton>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="Import settings JSON file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importSettings(file);
                e.target.value = "";
              }}
            />
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* ── Local browser storage ── */}
      <SettingsSection
        title="Local storage & privacy"
        hint="Cached queries and session data kept in this browser."
      >
        <SettingsRow
          label="Search query history"
          description={`${historyStats.count} item${historyStats.count === 1 ? "" : "s"} stored locally · ${historyStats.bytes} KB`}
        >
          <button type="button" onClick={handleClearSearchHistory} className={dangerBtn(confirmHistoryClear)}>
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

      {/* ── Server caches ── */}
      <SettingsSection
        title="Lab server cache"
        hint="In-memory, FoldX repacking, and persistent SQLite lookup caches on the compute server."
      >
        <SettingsRow
          label="Pipeline registries"
          description={
            totalCached !== null
              ? `${diagnostics?.cacheDiagnostics ? Object.keys(diagnostics.cacheDiagnostics).length : 0} registries · ${totalCached} cached entries`
              : "Clear in-memory and disk caches on the lab server."
          }
        >
          <button type="button" onClick={purgeServerCaches} className={dangerBtn(confirmServerPurge)}>
            {confirmServerPurge ? <Check className="w-3.5 h-3.5" /> : <Database className="w-3.5 h-3.5" />}
            {confirmServerPurge ? "Confirm purge" : "Purge server caches"}
          </button>
        </SettingsRow>
      </SettingsSection>

      {dataStatus && (
        <p
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border border-cs-border-subtle bg-cs-surface px-3 py-2 text-[12px] text-cs-text-secondary"
        >
          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          {dataStatus}
        </p>
      )}

      {/* ── About / provenance ── */}
      <SettingsSection title="About">
        <SettingsBlock>
          <div className="flex items-start gap-3">
            <div className="grid place-items-center w-9 h-9 rounded-lg shrink-0 bg-cs-accent-clay/12 text-cs-accent-clay">
              <HardDrive className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h4 className="text-[13px] font-medium text-cs-text-primary">Scientific provenance &amp; attribution</h4>
                {onNavigateAbout && (
                  <button
                    type="button"
                    onClick={onNavigateAbout}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-cs-text-accent hover:underline underline-offset-2 cursor-pointer"
                  >
                    Open About guide
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-cs-text-muted max-w-[62ch]">
                Model commit hashes, database versions (dbNSFP, ClinVar, gnomAD, FoldX), and BibTeX citations live in
                the About view.
              </p>
            </div>
          </div>
        </SettingsBlock>
        <SettingsBlock className="!py-2.5">
          <div className="flex items-center justify-between gap-3 text-[12px] text-cs-text-muted">
            <span className="flex items-center gap-2">
              <Server className="w-3.5 h-3.5" />
              Missense Structural Explorer
            </span>
            <span className="font-mono text-[11px] [font-variant-numeric:tabular-nums]">
              v{version?.version || "1.0.0"}
              {version?.env ? ` · ${version.env}` : ""}
            </span>
          </div>
        </SettingsBlock>
      </SettingsSection>
    </div>
  );
}
