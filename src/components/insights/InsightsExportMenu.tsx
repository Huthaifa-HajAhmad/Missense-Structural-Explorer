import React from "react";
import { CheckCircle2, ChevronDown, Copy, Download } from "lucide-react";
import { generateProvenanceManifest } from "../../shared/provenance";
import { buildExportVerdictContext, deriveConsensus } from "../../lib/insightsConsensus";
import { downloadBlob } from "../../lib/download";
import { toCanonicalDdg } from "../../shared/engineStatus";
import { useFoldxRunState } from "../../hooks/useFoldxRunState";
import type { AnalysisState, UserSettings } from "../../types";

/**
 * The Insights title row's export menu: the provenance manifest, the full JSON payload and the
 * Markdown report. It sits beside the guide link so the verdict is the first thing under the title.
 * The menu stays one labelled group of plain buttons, locked while the analysis is still loading.
 */
interface Props {
  analysisState: AnalysisState;
  gene: string;
  variant: string;
  uniprotId: string;
  settings: UserSettings;
  foldingEnergetics?: any;
  foldingDdG?: number | null;
  disruptionPredictor?: any;
  handleCopyReport: () => void | Promise<void>;
  copied: boolean;
}

export function InsightsExportMenu({ analysisState, gene, variant, uniprotId, settings, foldingEnergetics, foldingDdG, disruptionPredictor, handleCopyReport, copied }: Props) {
  const { isFolding, foldingStatus } = useFoldxRunState();

  const handleExportJSON = () => {
    if (!analysisState.result) return;

    /**
     * ONE derived consensus for the whole export.
     *
     * The three consensus fields used to come from three separate calls, and the interval bounds were
     * not derived at all — they were read from the stored snapshot. The result was a report whose
     * interval did not contain its own point estimate: measured on screen as 80.6% with 68.1-89.1,
     * exported as 80.6% with 2.1-11.3, because the stored snapshot came from an earlier two-engine
     * commit. A derived value beside a stored one is the same defect class this export already fixed for
     * the verdict itself.
     */
    const derivedConsensus = deriveConsensus({
      result: analysisState.result,
      foldingEnergetics,
      foldingDdG,
      plddt: disruptionPredictor?.plddt,
      isFolding,
      foldingStatus
    });

    const exportData = {
      metadata: {
        gene: gene,
        variant: variant,
        uniprotId: uniprotId || analysisState.result.metadata?.uniprotId || "",
        timestamp: new Date().toISOString(),
        // Model and version strings were literals here ("DynaMut2", "RaSP Precomputed",
        // appVersion "1.0.0") that named engines regardless of what ran. Only what the
        // payload records is exported.
        narrativeModel: (analysisState.result.insights as { model?: string } | undefined)?.model ?? null
      },
      inputParameters: {
        gene,
        variant,
        uniprotId,
        acmgWeighting: settings.acmgWeighting
      },
      databaseResults: {
        clinvar: analysisState.result.clinvar || null,
        gnomad: {
          frequency: analysisState.result.gnomadFrequency || null,
          constraint: analysisState.result.gnomadConstraint || null
        },
        predictors: analysisState.result.predictorData || null,
        conservation: analysisState.result.conservationData || null,
        uniprotFeatures: analysisState.result.uniprotFeatures || null
      },
      biophysicalEnergetics: {
        foldx: {
          ddG: foldingEnergetics?.foldx ?? analysisState.result.foldingEnergetics?.foldx ?? foldingDdG ?? null,
          mean: foldingEnergetics?.foldxMean ?? analysisState.result.foldingEnergetics?.foldxMean ?? foldingDdG ?? null,
          sd: foldingEnergetics?.foldxSd ?? analysisState.result.foldingEnergetics?.foldxSd ?? null,
          vdwClashDelta: foldingEnergetics?.vdw ?? null,
          electrostatics: foldingEnergetics?.electrostatics ?? null,
          stericClashWarning: foldingEnergetics?.stericClashWarning ?? false,
          sidechainRmsd: foldingEnergetics?.localSidechainRmsd ?? null
        },
        rasp: foldingEnergetics?.rasp ?? analysisState.result.rasp ?? null,
        thermompnn: foldingEnergetics?.thermompnn ?? analysisState.result.thermompnn ?? null,
        stabilityoracle: foldingEnergetics?.stabilityoracle ?? analysisState.result.foldingEnergetics?.stabilityoracle ?? null,
        // Derived, not read from the snapshot: see `deriveConsensus`.
        consensusStabilityVerdict:
          derivedConsensus?.consensusVerdict ?? foldingEnergetics?.consensusVerdict ?? null,
        // The JSON export carries the caveat too, so a downstream reader of the report knows the
        // verdict can still move. This replaced the " (Preliminary - pending: …)" suffix.
        // From the stored field, as the manifest does — the derivation was reverted, see
        // `buildExportVerdictContext`.
        consensusEvidenceComplete: foldingEnergetics?.evidenceComplete ?? null,
        consensusPendingTools: foldingEnergetics?.pendingTools ?? [],
        /**
         * The agreement behind the verdict, derived with it. This replaced `consensusProbability` and
         * `consensusConfMin/Max`, which came from hand-typed curves (`thresholds/consensus.ts`).
         */
        consensusEnginesCounted: derivedConsensus?.enginesCounted ?? null,
        consensusEnginesDestabilizing: derivedConsensus?.enginesDestabilizing ?? null,
        consensusMedianDdg: derivedConsensus?.medianDdg ?? null,
        /**
         * Every engine in ONE sign convention.
         */
        signConvention: "canonicalDdg: kcal/mol, positive = destabilizing for every engine",
        canonicalDdg: {
          foldx: toCanonicalDdg(
            "foldx",
            foldingEnergetics?.foldxMean ??
              foldingEnergetics?.foldx ??
              analysisState.result.foldingEnergetics?.foldxMean ??
              analysisState.result.foldingEnergetics?.foldx ??
              foldingDdG ??
              null
          ),
          rasp: toCanonicalDdg("rasp", foldingEnergetics?.rasp ?? analysisState.result.rasp ?? null),
          thermompnn: toCanonicalDdg("thermompnn", foldingEnergetics?.thermompnn ?? analysisState.result.thermompnn ?? null),
          stabilityoracle: toCanonicalDdg(
            "stabilityoracle",
            foldingEnergetics?.stabilityoracle ?? analysisState.result.foldingEnergetics?.stabilityoracle ?? null
          )
        }
      },
      acmgCriteriaSuggestions: {
        ruleBased: analysisState.result.ruleBasedInsights || null,
        aiGenerated: analysisState.result.insights || null
      }
    };

    const filename = `${gene}_${variant}_analysis_export.json`.replace(/\s+/g, "_");
    downloadBlob(filename, "application/json", JSON.stringify(exportData, null, 2));
  };

  const handleExportProvenanceJSON = () => {
    if (!analysisState.result) return;
    const manifest = generateProvenanceManifest(
      gene,
      variant,
      uniprotId || analysisState.result.metadata?.uniprotId || "",
      analysisState.result,
      settings,
      foldingEnergetics,
      // One call, inputs only — see `buildExportVerdictContext`.
      buildExportVerdictContext({
        result: analysisState.result,
        foldingEnergetics,
        foldingDdG,
        plddt: disruptionPredictor?.plddt,
        isFolding,
        foldingStatus
      })
    );
    const filename = `${gene}_${variant}_provenance_manifest.json`.replace(/\s+/g, "_");
    downloadBlob(filename, "application/json", JSON.stringify(manifest, null, 2));
  };

  const busy = analysisState.isLoading;
  // A click on a menu item closes the menu. The live region sits outside the menu, so "Copied" is still
  // announced after it closes (a closed <details> hides its content from screen readers).
  const closeAfter = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button:not(:disabled)")) event.currentTarget.closest("details")?.removeAttribute("open");
  };
  return (
    <>
    <details className="ins-export-menu">
      <summary className="ins-export ins-export-menu__toggle"><Download className="w-3.5 h-3.5" aria-hidden="true" /><span>Export</span><ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /></summary>
      <div className="ins-shell__exports" role="group" aria-label="Export and copy analysis" onClick={closeAfter}>
        <button type="button" onClick={handleExportProvenanceJSON} disabled={busy} className="ins-export"
          title="Export verifiable scientific provenance manifest (model hashes, data versions, and structure metadata)">
          <Download className="w-3.5 h-3.5" aria-hidden="true" /><span>Provenance Manifest</span>
        </button>
        <button type="button" onClick={handleExportJSON} disabled={busy} className="ins-export" title="Export structured analysis payload as JSON file">
          <Download className="w-3.5 h-3.5" aria-hidden="true" /><span>Export JSON</span>
        </button>
        <button type="button" onClick={handleCopyReport} disabled={busy} className="ins-export" title="Copy markdown report to clipboard">
          {copied
            ? <><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" style={{ color: "var(--cs-text-accent)" }} /><span className="font-semibold" style={{ color: "var(--cs-text-accent)" }}>Copied</span></>
            : <><Copy className="w-3.5 h-3.5" aria-hidden="true" /><span>Copy Report</span></>}
        </button>
      </div>
    </details>
    <span className="sr-only" aria-live="polite">{copied ? "Report copied to clipboard" : ""}</span>
    </>
  );
}
