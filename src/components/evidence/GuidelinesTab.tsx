import React from "react";
import { TabComponentProps } from "./types";
import { THRESHOLDS } from "../../shared/thresholds";

export function GuidelinesTab({
  analysisState,
  foldingDdG,
  foldingEnergetics
}: TabComponentProps) {
  const result = analysisState.result;
  if (!result) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="screen-title">Threshold Guide</h1>
        <p className="screen-tab-description">ACMG/AMP evidence code thresholds for each computational predictor, with live match highlighting for the current variant.</p>
      </div>
      


      {/* Threshold Table */}
      <div className="rounded-xl border border-[var(--cs-border)] overflow-hidden bg-[var(--cs-surface)] shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full font-sans border-collapse">
            <thead>
              <tr className="table-header-row border-b border-[var(--cs-border)]" style={{ background: "var(--cs-surface-2)" }}>
                <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-left border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Assay / Metric</th>
                <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center font-mono border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Score</th>
                <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Benign ≤</th>
                <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>Pathogenic ≥</th>
                <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-secondary)" }}>ACMG Code</th>
                <th className="p-3 px-4 text-[11px] font-medium uppercase tracking-wider text-center" style={{ color: "var(--cs-text-secondary)" }}>Match</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const caddVal = result.predictorData?.caddPhred ?? null;
                const revelVal = result.conservationData?.revel ?? null;
                const amVal = result.predictorData?.amPathogenicity ?? null;
                const amCls = result.predictorData?.amClass ?? null;
                const bayesdelVal = result.conservationData?.bayesdel ?? null;
                const metarnnVal = result.conservationData?.metarnn ?? null;
                const clinpredVal = result.conservationData?.clinpred ?? null;
                const eigenVal = result.conservationData?.eigenPhred ?? null;
                const dannVal = result.conservationData?.dann ?? null;
                const popeveVal = result.conservationData?.popeve ?? null;
                const esmVal = result.conservationData?.esm1b ?? null;
                const vesmVal = result.esmcEval?.llr ?? null;

                const foldxVal = foldingDdG ?? null;
                const dynamut2Val = result.dynamut2 ?? foldingEnergetics?.dynamut2 ?? null;
                const ddmutVal = result.ddmut ?? foldingEnergetics?.ddmut ?? null;
                const raspVal = result.rasp ?? foldingEnergetics?.rasp ?? null;
                const thermompnnVal = foldingEnergetics?.thermompnn ?? result.thermompnn ?? null;

                const gerpVal = result.conservationData?.gerp ?? null;
                const phylopVal = result.conservationData?.phylop ?? null;
                const misZVal = (result as any)?.misZ ?? (result as any)?.gnomadMisZ ?? null;
                const loeufVal = (result as any)?.loeuf ?? (result as any)?.gnomadLoeuf ?? null;

                const renderCategoryHeader = (catKey: string, catTitle: string) => (
                  <tr key={catKey} className="bg-[var(--cs-surface-2)]">
                    <td colSpan={6} className="p-2 px-4 text-[10.5px] font-bold uppercase tracking-wider text-left border-b border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-accent-clay)" }}>
                      {catTitle}
                    </td>
                  </tr>
                );

                const renderRow = (
                  key: string,
                  name: string,
                  val: number | null | undefined,
                  valDisplay: string,
                  benignText: string,
                  pathText: string,
                  acmgCode: string,
                  status: "path_strong" | "path" | "benign" | "neutral" | "vus" | "none",
                  matchBadgeLabel: string
                ) => {
                  const isPath = status === "path_strong" || status === "path";
                  const isBenign = status === "benign";
                  const codes = acmgCode.split('/');
                  const pathCode = codes[0]?.trim() || acmgCode;
                  const benignCode = codes[1]?.trim() || acmgCode;

                  return (
                    <tr key={key} className="hover:bg-[var(--cs-bg-subtle)] transition-colors" style={{ color: "var(--cs-text-primary)", borderBottom: "1px solid var(--cs-border-subtle)" }}>
                      <td className="p-3 px-4 text-[12px] font-semibold text-left border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-primary)" }}>{name}</td>
                      <td className="p-3 px-4 text-center font-mono text-[12px] border-r border-[var(--cs-border-subtle)]">{val !== null && val !== undefined ? valDisplay : "—"}</td>
                      <td className="p-3 px-4 text-center text-[11px] font-mono border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-muted)" }}>{benignText}</td>
                      <td className="p-3 px-4 text-center text-[11px] font-mono border-r border-[var(--cs-border-subtle)]" style={{ color: "var(--cs-text-muted)" }}>{pathText}</td>
                      <td className="p-3 px-4 text-center font-bold font-mono text-xs border-r border-[var(--cs-border-subtle)]">
                        {isPath ? (
                          <span className="px-2 py-0.5 rounded border font-bold" style={{ color: "var(--cs-text-danger)", backgroundColor: "var(--cs-bg-danger)", borderColor: "var(--cs-text-danger)" }}>{pathCode}</span>
                        ) : isBenign ? (
                          <span className="px-2 py-0.5 rounded border font-bold" style={{ color: "var(--cs-text-success)", backgroundColor: "var(--cs-bg-success)", borderColor: "var(--cs-text-success)" }}>{benignCode}</span>
                        ) : (
                          <span className="opacity-40" style={{ color: "var(--cs-text-muted)" }}>{acmgCode}</span>
                        )}
                      </td>
                      <td className="p-3 px-4 text-center">
                        {val !== null && val !== undefined ? (
                          <span className="badge-data-source">{matchBadgeLabel}</span>
                        ) : (
                          <span style={{ color: "var(--cs-text-muted)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                };

                const rows: React.ReactNode[] = [];

                // --- CATEGORY 1: In-Silico Pathogenicity Predictors ---
                rows.push(renderCategoryHeader("cat-path", "1. In-Silico Pathogenicity & Machine Learning"));

                const revelStatus = revelVal !== null ? (revelVal >= 0.75 ? "path_strong" : revelVal >= 0.5 ? "path" : revelVal < 0.15 ? "benign" : "vus") : "none";
                rows.push(renderRow("revel", "REVEL", revelVal, revelVal?.toFixed(3) ?? "—", "< 0.15", ">= 0.50 (strong >= 0.75)", "PP3 / BP4", revelStatus, revelStatus === "path_strong" ? "Strong Path." : revelStatus === "path" ? "Path. Supp." : revelStatus === "benign" ? "Benign" : "VUS"));

                const amStatus = (amCls?.toLowerCase().includes("pathogenic") || (amVal !== null && amVal >= 0.983)) ? "path_strong" : (amCls?.toLowerCase().includes("benign") || (amVal !== null && amVal <= 0.063)) ? "benign" : "vus";
                rows.push(renderRow("am", "AlphaMissense", amVal, amVal?.toFixed(3) ?? "—", "<= 0.063", ">= 0.983 (supp >= 0.564)", "PP3 / BP4", amVal !== null || amCls !== null ? amStatus : "none", amStatus === "path_strong" ? "Pathogenic" : amStatus === "benign" ? "Benign" : "VUS"));

                const caddStatus = caddVal !== null ? (caddVal >= 25 ? "path_strong" : caddVal >= 20 ? "path" : caddVal <= 10 ? "benign" : "vus") : "none";
                rows.push(renderRow("cadd", "CADD PHRED", caddVal, caddVal?.toFixed(1) ?? "—", "<= 10.0", ">= 20.0 (strong >= 25)", "PP3 / BP4", caddStatus, caddStatus === "path_strong" ? "Strong Path." : caddStatus === "path" ? "Path. Supp." : caddStatus === "benign" ? "Benign" : "Moderate"));

                const bayesdelStatus = bayesdelVal !== null ? (bayesdelVal >= 0.133 ? "path" : bayesdelVal <= -0.0404 ? "benign" : "vus") : "none";
                rows.push(renderRow("bayesdel", "BayesDel (noAF)", bayesdelVal, bayesdelVal?.toFixed(3) ?? "—", "<= -0.0404", ">= 0.133", "PP3 / BP4", bayesdelStatus, bayesdelStatus === "path" ? "Pathogenic" : bayesdelStatus === "benign" ? "Benign" : "VUS"));

                const metarnnStatus = metarnnVal !== null ? (metarnnVal >= 0.5 ? "path" : "benign") : "none";
                rows.push(renderRow("metarnn", "MetaRNN", metarnnVal, metarnnVal?.toFixed(3) ?? "—", "< 0.50", ">= 0.50", "PP3 / BP4", metarnnStatus, metarnnStatus === "path" ? "Deleterious" : "Tolerated"));

                const clinpredStatus = clinpredVal !== null ? (clinpredVal >= 0.5 ? "path" : "benign") : "none";
                rows.push(renderRow("clinpred", "ClinPred", clinpredVal, clinpredVal?.toFixed(3) ?? "—", "< 0.50", ">= 0.50", "PP3 / BP4", clinpredStatus, clinpredStatus === "path" ? "Deleterious" : "Tolerated"));

                const eigenStatus = eigenVal !== null ? (eigenVal >= 4.0 ? "path" : "benign") : "none";
                rows.push(renderRow("eigen", "Eigen PHRED", eigenVal, eigenVal?.toFixed(1) ?? "—", "< 4.0", ">= 4.0", "PP3 / BP4", eigenStatus, eigenStatus === "path" ? "Pathogenic" : "Benign"));

                const dannStatus = dannVal !== null ? (dannVal >= 0.96 ? "path" : dannVal <= 0.5 ? "benign" : "vus") : "none";
                rows.push(renderRow("dann", "DANN", dannVal, dannVal?.toFixed(3) ?? "—", "<= 0.50", ">= 0.96", "PP3 / BP4", dannStatus, dannStatus === "path" ? "Pathogenic" : dannStatus === "benign" ? "Benign" : "Moderate"));

                const popeveStatus = popeveVal !== null ? (popeveVal < 0 ? (popeveVal <= -4.617 ? "path_strong" : popeveVal <= -2.0 ? "path" : popeveVal >= -1.0 ? "benign" : "vus") : (popeveVal >= 0.75 ? "path_strong" : popeveVal <= 0.25 ? "benign" : "vus")) : "none";
                rows.push(renderRow("popeve", "popEVE", popeveVal, popeveVal?.toFixed(3) ?? "—", "<= 0.25 (LLR >= -1.0)", ">= 0.75 (LLR <= -4.617 severe)", "PP3 / BP4", popeveStatus, popeveStatus === "path_strong" ? "Severe Path." : popeveStatus === "path" ? "Pathogenic" : popeveStatus === "benign" ? "Benign" : "VUS"));

                const esmStatus = esmVal !== null ? (esmVal <= -5.0 ? "path" : esmVal >= -2.0 ? "benign" : "vus") : "none";
                rows.push(renderRow("esm", "ESM-1b", esmVal, esmVal?.toFixed(2) ?? "—", ">= -2.0", "<= -5.0", "Info / -", esmStatus, esmStatus === "path" ? "Deleterious" : esmStatus === "benign" ? "Tolerated" : "Neutral"));

                const vesmStatus = vesmVal !== null ? (vesmVal <= -5.0 ? "path" : vesmVal >= -2.0 ? "benign" : "vus") : "none";
                rows.push(renderRow("vesm", "VESM-150M", vesmVal, vesmVal?.toFixed(2) ?? "—", ">= -2.0", "<= -5.0", "Info / -", vesmStatus, vesmStatus === "path" ? "Deleterious" : vesmStatus === "benign" ? "Tolerated" : "Neutral"));

                // --- CATEGORY 2: Biophysical & Structural Energetics ---
                rows.push(renderCategoryHeader("cat-biophys", "2. Biophysical & Structural Energetics"));

                const foldxStatus = foldxVal !== null ? (foldxVal > 1.5 ? "path_strong" : foldxVal > 0.5 ? "path" : foldxVal >= -0.5 ? "benign" : "neutral") : "none";
                rows.push(renderRow("foldx", "FoldX ΔΔG", foldxVal, foldxVal ? `${foldxVal.toFixed(2)} kcal/mol` : "—", "-0.5 to +0.5", "> 0.50 (severe > 1.50)", "PM1 / BP3", foldxStatus, foldxStatus === "path_strong" ? "Severe Destab." : foldxStatus === "path" ? "Destab." : foldxStatus === "benign" ? "Neutral" : "Stabilizing"));

                const dynamut2Status = dynamut2Val !== null ? (dynamut2Val <= -1.0 ? "path" : "benign") : "none";
                rows.push(renderRow("dynamut2", "DynaMut2 ΔΔG", dynamut2Val, dynamut2Val ? `${dynamut2Val.toFixed(2)} kcal/mol` : "—", "> -1.0", "<= -1.0 kcal/mol", "PM1 / BP3", dynamut2Status, dynamut2Status === "path" ? "Destabilizing" : "Neutral"));

                const ddmutStatus = ddmutVal !== null ? (ddmutVal <= -1.0 ? "path" : "benign") : "none";
                rows.push(renderRow("ddmut", "DDMut ΔΔG", ddmutVal, ddmutVal ? `${ddmutVal.toFixed(2)} kcal/mol` : "—", "> -1.0", "<= -1.0 kcal/mol", "PM1 / BP3", ddmutStatus, ddmutStatus === "path" ? "Destabilizing" : "Neutral"));

                const raspStatus = raspVal !== null ? (raspVal > 0.5 ? "path" : "benign") : "none";
                rows.push(renderRow("rasp", "RaSP ΔΔG", raspVal, raspVal ? `${raspVal.toFixed(2)} kcal/mol` : "—", "-0.5 to +0.5", "> 0.50 kcal/mol", "PM1 / BP3", raspStatus, raspStatus === "path" ? "Destabilizing" : "Neutral"));

                const thermompnnStatus = thermompnnVal !== null ? (thermompnnVal >= 1.0 ? "path" : "benign") : "none";
                rows.push(renderRow("thermompnn", "ThermoMPNN ΔΔG°", thermompnnVal, thermompnnVal ? `${thermompnnVal.toFixed(2)} kcal/mol` : "—", "< 1.00", ">= +1.00 kcal/mol", "PM1 / BP3", thermompnnStatus, thermompnnStatus === "path" ? "Destabilizing" : "Neutral"));

                // --- CATEGORY 3: Evolutionary Conservation & Population Intolerance ---
                rows.push(renderCategoryHeader("cat-cons", "3. Evolutionary Conservation & Population Intolerance"));

                const gerpStatus = gerpVal !== null ? (gerpVal >= 2.0 ? "path" : "benign") : "none";
                rows.push(renderRow("gerp", "GERP++ RS", gerpVal, gerpVal?.toFixed(2) ?? "—", "< 2.00", ">= 2.00 (conserved)", "PP3 / BP4", gerpStatus, gerpStatus === "path" ? "Conserved" : "Neutral"));

                const phylopStatus = phylopVal !== null ? (phylopVal >= 1.5 ? "path" : "benign") : "none";
                rows.push(renderRow("phylop", "phyloP 100-way", phylopVal, phylopVal?.toFixed(2) ?? "—", "< 1.50", ">= 1.50 (conserved)", "PP3 / BP4", phylopStatus, phylopStatus === "path" ? "Conserved" : "Variable"));

                const misZStatus = misZVal !== null ? (misZVal >= 3.09 ? "path_strong" : misZVal >= 2.0 ? "path" : "benign") : "none";
                rows.push(renderRow("misZ", "gnomAD Missense Z", misZVal, misZVal?.toFixed(2) ?? "—", "< 2.00", ">= 2.00 (strong >= 3.09)", "PP2 / BP1", misZStatus, misZStatus === "path_strong" ? "Depleted (Strong)" : misZStatus === "path" ? "Constrained" : "Unconstrained"));

                const loeufStatus = loeufVal !== null ? (loeufVal < 0.35 ? "path_strong" : loeufVal < 0.60 ? "path" : "benign") : "none";
                rows.push(renderRow("loeuf", "gnomAD LOEUF", loeufVal, loeufVal?.toFixed(2) ?? "—", ">= 0.60", "< 0.35 (mod < 0.60)", "PP2 / BP1", loeufStatus, loeufStatus === "path_strong" ? "Severe Intolerant" : loeufStatus === "path" ? "Mod. Intolerant" : "Tolerated"));

                return rows;
              })()}
            </tbody>
          </table>
        </div>
      </div>

      <div className="p-3 rounded-lg border text-[12px] font-sans leading-relaxed shadow-sm" style={{ background: "var(--cs-surface-2)", borderColor: "var(--cs-border)", color: "var(--cs-text-secondary)" }}>
        <h5 className="font-bold text-[11px] font-medium uppercase tracking-wider mb-1" style={{ color: "var(--cs-text-primary)" }}>ACMG/AMP Evidence Codes Key:</h5>
        <ul className="list-disc pl-4 space-y-1">
          <li><strong className="font-mono" style={{ color: "var(--cs-accent-clay)" }}>PP3 (Pathogenic Supporting)</strong> / <strong className="font-mono" style={{ color: "var(--cs-accent-clay)" }}>BP4 (Benign Supporting)</strong>: Computational algorithms predict a deleterious/neutral effect on the protein.</li>
          <li><strong className="font-mono" style={{ color: "var(--cs-accent-clay)" }}>PM1 (Pathogenic Moderate)</strong>: Mutational hot-spot or critical functional domain (e.g. binding pocket interface) without benign variation.</li>
          <li><strong className="font-mono" style={{ color: "var(--cs-accent-clay)" }}>BP3 (Benign Supporting)</strong>: In-frame deletion/insertion in a repetitive region, or structurally neutral substitution.</li>
        </ul>
      </div>
    </div>
  );
}
