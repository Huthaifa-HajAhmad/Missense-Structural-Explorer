import { useMemo } from "react";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { PDB_SOURCE_RCSB } from "../shared/contracts";
import { describeFoldxPhase } from "../shared/foldxPhase";
import { identifyAlphaFoldHeader, readResidueAt, scanBFactors } from "../shared/coordinateText";
import {
  buildStructure3dEvidence,
  type ModelFamily,
  type Structure3dEvidence,
  type Structure3dInput,
} from "../shared/structure3dEvidence";

/**
 * The one place the 3D view's model is assembled from the store.
 *
 * The viewer (toolbar, canvas legend, overlays), `AppViews` (which coordinates to hand the canvas) and
 * the inspector rail all call this hook, so they read one model built from one set of inputs. Before,
 * the toolbar read the store's last-written provenance, the inspector read the analysis metadata and
 * the canvas guessed from B-factor values — three answers to "what is on screen".
 *
 * Scans of the PDB texts are memoised on the text itself; they re-run only when coordinates change.
 */
export function useStructure3dEvidence(familyOverride?: ModelFamily): Structure3dEvidence {
  const active3dModelTab = useVariantAnalysisStore(s => s.active3dModelTab);
  const family: ModelFamily = familyOverride ?? (active3dModelTab === "alphafold2" ? "alphafold" : "esmfold");

  const viewMode = useVariantAnalysisStore(s => s.viewMode);
  const representation = useVariantAnalysisStore(s => s.structureRepresentation);
  const esmAlignmentScope = useVariantAnalysisStore(s => s.esmAlignmentScope);
  const selectedResidueIndex = useVariantAnalysisStore(s => s.selectedResidueIndex);

  const metadata = useVariantAnalysisStore(s => s.analysisState?.result?.metadata);
  const uniprotFromSearch = useVariantAnalysisStore(s => s.uniprotId);
  const gene = useVariantAnalysisStore(s => s.gene);
  const disruption = useVariantAnalysisStore(s => s.analysisState?.result?.disruptionPredictor ?? null);
  const features = useVariantAnalysisStore(s => s.analysisState?.result?.uniprotFeatures?.features ?? null);
  const esm3Eval = useVariantAnalysisStore(s => s.analysisState?.result?.esm3Eval ?? null);

  const pdbText = useVariantAnalysisStore(s => s.pdbText);
  const pdbTextProvenance = useVariantAnalysisStore(s => s.pdbTextProvenance);
  const customPdbUrl = useVariantAnalysisStore(s => s.customPdbUrl);
  const customPdbEntryRaw = useVariantAnalysisStore(s => s.customPdbEntry);
  // Only the entry fetched for the URL now selected; a previous selection's text is stale.
  const customPdbEntry = customPdbUrl && customPdbEntryRaw?.url === customPdbUrl ? customPdbEntryRaw : null;
  const customPdbText = customPdbEntry?.text ?? null;
  const entryMeta = useMemo(
    () => (customPdbEntry ? { numbering: customPdbEntry.numbering, chainId: customPdbEntry.chainId, mapping: customPdbEntry.mapping, reason: customPdbEntry.reason } : null),
    [customPdbEntry]
  );
  const homologs = useVariantAnalysisStore(s => s.homologs);
  const homologsLoading = useVariantAnalysisStore(s => s.isHomologsLoading);

  const isFolding = useVariantAnalysisStore(s => s.isFolding);
  const foldingProgress = useVariantAnalysisStore(s => s.foldingProgress);
  const foldingStatus = useVariantAnalysisStore(s => s.foldingStatus);
  const foldingError = useVariantAnalysisStore(s => s.foldingError);
  const foldingDdG = useVariantAnalysisStore(s => s.foldingDdG);
  const foldingEnergetics = useVariantAnalysisStore(s => s.foldingEnergetics);
  const foldxReference = useVariantAnalysisStore(s => s.foldxReference);
  const foldxReferencePdb = useVariantAnalysisStore(s => s.foldxReferencePdb);
  const foldxAlignedPdb = useVariantAnalysisStore(s => s.foldxAlignedPdb);
  const foldxMetrics = useVariantAnalysisStore(s => s.foldxMetrics);

  const isEsmFolding = useVariantAnalysisStore(s => s.isEsmFolding);
  const esmFoldingError = useVariantAnalysisStore(s => s.esmFoldingError);
  const esmFoldWtPdb = useVariantAnalysisStore(s => s.esmFoldWtPdb);
  const esmFoldMutPdb = useVariantAnalysisStore(s => s.esmFoldMutPdb);
  const esmFoldAlignedPdb = useVariantAnalysisStore(s => s.esmFoldAlignedPdb);
  const esmFoldMetrics = useVariantAnalysisStore(s => s.esmFoldMetrics);
  const esmFoldEngines = useVariantAnalysisStore(s => s.esmFoldEngines);
  const esmFoldSingleStructure = useVariantAnalysisStore(s => s.esmFoldSingleStructure);

  const position = metadata?.residueIndex ?? null;
  const templateChain = foldingEnergetics?.structureProvenance?.chainId ?? null;

  const wildTypeText = customPdbUrl ? customPdbText : pdbText;
  const wildTypeScan = useMemo(() => scanBFactors(wildTypeText), [wildTypeText]);
  const wildTypeSite = useMemo(() => readResidueAt(wildTypeText, position), [wildTypeText, position]);
  const headerSaysAlphaFold = useMemo(() => identifyAlphaFoldHeader(pdbText), [pdbText]);
  const referenceSite = useMemo(() => readResidueAt(foldxReferencePdb, position, templateChain), [foldxReferencePdb, position, templateChain]);
  const deNovoScan = useMemo(() => scanBFactors(esmFoldWtPdb), [esmFoldWtPdb]);
  const deNovoSite = useMemo(() => readResidueAt(esmFoldWtPdb, position), [esmFoldWtPdb, position]);

  const region = useMemo(() => {
    if (!position || !Array.isArray(features)) return null;
    const hit = features.find(
      (f: any) => position >= f.start && position <= f.end && ["DOMAIN", "REGION", "BINDING", "ACT_SITE"].includes(f.type)
    );
    return hit ? `${hit.description || hit.type} (${hit.start}–${hit.end})` : null;
  }, [features, position]);

  return useMemo(() => {
    const disruptionStructure =
      metadata?.pdbSource === PDB_SOURCE_RCSB && metadata?.pdbId ? `PDB ${metadata.pdbId}` : "the AlphaFold model";
    const esm3 = esm3Eval
      ? "error" in (esm3Eval as any)
        ? { scoreCount: null, error: String((esm3Eval as any).error ?? "ESM3 failed") }
        : { scoreCount: Array.isArray((esm3Eval as any).perturbationScores) ? (esm3Eval as any).perturbationScores.length : null, error: null }
      : null;

    const input: Structure3dInput = {
      family,
      viewMode,
      representation,
      variant: {
        position,
        wildType: metadata?.wildType ?? null,
        mutant: metadata?.mutant ?? null,
        uniprotId: metadata?.uniprotId || uniprotFromSearch || null,
        gene: gene || null,
      },
      selectedResidue: selectedResidueIndex ?? null,
      wildType: {
        provenance: pdbTextProvenance,
        headerSaysAlphaFold,
        customPdbUrl,
        entry: entryMeta,
        scan: wildTypeScan,
        site: wildTypeSite,
      },
      foldx: {
        running: isFolding,
        phaseLabel: describeFoldxPhase(foldingProgress?.phase)?.label ?? null,
        status: (foldingStatus as "success" | "failed" | "unavailable" | null) ?? null,
        error: foldingError ?? null,
        ddG: typeof foldingDdG === "number" ? foldingDdG : null,
        ddGSd: typeof foldingEnergetics?.foldxSd === "number" ? foldingEnergetics.foldxSd : null,
        runs: typeof foldingEnergetics?.structureProvenance?.foldxRuns === "number"
          ? foldingEnergetics.structureProvenance.foldxRuns
          : Array.isArray(foldingEnergetics?.rawDdGs) && foldingEnergetics!.rawDdGs!.length > 0
            ? foldingEnergetics!.rawDdGs!.length
            : null,
        template: foldingEnergetics?.structureProvenance ?? null,
        repairSkipped: Boolean(foldingEnergetics?.foldxRepairSkipped),
        repairSkippedReason: foldingEnergetics?.foldxRepairSkippedReason ?? null,
        repairFailed: Boolean(foldingEnergetics?.foldxRepairFailed),
        reference: foldxReference,
        aligned: Boolean(foldxAlignedPdb && foldxReferencePdb),
        referenceSite,
      },
      deNovo: {
        folding: isEsmFolding,
        error: esmFoldingError ?? null,
        wildTypeLoaded: Boolean(esmFoldWtPdb),
        variantLoaded: Boolean(esmFoldMutPdb),
        singleStructure: esmFoldSingleStructure,
        engines: esmFoldEngines,
        scan: deNovoScan,
        aligned: Boolean(esmFoldAlignedPdb && esmFoldMutPdb),
        site: deNovoSite,
      },
      alignmentScope: esmAlignmentScope,
      metrics: family === "alphafold" ? (foldxMetrics as any) : (esmFoldMetrics as any),
      esm3,
      region,
      burial: disruption
        ? {
            rsa: typeof disruption.rsa === "number" ? disruption.rsa : null,
            label: disruption.burialStatus
              ? disruption.burialStatus === "core"
                ? "Buried"
                : disruption.burialStatus === "surface"
                  ? "Exposed"
                  : "Intermediate"
              : null,
            structure: disruptionStructure,
          }
        : null,
      homologs: homologs as any,
      homologsLoading,
    };
    return buildStructure3dEvidence(input);
  }, [
    family, viewMode, representation, esmAlignmentScope, selectedResidueIndex, metadata, uniprotFromSearch, gene,
    disruption, esm3Eval, pdbTextProvenance, headerSaysAlphaFold, customPdbUrl, entryMeta, wildTypeScan, wildTypeSite,
    isFolding, foldingProgress, foldingStatus, foldingError, foldingDdG, foldingEnergetics, foldxReference,
    foldxAlignedPdb, foldxReferencePdb, referenceSite, isEsmFolding, esmFoldingError, esmFoldWtPdb, esmFoldMutPdb,
    esmFoldSingleStructure, esmFoldEngines, deNovoScan, esmFoldAlignedPdb, deNovoSite, foldxMetrics, esmFoldMetrics,
    region, homologs, homologsLoading, position,
  ]);
}
