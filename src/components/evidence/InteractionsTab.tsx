import React, { useState, useEffect, useCallback } from "react";
import { ShieldCheck, AlertTriangle, RefreshCw, Zap } from "lucide-react";
import { TabComponentProps } from "./types";
import { PpiBindingData } from "../../types";

export function InteractionsTab({ analysisState, formatDdGValue, energyUnit }: TabComponentProps) {
  const result = analysisState.result;
  const gene = result?.metadata?.gene;
  const variant = result?.metadata?.variant;
  const uniprotId = result?.metadata?.uniprotId;
  const complexPdb = result?.multimerData?.complexPdb;

  const [ppiData, setPpiData] = useState<PpiBindingData | null>(result?.ppiBindingData || null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPpiData = useCallback(async (signal?: AbortSignal) => {
    if (!gene || !variant) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/ppi/binding-affinity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gene,
          variant,
          uniprotId,
          wtPdb: complexPdb || null,
          mutPdb: complexPdb || null,
          chainA: "A",
          chainB: "B"
        }),
        signal
      });
      if (response.ok) {
        const data = await response.json();
        setPpiData(data);
      } else {
        setError(`Failed to fetch PPI binding data (HTTP ${response.status})`);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "Network error loading PPI data");
      }
    } finally {
      setIsLoading(false);
    }
  }, [gene, variant, uniprotId, complexPdb]);

  // Synchronize local state on variant change and abort in-flight queries
  useEffect(() => {
    setPpiData(result?.ppiBindingData || null);
    setError(null);
    if (!gene || !variant) return;

    const controller = new AbortController();
    fetchPpiData(controller.signal);

    return () => {
      controller.abort();
    };
  }, [gene, variant, uniprotId, complexPdb, fetchPpiData]);

  if (!result) return null;

  // Fallback to result.stringInteractions if ppiData not yet resolved
  const stringPartners = ppiData?.stringPartners || result.stringInteractions || [];
  const bindingShift = ppiData?.bindingShift;
  const interfaceResidues = ppiData?.interfaceResidues || [];

  const getClassificationBadge = (cls?: string) => {
    switch (cls) {
      case "INTERFACE_DISRUPTIVE":
        return "bg-rose-500/10 border-rose-500/30 text-rose-400";
      case "ALLOSTERIC_PERTURBATION":
        return "bg-amber-500/10 border-amber-500/30 text-amber-400";
      case "SURFACE_NEUTRAL":
        return "bg-emerald-500/10 border-emerald-500/30 text-emerald-400";
      default:
        return "bg-slate-500/10 border-slate-500/30 text-slate-400";
    }
  };

  return (
    <div className="space-y-4">
      {/* Tab Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="screen-title">PPI Networks &amp; Interface Binding Affinity</h1>
          <p className="screen-tab-description">
            Functional protein-protein interaction networks (STRING-db) and structural interface binding affinity shifts (ΔΔG_bind via JapanFold OpenBind-0).
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchPpiData()}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium self-start sm:self-auto transition-colors disabled:opacity-50"
          style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-primary)" }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>{isLoading ? "Analyzing..." : "Refresh PPI"}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg border text-xs flex items-center gap-2 bg-rose-500/10 border-rose-500/20 text-rose-300">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Section 1: OpenBind-0 Interface Binding Affinity Card */}
      <div className="p-4 rounded-xl border space-y-3" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3" style={{ borderColor: "var(--cs-border-subtle)" }}>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--cs-text-primary)" }}>
              OpenBind-0 Interface Binding Affinity Shift (ΔΔG_bind)
            </h3>
          </div>
          <span className="badge-data-source">
            {bindingShift?.provenance || "JapanFold OpenBind-0 (Tier 1)"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="metric-card">
            <span className="metric-card-label">ΔΔG_bind</span>
            <span className={`metric-card-value ${
              Number.isFinite(bindingShift?.ddgBind) && bindingShift!.ddgBind! >= 1.5
                ? "text-[var(--cs-text-danger)]"
                : ""
            }`}>
              {Number.isFinite(bindingShift?.ddgBind)
                ? formatDdGValue(bindingShift!.ddgBind!, energyUnit)
                : "Awaiting Complex"}
            </span>
            <span className="metric-card-desc">Binding free energy shift across interface</span>
          </div>

          <div className="metric-card">
            <span className="metric-card-label">Interface Classification</span>
            <div className="mt-1">
              <span className={`text-[11px] px-2 py-0.5 rounded border font-mono font-bold uppercase ${getClassificationBadge(bindingShift?.classification)}`}>
                {bindingShift?.classification || "MONOMER / UNBOUND"}
              </span>
            </div>
            <span className="metric-card-desc">Impact on complex stability</span>
          </div>

          <div className="metric-card">
            <span className="metric-card-label">Interface Contact Status</span>
            <div className="mt-1 flex items-center gap-1.5">
              {interfaceResidues.some(r => r.isVariantPosition) ? (
                <span className="text-[11px] font-bold text-rose-400 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                  Direct Interface Residue
                </span>
              ) : (
                <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  Distal / Non-Interface
                </span>
              )}
            </div>
            <span className="metric-card-desc">UniProt curated interface proximity</span>
          </div>
        </div>

        {/* Informational Banner */}
        <p className="text-[11px] leading-relaxed pt-1" style={{ color: "var(--cs-text-muted)" }}>
          {Number.isFinite(bindingShift?.ddgBind)
            ? `OpenBind-0 predicted an interface binding shift of ${formatDdGValue(bindingShift!.ddgBind!, energyUnit)}. Positive shifts (ΔΔG > 0) denote diminished complex affinity or disrupted subunit docking.`
            : "Interface binding affinity calculation requires a multi-chain complex. Generate a quaternary assembly in the Multimers tab to evaluate live OpenBind-0 interface shifts."}
        </p>
      </div>

      {/* Section 2: UniProt Curated Interface Residues */}
      {interfaceResidues.length > 0 && (
        <div className="p-4 rounded-xl border space-y-2.5" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider font-sans" style={{ color: "var(--cs-accent-clay)" }}>
            UniProt Curated Interface &amp; Subunit Binding Sites
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {interfaceResidues.map((item, idx) => (
              <div
                key={idx}
                className={`p-2.5 px-3 rounded-lg border text-xs flex items-center justify-between ${
                  item.isVariantPosition
                    ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
                    : "bg-[var(--cs-surface-2)] border-[var(--cs-border)] text-[var(--cs-text-primary)]"
                }`}
              >
                <div>
                  <span className="font-mono font-bold text-[12px] block">
                    Residue {item.pos} {item.isVariantPosition ? "(Mutation Site)" : ""}
                  </span>
                  <span className="text-[10px] text-[var(--cs-text-muted)]">{item.description}</span>
                </div>
                {item.isVariantPosition && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase bg-rose-500/20 text-rose-400 border border-rose-500/30">
                    Interface
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 3: STRING-db Functional Partner Network */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--cs-text-primary)" }}>
            STRING-db Functional Interaction Partners
          </h3>
          <span className="text-[10px] font-mono text-[var(--cs-text-muted)]">
            Species: Homo sapiens (TaxID 9606)
          </span>
        </div>

        {stringPartners.length > 0 ? (
          <div className="rounded-xl border border-[var(--cs-border)] overflow-hidden bg-[var(--cs-surface)] shadow-none">
            <div className="overflow-x-auto">
              <table className="w-full font-sans border-collapse">
                <thead>
                  <tr className="table-header-row border-b border-[var(--cs-border)]" style={{ background: "var(--cs-surface-2)" }}>
                    <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-left w-1/3 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Associated Partner</th>
                    <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center w-1/3 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>STRING Score</th>
                    <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center w-1/3" style={{ color: "var(--cs-text-secondary)" }}>Confidence Level</th>
                  </tr>
                </thead>
                <tbody>
                  {stringPartners.map((partner, pIdx) => {
                    const isScoreFinite = Number.isFinite(partner.score);
                    const pct = isScoreFinite ? (partner.score * 100).toFixed(0) : "—";
                    const isHigh = isScoreFinite && partner.score >= 0.7;
                    return (
                      <tr key={pIdx} className="hover:bg-[var(--cs-bg-subtle)] transition-colors" style={{ color: "var(--cs-text-primary)", borderBottom: pIdx < stringPartners.length - 1 ? "1px solid var(--cs-border-subtle)" : "none" }}>
                        <td className="p-3 px-4 text-[12px] font-semibold text-left w-1/3 border-r border-[var(--cs-border-subtle)]">
                          <span style={{ color: "var(--cs-text-primary)" }}>{partner.partner}</span>
                        </td>
                        <td className="p-3 px-4 text-center font-mono text-[12px] w-1/3 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-primary)" }}>
                          {isScoreFinite ? partner.score.toFixed(3) : "—"}
                        </td>
                        <td className="p-3 px-4 text-center w-1/3">
                          <div className="inline-flex items-center justify-center gap-2 w-full">
                            <span className="font-mono text-xs" style={{ color: "var(--cs-text-secondary)" }}>{pct}%</span>
                            <span className={`px-2 py-0.5 text-[10px] rounded font-bold uppercase font-mono ${
                              isHigh
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                            }`}>
                              {isHigh ? "High" : "Medium"}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="empty-state-box">
            No STRING-db interaction partners found for {gene || "this gene"}.
          </div>
        )}
      </div>
    </div>
  );
}
