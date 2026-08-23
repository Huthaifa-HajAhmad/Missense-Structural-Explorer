import { useRef, useState } from "react";
import { z } from "zod";
import { Check, Database, Download, Eraser, Upload } from "lucide-react";
import { useSettings } from "../../../context/SettingsContext";
import { useDiagnostics } from "../../../hooks/useDiagnostics";
import { SettingsRow, SettingsSection } from "../ui/Section";
import { DEFAULT_USER_SETTINGS, TRANSIENT_SETTING_KEYS } from "../defaults";
import { PROVENANCE_DATA_SOURCES, PROVENANCE_MODEL_REVISIONS } from "../../../shared/provenance";
import { clearClientVariantCache } from "../../../services/pipeline/variantCache";
import type { UserSettings } from "../../../types";

const IMPORT_SCHEMA = z.object({
  __type: z.string().optional(),
  version: z.number().optional(),
  settings: z.record(z.string(), z.unknown()).optional()
});

const MODEL_REVISIONS = Object.entries(PROVENANCE_MODEL_REVISIONS) as [string, { model: string; commitSha?: string; weights?: string }][];
const DATA_SOURCES = Object.entries(PROVENANCE_DATA_SOURCES) as [string, string][];

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
      className={`cs-btn-ghost ${danger ? "!text-rose-600 dark:!text-rose-400 hover:!bg-rose-500/10" : ""}`}
    >
      {icon}
      {children}
    </button>
  );
}

export function AboutSection() {
  const { settings, applySettings } = useSettings();
  const { version, diagnostics, refresh } = useDiagnostics();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dataStatus, setDataStatus] = useState<string | null>(null);
  const [confirmServerPurge, setConfirmServerPurge] = useState(false);

  const flashStatus = (message: string) => {
    setDataStatus(message);
    window.setTimeout(() => setDataStatus(null), 4000);
  };

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
    flashStatus("Settings exported. Credentials are never included in the file.");
  };

  const importSettings = async (file: File) => {
    try {
      const parsed = IMPORT_SCHEMA.parse(JSON.parse(await file.text()));
      const incoming = parsed.settings && Object.keys(parsed.settings).length > 0
        ? parsed.settings
        : (() => {
            // Tolerate a bare settings object without the wrapper.
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
      flashStatus(`Imported ${applied} setting${applied === 1 ? "" : "s"}.`);
    } catch {
      flashStatus("Import failed — the file is not a valid settings export.");
    }
  };

  const clearSearchHistory = () => {
    try {
      localStorage.removeItem("variantHistoryObfuscated");
      localStorage.removeItem("variantHistory");
      flashStatus("Search history cleared from this device.");
    } catch {
      flashStatus("Could not clear search history.");
    }
  };

  const purgeClientCache = () => {
    clearClientVariantCache();
    flashStatus("Client variant cache purged for this tab.");
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
      const res = await fetch("/api/v1/debug/clear-caches", { method: "POST", headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.message || data.error || `HTTP ${res.status}`);
      flashStatus("Server caches purged. Re-run analyses to rebuild them.");
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
      <SettingsSection title="Version">
        <div className="py-3 space-y-2">
          <div className="flex items-baseline gap-3">
            <span className="text-[15px] font-semibold text-cs-text-primary">
              Missense Structural Explorer
            </span>
            <span className="font-mono text-[11px] text-cs-text-muted [font-variant-numeric:tabular-nums]">
              v{version?.version || "1.0.0"}
              {version?.env ? ` · ${version.env}` : ""}
            </span>
          </div>
          {totalCached !== null && (
            <p className="text-[11px] text-cs-text-muted">
              {diagnostics?.cacheDiagnostics
                ? Object.keys(diagnostics.cacheDiagnostics).length
                : 0}{" "}
              server caches holding {totalCached} entries in total.
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title="Pinned model revisions" hint="Foundation model weights are pinned to these revisions for reproducibility.">
        <div className="py-3 space-y-1.5">
          {MODEL_REVISIONS.map(([id, rev]) => (
            <div key={id} className="flex items-baseline justify-between gap-4 text-[11px]">
              <span className="font-medium text-cs-text-primary">{rev.model}</span>
              <span className="font-mono text-[10px] text-cs-text-muted truncate">
                {rev.commitSha ? `@${rev.commitSha.slice(0, 10)}` : rev.weights || id}
              </span>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Data sources">
        <div className="py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {DATA_SOURCES.map(([id, release]) => (
            <div key={id} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="font-medium capitalize text-cs-text-primary">{id}</span>
              <span className="font-mono text-[10px] text-cs-text-muted truncate">{release}</span>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Your data" hint="Everything below stays on this device (or this server) unless stated.">
        <SettingsRow
          label="Settings backup"
          description="Export your preferences as JSON, or import a previous export. Credentials are never included."
        >
          <div className="flex items-center gap-2">
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
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importSettings(file);
                e.target.value = "";
              }}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          label="Search history"
          description="Removes all locally stored variant queries from this browser."
        >
          <ActionButton onClick={clearSearchHistory} icon={<Eraser className="w-3.5 h-3.5" />} danger>
            Clear
          </ActionButton>
        </SettingsRow>
        <SettingsRow
          label="Client variant cache"
          description="Session-scoped snapshots of analyzed variants (structures, energetics, ACMG)."
        >
          <ActionButton onClick={purgeClientCache} icon={<Database className="w-3.5 h-3.5" />} danger>
            Purge
          </ActionButton>
        </SettingsRow>
        <SettingsRow
          label="Server caches"
          description="Clears all in-memory and disk caches on the lab server, including FoldX and job registries."
        >
          <button
            type="button"
            onClick={purgeServerCaches}
            className={`cs-btn-ghost ${confirmServerPurge ? "!text-rose-600 dark:!text-rose-400 !border-rose-500/40 !bg-rose-500/10" : ""}`}
          >
            {confirmServerPurge ? <Check className="w-3.5 h-3.5" /> : <Database className="w-3.5 h-3.5" />}
            {confirmServerPurge ? "Confirm purge" : "Purge"}
          </button>
        </SettingsRow>
        {dataStatus && (
          <p role="status" aria-live="polite" className="text-[11px] text-cs-text-secondary py-2">
            {dataStatus}
          </p>
        )}
      </SettingsSection>
    </div>
  );
}
