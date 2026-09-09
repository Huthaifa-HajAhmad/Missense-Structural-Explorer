/**
 * server/services/ppi.ts
 *
 * Protein-Protein Interaction (PPI) & Interface Binding Affinity Service.
 * - Resolves STRING-db functional interaction partners
 * - Maps UniProt curated interface residues
 * - Computes interface binding affinity shifts (ΔΔG_bind) via JapanFold OpenBind-0
 */
import { fetchStringInteractions, StringInteraction } from "./string.ts";
import { queryOpenBind, JapanFoldBindingResult } from "./japanfold-client.ts";
import { fetchUniprotFeatures } from "./uniprot.ts";

export interface PpiBindingAffinityResult {
  status: "success" | "unavailable" | "failed";
  gene: string;
  variant: string;
  uniprotId?: string;
  stringPartners: StringInteraction[];
  bindingShift: {
    ddgBind: number | null;
    unit: string;
    classification: "INTERFACE_DISRUPTIVE" | "ALLOSTERIC_PERTURBATION" | "SURFACE_NEUTRAL" | "UNKNOWN";
    provenance: string;
  } | null;
  interfaceResidues: Array<{
    pos: number;
    description: string;
    isVariantPosition: boolean;
  }>;
  error?: string;
}

import { parseMutationParam } from "../utils/mutation.ts";

export async function analyzePpiBinding(
  gene: string,
  variant: string,
  uniprotId?: string,
  wtPdb?: string | null,
  mutPdb?: string | null,
  chainA: string = "A",
  chainB: string = "B",
  signal?: AbortSignal
): Promise<PpiBindingAffinityResult> {
  // 1. Fetch STRING partners
  const stringPartners = await fetchStringInteractions(gene);

  // 2. Parse variant position
  let pos = 0;
  const parsedMut = parseMutationParam(variant);
  if (parsedMut && parsedMut.posNum) {
    pos = parsedMut.posNum;
  }

  // 3. Extract curated interface annotations from UniProt if uniprotId available
  const interfaceResidues: Array<{
    pos: number;
    description: string;
    isVariantPosition: boolean;
  }> = [];

  if (uniprotId) {
    try {
      const featuresResult = await fetchUniprotFeatures(uniprotId);
      if (featuresResult?.features) {
        for (const feat of featuresResult.features) {
          const typeLower = (feat.type || "").toLowerCase();
          const descLower = (feat.description || "").toLowerCase();

          // Exclude catalytic active sites, metal coordination, and generic structural regions
          const isExcluded =
            typeLower.includes("active site") ||
            typeLower.includes("metal binding") ||
            typeLower === "site" ||
            typeLower === "region";

          // Strictly match quaternary / PPI subunit interface annotations
          const isInterface =
            !isExcluded &&
            (descLower.includes("interface") ||
              descLower.includes("subunit") ||
              descLower.includes("inter-chain") ||
              descLower.includes("complex interaction") ||
              (typeLower === "binding site" && (descLower.includes("chain") || descLower.includes("hetero") || descLower.includes("homo"))));

          if (isInterface) {
            const matchesVariant = pos >= feat.start && pos <= feat.end;
            if (matchesVariant || interfaceResidues.length < 5) {
              interfaceResidues.push({
                pos: feat.start,
                description: feat.description || feat.type,
                isVariantPosition: matchesVariant
              });
            }
          }
        }
      }
    } catch (err: any) {
      console.warn(`[PPI Service] Failed to fetch UniProt features for ${uniprotId}:`, err.message);
    }
  }

  // 4. Query OpenBind-0 if distinct dual-chain complexes are provided
  let bindingShift: PpiBindingAffinityResult["bindingShift"] = null;

  if (wtPdb && mutPdb && chainA.toUpperCase() !== chainB.toUpperCase()) {
    try {
      const openBindResult = await queryOpenBind(wtPdb, mutPdb, chainA, chainB, signal);
      if (openBindResult && openBindResult.status === "success") {
        bindingShift = {
          ddgBind: openBindResult.ddgBind,
          unit: openBindResult.unit,
          classification: openBindResult.classification,
          provenance: openBindResult.provenance
        };
      }
    } catch (err: any) {
      console.warn(`[PPI Service] OpenBind-0 evaluation error: ${err.message}`);
    }
  }

  return {
    status: "success",
    gene,
    variant,
    uniprotId,
    stringPartners,
    bindingShift,
    interfaceResidues
  };
}
