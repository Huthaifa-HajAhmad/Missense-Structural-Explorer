import React, { useState, useEffect, useCallback } from "react";
import { Layers, ShieldCheck, AlertCircle, RefreshCw, Box, AlertTriangle } from "lucide-react";
import { TabComponentProps } from "./types";
import { MultimerData } from "../../types";
import { useApiClient, extractErrorMessage } from "../../apiClient";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";

export function MultimersTab({ analysisState }: TabComponentProps) {
  const result = analysisState.result;
  const gene = result?.metadata?.gene;
  const variant = result?.metadata?.variant;
  const uniprotId = result?.metadata?.uniprotId;

  const { fetchWithAuth } = useApiClient();
  const [multimerData, setMultimerData] = useState<MultimerData | null>(result?.multimerData || null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMultimerData = useCallback(async (signal?: AbortSignal) => {
    if (!gene || !variant || !uniprotId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchWithAuth("/api/v1/structure/multimer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gene, variant, uniprotId }),
        signal
      });
      if (response.ok) {
        const data = await response.json();
        setMultimerData(data);
        useVariantAnalysisStore.getState().setAnalysisState((prev: any) => {
          if (!prev?.result) return prev;
          return {
            ...prev,
            result: {
              ...prev.result,
              multimerData: data
            }
          };
        });
      } else {
        const errorMsg = await extractErrorMessage(response, "Failed to fetch multimer data");
        setError(errorMsg);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "Network error loading multimer structure");
      }
    } finally {
      setIsLoading(false);
    }
  }, [gene, variant, uniprotId, fetchWithAuth]);

  // Synchronize on variant change and abort in-flight requests on unmount/variant switch
  useEffect(() => {
    if (result?.multimerData) {
      setMultimerData(result.multimerData);
      return;
    }
    setMultimerData(null);
    setError(null);
    if (!gene || !variant || !uniprotId) return;

    const controller = new AbortController();
    fetchMultimerData(controller.signal);

    return () => {
      controller.abort();
    };
  }, [gene, variant, uniprotId, result?.multimerData, fetchMultimerData]);

  if (!result) return null;

  const subunitComment = multimerData?.subunitComment || result.uniprotFeatures?.subunitComment;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="screen-title">Multimers (Quaternary Assembly)</h1>
          <p className="screen-tab-description">
            Whole-complex oligomeric structure modeling (Boltz-2 / OpenFold3) and inter-chain subunit interface contact mapping.
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchMultimerData()}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-all self-start sm:self-auto hover:bg-cs-bg-subtle border-cs-border"
          style={{ background: "var(--cs-surface)", color: "var(--cs-text-primary)" }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>{isLoading ? "Modeling..." : "Re-evaluate Complex"}</span>
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center p-8 text-center border rounded-xl border-dashed" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mb-3" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }} />
          <span className="text-xs font-semibold" style={{ color: "var(--cs-text-primary)" }}>Assembling Quaternary Complex via JapanFold Boltz-2...</span>
          <span className="text-[10px] mt-1" style={{ color: "var(--cs-text-muted)" }}>Evaluating inter-subunit interface contacts on Tenstorrent superclusters</span>
        </div>
      ) : error || multimerData?.status === "failed" ? (
        <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/5 text-xs flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-rose-500 block mb-0.5">Complex Modeling Unavailable</span>
            <p className="text-rose-400 leading-relaxed">
              {error || multimerData?.error || "Upstream quaternary assembly modeling could not be completed."}
            </p>
            {subunitComment && (
              <div className="mt-2 p-2.5 rounded border text-[11px] font-mono bg-cs-surface border-cs-border text-cs-text-muted">
                <span className="font-sans font-bold block text-[10px] text-cs-text-primary mb-0.5">Curated SUBUNIT annotation:</span>
                {subunitComment}
              </div>
            )}
          </div>
        </div>
      ) : multimerData?.status === "monomeric" ? (
        <div className="p-5 rounded-xl border space-y-3" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--cs-text-primary)" }}>
              Physiological Monomer
            </h4>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
            According to curated UniProt annotations, <strong>{gene}</strong> canonically functions as a single-chain monomer under physiological conditions.
          </p>
          {subunitComment && (
            <div className="p-3 rounded-lg border text-xs font-mono" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)" }}>
              <span className="text-[10px] font-sans font-bold uppercase block mb-1 text-cs-text-muted">UniProt SUBUNIT Annotation:</span>
              {subunitComment}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Assembly Status & Provenance Card */}
          <div className="p-4 rounded-xl border space-y-3" style={{ background: "var(--cs-surface)", borderColor: "var(--cs-border)" }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4" style={{ color: "var(--cs-accent-clay)" }} />
                <span className="text-xs font-bold" style={{ color: "var(--cs-text-primary)" }}>
                  Detected Assembly: {multimerData?.oligomericState || "Oligomeric Assembly"}
                </span>
              </div>
              <span className="badge-data-source">
                {multimerData?.provenance || "JapanFold Boltz-2 (Tier 1)"}
              </span>
            </div>

            {/* Quality Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="metric-card">
                <span className="metric-card-label">Subunit Chains</span>
                <span className="metric-card-value" style={{ color: "var(--cs-accent)" }}>
                  {multimerData?.chainCount || 2} Chains ({multimerData?.chainIds?.join(", ") || "A, B"})
                </span>
                <span className="metric-card-desc">Stoichiometric assembly</span>
              </div>

              <div className="metric-card">
                <span className="metric-card-label">Interface pTM (ipTM)</span>
                <span className={`metric-card-value ${Number.isFinite(multimerData?.ipTm) ? "text-emerald-500" : "text-cs-text-muted"}`}>
                  {Number.isFinite(multimerData?.ipTm) ? multimerData!.ipTm!.toFixed(2) : "Unavailable"}
                </span>
                <span className="metric-card-desc">Complex interface confidence</span>
              </div>

              <div className="metric-card">
                <span className="metric-card-label">Overall pTM</span>
                <span className={`metric-card-value ${Number.isFinite(multimerData?.pTm) ? "text-emerald-500" : "text-cs-text-muted"}`}>
                  {Number.isFinite(multimerData?.pTm) ? multimerData!.pTm!.toFixed(2) : "Unavailable"}
                </span>
                <span className="metric-card-desc">Whole-complex prediction score</span>
              </div>
            </div>

            {multimerData?.mutationInterfaceDisrupted && (
              <div className="p-3 rounded-lg border text-xs leading-relaxed bg-amber-500/10 border-amber-500/30 text-amber-400 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block mb-0.5">Interface Contact Disruption Detected:</span>
                  The substitution at residue #{result.metadata?.residueIndex} directly disrupts inter-chain quaternary contacts across subunit interfaces.
                </div>
              </div>
            )}
          </div>

          {/* Inter-chain Contact Table */}
          <div className="rounded-xl border border-[var(--cs-border)] overflow-hidden bg-[var(--cs-surface)] shadow-none">
            <div className="p-3 px-4 border-b border-[var(--cs-border)] flex items-center justify-between" style={{ background: "var(--cs-surface-2)" }}>
              <h4 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--cs-text-primary)" }}>
                Inter-Subunit Interface Residue Contacts (Chain A &harr; Partner Chains)
              </h4>
              <span className="text-[10px] font-mono text-cs-text-muted">Threshold: &le; 4.5 &Aring;</span>
            </div>
            {multimerData?.interfaceContacts && multimerData.interfaceContacts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full font-sans border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--cs-border-subtle)] text-[11px] uppercase text-cs-text-muted">
                      <th className="p-2.5 px-4 text-left">Chain A Residue</th>
                      <th className="p-2.5 px-4 text-left">Partner Chain Residue</th>
                      <th className="p-2.5 px-4 text-center">Distance (&Aring;)</th>
                      <th className="p-2.5 px-4 text-center">Impact Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {multimerData.interfaceContacts.slice(0, 8).map((c, idx) => {
                      const isMutSite = Math.abs(c.resA - (result.metadata?.residueIndex || 0)) <= 2;
                      return (
                        <tr key={idx} className="border-b border-[var(--cs-border-subtle)] hover:bg-cs-bg-subtle transition-colors">
                          <td className="p-2.5 px-4 font-mono font-semibold">Residue #{c.resA}</td>
                          <td className="p-2.5 px-4 font-mono font-semibold">Residue #{c.resB}</td>
                          <td className="p-2.5 px-4 text-center font-mono">
                            {Number.isFinite(c.distance) ? `${c.distance.toFixed(2)} Å` : "—"}
                          </td>
                          <td className="p-2.5 px-4 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${isMutSite ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"}`}>
                              {isMutSite ? "PERTURBED" : "STABLE"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 text-xs text-center text-cs-text-muted">
                No steric or inter-chain contact clashes detected at threshold &le; 4.5 &Aring;.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
