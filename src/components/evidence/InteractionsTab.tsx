import React, { useState, useEffect, useCallback } from "react";
import { ShieldCheck, AlertTriangle, RefreshCw, Zap, ExternalLink, HelpCircle } from "lucide-react";
import { TabComponentProps } from "./types";
import { PpiBindingData } from "../../types";
import { useApiClient, extractErrorMessage } from "../../apiClient";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";

export function InteractionsTab({ analysisState, formatDdGValue, energyUnit, onTabChange }: TabComponentProps) {
  const result = analysisState.result;
  const gene = result?.metadata?.gene;
  const variant = result?.metadata?.variant;
  const uniprotId = result?.metadata?.uniprotId;
  const complexPdb = result?.multimerData?.complexPdb;
  const chainIds = result?.multimerData?.chainIds;
  const chainA = (chainIds && chainIds.length > 0 && chainIds[0]) ? chainIds[0] : "A";
  const chainB = (chainIds && chainIds.length > 1 && chainIds[1]) ? chainIds[1] : "B";

  const { fetchWithAuth } = useApiClient();
  const [ppiData, setPpiData] = useState<PpiBindingData | null>(result?.ppiBindingData || null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPpiData = useCallback(async (signal?: AbortSignal) => {
    if (!gene || !variant) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchWithAuth("/api/v1/ppi/binding-affinity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gene,
          variant,
          uniprotId,
          wtPdb: complexPdb || null,
          // Zero synthetic fallbacks protocol: never pass identical WT coordinates as mutant.
          // Live interface energy calculation requires a genuinely modeled mutant multimer complex.
          mutPdb: null,
          chainA,
          chainB
        }),
        signal
      });
      if (response.ok) {
        const data = await response.json();
        setPpiData(data);
        useVariantAnalysisStore.getState().setAnalysisState((prev: any) => {
          if (!prev?.result) return prev;
          return {
            ...prev,
            result: {
              ...prev.result,
              ppiBindingData: data
            }
          };
        });
      } else {
        const errorMsg = await extractErrorMessage(response, "Failed to fetch PPI binding data");
        setError(errorMsg);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "Network error loading PPI data");
      }
    } finally {
      setIsLoading(false);
    }
  }, [gene, variant, uniprotId, complexPdb, chainA, chainB, fetchWithAuth]);

  // Synchronize local state on variant change and abort in-flight queries
  useEffect(() => {
    if (result?.ppiBindingData) {
      setPpiData(result.ppiBindingData);
      return;
    }
    setPpiData(null);
    setError(null);
    if (!gene || !variant) return;

    const controller = new AbortController();
    fetchPpiData(controller.signal);

    return () => {
      controller.abort();
    };
  }, [gene, variant, uniprotId, complexPdb, result?.ppiBindingData, fetchPpiData]);

  if (!result) return null;

  // Fallback to result.stringInteractions if ppiData not yet resolved
  const stringPartners = ppiData?.stringPartners || result.stringInteractions || [];
  const bindingShift = ppiData?.bindingShift;
  const interfaceResidues = ppiData?.interfaceResidues || [];

  // Multimer & Quaternary Assembly context
  const multimerData = result?.multimerData;
  const multimerContacts = multimerData?.interfaceContacts || [];
  const oligomericState = multimerData?.oligomericState;
  const subunitComment = multimerData?.subunitComment || result?.uniprotFeatures?.subunitComment;
  const variantPos = result?.metadata?.residueIndex || 0;

  const isExplicitMonomer = multimerData?.status === "monomeric" || 
    (oligomericState ? oligomericState.toLowerCase().trim() === "monomer" : false);
  const isExplicitMultimer = multimerData?.status === "success" || (multimerData?.chainCount ?? 0) > 1;

  const isMonomeric = isExplicitMonomer || (
    !isExplicitMultimer && 
    Boolean(subunitComment && /^monomer(\.|\b)/i.test(subunitComment.trim()))
  );

  // Multi-tier interface contact determination (guard variantPos > 0 to prevent false-positive contact matches at residue 0)
  const hasDirectComplexContact = variantPos > 0 && multimerContacts.some(
    c => Math.abs(c.resA - variantPos) <= 4 || ((multimerData?.chainCount ?? 0) <= 2 && Math.abs(c.resB - variantPos) <= 4)
  );
  const hasCuratedInterface = interfaceResidues.some(r => r.isVariantPosition);
  const hasCuratedInterfaceAny = interfaceResidues.length > 0;

  const getClassificationBadge = (cls?: string) => {
    switch (cls) {
      case "INTERFACE_DISRUPTIVE":
        return "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400";
      case "ALLOSTERIC_PERTURBATION":
        return "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400";
      case "SURFACE_NEUTRAL":
        return "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400";
      default:
        return "bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-400";
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
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium self-start sm:self-auto transition-colors disabled:opacity-50 cursor-pointer"
          style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-primary)" }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>{isLoading ? "Analyzing..." : "Refresh PPI"}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg border text-xs flex items-center gap-2 bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-300">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
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
          {/* Card 1: ΔΔG_bind */}
          <div className="metric-card">
            <span className="metric-card-label">ΔΔG_bind</span>
            <span className={`metric-card-value ${
              Number.isFinite(bindingShift?.ddgBind)
                ? bindingShift!.ddgBind! >= 1.5
                  ? "text-[var(--cs-text-danger)]"
                  : bindingShift!.ddgBind! >= 0.5
                    ? "text-amber-400"
                    : "text-emerald-400"
                : "text-[var(--cs-text-muted)]"
            }`}>
              {Number.isFinite(bindingShift?.ddgBind)
                ? formatDdGValue(bindingShift!.ddgBind!, energyUnit)
                : isMonomeric
                  ? "N/A (Monomer)"
                  : "Pending / Unbound"}
            </span>
            <span className="metric-card-desc">
              {Number.isFinite(bindingShift?.ddgBind)
                ? "Binding free energy shift across interface"
                : isMonomeric
                  ? "Single-chain monomer; no inter-chain interface"
                  : "Requires multi-chain 3D quaternary coordinates"}
            </span>
          </div>

          {/* Card 2: Quaternary Assembly */}
          <div className="metric-card">
            <span className="metric-card-label">Quaternary Assembly</span>
            <div className="mt-1">
              {bindingShift?.classification ? (
                <span className={`text-[11px] px-2 py-0.5 rounded border font-mono font-bold uppercase ${getClassificationBadge(bindingShift?.classification)}`}>
                  {bindingShift.classification}
                </span>
              ) : isMonomeric ? (
                <span className="text-[11px] px-2 py-0.5 rounded border font-mono font-bold uppercase bg-slate-500/10 border-slate-500/30 text-slate-400">
                  MONOMER (SINGLE CHAIN)
                </span>
              ) : oligomericState ? (
                <span className="text-[11px] px-2 py-0.5 rounded border font-mono font-bold uppercase bg-indigo-500/10 border-indigo-500/30 text-indigo-400">
                  {oligomericState.toUpperCase()}
                </span>
              ) : (
                <span className="text-[11px] px-2 py-0.5 rounded border font-mono font-bold uppercase bg-slate-500/10 border-slate-500/30 text-slate-400">
                  UNCHARACTERIZED
                </span>
              )}
            </div>
            <span className="metric-card-desc">
              {bindingShift?.classification
                ? "Impact on complex stability"
                : oligomericState || (isMonomeric ? "Curated physiological single-chain state" : "Oligomeric assembly")}
            </span>
          </div>

          {/* Card 3: Residue Interface Proximity */}
          <div className="metric-card">
            <span className="metric-card-label">Residue Interface Proximity</span>
            <div className="mt-1 flex items-center gap-1.5">
              {isMonomeric ? (
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                  Intramolecular (No Interface)
                </span>
              ) : hasDirectComplexContact ? (
                <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                  Direct Interface Contact (&lt; 5 Å)
                </span>
              ) : hasCuratedInterface ? (
                <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                  Direct Interface Residue
                </span>
              ) : hasCuratedInterfaceAny ? (
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  Distal from Curated Site
                </span>
              ) : multimerContacts.length > 0 ? (
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  Distal Complex Residue (&gt; 5 Å)
                </span>
              ) : (
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                  Uncharacterized Position
                </span>
              )}
            </div>
            <span className="metric-card-desc">
              {isMonomeric
                ? "Residue is internal to single-chain structure"
                : hasDirectComplexContact || multimerContacts.length > 0
                  ? "3D quaternary contact mapping"
                  : hasCuratedInterfaceAny
                    ? "UniProt curated interface proximity"
                    : "No quaternary interface coordinates"}
            </span>
          </div>
        </div>

        {/* Compact Status Note when ΔΔG_bind is computed */}
        {Number.isFinite(bindingShift?.ddgBind) && (
          <p className="text-[11px] leading-relaxed pt-1" style={{ color: "var(--cs-text-muted)" }}>
            OpenBind-0 predicted an interface binding shift of {formatDdGValue(bindingShift!.ddgBind!, energyUnit)}. Positive shifts (ΔΔG &gt; 0) denote diminished complex affinity or disrupted subunit docking.
          </p>
        )}
      </div>

      {/* Section 2: UniProt Curated Interface Residues */}
      {interfaceResidues.length > 0 ? (
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
                    ? "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-300"
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
      ) : (
        <div className="p-3.5 rounded-xl border space-y-1.5" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold uppercase tracking-wider font-sans" style={{ color: "var(--cs-accent-clay)" }}>
              UniProt Curated Interface &amp; Subunit Binding Sites
            </h3>
            <span className="badge-data-source">UniProtKB</span>
          </div>
          <p className="text-xs text-cs-text-muted leading-relaxed">
            No direct residue-level interface annotations are recorded in Swiss-Prot for <strong>{gene}</strong>.
            {subunitComment ? ` Curated SUBUNIT annotation: "${subunitComment}"` : ""}
          </p>
        </div>
      )}

      {/* Section 3: STRING-db Functional Partner Network */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--cs-text-primary)" }}>
              STRING-db Functional Interaction Partners
            </h3>
            <span className="text-[10px] text-[var(--cs-text-muted)]">
              Proteome-wide functional co-expression, shared pathways, and physical interaction evidence.
            </span>
          </div>
          <span className="text-[10px] font-mono text-[var(--cs-text-muted)] shrink-0">
            Species: Homo sapiens (TaxID 9606)
          </span>
        </div>

        {stringPartners.length > 0 ? (
          <div className="rounded-xl border border-[var(--cs-border)] overflow-hidden bg-[var(--cs-surface)] shadow-none">
            <div className="overflow-x-auto">
              <table className="w-full font-sans border-collapse">
                <thead>
                  <tr className="table-header-row border-b border-[var(--cs-border)]" style={{ background: "var(--cs-surface-2)" }}>
                    <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-left w-2/5 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Associated Partner</th>
                    <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center w-1/4 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>STRING Score</th>
                    <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center w-1/3" style={{ color: "var(--cs-text-secondary)" }}>Confidence Level</th>
                  </tr>
                </thead>
                <tbody>
                  {stringPartners.map((partner, pIdx) => {
                    const isScoreFinite = Number.isFinite(partner.score);
                    const pct = isScoreFinite ? (partner.score * 100).toFixed(0) : "—";
                    const isHighest = isScoreFinite && partner.score >= 0.9;
                    const isHigh = isScoreFinite && partner.score >= 0.7;
                    const stringUrl = `https://string-db.org/network/9606.${encodeURIComponent(partner.partner || "")}`;

                    return (
                      <tr key={partner.partner || pIdx} className="hover:bg-[var(--cs-bg-subtle)] transition-colors" style={{ color: "var(--cs-text-primary)", borderBottom: pIdx < stringPartners.length - 1 ? "1px solid var(--cs-border-subtle)" : "none" }}>
                        <td className="p-3 px-4 text-[12px] font-semibold text-left w-2/5 border-r border-[var(--cs-border-subtle)]">
                          <a
                            href={stringUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 font-mono text-cs-text-primary hover:text-cs-accent-clay group"
                            title={`Inspect ${partner.partner} interaction network on STRING-db`}
                          >
                            <span>{partner.partner}</span>
                            <ExternalLink className="w-3 h-3 opacity-40 group-hover:opacity-100 transition-opacity" />
                          </a>
                        </td>
                        <td className="p-3 px-4 text-center font-mono text-[12px] w-1/4 border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-primary)" }}>
                          {isScoreFinite ? partner.score.toFixed(3) : "—"}
                        </td>
                        <td className="p-3 px-4 text-center w-1/3">
                          <div className="inline-flex items-center justify-center gap-2 w-full">
                            <span className="font-mono text-xs" style={{ color: "var(--cs-text-secondary)" }}>{pct}%</span>
                            <span className={`px-2 py-0.5 text-[10px] rounded font-bold uppercase font-mono ${
                              isHighest
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                : isHigh
                                  ? "bg-teal-500/10 text-teal-400 border border-teal-500/20"
                                  : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                            }`}>
                              {isHighest ? "Highest" : isHigh ? "High" : "Medium"}
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

export default React.memo(InteractionsTab);
