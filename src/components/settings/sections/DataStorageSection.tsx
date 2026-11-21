import { useRef, useState } from "react";
import {
  AlertCircle,
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
import { useOptionalAccount } from "../../../context/AccountContext";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { downloadBlob } from "../../../lib/download";
import { useDiagnostics } from "../../../hooks/useDiagnostics";
import { useAppVersion, versionLabel } from "../../../hooks/useAppVersion";
import { SettingsBlock, SettingsRow, SettingsSection } from "../ui/Section";
import { readSettingsBackup, writeSettingsBackup } from "../settingsBackup";
import { clearClientVariantCache } from "../../../services/pipeline/variantCache";

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
  const { settings, applySettings, theme, setTheme } = useSettings();
  const { diagnostics, refresh } = useDiagnostics();
  const version = useAppVersion();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const account = useOptionalAccount();
  // The server lets an admin purge, or anyone holding the server token (the no-accounts setup).
  const canPurgeServer = !account?.accountsEnabled || account.user?.role === "admin";
  const history = useVariantAnalysisStore((s) => s.history);
  const clearHistory = useVariantAnalysisStore((s) => s.clearHistory);

  const [dataStatus, setDataStatus] = useState<{ message: string; failed: boolean } | null>(null);
  const [confirmServerPurge, setConfirmServerPurge] = useState(false);
  const [confirmHistoryClear, setConfirmHistoryClear] = useState(false);

  const statusTimer = useRef<number | undefined>(undefined);
  // Success notes fade; a failure stays until the next action so the reader can act on it. Each new
  // note cancels the previous note's timer, so an old success cannot clear a newer error.
  const flashStatus = (message: string, failed = false) => {
    window.clearTimeout(statusTimer.current);
    setDataStatus({ message, failed });
    if (!failed) statusTimer.current = window.setTimeout(() => setDataStatus(null), 4000);
  };

  const exportSettings = () => {
    downloadBlob("missense-settings.json", "application/json", writeSettingsBackup(settings, theme));
    flashStatus("Settings exported. API tokens and credentials are never included.");
  };

  const importSettings = async (file: File) => {
    try {
      const backup = readSettingsBackup(await file.text());
      const applied = Object.keys(backup.settings).length + (backup.theme ? 1 : 0);
      const skippedNote = backup.skipped.length > 0
        ? ` Skipped ${backup.skipped.length} with a value this version does not offer: ${backup.skipped.join(", ")}.`
        : "";
      if (applied === 0) {
        flashStatus(`No usable settings found in that file.${skippedNote}`, true);
        return;
      }
      applySettings(backup.settings);
      if (backup.theme) setTheme(backup.theme);
      flashStatus(`Imported ${applied} setting${applied === 1 ? "" : "s"}.${skippedNote}`);
    } catch {
      flashStatus("Import failed — file is not a valid settings export.", true);
    }
  };

  const handleClearSearchHistory = () => {
    if (!confirmHistoryClear) {
      setConfirmHistoryClear(true);
      window.setTimeout(() => setConfirmHistoryClear(false), 3000);
      return;
    }
    setConfirmHistoryClear(false);
    clearHistory();
    flashStatus("Search history cleared from this browser.");
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
      void refresh();
    } catch (err) {
      flashStatus(err instanceof Error ? err.message : "Server cache purge failed.", true);
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
                if (file) void importSettings(file);
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
          description={`${history.length} recent search${history.length === 1 ? "" : "es"} · ${
            settings.saveHistory ? "saved in this browser" : "kept until you reload"
          }`}
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
      {canPurgeServer && (
        <SettingsSection
          title="Lab server cache"
          hint="Clears lookup caches, saved FoldX and AI results, and the job list for every user of this server. Jobs that are running lose their status."
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
              {confirmServerPurge ? "Confirm purge for everyone" : "Purge server caches"}
            </button>
          </SettingsRow>
        </SettingsSection>
      )}

      {dataStatus && (
        <p
          role={dataStatus.failed ? "alert" : "status"}
          aria-live={dataStatus.failed ? "assertive" : "polite"}
          className="flex items-center gap-2 rounded-lg border border-cs-border-subtle bg-cs-surface px-3 py-2 text-[12px] text-cs-text-secondary"
        >
          {dataStatus.failed
            ? <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
            : <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
          {dataStatus.message}
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
              {versionLabel(version)}
            </span>
          </div>
        </SettingsBlock>
      </SettingsSection>
    </div>
  );
}
