/**
 * server/services/ppi.ts
 *
 * Protein-Protein Interaction (PPI) & Interface Binding Affinity Service.
 * - Resolves STRING-db functional interaction partners
 * - Maps UniProt curated interface residues
 * - Computes interface binding affinity shifts (ΔΔG_bind) via JapanFold OpenBind-0
 */
import { fetchStringInteractionsWithStatus, StringInteraction } from "./string.ts";
import { queryOpenBind, JapanFoldBindingResult } from "./japanfold-client.ts";
import { fetchUniprotFeatures } from "./uniprot.ts";

/** How one upstream lookup for a PPI section ended. */
export type PpiLookupStatus = "ok" | "failed" | "skipped";

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
  /**
   * Outcome of each independent lookup, so a consumer can tell an empty answer
   * from no answer at all.
   *
   * Both sections used to return an empty array for every non-answer: the STRING
   * fetcher caught its own error and returned `[]`, and a UniProt request that
   * failed returned `null` from inside a `try` that only logged. The PPI tab
   * rendered those as "no association for this gene" and "no residue-level
   * interface annotation is recorded" — claims about the protein, made on the
   * strength of a failed HTTP call. `skipped` is the third case the tab could not
   * see either: no UniProt id was resolved, so nothing was ever asked.
   */
  lookups: {
    stringPartners: Exclude<PpiLookupStatus, "skipped">;
    interfaceResidues: PpiLookupStatus;
  };
  error?: string;
}

import { parseMutationParam } from "../../utils/mutation.ts";

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
  // 1. Fetch STRING partners, keeping the lookup's outcome
  let stringPartners: StringInteraction[] = [];
  let stringLookup: "ok" | "failed" = "failed";
  try {
    const stringResult = await fetchStringInteractionsWithStatus(gene);
    stringPartners = stringResult.partners;
    stringLookup = stringResult.status;
  } catch (err: any) {
    console.warn(`[PPI Service] STRING lookup threw for ${gene}:`, err?.message);
  }

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

  // "skipped" means no id was resolved, so nothing could be asked — which is a
  // different statement from "UniProt has nothing annotated here".
  let interfaceLookup: PpiLookupStatus = "skipped";

  if (uniprotId) {
    // Assume failure until an answer arrives. `fetchUniprotFeatures` returns null
    // (rather than throwing) on a non-OK response, and a null result is never
    // cached, so a null return reliably means the lookup did not happen.
    interfaceLookup = "failed";
    try {
      const featuresResult = await fetchUniprotFeatures(uniprotId);
      if (featuresResult) {
        interfaceLookup = "ok";
        for (const feat of featuresResult.features ?? []) {
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
    interfaceResidues,
    lookups: {
      stringPartners: stringLookup,
      interfaceResidues: interfaceLookup
    }
  };
}
