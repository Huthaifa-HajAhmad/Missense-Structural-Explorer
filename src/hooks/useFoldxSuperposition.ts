import { useEffect, useRef } from "react";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { IDLE_FOLDX_REFERENCE, type FoldxReferenceState } from "../stores/slices/biophysicalSlice";
import { identifyAlphaFoldHeader, readResidueAt } from "../shared/coordinateText";
import type { StructureProvenance } from "../shared/contracts";

/**
 * Pairs the FoldX variant with the structure FoldX built it on, and superposes the two.
 *
 * WHY THIS EXISTS
 * ---------------
 * The AlphaFold view draws the AlphaFold DB model as the wild type, but `/generate-mutant` builds
 * the variant on whatever `resolveStructure` picks — for NAE1 p.Asp116Gly, crystal structure 1YOV
 * chain A. The previous code aligned the FoldX variant to the AlphaFold model (when it ran at all:
 * its effect was dead, so the viewer overlaid the raw, unaligned variant). Every RMSD, contact and
 * surface difference then described AlphaFold-versus-crystal, not the substitution.
 *
 * The reference is fetched from the same resolver FoldX used and checked against the template FoldX
 * reported (entry and chain). If they differ — the resolver's memo expired and chose another tier —
 * the pair is declared unavailable with that reason rather than built on the wrong structure.
 */

type Reference = { pdb: string; provenance: StructureProvenance } | { reason: string };

function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();
}

async function resolveReference(args: {
  apiClient: any;
  template: StructureProvenance;
  uniprotId: string | null;
  position: number;
  pdbText: string | null;
  pdbTextProvenance: StructureProvenance | null;
  signal: AbortSignal;
}): Promise<Reference> {
  const { apiClient, template, uniprotId, position, pdbText, pdbTextProvenance, signal } = args;

  if (template.source === "alphafold") {
    const textIsAlphaFold = pdbTextProvenance?.source === "alphafold" || (!pdbTextProvenance && !!identifyAlphaFoldHeader(pdbText));
    if (pdbText && textIsAlphaFold) {
      return { pdb: pdbText, provenance: pdbTextProvenance ?? { source: "alphafold" } };
    }
    if (!uniprotId) return { reason: "The UniProt accession is not known, so the AlphaFold template cannot be fetched." };
    const fetched = await apiClient.getAlphaFoldPdbWithProvenance(uniprotId, signal);
    return { pdb: fetched.pdbText, provenance: fetched.provenance ?? { source: "alphafold" } };
  }

  if (template.source === "experimental" || template.source === "homolog") {
    if (!uniprotId) return { reason: "The UniProt accession is not known, so FoldX's template cannot be fetched." };
    const fetched = await apiClient.getPdbWithProvenance(uniprotId, position, signal);
    const got = fetched?.provenance as StructureProvenance | undefined;
    const want = `PDB ${String(template.pdbId ?? "?").toUpperCase()}${template.chainId ? ` chain ${template.chainId}` : ""}`;
    if (!got || got.source !== template.source || !sameId(got.pdbId, template.pdbId) || (template.chainId && got.chainId && !sameId(got.chainId, template.chainId))) {
      const gotName = got?.pdbId ? `PDB ${got.pdbId.toUpperCase()}${got.chainId ? ` chain ${got.chainId}` : ""}` : got?.source === "alphafold" ? "the AlphaFold model" : "a different structure";
      return { reason: `The server now resolves ${gotName} for this position, not ${want} that FoldX used, so the pair cannot be rebuilt.` };
    }
    return { pdb: fetched.pdbText, provenance: got };
  }

  if (template.source === "client-provided" && pdbText) {
    return { pdb: pdbText, provenance: template };
  }

  return { reason: "FoldX did not report which structure it built on." };
}

export function useFoldxSuperposition(apiClient: any): void {
  /**
   * Held in a ref: `useApiClient` rebuilds the client whenever ANY setting changes, and a dependency
   * on it would refetch the template and re-superpose on every settings toggle.
   */
  const apiClientRef = useRef(apiClient);
  apiClientRef.current = apiClient;
  const foldingStatus = useVariantAnalysisStore(s => s.foldingStatus);
  const mutantPdb = useVariantAnalysisStore(s => s.mutantPdb);
  const foldedResidueIndex = useVariantAnalysisStore(s => s.foldedResidueIndex);
  const templateSource = useVariantAnalysisStore(s => s.foldingEnergetics?.structureProvenance?.source ?? null);
  const templatePdbId = useVariantAnalysisStore(s => s.foldingEnergetics?.structureProvenance?.pdbId ?? null);
  const templateChain = useVariantAnalysisStore(s => s.foldingEnergetics?.structureProvenance?.chainId ?? null);
  const pdbText = useVariantAnalysisStore(s => s.pdbText);
  const pdbTextSource = useVariantAnalysisStore(s => s.pdbTextProvenance?.source ?? null);
  const uniprotId = useVariantAnalysisStore(s => s.uniprotId || s.analysisState?.result?.metadata?.uniprotId || null);
  const residueIndex = useVariantAnalysisStore(s => s.analysisState?.result?.metadata?.residueIndex ?? null);

  useEffect(() => {
    const store = useVariantAnalysisStore.getState();
    const settle = (reference: FoldxReferenceState) => {
      store.setFoldxReference(reference, null);
      store.setFoldxAlignedPdb(null);
      store.setFoldxMetrics(null);
      store.setStructuralDiff(null);
    };

    if (foldingStatus !== "success" || !mutantPdb) {
      settle(IDLE_FOLDX_REFERENCE);
      return;
    }
    const template = store.foldingEnergetics?.structureProvenance ?? null;
    const position = foldedResidueIndex ?? residueIndex;
    if (!template?.source) {
      settle({ state: "unavailable", reason: "FoldX did not report which structure it built on.", provenance: null });
      return;
    }
    if (!position) {
      settle({ state: "unavailable", reason: "The variant's position is not known.", provenance: template });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    store.setFoldxReference({ state: "loading", reason: null, provenance: template }, null);
    store.setFoldxAlignedPdb(null);

    (async () => {
      try {
        const apiClient = apiClientRef.current;
        const reference = await resolveReference({
          apiClient,
          template,
          uniprotId,
          position,
          pdbText: store.pdbText,
          pdbTextProvenance: store.pdbTextProvenance,
          signal: controller.signal,
        });
        if (cancelled) return;
        if ("reason" in reference) {
          settle({ state: "unavailable", reason: reference.reason, provenance: template });
          return;
        }
        if (!readResidueAt(reference.pdb, position, template.chainId)) {
          settle({ state: "unavailable", reason: `Residue ${position} is not in FoldX's template, so the pair cannot be superposed there.`, provenance: template });
          return;
        }
        const [diff, align] = await Promise.all([
          apiClient.getStructuralDiff({ wtPdb: reference.pdb, mutPdb: mutantPdb, pos: position, chain: template.chainId || "A" }, controller.signal),
          apiClient.structuralAlign({ pdb1: reference.pdb, pdb2: mutantPdb, targetIndex: position, alignmentScope: "global" }, controller.signal),
        ]);
        if (cancelled) return;
        store.setFoldxReference({ state: "ready", reason: null, provenance: reference.provenance }, reference.pdb);
        store.setFoldxAlignedPdb(align.alignedPdb ?? null);
        store.setFoldxMetrics(align.metrics ?? null);
        /**
         * Mirrored for the Perturbation tab's collision and Cα rows, which read the store's
         * `structuralDiff`. Against the right template the Cα terms come out as FoldX's fixed
         * backbone makes them — zero — which that tab reads as "rigid backbone".
         */
        store.setStructuralDiff(diff ?? null);
      } catch (err: any) {
        if (cancelled || controller.signal.aborted) return;
        settle({
          state: "unavailable",
          reason: `The superposition could not be computed: ${err?.message || String(err)}`,
          provenance: template,
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    foldingStatus,
    mutantPdb,
    foldedResidueIndex,
    residueIndex,
    templateSource,
    templatePdbId,
    templateChain,
    pdbText,
    pdbTextSource,
    uniprotId,
  ]);
}
